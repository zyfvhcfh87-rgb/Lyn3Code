import {
  MemoryRetrievalRecordId,
  type AgentMemoryContextPackage,
  type AgentRunId,
  type IndexedChunk,
  type IndexedSource,
  type MemoryCitation,
  type MemoryEntry,
  type MemoryEntryStatus,
  type MemoryEntryType,
  type MemoryRetrievalMode,
  type MemoryRetrievalRecord,
  type MemorySearchInput,
  type MemorySearchResult,
  type MemorySelectionReason,
  type MemorySettings,
  type MemorySource,
  type MemorySourceType,
  type MemoryStaleBehavior,
  type MemoryTrustLevel,
  type MessageId,
  type RetrievedMemory,
  type RetrievedSourceExcerpt,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  EmbeddingProvider,
  type EmbeddingProviderMetadata,
  type EmbeddingProviderShape,
} from "./EmbeddingProvider.ts";
import { redactMemorySourceText } from "./MemorySourceSecurity.ts";

const DAY_MILLISECONDS = 86_400_000;
const MAX_QUERY_TERMS = 32;
const MAX_EXCERPT_CHARACTERS = 16_000;

export interface LexicalQuery {
  readonly normalized: string;
  readonly terms: ReadonlyArray<string>;
  readonly phrases: ReadonlyArray<string>;
  readonly ftsQuery: string;
}

export interface LexicalDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly path: string | null;
  readonly symbols: ReadonlyArray<string>;
}

export interface LexicalDocumentMatch {
  readonly id: string;
  readonly score: number;
  readonly matchedFields: ReadonlyArray<string>;
}

export interface MemoryRetrievalCandidate {
  readonly entry: MemoryEntry;
  readonly sources: ReadonlyArray<MemorySource>;
  readonly lexicalScore: number | null;
  readonly semanticScore: number | null;
  readonly matchedFields: ReadonlyArray<string>;
}

export interface SourceRetrievalCandidate {
  readonly chunk: IndexedChunk;
  readonly source: IndexedSource;
  readonly lexicalScore: number | null;
  readonly semanticScore: number | null;
  readonly matchedFields: ReadonlyArray<string>;
}

export interface MemoryCandidateSet {
  readonly memories: ReadonlyArray<MemoryRetrievalCandidate>;
  readonly chunks: ReadonlyArray<SourceRetrievalCandidate>;
}

export interface LexicalCandidateSet extends MemoryCandidateSet {
  readonly engine: "fts" | "fallback";
}

export interface MemoryLexicalSearchRequest {
  readonly input: MemorySearchInput;
  readonly query: LexicalQuery;
  readonly candidateLimit: number;
}

export interface MemorySemanticSearchRequest {
  readonly input: MemorySearchInput;
  readonly vector: ReadonlyArray<number>;
  readonly provider: EmbeddingProviderMetadata;
  readonly candidateLimit: number;
}

export class MemoryRetrievalError extends Schema.TaggedErrorClass<MemoryRetrievalError>()(
  "MemoryRetrievalError",
  {
    reason: Schema.Literals([
      "settings_unavailable",
      "lexical_search_failed",
      "semantic_search_failed",
      "audit_failed",
    ]),
    message: Schema.String,
  },
) {}

export interface MemoryRetrievalDataSourceShape {
  readonly getSettings: (
    projectId: MemorySearchInput["projectId"],
  ) => Effect.Effect<MemorySettings, MemoryRetrievalError>;
  readonly searchLexical: (
    request: MemoryLexicalSearchRequest,
  ) => Effect.Effect<LexicalCandidateSet, MemoryRetrievalError>;
  readonly searchSemantic: (
    request: MemorySemanticSearchRequest,
  ) => Effect.Effect<MemoryCandidateSet, MemoryRetrievalError>;
  readonly saveRetrievalRecord: (
    record: MemoryRetrievalRecord,
  ) => Effect.Effect<void, MemoryRetrievalError>;
}

export class MemoryRetrievalDataSource extends Context.Service<
  MemoryRetrievalDataSource,
  MemoryRetrievalDataSourceShape
>()("t3/memory/MemoryRetrieval/MemoryRetrievalDataSource") {}

export type MemoryRetrievalRequest = MemorySearchInput & {
  readonly agentRunId: AgentRunId | null;
  readonly threadId: ThreadId | null;
  readonly messageId: MessageId | null;
};

export interface MemoryRetrievalShape {
  readonly retrieve: (
    request: MemoryRetrievalRequest,
  ) => Effect.Effect<MemorySearchResult, MemoryRetrievalError>;
}

export class MemoryRetrieval extends Context.Service<MemoryRetrieval, MemoryRetrievalShape>()(
  "t3/memory/MemoryRetrieval",
) {}

const normalizeText = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

const normalizePath = (value: string) => normalizeText(value).replaceAll("\\", "/");

