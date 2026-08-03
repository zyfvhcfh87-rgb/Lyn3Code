import {
  IndexedChunkId,
  IndexedSourceId,
  ProjectId,
  type IndexedChunk,
  type IndexedSource,
  type MemorySettings,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionMemoryRepositoryShape } from "../persistence/Services/ProjectionMemory.ts";
import type { EmbeddingProviderShape } from "./EmbeddingProvider.ts";
import { makeMemoryEmbeddingCoordinator } from "./MemoryEmbeddingCoordinator.ts";

const now = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("embedding-project");

const settings: MemorySettings = {
  projectId,
  enabled: true,
  automaticProposalGeneration: false,
  automaticAuthoritativeIndexing: true,
  repositoryExclusions: [],
  maximumIndexedFileSizeBytes: 1_000_000,
  contextTokenBudget: 2_000,
  lexicalOnly: false,
  semanticRetrievalEnabled: true,
  embeddingProviderKind: "local",
  embeddingProviderId: "local-test",
  embeddingModel: "tiny-test",
  embeddingDimensions: 2,
  remoteCodeUploadAcceptedAt: null,
  proposalRetentionDays: 30,
  staleMemoryBehavior: "exclude",
  indexingPaused: false,
  createdAt: now,
  updatedAt: now,
};

const source = (id: string, branchName: string | null): IndexedSource => ({
  id: IndexedSourceId.make(id),
  projectId,
  sourceType: "repository_file",
  sourceIdentifier: `${id}.ts`,
  relativePath: `${id}.ts`,
  branchName,
  commitHash: "abc123",
  contentFingerprint: `sha256:${id}`,
  language: "typescript",
  sizeBytes: 20,
  indexStatus: "indexed",
  skipReason: null,
  lastIndexedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
});

const chunk = (
  id: string,
  indexedSourceId: IndexedSource["id"],
  fingerprint: string,
): IndexedChunk => ({
  id: IndexedChunkId.make(id),
  indexedSourceId,
  chunkIndex: 0,
  startLine: 1,
  endLine: 1,
  content: `content ${fingerprint}`,
  contentFingerprint: fingerprint,
  tokenEstimate: 3,
  symbolMetadata: null,
  embeddingStatus: "queued",
  embeddingProvider: null,
  embeddingModel: null,
  embeddingDimensions: null,
  createdAt: now,
  updatedAt: now,
});

it.effect("embeds changed fingerprints once and persists vectors for every matching chunk", () => {
  const sourceA = source("source-a", null);
  const sourceB = source("source-b", null);
  const branchSource = source("branch-source", "feature/other");
  const hits = [
    { chunk: chunk("chunk-a", sourceA.id, "same"), source: sourceA, lexicalScore: 0 },
    { chunk: chunk("chunk-b", sourceB.id, "same"), source: sourceB, lexicalScore: 0 },
    { chunk: chunk("chunk-c", sourceB.id, "different"), source: sourceB, lexicalScore: 0 },
    {
      chunk: chunk("branch-chunk", branchSource.id, "branch"),
      source: branchSource,
      lexicalScore: 0,
    },
  ];
  const embeddedTexts: Array<ReadonlyArray<string>> = [];
  const saved: Array<string> = [];
  const statuses: Array<string> = [];
  const repository: Pick<
    ProjectionMemoryRepositoryShape,
    | "getOrCreateSettings"
    | "listIndexedChunks"
    | "saveChunkEmbedding"
    | "updateChunkEmbeddingStatus"
  > = {
    getOrCreateSettings: () => Effect.succeed(settings),
    listIndexedChunks: (input) => Effect.succeed(input.offset === 0 ? hits : []),
    saveChunkEmbedding: (input) =>
      Effect.sync(() => {
        saved.push(input.indexedChunkId);
      }),
    updateChunkEmbeddingStatus: (input) =>
      Effect.sync(() => {
        statuses.push(`${input.indexedChunkId}:${input.status}`);
      }),
  };
  const provider: EmbeddingProviderShape = {
    configured: Option.some({
      metadata: {
        id: "local-test",
        kind: "local",
        model: "tiny-test",
        dimensions: 2,
        sendsContentRemotely: false,
        remoteContentDescription: null,
        remoteCodeUploadAcceptedAt: null,
      },
      embed: (request) =>
        Effect.sync(() => {
          embeddedTexts.push(request.texts);
          return request.texts.map((_, index) => [index + 1, index + 2]);
        }),
    }),
  };

  return Effect.gen(function* () {
    const coordinator = makeMemoryEmbeddingCoordinator(repository, provider);
    const outcome = yield* coordinator.processProject({ projectId, branchName: null });
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.uniqueContentsEmbedded, 2);
    assert.equal(outcome.processedChunks, 3);
    assert.equal(embeddedTexts.flat().length, 2);
    assert.deepStrictEqual(saved.sort(), ["chunk-a", "chunk-b", "chunk-c"]);
    assert.equal(statuses.length, 3);
    assert.isFalse(saved.includes("branch-chunk"));
  });
});

it.effect("does not call a remote provider without project-level upload consent", () => {
  let called = false;
  const repository = {
    getOrCreateSettings: () =>
      Effect.succeed({
        ...settings,
        embeddingProviderKind: "remote" as const,
        embeddingProviderId: "remote-test",
      }),
    listIndexedChunks: () => Effect.succeed([]),
    saveChunkEmbedding: () => Effect.void,
    updateChunkEmbeddingStatus: () => Effect.void,
  };
  const provider: EmbeddingProviderShape = {
    configured: Option.some({
      metadata: {
        id: "remote-test",
        kind: "remote",
        model: "tiny-test",
        dimensions: 2,
        sendsContentRemotely: true,
        remoteContentDescription: "Redacted indexed source chunks",
        remoteCodeUploadAcceptedAt: now,
      },
      embed: () => {
        called = true;
        return Effect.succeed([]);
      },
    }),
  };

  return Effect.gen(function* () {
    const outcome = yield* makeMemoryEmbeddingCoordinator(repository, provider).processProject({
      projectId,
      branchName: null,
    });
    assert.equal(outcome.status, "unavailable");
    assert.isFalse(called);
  });
});
