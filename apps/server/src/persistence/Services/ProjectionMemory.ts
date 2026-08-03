import type {
  CreateMemoryEntryInput,
  CreateMemoryProposalInput,
  CreateMemoryRelationInput,
  IndexedChunk,
  IndexedChunkId,
  IndexedSource,
  IndexedSourceId,
  IndexedSourceStatus,
  EmbeddingStatus,
  MemoryEntry,
  MemoryEntryActionInput,
  MemoryEntryDetail,
  MemoryEntryId,
  MemoryEntryStatus,
  MemoryExportBundle,
  MemoryImportInput,
  MemoryIndexOperation,
  MemoryIndexOperationId,
  MemoryLifecycleRecord,
  MemoryListFilter,
  MemoryProposal,
  MemoryProposalId,
  MemoryProposalListFilter,
  MemoryRelation,
  MemoryRetrievalRecord,
  MemoryRetrievalRecordId,
  MemorySettings,
  MemorySource,
  MemorySourceDraft,
  MemorySourceId,
  MemorySearchInput,
  ProjectId,
  ReviewMemoryProposalInput,
  SupersedeMemoryEntryInput,
  UpdateMemoryEntryInput,
  UpdateMemorySettingsInput,
} from "@t3tools/contracts";
import type {
  MemoryConflictError,
  MemoryNotFoundError,
  MemoryValidationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

export type ProjectionMemoryRepositoryError =
  | ProjectionRepositoryError
  | MemoryValidationError
  | MemoryNotFoundError
  | MemoryConflictError;

export interface MemoryEntrySearchHit {
  readonly entry: MemoryEntry;
  /** SQLite bm25 is normalized so a larger value is always better. */
  readonly lexicalScore: number;
}

export interface IndexedChunkSearchHit {
  readonly chunk: IndexedChunk;
  readonly source: IndexedSource;
  /** SQLite bm25 is normalized so a larger value is always better. */
  readonly lexicalScore: number;
}

export interface AddMemorySourceInput {
  readonly memoryEntryId: MemoryEntryId;
  readonly source: MemorySourceDraft;
  readonly actorType: MemoryEntry["createdByType"];
  readonly actorId: string | null;
  readonly reason: string | null;
}

export interface ListMemoryRelationsInput {
  readonly memoryEntryId: MemoryEntryId;
}

export interface IndexedSourceIdentityInput {
  readonly projectId: ProjectId;
  readonly sourceType: IndexedSource["sourceType"];
  readonly sourceIdentifier: string;
  readonly branchName: string | null;
  readonly commitHash: string | null;
}

export interface ListIndexedSourcesInput {
  readonly projectId: ProjectId;
  readonly branchName: string | null;
  readonly statuses: ReadonlyArray<IndexedSourceStatus>;
  readonly limit: number;
  readonly offset: number;
}

export interface UpdateIndexedSourceStatusInput {
  readonly indexedSourceId: IndexedSourceId;
  readonly status: IndexedSourceStatus;
  readonly skipReason: string | null;
  readonly lastError: string | null;
  readonly lastIndexedAt: string | null;
  readonly updatedAt: string;
}

export interface ReplaceIndexedChunksInput {
  readonly indexedSourceId: IndexedSourceId;
  readonly chunks: ReadonlyArray<IndexedChunk>;
  readonly lastIndexedAt: string;
}

export interface ListIndexedChunksInput {
  readonly projectId: ProjectId;
  readonly indexedSourceId: IndexedSourceId | null;
  readonly branchName: string | null;
  readonly pathPrefix: string | null;
  readonly limit: number;
  readonly offset: number;
}

export interface SearchIndexedChunksInput {
  readonly projectId: ProjectId;
  readonly query: string;
  readonly branchName: string | null;
  readonly pathPrefix: string | null;
  readonly limit: number;
}

export interface MemoryIndexStats {
  readonly indexedFiles: number;
  readonly skippedFiles: number;
  readonly failedFiles: number;
  readonly indexedChunks: number;
  readonly indexSizeBytes: number;
  readonly lastIndexedAt: string | null;
  readonly embeddingStatus: EmbeddingStatus;
}

export interface ClearDerivedIndexInput {
  readonly projectId: ProjectId;
  readonly branchName: string | null;
}

export interface SaveChunkEmbeddingInput {
  readonly indexedChunkId: IndexedChunkId;
  readonly providerId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly vector: Uint8Array;
  readonly contentFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateChunkEmbeddingStatusInput {
  readonly indexedChunkId: IndexedChunkId;
  readonly status: EmbeddingStatus;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly dimensions: number | null;
  readonly updatedAt: string;
}

export interface SearchChunkEmbeddingsInput {
  readonly projectId: ProjectId;
  readonly branchName: string | null;
  readonly pathPrefix: string | null;
  readonly providerId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly queryVector: ReadonlyArray<number>;
  readonly limit: number;
}

export interface EmbeddedChunkSearchHit {
  readonly chunk: IndexedChunk;
  readonly source: IndexedSource;
  readonly similarity: number;
}

/** Embedding blobs use portable little-endian float32 components. */
export const encodeMemoryEmbeddingVector = (vector: ReadonlyArray<number>): Uint8Array => {
  const bytes = new Uint8Array(vector.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < vector.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, vector[index] ?? 0, true);
  }
  return bytes;
};

export const decodeMemoryEmbeddingVector = (
  bytes: Uint8Array,
  dimensions: number,
): ReadonlyArray<number> | null => {
  if (bytes.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = Array.from({ length: dimensions }, (_, index) =>
    view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true),
  );
  return vector.every(Number.isFinite) ? vector : null;
};

export interface GetCurrentIndexOperationInput {
  readonly projectId: ProjectId;
}

export interface RecoverIndexOperationsInput {
  readonly projectId: ProjectId;
  readonly recoveredAt: string;
}

export interface ListIndexOperationsInput {
  readonly projectId: ProjectId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListRetrievalRecordsInput {
  readonly projectId: ProjectId;
  readonly agentRunId: string | null;
  readonly threadId: string | null;
  readonly limit: number;
  readonly offset: number;
}

export interface MemoryImportResult {
  readonly importedEntryIds: ReadonlyArray<MemoryEntryId>;
  readonly createdProposalIds: ReadonlyArray<MemoryProposalId>;
  readonly skippedCount: number;
}

export interface ProjectionMemoryRepositoryShape {
  readonly createEntry: (
    input: CreateMemoryEntryInput,
  ) => Effect.Effect<MemoryEntryDetail, ProjectionMemoryRepositoryError>;
  readonly updateEntry: (
    input: UpdateMemoryEntryInput,
  ) => Effect.Effect<MemoryEntryDetail, ProjectionMemoryRepositoryError>;
  readonly applyEntryAction: (
    input: MemoryEntryActionInput,
  ) => Effect.Effect<MemoryEntryDetail, ProjectionMemoryRepositoryError>;
  readonly supersedeEntry: (
    input: SupersedeMemoryEntryInput,
  ) => Effect.Effect<MemoryEntryDetail, ProjectionMemoryRepositoryError>;
  readonly addSource: (
    input: AddMemorySourceInput,
  ) => Effect.Effect<MemorySource, ProjectionMemoryRepositoryError>;
  readonly createRelation: (
    input: CreateMemoryRelationInput,
  ) => Effect.Effect<MemoryRelation, ProjectionMemoryRepositoryError>;
  readonly getEntryDetail: (
    memoryEntryId: MemoryEntryId,
  ) => Effect.Effect<Option.Option<MemoryEntryDetail>, ProjectionMemoryRepositoryError>;
  readonly getSource: (
    memorySourceId: MemorySourceId,
  ) => Effect.Effect<Option.Option<MemorySource>, ProjectionMemoryRepositoryError>;
  readonly listEntrySources: (
    memoryEntryId: MemoryEntryId,
  ) => Effect.Effect<ReadonlyArray<MemorySource>, ProjectionMemoryRepositoryError>;
  readonly updateMemorySourceStatus: (input: {
    readonly memorySourceId: MemorySourceId;
    readonly status: MemorySource["sourceStatus"];
  }) => Effect.Effect<void, ProjectionMemoryRepositoryError>;
  readonly listRelations: (
    input: ListMemoryRelationsInput,
  ) => Effect.Effect<ReadonlyArray<MemoryRelation>, ProjectionMemoryRepositoryError>;
  readonly listEntries: (
    filter: MemoryListFilter,
  ) => Effect.Effect<ReadonlyArray<MemoryEntry>, ProjectionMemoryRepositoryError>;
  readonly countEntries: (
    filter: MemoryListFilter,
  ) => Effect.Effect<number, ProjectionMemoryRepositoryError>;
  readonly searchEligibleEntries: (
    input: MemorySearchInput,
  ) => Effect.Effect<ReadonlyArray<MemoryEntrySearchHit>, ProjectionMemoryRepositoryError>;

  readonly createProposal: (
    input: CreateMemoryProposalInput,
  ) => Effect.Effect<MemoryProposal, ProjectionMemoryRepositoryError>;
  readonly reviewProposal: (
    input: ReviewMemoryProposalInput,
  ) => Effect.Effect<MemoryProposal, ProjectionMemoryRepositoryError>;
  readonly getProposal: (
    proposalId: MemoryProposalId,
  ) => Effect.Effect<Option.Option<MemoryProposal>, ProjectionMemoryRepositoryError>;
  readonly listProposals: (
    filter: MemoryProposalListFilter,
  ) => Effect.Effect<ReadonlyArray<MemoryProposal>, ProjectionMemoryRepositoryError>;
  readonly countProposals: (
    filter: MemoryProposalListFilter,
  ) => Effect.Effect<number, ProjectionMemoryRepositoryError>;

  readonly getSettings: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<MemorySettings>, ProjectionMemoryRepositoryError>;
  readonly getOrCreateSettings: (
    projectId: ProjectId,
  ) => Effect.Effect<MemorySettings, ProjectionMemoryRepositoryError>;
  readonly saveSettings: (
    settings: MemorySettings,
  ) => Effect.Effect<MemorySettings, ProjectionMemoryRepositoryError>;
  readonly updateSettings: (
    input: UpdateMemorySettingsInput,
  ) => Effect.Effect<MemorySettings, ProjectionMemoryRepositoryError>;

  readonly upsertIndexedSource: (
    source: IndexedSource,
  ) => Effect.Effect<IndexedSource, ProjectionMemoryRepositoryError>;
  readonly getIndexedSource: (
    indexedSourceId: IndexedSourceId,
  ) => Effect.Effect<Option.Option<IndexedSource>, ProjectionMemoryRepositoryError>;
  readonly findIndexedSource: (
    input: IndexedSourceIdentityInput,
  ) => Effect.Effect<Option.Option<IndexedSource>, ProjectionMemoryRepositoryError>;
  readonly listIndexedSources: (
    input: ListIndexedSourcesInput,
  ) => Effect.Effect<ReadonlyArray<IndexedSource>, ProjectionMemoryRepositoryError>;
  readonly countIndexedSources: (
    input: ListIndexedSourcesInput,
  ) => Effect.Effect<number, ProjectionMemoryRepositoryError>;
  readonly updateIndexedSourceStatus: (
    input: UpdateIndexedSourceStatusInput,
  ) => Effect.Effect<IndexedSource, ProjectionMemoryRepositoryError>;
  readonly replaceIndexedChunks: (
    input: ReplaceIndexedChunksInput,
  ) => Effect.Effect<ReadonlyArray<IndexedChunk>, ProjectionMemoryRepositoryError>;
  readonly listIndexedChunks: (
    input: ListIndexedChunksInput,
  ) => Effect.Effect<ReadonlyArray<IndexedChunkSearchHit>, ProjectionMemoryRepositoryError>;
  readonly searchIndexedChunks: (
    input: SearchIndexedChunksInput,
  ) => Effect.Effect<ReadonlyArray<IndexedChunkSearchHit>, ProjectionMemoryRepositoryError>;
  readonly countIndexedChunks: (input: {
    readonly projectId: ProjectId;
    readonly branchName: string | null;
  }) => Effect.Effect<number, ProjectionMemoryRepositoryError>;
  readonly getIndexStats: (input: {
    readonly projectId: ProjectId;
    readonly branchName: string | null;
  }) => Effect.Effect<MemoryIndexStats, ProjectionMemoryRepositoryError>;
  readonly clearDerivedIndex: (
    input: ClearDerivedIndexInput,
  ) => Effect.Effect<number, ProjectionMemoryRepositoryError>;
  readonly saveChunkEmbedding: (
    input: SaveChunkEmbeddingInput,
  ) => Effect.Effect<void, ProjectionMemoryRepositoryError>;
  readonly updateChunkEmbeddingStatus: (
    input: UpdateChunkEmbeddingStatusInput,
  ) => Effect.Effect<void, ProjectionMemoryRepositoryError>;
  readonly searchChunkEmbeddings: (
    input: SearchChunkEmbeddingsInput,
  ) => Effect.Effect<ReadonlyArray<EmbeddedChunkSearchHit>, ProjectionMemoryRepositoryError>;

  readonly saveIndexOperation: (
    operation: MemoryIndexOperation,
  ) => Effect.Effect<MemoryIndexOperation, ProjectionMemoryRepositoryError>;
  readonly getIndexOperation: (
    operationId: MemoryIndexOperationId,
  ) => Effect.Effect<Option.Option<MemoryIndexOperation>, ProjectionMemoryRepositoryError>;
  readonly getCurrentIndexOperation: (
    input: GetCurrentIndexOperationInput,
  ) => Effect.Effect<Option.Option<MemoryIndexOperation>, ProjectionMemoryRepositoryError>;
  readonly listIndexOperations: (
    input: ListIndexOperationsInput,
  ) => Effect.Effect<ReadonlyArray<MemoryIndexOperation>, ProjectionMemoryRepositoryError>;
  readonly recoverInterruptedIndexOperations: (
    input: RecoverIndexOperationsInput,
  ) => Effect.Effect<ReadonlyArray<MemoryIndexOperation>, ProjectionMemoryRepositoryError>;

  readonly saveRetrievalRecord: (
    record: MemoryRetrievalRecord,
  ) => Effect.Effect<MemoryRetrievalRecord, ProjectionMemoryRepositoryError>;
  readonly getRetrievalRecord: (
    recordId: MemoryRetrievalRecordId,
  ) => Effect.Effect<Option.Option<MemoryRetrievalRecord>, ProjectionMemoryRepositoryError>;
  readonly listRetrievalRecords: (
    input: ListRetrievalRecordsInput,
  ) => Effect.Effect<ReadonlyArray<MemoryRetrievalRecord>, ProjectionMemoryRepositoryError>;
  readonly countRetrievalRecords: (
    input: ListRetrievalRecordsInput,
  ) => Effect.Effect<number, ProjectionMemoryRepositoryError>;
  readonly exportMemory: (
    projectId: ProjectId | null,
  ) => Effect.Effect<MemoryExportBundle, ProjectionMemoryRepositoryError>;
  readonly importMemory: (
    input: MemoryImportInput,
  ) => Effect.Effect<MemoryImportResult, ProjectionMemoryRepositoryError>;
}

export class ProjectionMemoryRepository extends Context.Service<
  ProjectionMemoryRepository,
  ProjectionMemoryRepositoryShape
>()("t3/persistence/Services/ProjectionMemory/ProjectionMemoryRepository") {}

export type {
  IndexedChunk,
  IndexedSource,
  MemoryEntry,
  MemoryEntryDetail,
  MemoryEntryStatus,
  MemoryLifecycleRecord,
  MemoryProposal,
  MemoryRelation,
  MemoryRetrievalRecord,
  MemorySettings,
  MemorySource,
};