const uniqueInOrder = (values: ReadonlyArray<string>) => {
  const seen = new Set<string>();
  const unique: Array<string> = [];
  for (const value of values) {
    if (value.length > 0 && !seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }
  return unique;
};

const quoteFts = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Produces an operator-free FTS5 query. User input never becomes FTS syntax. */
export const buildLexicalQuery = (query: string): LexicalQuery => {
  const normalized = normalizeText(query);
  const phrases = uniqueInOrder(
    [...normalized.matchAll(/"([^"\r\n]+)"/g)]
      .map((match) => normalizeText(match[1] ?? ""))
      .filter((phrase) => phrase.length > 0),
  ).slice(0, MAX_QUERY_TERMS);
  const terms = uniqueInOrder(normalized.match(/[\p{L}\p{N}_./:-]+/gu) ?? []).slice(
    0,
    MAX_QUERY_TERMS,
  );
  const clauses = uniqueInOrder([
    ...phrases.map(quoteFts),
    ...terms.map((term) => `${quoteFts(term)}${term.length >= 3 ? "*" : ""}`),
  ]);
  return {
    normalized,
    phrases,
    terms,
    ftsQuery: clauses.join(" OR "),
  };
};

const countOccurrences = (haystack: string, needle: string) => {
  if (needle.length === 0) return 0;
  let count = 0;
  let position = 0;
  while (count < 8) {
    const found = haystack.indexOf(needle, position);
    if (found < 0) break;
    count += 1;
    position = found + needle.length;
  }
  return count;
};

export const scoreLexicalDocument = (
  query: LexicalQuery,
  document: LexicalDocument,
): LexicalDocumentMatch | null => {
  if (query.terms.length === 0 && query.phrases.length === 0) {
    return { id: document.id, score: 0, matchedFields: [] };
  }
  const fields = {
    title: normalizeText(document.title),
    content: normalizeText(document.content),
    path: document.path === null ? "" : normalizePath(document.path),
    symbols: normalizeText(document.symbols.join(" ")),
  };
  const matchedFields = new Set<string>();
  let rawScore = 0;
  for (const phrase of query.phrases) {
    for (const [field, text] of Object.entries(fields)) {
      if (text.includes(phrase)) {
        matchedFields.add(field);
        rawScore += field === "title" ? 6 : field === "symbols" ? 5 : field === "path" ? 4 : 3;
      }
    }
  }
  for (const term of query.terms) {
    for (const [field, text] of Object.entries(fields)) {
      const occurrences = countOccurrences(text, term);
      if (occurrences > 0) {
        matchedFields.add(field);
        const fieldWeight =
          field === "title" ? 3 : field === "symbols" ? 2.5 : field === "path" ? 2 : 1;
        rawScore += fieldWeight * Math.min(occurrences, 3);
      }
    }
  }
  if (matchedFields.size === 0) return null;
  const maximumUsefulScore = Math.max(1, query.terms.length * 6 + query.phrases.length * 8);
  return {
    id: document.id,
    score: Math.min(1, rawScore / maximumUsefulScore),
    matchedFields: [...matchedFields].sort(),
  };
};

/** Deterministic fallback for SQLite builds where FTS is unavailable. */
export const searchLexicalFallback = (
  query: LexicalQuery,
  documents: ReadonlyArray<LexicalDocument>,
  limit: number,
): ReadonlyArray<LexicalDocumentMatch> =>
  documents
    .map((document) => scoreLexicalDocument(query, document))
    .filter((match): match is LexicalDocumentMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, limit));

export const estimateMemoryTokens = (content: string) =>
  content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4));

const clampScore = (score: number | null) =>
  score === null || !Number.isFinite(score) ? 0 : Math.max(0, Math.min(1, score));

const trustRank: Record<MemoryTrustLevel, number> = {
  authoritative: 6,
  verified: 5,
  supported: 4,
  inferred: 3,
  unverified: 2,
  disputed: 1,
};

const trustWeight: Record<MemoryTrustLevel, number> = {
  authoritative: 1,
  verified: 0.9,
  supported: 0.75,
  inferred: 0.5,
  unverified: 0.3,
  disputed: 0.05,
};

const sourceAuthority: Record<MemorySourceType, number> = {
  repository_file: 0.95,
  git_commit: 0.9,
  git_diff: 0.75,
  agents_file: 1,
  documentation: 0.9,
  user_instruction: 1,
  mission_event: 0.7,
  agent_handoff: 0.65,
  verification_result: 0.9,
  github_issue: 0.7,
  github_pull_request: 0.75,
  github_review: 0.85,
  manual_entry: 0.75,
  derived: 0.35,
};

const indexedSourceAuthority: Record<IndexedSource["sourceType"], number> = {
  repository_file: 1,
  repository_map: 0.45,
  github_issue: 0.7,
  github_pull_request: 0.75,
  github_review: 0.85,
  agent_handoff: 0.65,
  verification_summary: 0.85,
};

const typePriority: Partial<Record<MemoryEntryType, number>> = {
  security_rule: 1,
  constraint: 0.95,
  product_requirement: 0.9,
  architecture_decision: 0.85,
  coding_convention: 0.65,
  failed_approach: 0.6,
  test_procedure: 0.55,
  release_procedure: 0.55,
};

