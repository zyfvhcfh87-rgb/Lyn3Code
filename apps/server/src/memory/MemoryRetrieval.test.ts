import {
  AgentRunId,
  IndexedChunkId,
  IndexedSourceId,
  MemoryEntryId,
  MemoryRetrievalRecordId,
  MemorySourceId,
  MessageId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ThreadId,
  type IndexedChunk,
  type IndexedSource,
  type MemoryEntry,
  type MemoryEntryStatus,
  type MemoryRetrievalRecord,
  type MemorySettings,
  type MemorySource,
  type MemoryTrustLevel,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import {
  makeConfiguredEmbeddingProvider,
  type EmbeddingProviderShape,
} from "./EmbeddingProvider.ts";
import {
  buildLexicalQuery,
  makeMemoryRetrieval,
  MemoryRetrievalError,
  searchLexicalFallback,
  type LexicalCandidateSet,
  type MemoryCandidateSet,
  type MemoryRetrievalCandidate,
  type MemoryRetrievalDataSourceShape,
  type MemoryRetrievalRequest,
  type SourceRetrievalCandidate,
} from "./MemoryRetrieval.ts";

const now = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("memory-project");
const missionId = MissionId.make("memory-mission");
const taskId = MissionTaskId.make("memory-task");
const threadId = ThreadId.make("memory-thread");
const branchName = "agent/memory/task";

const settings = (overrides: Partial<MemorySettings> = {}): MemorySettings => ({
  projectId,
  enabled: true,
  automaticProposalGeneration: false,
  automaticAuthoritativeIndexing: true,
  repositoryExclusions: [],
  maximumIndexedFileSizeBytes: 1_000_000,
  contextTokenBudget: 2_000,
  lexicalOnly: true,
  semanticRetrievalEnabled: false,
  embeddingProviderKind: "none",
  embeddingProviderId: null,
  embeddingModel: null,
  embeddingDimensions: null,
  remoteCodeUploadAcceptedAt: null,
  proposalRetentionDays: 30,
  staleMemoryBehavior: "exclude",
  indexingPaused: false,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const entry = (
  id: string,
  scopeType: MemoryEntry["scopeType"],
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry => ({
  id: MemoryEntryId.make(id),
  scopeType,
  scopeId:
    scopeType === "user"
      ? null
      : scopeType === "project"
        ? projectId
        : scopeType === "branch"
          ? branchName
          : scopeType === "mission"
            ? missionId
            : taskId,
  projectId: scopeType === "user" ? null : projectId,
  branchName: scopeType === "branch" ? branchName : null,
  missionId: scopeType === "mission" || scopeType === "task" ? missionId : null,
  taskId: scopeType === "task" ? taskId : null,
  type: scopeType === "user" ? "user_preference" : "coding_convention",
  title: `${scopeType} rule`,
  content: "Use the scoped implementation rule.",
  structuredData: null,
  trustLevel: "supported",
  status: "active",
  confidence: 0.9,
  createdByType: "user",
  createdById: null,
  creationMode: "explicit",
  pinned: false,
  createdAt: now,
  updatedAt: now,
  lastVerifiedAt: now,
  expiresAt: null,
  supersededById: null,
  contradictionGroupId: null,
  staleReason: null,
  ...overrides,
});

const source = (memoryEntry: MemoryEntry, overrides: Partial<MemorySource> = {}): MemorySource => ({
  id: MemorySourceId.make(`source-${memoryEntry.id}`),
  memoryEntryId: memoryEntry.id,
  sourceType: "repository_file",
  sourceIdentifier: "apps/desktop/src/preload.ts",
  projectId,
  repositoryPath: "C:\\repo",
  filePath: "apps/desktop/src/preload.ts",
  startLine: 12,
  endLine: 44,
  commitHash: "abc123",
  branchName: null,
  missionId: null,
  taskId: null,
  agentRunId: null,
  verificationRunId: null,
  githubRecordType: null,
  githubRecordId: null,
  messageReference: null,
  contentFingerprint: "sha256:source",
  sourceStatus: "resolved",
  createdAt: now,
  ...overrides,
});

const memoryCandidate = (
  memoryEntry: MemoryEntry,
  overrides: Partial<MemoryRetrievalCandidate> = {},
): MemoryRetrievalCandidate => ({
  entry: memoryEntry,
  sources: [source(memoryEntry)],
  lexicalScore: 1,
  semanticScore: null,
  matchedFields: ["content"],
  ...overrides,
});

const indexedSource: IndexedSource = {
  id: IndexedSourceId.make("indexed-preload"),
  projectId,
  sourceType: "repository_file",
  sourceIdentifier: "apps/desktop/src/preload.ts",
  relativePath: "apps/desktop/src/preload.ts",
  branchName,
  commitHash: "abc123",
  contentFingerprint: "sha256:file",
  language: "typescript",
  sizeBytes: 1_024,
  indexStatus: "indexed",
  skipReason: null,
  lastIndexedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const indexedChunk: IndexedChunk = {
  id: IndexedChunkId.make("chunk-preload"),
  indexedSourceId: indexedSource.id,
  chunkIndex: 0,
  startLine: 12,
  endLine: 14,
  content: "export const bridge = {\n  readFile: safeReadFile,\n};",
  contentFingerprint: "sha256:chunk",
  tokenEstimate: 14,
  symbolMetadata: { symbols: ["bridge"] },
  embeddingStatus: "disabled",
  embeddingProvider: null,
  embeddingModel: null,
  embeddingDimensions: null,
  createdAt: now,
  updatedAt: now,
};

const chunkCandidate = (
  overrides: Partial<SourceRetrievalCandidate> = {},
): SourceRetrievalCandidate => ({
  chunk: indexedChunk,
  source: indexedSource,
  lexicalScore: 0.9,
  semanticScore: null,
  matchedFields: ["symbol"],
  ...overrides,
});

const request = (overrides: Partial<MemoryRetrievalRequest> = {}): MemoryRetrievalRequest => ({
  projectId,
  branchName,
  missionId,
  taskId,
  query: "scoped implementation rule",
  mode: "lexical",
  pathPrefix: null,
  types: [],
  statuses: [],
  minimumTrust: null,
  tokenBudget: 2_000,
  limit: 20,
  agentRunId: AgentRunId.make("memory-run"),
  threadId,
  messageId: MessageId.make("memory-message"),
  ...overrides,
});

const dataSource = (
  memorySettings: MemorySettings,
  lexical: LexicalCandidateSet,
  semantic: MemoryCandidateSet = { memories: [], chunks: [] },
) => {
  const records: Array<MemoryRetrievalRecord> = [];
  const service: MemoryRetrievalDataSourceShape = {
    getSettings: () => Effect.succeed(memorySettings),
    searchLexical: () => Effect.succeed(lexical),
    searchSemantic: () => Effect.succeed(semantic),
    saveRetrievalRecord: (record) => Effect.sync(() => void records.push(record)),
  };
  return { service, records };
};

const retrieve = (
  data: MemoryRetrievalDataSourceShape,
  input: MemoryRetrievalRequest,
  embeddingProvider: EmbeddingProviderShape = { configured: Option.none() },
) =>
  makeMemoryRetrieval({
    dataSource: data,
    embeddingProvider,
    now: Effect.succeed(DateTime.makeUnsafe(now)),
    nextAuditId: Effect.succeed(MemoryRetrievalRecordId.make("retrieval-audit")),
  }).retrieve(input);

describe("MemoryRetrieval lexical helpers", () => {
  it("constructs operator-free, deterministic FTS queries", () => {
    const query = buildLexicalQuery('"exact phrase" bridge OR path*');
    assert.deepStrictEqual(query.phrases, ["exact phrase"]);
    assert.deepStrictEqual(query.terms, ["exact", "phrase", "bridge", "or", "path"]);
    assert.include(query.ftsQuery, '"exact phrase"');
    assert.include(query.ftsQuery, '"bridge"*');
    assert.notInclude(query.ftsQuery, "path**");
    assert.equal(buildLexicalQuery('"exact phrase" bridge OR path*').ftsQuery, query.ftsQuery);
  });

  it("supports phrase, symbol, and path matching without FTS", () => {
    const matches = searchLexicalFallback(
      buildLexicalQuery('"preload bridge" readFile'),
      [
        {
          id: "bridge",
          title: "Desktop preload bridge",
          content: "Expose readFile through a constrained API.",
          path: "apps/desktop/src/preload.ts",
          symbols: ["readFile"],
        },
        { id: "other", title: "Other", content: "No match", path: null, symbols: [] },
      ],
      10,
    );
    assert.deepStrictEqual(
      matches.map((match) => match.id),
      ["bridge"],
    );
    assert.include(matches[0]?.matchedFields ?? [], "symbols");
  });
});

describe("MemoryRetrieval ranking and auditing", () => {
  it.effect("orders task, mission, branch, project, and user scopes deterministically", () => {
    const entries = (["user", "project", "branch", "mission", "task"] as const).map((scope) =>
      memoryCandidate(entry(`entry-${scope}`, scope)),
    );
    const { service, records } = dataSource(settings(), {
      engine: "fts",
      memories: entries,
      chunks: [],
    });
    return Effect.gen(function* () {
      const result = yield* retrieve(service, request());
      assert.deepStrictEqual(
        result.context.memories.map((memory) => memory.entry.scopeType),
        ["task", "mission", "branch", "project", "user"],
      );
      assert.equal(records.length, 1);
      assert.deepStrictEqual(
        records[0]?.selectedMemoryIds,
        result.context.memories.map((m) => m.entry.id),
      );
      assert.equal(records[0]?.agentRunId, AgentRunId.make("memory-run"));
      assert.equal(records[0]?.threadId, threadId);
      assert.equal(records[0]?.messageId, MessageId.make("memory-message"));
    });
  });

  it.effect("keeps project rules ahead of duplicate generic user preferences", () => {
    const user = entry("user-duplicate", "user", { title: "Formatting", content: "Use tabs." });
    const project = entry("project-duplicate", "project", {
      title: "Formatting",
      content: "Use tabs.",
    });
    const { service } = dataSource(settings(), {
      engine: "fallback",
      memories: [memoryCandidate(user), memoryCandidate(project)],
      chunks: [],
    });
    return Effect.gen(function* () {
      const result = yield* retrieve(service, request());
      assert.deepStrictEqual(
        result.context.memories.map((memory) => memory.entry.id),
        [project.id],
      );
      assert.equal(result.excludedCandidateCount, 1);
    });
  });

  it.effect("does not leak branch memory or indexed chunks across branches", () => {
    const current = entry("current-branch", "branch");
    const other = entry("other-branch", "branch", {
      scopeId: "agent/other/task",
      branchName: "agent/other/task",
    });
    const otherSource: IndexedSource = {
      ...indexedSource,
      id: IndexedSourceId.make("other-indexed-source"),
      branchName: "agent/other/task",
    };
    const otherChunk: IndexedChunk = {
      ...indexedChunk,
      id: IndexedChunkId.make("other-chunk"),
      indexedSourceId: otherSource.id,
      contentFingerprint: "sha256:other-chunk",
    };
    const { service } = dataSource(settings(), {
      engine: "fts",
      memories: [memoryCandidate(current), memoryCandidate(other)],
      chunks: [chunkCandidate(), chunkCandidate({ chunk: otherChunk, source: otherSource })],
    });
    return Effect.gen(function* () {
      const result = yield* retrieve(service, request());
      assert.deepStrictEqual(
        result.context.memories.map((memory) => memory.entry.id),
        [current.id],
      );
      assert.deepStrictEqual(
        result.context.sourceExcerpts.map((excerpt) => excerpt.indexedChunkId),
        [indexedChunk.id],
      );
    });
  });

  it.effect("excludes inactive and low-trust claims while retaining exact citations", () => {
    const active = entry("active", "project", { trustLevel: "verified" });
    const variants: ReadonlyArray<[MemoryEntryStatus, MemoryTrustLevel]> = [
      ["stale", "supported"],
      ["superseded", "verified"],
      ["disputed", "disputed"],
      ["rejected", "supported"],
    ];
    const candidates = [
      memoryCandidate(active),
      ...variants.map(([status, trustLevel], index) =>
        memoryCandidate(entry(`inactive-${index}`, "project", { status, trustLevel })),
      ),
      memoryCandidate(entry("weak", "project", { trustLevel: "inferred" })),
    ];
    const { service } = dataSource(settings(), {
      engine: "fts",
      memories: candidates,
      chunks: [],
    });
    return Effect.gen(function* () {
      const result = yield* retrieve(service, request({ minimumTrust: "supported" }));
      assert.deepStrictEqual(
        result.context.memories.map((memory) => memory.entry.id),
        [active.id],
      );
      assert.deepInclude(result.context.memories[0]?.citation, {
        path: "apps/desktop/src/preload.ts",
        startLine: 12,
        endLine: 44,
        commitHash: "abc123",
        freshness: "current",
      });
    });
  });

  it.effect(
    "fits redacted source excerpts and their envelope into the configured token budget",
    () => {
      const { service, records } = dataSource(settings({ contextTokenBudget: 192 }), {
        engine: "fts",
        memories: [],
        chunks: [chunkCandidate()],
      });
      return Effect.gen(function* () {
        const result = yield* retrieve(service, request({ tokenBudget: 192 }));
        assert.isAtMost(result.context.tokenEstimate, 192);
        assert.equal(result.context.sourceExcerpts.length, 1);
        assert.equal(result.context.sourceExcerpts[0]?.path, "apps/desktop/src/preload.ts");
        assert.equal(records[0]?.tokenEstimate, result.context.tokenEstimate);
      });
    },
  );

  it.effect("returns no context when the budget cannot fit a safe context envelope", () => {
    const { service } = dataSource(settings({ contextTokenBudget: 8 }), {
      engine: "fts",
      memories: [],
      chunks: [chunkCandidate()],
    });
    return Effect.gen(function* () {
      const result = yield* retrieve(service, request({ tokenBudget: 8 }));
      assert.equal(result.context.tokenEstimate, 0);
      assert.equal(result.context.sourceExcerpts.length, 0);
      assert.equal(result.excludedCandidateCount, 1);
    });
  });

  it.effect("labels included stale claims and changed sources as uncertainty", () => {
    const stale = entry("stale-labeled", "project", {
      status: "stale",
      staleReason: "Supporting file changed",
    });
    const { service } = dataSource(settings({ staleMemoryBehavior: "include_labeled" }), {
      engine: "fts",
      memories: [
        memoryCandidate(stale, {
          sources: [source(stale, { sourceStatus: "changed" })],
        }),
      ],
      chunks: [],
    });
    return Effect.gen(function* () {
      const result = yield* retrieve(service, request());
      assert.deepStrictEqual(
        result.context.memories.map((memory) => memory.entry.id),
        [stale.id],
      );
      assert.isTrue(
        result.context.uncertainties.some(
          (uncertainty) =>
            uncertainty.memoryId === stale.id && uncertainty.reason === "Supporting file changed",
        ),
      );
      assert.equal(result.context.memories[0]?.citation?.freshness, "changed");
    });
  });

  it.effect("records disabled retrieval without searching", () => {
    let searches = 0;
    const { service: base, records } = dataSource(settings({ enabled: false }), {
      engine: "fts",
      memories: [],
      chunks: [],
    });
    const service: MemoryRetrievalDataSourceShape = {
      ...base,
      searchLexical: (input) => {
        searches += 1;
        return base.searchLexical(input);
      },
    };
    return Effect.gen(function* () {
      const result = yield* retrieve(
        service,
        request({ agentRunId: null, threadId: null, messageId: null }),
      );
      assert.equal(result.context.retrievalMode, "disabled");
      assert.equal(searches, 0);
      assert.equal(records[0]?.status, "disabled");
      assert.equal(records[0]?.threadId, null);
    });
  });

  it.effect("persists a failed audit when lexical retrieval is unavailable", () => {
    const { service: base, records } = dataSource(settings(), {
      engine: "fts",
      memories: [],
      chunks: [],
    });
    const service: MemoryRetrievalDataSourceShape = {
      ...base,
      searchLexical: () =>
        Effect.fail(
          new MemoryRetrievalError({
            reason: "lexical_search_failed",
            message: "Lexical index unavailable",
          }),
        ),
    };
    return Effect.gen(function* () {
      const result = yield* Effect.result(retrieve(service, request()));
      assert.isTrue(Result.isFailure(result));
      assert.equal(records[0]?.status, "failed");
      assert.equal(records[0]?.errorSummary, "Lexical index unavailable");
    });
  });

  it.effect("falls back to lexical retrieval without uploading a query remotely", () =>
    Effect.gen(function* () {
      let remoteExecutions = 0;
      let semanticSearches = 0;
      const configured = yield* makeConfiguredEmbeddingProvider(
        {
          id: "remote-private",
          kind: "remote",
          model: "remote-v1",
          dimensions: 2,
          sendsContentRemotely: true,
          remoteContentDescription: "The active retrieval query",
          remoteCodeUploadAcceptedAt: null,
        },
        () => {
          remoteExecutions += 1;
          return Effect.succeed({ model: "remote-v1", dimensions: 2, vectors: [[1, 0]] });
        },
      );
      const active = entry("lexical-fallback", "project");
      const { service: base, records } = dataSource(
        settings({
          lexicalOnly: false,
          semanticRetrievalEnabled: true,
          embeddingProviderKind: "remote",
          embeddingProviderId: "remote-private",
          embeddingModel: "remote-v1",
          embeddingDimensions: 2,
          remoteCodeUploadAcceptedAt: now,
        }),
        { engine: "fts", memories: [memoryCandidate(active)], chunks: [] },
      );
      const service: MemoryRetrievalDataSourceShape = {
        ...base,
        searchSemantic: (input) => {
          semanticSearches += 1;
          return base.searchSemantic(input);
        },
      };
      const result = yield* retrieve(service, request({ mode: "hybrid" }), {
        configured: Option.some(configured),
      });
      assert.equal(result.context.retrievalMode, "lexical");
      assert.deepStrictEqual(
        result.context.memories.map((memory) => memory.entry.id),
        [active.id],
      );
      assert.equal(remoteExecutions, 0);
      assert.equal(semanticSearches, 0);
      const metadata = records[0]?.rankingMetadata;
      assert.isObject(metadata);
      if (
        typeof metadata === "object" &&
        metadata !== null &&
        "semanticFallbackReason" in metadata
      ) {
        assert.equal(
          metadata.semanticFallbackReason,
          "Remote embedding is disabled until remote content processing is accepted",
        );
      }
    }),
  );

  it.effect("combines validated local semantic hits with lexical candidates", () =>
    Effect.gen(function* () {
      const configured = yield* makeConfiguredEmbeddingProvider(
        {
          id: "local-semantic",
          kind: "local",
          model: "local-v1",
          dimensions: 2,
          sendsContentRemotely: false,
          remoteContentDescription: null,
          remoteCodeUploadAcceptedAt: null,
        },
        () => Effect.succeed({ model: "local-v1", dimensions: 2, vectors: [[0.5, 0.5]] }),
      );
      const lexicalEntry = entry("lexical-entry", "project");
      const semanticEntry = entry("semantic-entry", "task", {
        title: "Semantic architecture",
        content: "Renderer filesystem access belongs behind the preload bridge.",
      });
      const { service, records } = dataSource(
        settings({
          lexicalOnly: false,
          semanticRetrievalEnabled: true,
          embeddingProviderKind: "local",
          embeddingProviderId: "local-semantic",
          embeddingModel: "local-v1",
          embeddingDimensions: 2,
        }),
        { engine: "fts", memories: [memoryCandidate(lexicalEntry)], chunks: [] },
        {
          memories: [
            memoryCandidate(semanticEntry, {
              lexicalScore: null,
              semanticScore: 0.95,
              matchedFields: ["embedding"],
            }),
          ],
          chunks: [],
        },
      );
      const result = yield* retrieve(service, request({ mode: "hybrid" }), {
        configured: Option.some(configured),
      });
      assert.equal(result.context.retrievalMode, "hybrid");
      assert.deepStrictEqual(
        new Set(result.context.memories.map((memory) => memory.entry.id)),
        new Set([lexicalEntry.id, semanticEntry.id]),
      );
      assert.equal(records[0]?.retrievalMode, "hybrid");
    }),
  );

  it.effect("redacts durable audit queries without changing the in-memory search query", () =>
    Effect.gen(function* () {
      const secret = "sk-abcdefghijklmnopqrstuvwxyz";
      const memory = entry("audit-redaction", "project", {
        content: "selected-memory-content-sentinel",
      });
      const { service: base, records } = dataSource(settings(), {
        engine: "fts",
        memories: [memoryCandidate(memory)],
        chunks: [chunkCandidate()],
      });
      let searchedQuery = "";
      const service: MemoryRetrievalDataSourceShape = {
        ...base,
        searchLexical: (input) => {
          searchedQuery = input.input.query;
          return base.searchLexical(input);
        },
      };

      yield* retrieve(service, request({ query: `find api_key=${secret}` }));

      assert.equal(searchedQuery, `find api_key=${secret}`);
      assert.notInclude(records[0]?.query ?? "", secret);
      assert.include(records[0]?.query ?? "", "[REDACTED]");
      const metadata = records[0]?.rankingMetadata;
      assert.isObject(metadata);
      if (typeof metadata === "object" && metadata !== null) {
        assert.notProperty(metadata, "content");
        assert.notProperty(metadata, "excerpt");
        if ("lexicalQuery" in metadata) {
          assert.notInclude(String(metadata.lexicalQuery), secret);
        }
        if ("selected" in metadata && Array.isArray(metadata.selected)) {
          for (const selected of metadata.selected) {
            assert.deepStrictEqual(Object.keys(selected).sort(), [
              "id",
              "kind",
              "reasons",
              "score",
            ]);
          }
        }
      }
    }),
  );
});
