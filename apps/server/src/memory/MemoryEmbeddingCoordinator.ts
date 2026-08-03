import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  encodeMemoryEmbeddingVector,
  ProjectionMemoryRepository,
  type IndexedChunkSearchHit,
  type ProjectionMemoryRepositoryShape,
} from "../persistence/Services/ProjectionMemory.ts";
import { EmbeddingProvider, type EmbeddingProviderShape } from "./EmbeddingProvider.ts";

export interface MemoryEmbeddingResult {
  readonly status: "disabled" | "unavailable" | "completed" | "failed";
  readonly processedChunks: number;
  readonly failedChunks: number;
  readonly uniqueContentsEmbedded: number;
  readonly reason: string | null;
}

export interface MemoryEmbeddingCoordinatorShape {
  readonly processProject: (input: {
    readonly projectId: ProjectId;
    readonly branchName: string | null;
  }) => Effect.Effect<MemoryEmbeddingResult>;
}

export class MemoryEmbeddingCoordinator extends Context.Service<
  MemoryEmbeddingCoordinator,
  MemoryEmbeddingCoordinatorShape
>()("t3/memory/MemoryEmbeddingCoordinator") {}

type MemoryEmbeddingRepository = Pick<
  ProjectionMemoryRepositoryShape,
  "getOrCreateSettings" | "listIndexedChunks" | "saveChunkEmbedding" | "updateChunkEmbeddingStatus"
>;

const result = (
  status: MemoryEmbeddingResult["status"],
  reason: string | null,
  processedChunks = 0,
  failedChunks = 0,
  uniqueContentsEmbedded = 0,
): MemoryEmbeddingResult => ({
  status,
  processedChunks,
  failedChunks,
  uniqueContentsEmbedded,
  reason,
});

const batchesOf = <Value>(values: ReadonlyArray<Value>, size: number) => {
  const batches: Array<ReadonlyArray<Value>> = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
};

/**
 * Embeds only source chunks whose current fingerprint is not already represented by the selected
 * provider/model. Equal fingerprints across worktrees share one provider call, while every local
 * chunk retains its own auditable embedding row.
 */
export const makeMemoryEmbeddingCoordinator = (
  repository: MemoryEmbeddingRepository,
  embeddingProvider: EmbeddingProviderShape,
): MemoryEmbeddingCoordinatorShape => ({
  processProject: (input) =>
    Effect.gen(function* () {
      const settings = yield* repository.getOrCreateSettings(input.projectId);
      if (!settings.enabled || !settings.semanticRetrievalEnabled || settings.lexicalOnly) {
        return result("disabled", "Semantic retrieval is disabled for this project.");
      }
      if (Option.isNone(embeddingProvider.configured)) {
        return result("unavailable", "No embedding provider is configured in this environment.");
      }

      const provider = embeddingProvider.configured.value;
      const metadata = provider.metadata;
      const settingsMatch =
        settings.embeddingProviderKind === metadata.kind &&
        settings.embeddingProviderId === metadata.id &&
        settings.embeddingModel === metadata.model &&
        settings.embeddingDimensions === metadata.dimensions;
      if (!settingsMatch) {
        return result(
          "unavailable",
          "The configured embedding provider does not match the project's explicit settings.",
        );
      }
      if (
        metadata.sendsContentRemotely &&
        (metadata.kind !== "remote" || settings.remoteCodeUploadAcceptedAt === null)
      ) {
        return result(
          "unavailable",
          "Remote source processing has not been explicitly accepted for this project.",
        );
      }

      // The repository is paged so large projects never require one unbounded database response.
      const indexedHits: Array<IndexedChunkSearchHit> = [];
      let offset = 0;
      const pageSize = 500;
      while (true) {
        const page = yield* repository.listIndexedChunks({
          projectId: input.projectId,
          indexedSourceId: null,
          branchName: null,
          pathPrefix: null,
          limit: pageSize,
          offset,
        });
        indexedHits.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      const pending = indexedHits.filter(
        ({ chunk, source }) =>
          source.indexStatus === "indexed" &&
          source.branchName === input.branchName &&
          (chunk.embeddingStatus !== "embedded" ||
            chunk.embeddingProvider !== metadata.id ||
            chunk.embeddingModel !== metadata.model ||
            chunk.embeddingDimensions !== metadata.dimensions),
      );
      const groups = new Map<
        string,
        {
          readonly content: string;
          readonly hits: Array<(typeof pending)[number]>;
        }
      >();
      for (const hit of pending) {
        const existing = groups.get(hit.chunk.contentFingerprint);
        if (existing === undefined) {
          groups.set(hit.chunk.contentFingerprint, { content: hit.chunk.content, hits: [hit] });
        } else {
          existing.hits.push(hit);
        }
      }

      let processedChunks = 0;
      let failedChunks = 0;
      let uniqueContentsEmbedded = 0;
      for (const batch of batchesOf([...groups.values()], 32)) {
        const startedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        yield* Effect.forEach(
          batch.flatMap((group) => group.hits),
          ({ chunk }) =>
            repository.updateChunkEmbeddingStatus({
              indexedChunkId: chunk.id,
              status: "embedding",
              providerId: metadata.id,
              model: metadata.model,
              dimensions: metadata.dimensions,
              updatedAt: startedAt,
            }),
          { concurrency: 8, discard: true },
        );

        const vectors = yield* provider
          .embed({ kind: "source", texts: batch.map((group) => group.content) })
          .pipe(Effect.option);
        const completedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        if (Option.isNone(vectors)) {
          const failed = batch.flatMap((group) => group.hits);
          failedChunks += failed.length;
          yield* Effect.forEach(
            failed,
            ({ chunk }) =>
              repository.updateChunkEmbeddingStatus({
                indexedChunkId: chunk.id,
                status: "failed",
                providerId: metadata.id,
                model: metadata.model,
                dimensions: metadata.dimensions,
                updatedAt: completedAt,
              }),
            { concurrency: 8, discard: true },
          );
          continue;
        }

        uniqueContentsEmbedded += batch.length;
        yield* Effect.forEach(
          batch,
          (group, index) => {
            const vector = vectors.value[index]!;
            const encoded = encodeMemoryEmbeddingVector(vector);
            processedChunks += group.hits.length;
            return Effect.forEach(
              group.hits,
              ({ chunk }) =>
                repository.saveChunkEmbedding({
                  indexedChunkId: chunk.id,
                  providerId: metadata.id,
                  model: metadata.model,
                  dimensions: metadata.dimensions,
                  vector: encoded,
                  contentFingerprint: chunk.contentFingerprint,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                }),
              { concurrency: 8, discard: true },
            );
          },
          { concurrency: 1, discard: true },
        );
      }

      return result(
        failedChunks === 0 ? "completed" : "failed",
        failedChunks === 0 ? null : "One or more embedding batches failed.",
        processedChunks,
        failedChunks,
        uniqueContentsEmbedded,
      );
    }).pipe(
      Effect.orElseSucceed(() =>
        result("failed", "The local embedding index could not be updated."),
      ),
    ),
});

export const layer = Layer.effect(
  MemoryEmbeddingCoordinator,
  Effect.gen(function* () {
    const repository = yield* ProjectionMemoryRepository;
    const provider = yield* EmbeddingProvider;
    return makeMemoryEmbeddingCoordinator(repository, provider);
  }),
);