const statusNeverRetrieved = new Set<MemoryEntryStatus>([
  "proposed",
  "rejected",
  "archived",
  "superseded",
]);

const toEpochMillis = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

const freshnessWeight = (entry: MemoryEntry, nowEpochMillis: number) => {
  const reference = entry.lastVerifiedAt ?? entry.updatedAt;
  const ageDays = Math.max(0, nowEpochMillis - toEpochMillis(reference)) / DAY_MILLISECONDS;
  return 1 / (1 + ageDays / 180);
};

const recencyWeight = (updatedAt: string, nowEpochMillis: number) => {
  const ageDays = Math.max(0, nowEpochMillis - toEpochMillis(updatedAt)) / DAY_MILLISECONDS;
  return 1 / (1 + ageDays / 365);
};

const isExpired = (entry: MemoryEntry, nowEpochMillis: number) =>
  entry.expiresAt !== null && toEpochMillis(entry.expiresAt) <= nowEpochMillis;

const hasPathPrefix = (sources: ReadonlyArray<MemorySource>, pathPrefix: string) => {
  const normalizedPrefix = normalizePath(pathPrefix);
  return sources.some((source) => {
    const path = source.filePath ?? source.repositoryPath;
    return path !== null && normalizePath(path).startsWith(normalizedPrefix);
  });
};

const entryScopePriority = (entry: MemoryEntry, input: MemorySearchInput) => {
  if (entry.scopeType === "task") {
    return entry.projectId === input.projectId &&
      entry.missionId === input.missionId &&
      entry.taskId === input.taskId
      ? 5
      : 0;
  }
  if (entry.scopeType === "mission") {
    return entry.projectId === input.projectId && entry.missionId === input.missionId ? 4 : 0;
  }
  if (entry.scopeType === "branch") {
    return entry.projectId === input.projectId &&
      entry.branchName !== null &&
      entry.branchName === input.branchName
      ? 3
      : 0;
  }
  if (entry.scopeType === "project") {
    return entry.projectId === input.projectId ? 2 : 0;
  }
  return entry.scopeType === "user" ? 1 : 0;
};

const sourceBranchApplies = (source: IndexedSource, input: MemorySearchInput) =>
  source.branchName === null || source.branchName === input.branchName;

const entryPassesFilters = (
  candidate: MemoryRetrievalCandidate,
  input: MemorySearchInput,
  staleBehavior: MemoryStaleBehavior,
  nowEpochMillis: number,
) => {
  const { entry, sources } = candidate;
  if (entryScopePriority(entry, input) === 0 || statusNeverRetrieved.has(entry.status))
    return false;
  if (entry.status === "disputed" && !input.statuses.includes("disputed")) return false;
  if (entry.status === "stale" || isExpired(entry, nowEpochMillis)) {
    if (staleBehavior === "exclude") return false;
  }
  if (input.statuses.length > 0 && !input.statuses.includes(entry.status)) return false;
  if (input.statuses.length === 0 && entry.status !== "active" && entry.status !== "stale") {
    return false;
  }
  if (input.types.length > 0 && !input.types.includes(entry.type)) return false;
  if (input.minimumTrust !== null && trustRank[entry.trustLevel] < trustRank[input.minimumTrust]) {
    return false;
  }
  if (input.pathPrefix !== null && !hasPathPrefix(sources, input.pathPrefix)) return false;
  return true;
};

const chunkPassesFilters = (candidate: SourceRetrievalCandidate, input: MemorySearchInput) => {
  if (
    candidate.source.projectId !== input.projectId ||
    candidate.source.indexStatus !== "indexed"
  ) {
    return false;
  }
  if (!sourceBranchApplies(candidate.source, input)) return false;
  if (input.pathPrefix !== null) {
    const path = candidate.source.relativePath;
    if (path === null || !normalizePath(path).startsWith(normalizePath(input.pathPrefix)))
      return false;
  }
  return candidate.source.relativePath !== null;
};

const selectionReason = (
  id: string,
  kind: MemorySelectionReason["kind"],
  summary: string,
  scoreContribution: number,
): MemorySelectionReason => ({ id, kind, summary, scoreContribution });

const sourceFreshnessScore = (sources: ReadonlyArray<MemorySource>) => {
  if (sources.some((source) => source.sourceStatus === "resolved")) return 1;
  if (sources.some((source) => source.sourceStatus === "changed")) return 0.35;
  return 0.1;
};

const bestSource = (sources: ReadonlyArray<MemorySource>) =>
  [...sources].sort((left, right) => {
    const freshnessDifference =
      (right.sourceStatus === "resolved" ? 1 : 0) - (left.sourceStatus === "resolved" ? 1 : 0);
    return (
      freshnessDifference ||
      sourceAuthority[right.sourceType] - sourceAuthority[left.sourceType] ||
      left.id.localeCompare(right.id)
    );
  })[0] ?? null;

