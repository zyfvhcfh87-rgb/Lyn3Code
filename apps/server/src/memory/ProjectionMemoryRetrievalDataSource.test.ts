import {
  IndexedChunkId,
  IndexedSourceId,
  MemoryEntryId,
  MemoryRetrievalRecordId,
  MemorySourceId,
  ProjectId,
  ThreadId,
  type IndexedChunk,
  type IndexedSource,
  type MemoryEntry,
  type MemoryRetrievalRecord,
  type MemorySettings,
  type MemorySource,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { buildLexicalQuery } from "./MemoryRetrieval.ts";
import {
  makeProjectionMemoryRetrievalDataSource,
  type ProjectionMemoryRetrievalRepository,
} from "./ProjectionMemoryRetrievalDataSource.ts";

const now = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("adapter-project");

const memorySettings: MemorySettings = {
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
};

const memoryEntry: MemoryEntry = {
  id: MemoryEntryId.make("adapter-entry"),
  scopeType: "project",
  scopeId: projectId,
  projectId,
  branchName: null,
  missionId: null,
  taskId: null,
  type: "architecture_decision",
  title: "Desktop bridge",
  content: "Use the preload bridge.",
  structuredData: null,
  trustLevel: "verified",
  status: "active",
  confidence: 1,
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
};

const memorySource: MemorySource = {
  id: MemorySourceId.make("adapter-source"),
  memoryEntryId: memoryEntry.id,
  sourceType: "repository_file",
  sourceIdentifier: "apps/desktop/src/preload.ts",
  projectId,
  repositoryPath: "C:\\repo",
  filePath: "apps/desktop/src/preload.ts",
  startLine: 1,
  endLine: 20,
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
};

const indexedSource: IndexedSource = {
  id: IndexedSourceId.make("adapter-indexed-source"),
  projectId,
  sourceType: "repository_file",
  sourceIdentifier: "apps/desktop/src/preload.ts",
  relativePath: "apps/desktop/src/preload.ts",
  branchName: null,
  commitHash: "abc123",
  contentFingerprint: "sha256:indexed-source",
  language: "typescript",
  sizeBytes: 100,
  indexStatus: "indexed",
  skipReason: null,
  lastIndexedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const indexedChunk: IndexedChunk = {
  id: IndexedChunkId.make("adapter-chunk"),
  indexedSourceId: indexedSource.id,
  chunkIndex: 0,
  startLine: 1,
  endLine: 2,
  content: "export const bridge = {};",
  contentFingerprint: "sha256:chunk",
  tokenEstimate: 6,
  symbolMetadata: null,
  embeddingStatus: "disabled",
  embeddingProvider: null,
  embeddingModel: null,
  embeddingDimensions: null,
  createdAt: now,
  updatedAt: now,
};

it.effect("adapts persistence lexical hits, sources, settings, and retrieval audit writes", () => {
  let entryQuery = "";
  let chunkQuery = "";
  const records: Array<MemoryRetrievalRecord> = [];
  const repository: ProjectionMemoryRetrievalRepository = {
    getOrCreateSettings: () => Effect.succeed(memorySettings),
    searchEligibleEntries: (input) => {
      entryQuery = input.query;
      return Effect.succeed([{ entry: memoryEntry, lexicalScore: 0.8 }]);
    },
    listEntrySources: () => Effect.succeed([memorySource]),
    searchIndexedChunks: (input) => {
      chunkQuery = input.query;
      return Effect.succeed([{ chunk: indexedChunk, source: indexedSource, lexicalScore: 0.7 }]);
    },
    searchChunkEmbeddings: () =>
      Effect.succeed([{ chunk: indexedChunk, source: indexedSource, similarity: 0.8 }]),
    saveRetrievalRecord: (record) =>
      Effect.sync(() => {
        records.push(record);
        return record;
      }),
  };
  const dataSource = makeProjectionMemoryRetrievalDataSource(repository);
  const input = {
    projectId,
    branchName: null,
    missionId: null,
    taskId: null,
    query: "bridge OR *",
    mode: "lexical" as const,
    pathPrefix: null,
    types: [],
    statuses: [],
    minimumTrust: null,
    tokenBudget: 1_000,
    limit: 10,
  };
  return Effect.gen(function* () {
    assert.deepStrictEqual(yield* dataSource.getSettings(projectId), memorySettings);
    const hits = yield* dataSource.searchLexical({
      input,
      query: buildLexicalQuery(input.query),
      candidateLimit: 80,
    });
    assert.equal(entryQuery, input.query);
    assert.equal(chunkQuery, input.query);
    assert.equal(hits.memories[0]?.sources[0]?.id, memorySource.id);
    assert.equal(hits.chunks[0]?.chunk.id, indexedChunk.id);

    const semanticHits = yield* dataSource.searchSemantic({
      input: { ...input, mode: "semantic" },
      vector: [0.25, 0.75],
      provider: {
        kind: "local",
        id: "test-provider",
        model: "test-model",
        dimensions: 2,
        sendsContentRemotely: false,
        remoteContentDescription: null,
        remoteCodeUploadAcceptedAt: null,
      },
      candidateLimit: 80,
    });
    assert.equal(semanticHits.chunks[0]?.chunk.id, indexedChunk.id);
    assert.equal(semanticHits.chunks[0]?.semanticScore, 0.9);
    assert.deepStrictEqual(semanticHits.chunks[0]?.matchedFields, ["embedding"]);

    const record: MemoryRetrievalRecord = {
      id: MemoryRetrievalRecordId.make("adapter-audit"),
      agentRunId: null,
      threadId: ThreadId.make("adapter-thread"),
      messageId: null,
      projectId,
      missionId: null,
      taskId: null,
      branchName: null,
      query: input.query,
      retrievalMode: "lexical",
      selectedMemoryIds: [memoryEntry.id],
      selectedChunkIds: [indexedChunk.id],
      excludedCandidateCount: 0,
      tokenEstimate: 10,
      rankingMetadata: {},
      status: "completed",
      errorSummary: null,
      createdAt: now,
    };
    yield* dataSource.saveRetrievalRecord(record);
    assert.deepStrictEqual(records, [record]);
  });
});
