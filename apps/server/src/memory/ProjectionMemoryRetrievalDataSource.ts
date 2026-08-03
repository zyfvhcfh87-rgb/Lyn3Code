import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ProjectionMemoryRepository,
  type ProjectionMemoryRepositoryShape,
} from "../persistence/Services/ProjectionMemory.ts";
import {
  MemoryRetrievalDataSource,
  MemoryRetrievalError,
  type MemoryRetrievalDataSourceShape,
} from "./MemoryRetrieval.ts";

export type ProjectionMemoryRetrievalRepository = Pick<
  ProjectionMemoryRepositoryShape,
  | "getOrCreateSettings"
  | "searchEligibleEntries"
  | "listEntrySources"
  | "searchIndexedChunks"
  | "searchChunkEmbeddings"
  | "saveRetrievalRecord"
>;

const repositoryError = (reason: MemoryRetrievalError["reason"], operation: string) =>
  Effect.mapError(
    () =>
      new MemoryRetrievalError({
        reason,
        message: `Memory repository operation failed: ${operation}`,
      }),
  );

export const makeProjectionMemoryRetrievalDataSource = (
  repository: ProjectionMemoryRetrievalRepository,
): MemoryRetrievalDataSourceShape => ({
  getSettings: (projectId) =>
    repository
      .getOrCreateSettings(projectId)
      .pipe(repositoryError("settings_unavailable", "getOrCreateSettings")),
  searchLexical: (request) =>
    Effect.gen(function* () {
      const [memoryHits, chunkHits] = yield* Effect.all([
        repository.searchEligibleEntries({
          ...request.input,
          limit: request.candidateLimit,
        }),
        repository.searchIndexedChunks({
          projectId: request.input.projectId,
          query: request.input.query,
          branchName: request.input.branchName,
          pathPrefix: request.input.pathPrefix,
          limit: request.candidateLimit,
        }),
      ]);
      const memories = yield* Effect.forEach(
        memoryHits,
        (hit) =>
          repository.listEntrySources(hit.entry.id).pipe(
            Effect.map((sources) => ({
              entry: hit.entry,
              sources,
              lexicalScore: hit.lexicalScore,
              semanticScore: null,
              matchedFields: ["full_text"],
            })),
          ),
        { concurrency: 8 },
      );
      return {
        engine: request.query.ftsQuery.length === 0 ? ("fallback" as const) : ("fts" as const),
        memories,
        chunks: chunkHits.map((hit) => ({
          chunk: hit.chunk,
          source: hit.source,
          lexicalScore: hit.lexicalScore,
          semanticScore: null,
          matchedFields: ["full_text"],
        })),
      };
    }).pipe(repositoryError("lexical_search_failed", "searchLexical")),
  searchSemantic: (request) =>
    repository
      .searchChunkEmbeddings({
        projectId: request.input.projectId,
        branchName: request.input.branchName,
        pathPrefix: request.input.pathPrefix,
        providerId: request.provider.id,
        model: request.provider.model,
        dimensions: request.provider.dimensions,
        queryVector: request.vector,
        limit: request.candidateLimit,
      })
      .pipe(
        Effect.map((hits) => ({
          memories: [],
          chunks: hits.map((hit) => ({
            chunk: hit.chunk,
            source: hit.source,
            lexicalScore: null,
            semanticScore: Math.max(0, Math.min(1, (hit.similarity + 1) / 2)),
            matchedFields: ["embedding"],
          })),
        })),
        repositoryError("semantic_search_failed", "searchChunkEmbeddings"),
      ),
  saveRetrievalRecord: (record) =>
    repository
      .saveRetrievalRecord(record)
      .pipe(Effect.asVoid, repositoryError("audit_failed", "saveRetrievalRecord")),
});

export const ProjectionMemoryRetrievalDataSourceLive = Layer.effect(
  MemoryRetrievalDataSource,
  Effect.map(ProjectionMemoryRepository, makeProjectionMemoryRetrievalDataSource),
);