const toCitation = (source: MemorySource | null): MemoryCitation | null =>
  source === null
    ? null
    : {
        sourceType: source.sourceType,
        sourceIdentifier: source.sourceIdentifier,
        path: source.filePath ?? source.repositoryPath,
        startLine: source.startLine,
        endLine: source.endLine,
        commitHash: source.commitHash,
        branchName: source.branchName,
        missionId: source.missionId,
        taskId: source.taskId,
        verificationRunId: source.verificationRunId,
        githubRecordType: source.githubRecordType,
        githubRecordId: source.githubRecordId,
        freshness:
          source.sourceStatus === "resolved"
            ? "current"
            : source.sourceStatus === "changed"
              ? "changed"
              : source.sourceStatus,
      };

interface RankedMemory {
  readonly value: RetrievedMemory;
  readonly tokens: number;
  readonly deduplicationKey: string;
  readonly uncertainties: ReadonlyArray<string>;
}

interface RankedChunk {
  readonly value: RetrievedSourceExcerpt;
  readonly tokens: number;
  readonly deduplicationKey: string;
  readonly sourceCandidate: SourceRetrievalCandidate;
}

const rankMemory = (
  candidate: MemoryRetrievalCandidate,
  input: MemorySearchInput,
  staleBehavior: MemoryStaleBehavior,
  nowEpochMillis: number,
): RankedMemory | null => {
  if (!entryPassesFilters(candidate, input, staleBehavior, nowEpochMillis)) return null;
  const { entry, sources } = candidate;
  const reasons: Array<MemorySelectionReason> = [];
  const lexical = clampScore(candidate.lexicalScore);
  const semantic = clampScore(candidate.semanticScore);
  const queryContribution = lexical * 4 + semantic * 3;
  if (queryContribution > 0) {
    reasons.push(
      selectionReason(
        `memory:${entry.id}:query`,
        semantic > lexical ? "semantic" : "lexical",
        candidate.matchedFields.length === 0
          ? "Matched the retrieval query"
          : `Matched ${candidate.matchedFields.join(", ")}`,
        queryContribution,
      ),
    );
  }
  const scope = entryScopePriority(entry, input);
  const scopeContribution = scope;
  reasons.push(
    selectionReason(
      `memory:${entry.id}:scope`,
      entry.scopeType === "branch" ? "branch_applicability" : "scope_proximity",
      `${entry.scopeType} memory applies to the current ${entry.scopeType} scope`,
      scopeContribution,
    ),
  );
  const trustContribution = trustWeight[entry.trustLevel] * 2.5;
  reasons.push(
    selectionReason(
      `memory:${entry.id}:trust`,
      "trust",
      `Trust level is ${entry.trustLevel}`,
      trustContribution,
    ),
  );
  const authority = sources.reduce(
    (highest, source) => Math.max(highest, sourceAuthority[source.sourceType]),
    0,
  );
  const authorityContribution = authority;
  if (authorityContribution > 0) {
    reasons.push(
      selectionReason(
        `memory:${entry.id}:authority`,
        "source_authority",
        "Supported by a traceable source",
        authorityContribution,
      ),
    );
  }
  const freshnessContribution =
    freshnessWeight(entry, nowEpochMillis) * 0.6 + sourceFreshnessScore(sources) * 0.8;
  reasons.push(
    selectionReason(
      `memory:${entry.id}:freshness`,
      "freshness",
      entry.lastVerifiedAt === null
        ? "Ranked using source state and update time"
        : `Last verified at ${entry.lastVerifiedAt}`,
      freshnessContribution,
    ),
  );
  const recencyContribution = recencyWeight(entry.updatedAt, nowEpochMillis) * 0.4;
  reasons.push(
    selectionReason(
      `memory:${entry.id}:recency`,
      "recency",
      `Updated at ${entry.updatedAt}`,
      recencyContribution,
    ),
  );
  if (entry.pinned) {
    reasons.push(selectionReason(`memory:${entry.id}:pinned`, "pinned", "Explicitly pinned", 0.5));
  }
  let score =
    queryContribution +
    scopeContribution +
    trustContribution +
    authorityContribution +
    freshnessContribution +
    recencyContribution +
    (typePriority[entry.type] ?? 0) +
    entry.confidence * 0.5 +
    (entry.pinned ? 0.5 : 0);
  const uncertainties: Array<string> = [];
  if (entry.status === "stale" || isExpired(entry, nowEpochMillis)) {
    score -= staleBehavior === "demote" ? 3 : 1;
    uncertainties.push(entry.staleReason ?? "Memory is stale or expired");
  }
  if (entry.status === "disputed" || entry.trustLevel === "disputed") {
    score -= 4;
    uncertainties.push("Memory is disputed and requires human resolution");
  }
  if (sources.length === 0) uncertainties.push("Memory has no currently resolvable source");
  if (sources.some((source) => source.sourceStatus !== "resolved")) {
    uncertainties.push("One or more supporting sources changed or cannot currently be resolved");
  }
  if (entry.contradictionGroupId !== null) {
    uncertainties.push(
      `Memory belongs to unresolved contradiction group ${entry.contradictionGroupId}`,
    );
  }
  const value: RetrievedMemory = {
    entry,
    citation: toCitation(bestSource(sources)),
    score,
    selectionReasons: reasons,
  };
  return {
    value,
    tokens: estimateMemoryTokens(
      JSON.stringify({
        id: entry.id,
        scope: entry.scopeType,
        type: entry.type,
        trust: entry.trustLevel,
        status: entry.status,
        content: entry.content,
        citation: value.citation,
        reasons: reasons.map((reason) => reason.summary),
        uncertainties,
      }),
    ),
    deduplicationKey: normalizeText(`${entry.title}\u0000${entry.content}`),
    uncertainties: uniqueInOrder(uncertainties),
  };
};

const countLines = (content: string) => (content.match(/\n/g) ?? []).length;

const boundedExcerpt = (candidate: SourceRetrievalCandidate, availableTokens: number) => {
  const characterLimit = Math.min(MAX_EXCERPT_CHARACTERS, Math.max(0, availableTokens * 4));
  if (characterLimit === 0) return null;
  let content = candidate.chunk.content;
  if (content.length > characterLimit) {
    const raw = content.slice(0, characterLimit);
    const lastLineBreak = raw.lastIndexOf("\n");
    content = lastLineBreak > 0 ? raw.slice(0, lastLineBreak + 1) : raw;
  }
  if (content.length === 0) return null;
  const startLine = candidate.chunk.startLine;
  const wasTruncated = content.length < candidate.chunk.content.length;
  const endLine =
    startLine === null
      ? null
      : wasTruncated
        ? startLine + countLines(content)
        : candidate.chunk.endLine;
  return { content, startLine, endLine, tokens: estimateMemoryTokens(content) };
};

const rankChunk = (
  candidate: SourceRetrievalCandidate,
  input: MemorySearchInput,
  nowEpochMillis: number,
  availableTokens: number,
): RankedChunk | null => {
  if (!chunkPassesFilters(candidate, input)) return null;
  const excerpt = boundedExcerpt(candidate, availableTokens);
  const path = candidate.source.relativePath;
  if (excerpt === null || path === null) return null;
  const lexical = clampScore(candidate.lexicalScore);
  const semantic = clampScore(candidate.semanticScore);
  const queryContribution = lexical * 4 + semantic * 3;
  const branchContribution = candidate.source.branchName === input.branchName ? 1.5 : 0.5;
  const authorityContribution = indexedSourceAuthority[candidate.source.sourceType];
  const recencyContribution = recencyWeight(candidate.source.updatedAt, nowEpochMillis) * 0.5;
  const reasons: Array<MemorySelectionReason> = [
    selectionReason(
      `chunk:${candidate.chunk.id}:query`,
      semantic > lexical ? "semantic" : "lexical",
      candidate.matchedFields.length === 0
        ? "Matched the retrieval query"
        : `Matched ${candidate.matchedFields.join(", ")}`,
      queryContribution,
    ),
    selectionReason(
      `chunk:${candidate.chunk.id}:branch`,
      "branch_applicability",
      candidate.source.branchName === null
        ? "Repository source is branch-independent"
        : `Repository source matches branch ${candidate.source.branchName}`,
      branchContribution,
    ),
    selectionReason(
      `chunk:${candidate.chunk.id}:authority`,
      "source_authority",
      `Source type is ${candidate.source.sourceType}`,
      authorityContribution,
    ),
  ];
  const score =
    queryContribution + branchContribution + authorityContribution + recencyContribution;
  return {
    value: {
      indexedChunkId: candidate.chunk.id,
      path,
      startLine: excerpt.startLine,
      endLine: excerpt.endLine,
      commitHash: candidate.source.commitHash,
      branchName: candidate.source.branchName,
      content: excerpt.content,
      tokenEstimate: excerpt.tokens,
      score,
      selectionReasons: reasons,
    },
    tokens: estimateMemoryTokens(
      JSON.stringify({
        path,
        startLine: excerpt.startLine,
        endLine: excerpt.endLine,
        commitHash: candidate.source.commitHash,
        branchName: candidate.source.branchName,
        content: excerpt.content,
        reasons: reasons.map((reason) => reason.summary),
      }),
    ),
    deduplicationKey: candidate.chunk.contentFingerprint,
    sourceCandidate: candidate,
  };
};

const mergeCandidateSets = (
  lexical: MemoryCandidateSet,
  semantic: MemoryCandidateSet,
): MemoryCandidateSet => {
  const memories = new Map<string, MemoryRetrievalCandidate>();
  const chunks = new Map<string, SourceRetrievalCandidate>();
  for (const candidate of [...lexical.memories, ...semantic.memories]) {
    const current = memories.get(candidate.entry.id);
    memories.set(
      candidate.entry.id,
      current === undefined
        ? candidate
        : {
            entry: current.entry,
            sources:
              current.sources.length >= candidate.sources.length
                ? current.sources
                : candidate.sources,
            lexicalScore:
              current.lexicalScore === null
                ? candidate.lexicalScore
                : Math.max(current.lexicalScore, candidate.lexicalScore ?? 0),
            semanticScore:
              current.semanticScore === null
                ? candidate.semanticScore
                : Math.max(current.semanticScore, candidate.semanticScore ?? 0),
            matchedFields: uniqueInOrder([...current.matchedFields, ...candidate.matchedFields]),
          },
    );
  }
  for (const candidate of [...lexical.chunks, ...semantic.chunks]) {
    const current = chunks.get(candidate.chunk.id);
    chunks.set(
      candidate.chunk.id,
      current === undefined
        ? candidate
        : {
            chunk: current.chunk,
            source: current.source,
            lexicalScore:
              current.lexicalScore === null
                ? candidate.lexicalScore
                : Math.max(current.lexicalScore, candidate.lexicalScore ?? 0),
            semanticScore:
              current.semanticScore === null
                ? candidate.semanticScore
                : Math.max(current.semanticScore, candidate.semanticScore ?? 0),
            matchedFields: uniqueInOrder([...current.matchedFields, ...candidate.matchedFields]),
          },
    );
  }
  return { memories: [...memories.values()], chunks: [...chunks.values()] };
};

interface SelectedContext {
  readonly memories: ReadonlyArray<RetrievedMemory>;
  readonly excerpts: ReadonlyArray<RetrievedSourceExcerpt>;
  readonly uncertainties: AgentMemoryContextPackage["uncertainties"];
  readonly tokenEstimate: number;
  readonly excludedCandidateCount: number;
}

const selectWithinBudget = (
  candidates: MemoryCandidateSet,
  input: MemorySearchInput,
  settings: MemorySettings,
  nowEpochMillis: number,
  tokenBudget: number,
): SelectedContext => {
  const rankedMemories = candidates.memories
    .map((candidate) => rankMemory(candidate, input, settings.staleMemoryBehavior, nowEpochMillis))
    .filter((candidate): candidate is RankedMemory => candidate !== null);
  const rankedChunks = candidates.chunks
    .map((candidate) => rankChunk(candidate, input, nowEpochMillis, tokenBudget))
    .filter((candidate): candidate is RankedChunk => candidate !== null);
  const combined = [
    ...rankedMemories.map((candidate) => ({ kind: "memory" as const, candidate })),
    ...rankedChunks.map((candidate) => ({ kind: "chunk" as const, candidate })),
  ].sort(
    (left, right) =>
      right.candidate.value.score - left.candidate.value.score ||
      left.kind.localeCompare(right.kind) ||
      left.candidate.deduplicationKey.localeCompare(right.candidate.deduplicationKey),
  );
  const seen = new Set<string>();
  const memories: Array<RetrievedMemory> = [];
  const excerpts: Array<RetrievedSourceExcerpt> = [];
  const uncertainties: Array<AgentMemoryContextPackage["uncertainties"][number]> = [];
  let usedTokens = 0;
  let selected = 0;
  const envelopeTokens = 64;
  for (const item of combined) {
    if (selected >= input.limit || seen.has(item.candidate.deduplicationKey)) continue;
    const envelope = selected === 0 ? envelopeTokens : 0;
    const remaining = tokenBudget - usedTokens - envelope;
    if (remaining <= 0) break;
    if (item.kind === "memory") {
      if (item.candidate.tokens > remaining) continue;
      memories.push(item.candidate.value);
      for (const reason of item.candidate.uncertainties) {
        uncertainties.push({
          memoryId: item.candidate.value.entry.id,
          indexedChunkId: null,
          reason,
        });
      }
      usedTokens += envelope + item.candidate.tokens;
    } else {
      const reranked = rankChunk(item.candidate.sourceCandidate, input, nowEpochMillis, remaining);
      if (reranked === null || reranked.tokens > remaining) continue;
      excerpts.push(reranked.value);
      usedTokens += envelope + reranked.tokens;
    }
    seen.add(item.candidate.deduplicationKey);
    selected += 1;
  }
  return {
    memories,
    excerpts,
    uncertainties,
    tokenEstimate: usedTokens,
    excludedCandidateCount: Math.max(0, combined.length - selected),
  };
};

const requestedSemantic = (mode: MemoryRetrievalMode) => mode === "semantic" || mode === "hybrid";

const providerMatchesSettings = (provider: EmbeddingProviderMetadata, settings: MemorySettings) =>
  provider.kind === settings.embeddingProviderKind &&
  (settings.embeddingProviderId === null || provider.id === settings.embeddingProviderId) &&
  (settings.embeddingModel === null || provider.model === settings.embeddingModel) &&
  (settings.embeddingDimensions === null || provider.dimensions === settings.embeddingDimensions);

export interface MemoryRetrievalDependencies {
  readonly dataSource: MemoryRetrievalDataSourceShape;
  readonly embeddingProvider: EmbeddingProviderShape;
  readonly now: Effect.Effect<DateTime.Utc>;
  readonly nextAuditId: Effect.Effect<MemoryRetrievalRecordId>;
}

export const makeMemoryRetrieval = (
  dependencies: MemoryRetrievalDependencies,
): MemoryRetrievalShape => ({
  retrieve: (request) =>
    Effect.gen(function* () {
      const [now, auditRecordId] = yield* Effect.all([dependencies.now, dependencies.nextAuditId]);
      const createdAt = DateTime.formatIso(now);
      const nowEpochMillis = DateTime.toEpochMillis(now);
      const auditQuery = redactMemorySourceText(request.query).content;
      const failedRecord = (
        error: MemoryRetrievalError,
        failedStage: "settings" | "lexical",
      ): MemoryRetrievalRecord => ({
        id: auditRecordId,
        agentRunId: request.agentRunId,
        threadId: request.threadId,
        messageId: request.messageId,
        projectId: request.projectId,
        missionId: request.missionId,
        taskId: request.taskId,
        branchName: request.branchName,
        query: auditQuery,
        retrievalMode: request.mode,
        selectedMemoryIds: [],
        selectedChunkIds: [],
        excludedCandidateCount: 0,
        tokenEstimate: 0,
        rankingMetadata: { failedStage },
        status: "failed",
        errorSummary: redactMemorySourceText(error.message).content.slice(0, 4_000),
        createdAt,
      });
      const settingsResult = yield* Effect.result(
        dependencies.dataSource.getSettings(request.projectId),
      );
      if (Result.isFailure(settingsResult)) {
        yield* dependencies.dataSource.saveRetrievalRecord(
          failedRecord(settingsResult.failure, "settings"),
        );
        return yield* settingsResult.failure;
      }
      const settings = settingsResult.success;
      const tokenBudget =
        request.tokenBudget === 0
          ? settings.contextTokenBudget
          : Math.min(request.tokenBudget, settings.contextTokenBudget);
      const disabled = !settings.enabled || request.mode === "disabled";
      if (disabled) {
        const record: MemoryRetrievalRecord = {
          id: auditRecordId,
          agentRunId: request.agentRunId,
          threadId: request.threadId,
          messageId: request.messageId,
          projectId: request.projectId,
          missionId: request.missionId,
          taskId: request.taskId,
          branchName: request.branchName,
          query: auditQuery,
          retrievalMode: "disabled",
          selectedMemoryIds: [],
          selectedChunkIds: [],
          excludedCandidateCount: 0,
          tokenEstimate: 0,
          rankingMetadata: { reason: settings.enabled ? "request_disabled" : "project_disabled" },
          status: "disabled",
          errorSummary: null,
          createdAt,
        };
        yield* dependencies.dataSource.saveRetrievalRecord(record);
        return {
          context: {
            scope: {
              projectId: request.projectId,
              branch: request.branchName,
              missionId: request.missionId,
              taskId: request.taskId,
            },
            memories: [],
            sourceExcerpts: [],
            uncertainties: [],
            tokenEstimate: 0,
            retrievalMode: "disabled",
            auditRecordId,
          },
          totalCandidateCount: 0,
          excludedCandidateCount: 0,
        } satisfies MemorySearchResult;
      }

      const lexicalQuery = buildLexicalQuery(request.query);
      const auditLexicalQuery = buildLexicalQuery(auditQuery);
      const candidateLimit = Math.max(request.limit * 8, 32);
      const lexicalResult = yield* Effect.result(
        dependencies.dataSource.searchLexical({
          input: request,
          query: lexicalQuery,
          candidateLimit,
        }),
      );
      if (Result.isFailure(lexicalResult)) {
        yield* dependencies.dataSource.saveRetrievalRecord(
          failedRecord(lexicalResult.failure, "lexical"),
        );
        return yield* lexicalResult.failure;
      }
      const lexical = lexicalResult.success;
      let actualMode: MemoryRetrievalMode = request.mode === "explicit" ? "explicit" : "lexical";
      let selectedCandidates: MemoryCandidateSet = lexical;
      let semanticFallbackReason: string | null = null;
      let semanticProviderMetadata: EmbeddingProviderMetadata | null = null;

      const semanticAllowed =
        requestedSemantic(request.mode) &&
        !settings.lexicalOnly &&
        settings.semanticRetrievalEnabled &&
        (settings.embeddingProviderKind !== "remote" ||
          settings.remoteCodeUploadAcceptedAt !== null) &&
        lexicalQuery.normalized.length > 0;
      if (semanticAllowed) {
        const provider = Option.getOrNull(dependencies.embeddingProvider.configured);
        if (provider === null) {
          semanticFallbackReason = "No embedding provider is configured";
        } else if (!providerMatchesSettings(provider.metadata, settings)) {
          semanticFallbackReason = "Embedding provider metadata does not match project settings";
        } else {
          semanticProviderMetadata = provider.metadata;
          const semanticAttempt = yield* Effect.result(
            Effect.gen(function* () {
              const vectors = yield* provider.embed({ kind: "query", texts: [auditQuery] });
              const vector = vectors[0];
              if (vector === undefined) {
                return yield* new MemoryRetrievalError({
                  reason: "semantic_search_failed",
                  message: "Embedding provider returned no query vector",
                });
              }
              return yield* dependencies.dataSource.searchSemantic({
                input: request,
                vector,
                provider: provider.metadata,
                candidateLimit,
              });
            }),
          );
          if (Result.isFailure(semanticAttempt)) {
            semanticFallbackReason = semanticAttempt.failure.message;
          } else if (
            semanticAttempt.success.memories.length === 0 &&
            semanticAttempt.success.chunks.length === 0
          ) {
            semanticFallbackReason = "Semantic search returned no candidates";
          } else if (request.mode === "hybrid") {
            selectedCandidates = mergeCandidateSets(lexical, semanticAttempt.success);
            actualMode = "hybrid";
          } else {
            selectedCandidates = semanticAttempt.success;
            actualMode = "semantic";
          }
        }
      } else if (requestedSemantic(request.mode)) {
        semanticFallbackReason = settings.lexicalOnly
          ? "Project is configured for lexical-only retrieval"
          : settings.embeddingProviderKind === "remote" &&
              settings.remoteCodeUploadAcceptedAt === null
            ? "Project has not accepted remote embedding content processing"
            : settings.semanticRetrievalEnabled
              ? "The query is empty"
              : "Semantic retrieval is disabled";
      }

      const totalCandidateCount =
        new Set(selectedCandidates.memories.map((candidate) => candidate.entry.id)).size +
        new Set(selectedCandidates.chunks.map((candidate) => candidate.chunk.id)).size;
      const selected = selectWithinBudget(
        selectedCandidates,
        request,
        settings,
        nowEpochMillis,
        tokenBudget,
      );
      const record: MemoryRetrievalRecord = {
        id: auditRecordId,
        agentRunId: request.agentRunId,
        threadId: request.threadId,
        messageId: request.messageId,
        projectId: request.projectId,
        missionId: request.missionId,
        taskId: request.taskId,
        branchName: request.branchName,
        query: auditQuery,
        retrievalMode: actualMode,
        selectedMemoryIds: selected.memories.map((memory) => memory.entry.id),
        selectedChunkIds: selected.excerpts.map((excerpt) => excerpt.indexedChunkId),
        excludedCandidateCount: selected.excludedCandidateCount,
        tokenEstimate: selected.tokenEstimate,
        rankingMetadata: {
          lexicalEngine: lexical.engine,
          lexicalQuery: auditLexicalQuery.ftsQuery,
          requestedMode: request.mode,
          actualMode,
          tokenBudget,
          semanticFallbackReason:
            semanticFallbackReason === null
              ? null
              : redactMemorySourceText(semanticFallbackReason).content.slice(0, 4_000),
          semanticProvider:
            semanticProviderMetadata === null
              ? null
              : {
                  id: semanticProviderMetadata.id,
                  kind: semanticProviderMetadata.kind,
                  model: semanticProviderMetadata.model,
                  dimensions: semanticProviderMetadata.dimensions,
                },
          selected: [
            ...selected.memories.map((memory) => ({
              id: memory.entry.id,
              kind: "memory",
              score: memory.score,
              reasons: memory.selectionReasons.map((reason) => reason.summary),
            })),
            ...selected.excerpts.map((excerpt) => ({
              id: excerpt.indexedChunkId,
              kind: "chunk",
              score: excerpt.score,
              reasons: excerpt.selectionReasons.map((reason) => reason.summary),
            })),
          ],
        },
        status: "completed",
        errorSummary: null,
        createdAt,
      };
      yield* dependencies.dataSource.saveRetrievalRecord(record);
      return {
        context: {
          scope: {
            projectId: request.projectId,
            branch: request.branchName,
            missionId: request.missionId,
            taskId: request.taskId,
          },
          memories: selected.memories,
          sourceExcerpts: selected.excerpts,
          uncertainties: selected.uncertainties,
          tokenEstimate: selected.tokenEstimate,
          retrievalMode: actualMode,
          auditRecordId,
        },
        totalCandidateCount,
        excludedCandidateCount: selected.excludedCandidateCount,
      } satisfies MemorySearchResult;
    }),
});

export const MemoryRetrievalLive = Layer.effect(
  MemoryRetrieval,
  Effect.gen(function* () {
    const dataSource = yield* MemoryRetrievalDataSource;
    const embeddingProvider = yield* EmbeddingProvider;
    const crypto = yield* Crypto.Crypto;
    return makeMemoryRetrieval({
      dataSource,
      embeddingProvider,
      now: DateTime.now,
      nextAuditId: crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => MemoryRetrievalRecordId.make(`memory-retrieval:${uuid}`)),
        Effect.orDie,
      ),
    });
  }),
);
