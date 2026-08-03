import * as Schema from "effect/Schema";

import {
  AgentRunId,
  IsoDateTime,
  MessageId,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  VerificationRunId,
} from "./baseSchemas.ts";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

const BoundedString = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));
const BoundedNonEmptyString = (maximumLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maximumLength));
const Confidence = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const MemoryEntryId = entityId("MemoryEntryId");
export type MemoryEntryId = typeof MemoryEntryId.Type;
export const MemorySourceId = entityId("MemorySourceId");
export type MemorySourceId = typeof MemorySourceId.Type;
export const MemoryRelationId = entityId("MemoryRelationId");
export type MemoryRelationId = typeof MemoryRelationId.Type;
export const MemoryProposalId = entityId("MemoryProposalId");
export type MemoryProposalId = typeof MemoryProposalId.Type;
export const IndexedSourceId = entityId("IndexedSourceId");
export type IndexedSourceId = typeof IndexedSourceId.Type;
export const IndexedChunkId = entityId("IndexedChunkId");
export type IndexedChunkId = typeof IndexedChunkId.Type;
export const MemoryRetrievalRecordId = entityId("MemoryRetrievalRecordId");
export type MemoryRetrievalRecordId = typeof MemoryRetrievalRecordId.Type;
export const MemoryLifecycleRecordId = entityId("MemoryLifecycleRecordId");
export type MemoryLifecycleRecordId = typeof MemoryLifecycleRecordId.Type;
export const MemoryIndexOperationId = entityId("MemoryIndexOperationId");
export type MemoryIndexOperationId = typeof MemoryIndexOperationId.Type;
export const MemoryAggregateId = entityId("MemoryAggregateId");
export type MemoryAggregateId = typeof MemoryAggregateId.Type;

export const MemoryScopeType = Schema.Literals(["user", "project", "branch", "mission", "task"]);
export type MemoryScopeType = typeof MemoryScopeType.Type;

export const MemoryEntryType = Schema.Literals([
  "architecture_decision",
  "constraint",
  "coding_convention",
  "product_requirement",
  "known_issue",
  "failed_approach",
  "successful_pattern",
  "dependency_fact",
  "environment_fact",
  "command",
  "test_procedure",
  "release_procedure",
  "security_rule",
  "user_preference",
  "repository_fact",
  "mission_summary",
  "task_result",
  "review_feedback",
  "custom",
]);
export type MemoryEntryType = typeof MemoryEntryType.Type;

export const MemoryTrustLevel = Schema.Literals([
  "authoritative",
  "verified",
  "supported",
  "inferred",
  "unverified",
  "disputed",
]);
export type MemoryTrustLevel = typeof MemoryTrustLevel.Type;

export const MemoryEntryStatus = Schema.Literals([
  "proposed",
  "active",
  "stale",
  "superseded",
  "disputed",
  "rejected",
  "archived",
]);
export type MemoryEntryStatus = typeof MemoryEntryStatus.Type;

export const MemoryCreatedByType = Schema.Literals(["user", "agent", "system", "import"]);
export type MemoryCreatedByType = typeof MemoryCreatedByType.Type;

export const MemoryCreationMode = Schema.Literals([
  "explicit",
  "proposed",
  "automatic_authoritative",
]);
export type MemoryCreationMode = typeof MemoryCreationMode.Type;

export const MemorySourceType = Schema.Literals([
  "repository_file",
  "git_commit",
  "git_diff",
  "agents_file",
  "documentation",
  "user_instruction",
  "mission_event",
  "agent_handoff",
  "verification_result",
  "github_issue",
  "github_pull_request",
  "github_review",
  "manual_entry",
  "derived",
]);
export type MemorySourceType = typeof MemorySourceType.Type;

export const MemoryRelationType = Schema.Literals([
  "supports",
  "contradicts",
  "supersedes",
  "refines",
  "depends_on",
  "applies_to",
  "derived_from",
  "related_to",
]);
export type MemoryRelationType = typeof MemoryRelationType.Type;

export const MemoryProposalStatus = Schema.Literals([
  "pending",
  "accepted",
  "edited_and_accepted",
  "rejected",
  "expired",
  "duplicate",
  "deferred",
]);
export type MemoryProposalStatus = typeof MemoryProposalStatus.Type;

export const IndexedSourceType = Schema.Literals([
  "repository_file",
  "repository_map",
  "github_issue",
  "github_pull_request",
  "github_review",
  "agent_handoff",
  "verification_summary",
]);
export type IndexedSourceType = typeof IndexedSourceType.Type;

export const IndexedSourceStatus = Schema.Literals([
  "queued",
  "indexing",
  "indexed",
  "skipped",
  "stale",
  "failed",
  "removed",
]);
export type IndexedSourceStatus = typeof IndexedSourceStatus.Type;

export const EmbeddingStatus = Schema.Literals([
  "disabled",
  "queued",
  "embedding",
  "embedded",
  "stale",
  "failed",
]);
export type EmbeddingStatus = typeof EmbeddingStatus.Type;

export const MemoryRetrievalMode = Schema.Literals([
  "lexical",
  "semantic",
  "hybrid",
  "explicit",
  "disabled",
]);
export type MemoryRetrievalMode = typeof MemoryRetrievalMode.Type;

export const MemoryIndexOperationType = Schema.Literals([
  "refresh_changed",
  "full_reindex",
  "branch_refresh",
  "clear_derived_index",
  "recovery",
]);
export type MemoryIndexOperationType = typeof MemoryIndexOperationType.Type;

export const MemoryIndexOperationStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);
export type MemoryIndexOperationStatus = typeof MemoryIndexOperationStatus.Type;

export const MemoryStaleBehavior = Schema.Literals(["exclude", "demote", "include_labeled"]);
export type MemoryStaleBehavior = typeof MemoryStaleBehavior.Type;

export const EmbeddingProviderKind = Schema.Literals(["none", "local", "remote"]);
export type EmbeddingProviderKind = typeof EmbeddingProviderKind.Type;

export const MemoryScope = Schema.Struct({
  scopeType: MemoryScopeType,
  scopeId: Schema.NullOr(TrimmedNonEmptyString),
  projectId: Schema.NullOr(ProjectId),
  branchName: Schema.NullOr(BoundedNonEmptyString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
});
export type MemoryScope = typeof MemoryScope.Type;

export const MemoryEntry = Schema.Struct({
  id: MemoryEntryId,
  ...MemoryScope.fields,
  type: MemoryEntryType,
  title: BoundedNonEmptyString(500),
  content: BoundedNonEmptyString(64_000),
  structuredData: Schema.NullOr(Schema.Unknown),
  trustLevel: MemoryTrustLevel,
  status: MemoryEntryStatus,
  confidence: Confidence,
  createdByType: MemoryCreatedByType,
  createdById: Schema.NullOr(TrimmedNonEmptyString),
  creationMode: MemoryCreationMode,
  pinned: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastVerifiedAt: Schema.NullOr(IsoDateTime),
  expiresAt: Schema.NullOr(IsoDateTime),
  supersededById: Schema.NullOr(MemoryEntryId),
  contradictionGroupId: Schema.NullOr(TrimmedNonEmptyString),
  staleReason: Schema.NullOr(BoundedString(4_000)),
});
export type MemoryEntry = typeof MemoryEntry.Type;

export const MemorySource = Schema.Struct({
  id: MemorySourceId,
  memoryEntryId: MemoryEntryId,
  sourceType: MemorySourceType,
  sourceIdentifier: BoundedNonEmptyString(4_096),
  projectId: Schema.NullOr(ProjectId),
  repositoryPath: Schema.NullOr(BoundedString(4_096)),
  filePath: Schema.NullOr(BoundedString(4_096)),
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  commitHash: Schema.NullOr(BoundedNonEmptyString(255)),
  branchName: Schema.NullOr(BoundedNonEmptyString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: Schema.NullOr(AgentRunId),
  verificationRunId: Schema.NullOr(VerificationRunId),
  githubRecordType: Schema.NullOr(BoundedNonEmptyString(100)),
  githubRecordId: Schema.NullOr(BoundedNonEmptyString(255)),
  messageReference: Schema.NullOr(BoundedString(2_048)),
  contentFingerprint: Schema.NullOr(BoundedNonEmptyString(255)),
  sourceStatus: Schema.Literals(["resolved", "changed", "missing", "unresolved"]),
  createdAt: IsoDateTime,
});
export type MemorySource = typeof MemorySource.Type;

export const MemorySourceDraft = Schema.Struct({
  sourceType: MemorySourceType,
  sourceIdentifier: BoundedNonEmptyString(4_096),
  projectId: Schema.NullOr(ProjectId),
  repositoryPath: Schema.NullOr(BoundedString(4_096)),
  filePath: Schema.NullOr(BoundedString(4_096)),
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  commitHash: Schema.NullOr(BoundedString(255)),
  branchName: Schema.NullOr(BoundedString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: Schema.NullOr(AgentRunId),
  verificationRunId: Schema.NullOr(VerificationRunId),
  githubRecordType: Schema.NullOr(BoundedString(100)),
  githubRecordId: Schema.NullOr(BoundedString(255)),
  messageReference: Schema.NullOr(BoundedString(2_048)),
  contentFingerprint: Schema.NullOr(BoundedString(255)),
});
export type MemorySourceDraft = typeof MemorySourceDraft.Type;

export const MemoryRelation = Schema.Struct({
  id: MemoryRelationId,
  fromMemoryEntryId: MemoryEntryId,
  toMemoryEntryId: MemoryEntryId,
  relationType: MemoryRelationType,
  createdAt: IsoDateTime,
});
export type MemoryRelation = typeof MemoryRelation.Type;

export const MemoryProposal = Schema.Struct({
  id: MemoryProposalId,
  scopeType: MemoryScopeType,
  scopeId: Schema.NullOr(TrimmedNonEmptyString),
  projectId: ProjectId,
  branchName: Schema.NullOr(BoundedNonEmptyString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  proposedType: MemoryEntryType,
  proposedTitle: BoundedNonEmptyString(500),
  proposedContent: BoundedNonEmptyString(64_000),
  proposedStructuredData: Schema.NullOr(Schema.Unknown),
  proposedTrustLevel: MemoryTrustLevel,
  confidence: Confidence,
  extractionSource: BoundedNonEmptyString(255),
  sourceReferences: Schema.Array(MemorySourceDraft),
  status: MemoryProposalStatus,
  reviewedBy: Schema.NullOr(TrimmedNonEmptyString),
  reviewedAt: Schema.NullOr(IsoDateTime),
  rejectionReason: Schema.NullOr(BoundedString(4_000)),
  duplicateOfMemoryEntryId: Schema.NullOr(MemoryEntryId),
  acceptedMemoryEntryId: Schema.NullOr(MemoryEntryId),
  createdAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type MemoryProposal = typeof MemoryProposal.Type;

export const IndexedSource = Schema.Struct({
  id: IndexedSourceId,
  projectId: ProjectId,
  sourceType: IndexedSourceType,
  sourceIdentifier: BoundedNonEmptyString(4_096),
  relativePath: Schema.NullOr(BoundedString(4_096)),
  branchName: Schema.NullOr(BoundedNonEmptyString(1_024)),
  commitHash: Schema.NullOr(BoundedNonEmptyString(255)),
  contentFingerprint: BoundedNonEmptyString(255),
  language: Schema.NullOr(BoundedNonEmptyString(100)),
  sizeBytes: NonNegativeInt,
  indexStatus: IndexedSourceStatus,
  skipReason: Schema.NullOr(BoundedString(2_000)),
  lastIndexedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(BoundedString(4_000)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IndexedSource = typeof IndexedSource.Type;

export const IndexedChunk = Schema.Struct({
  id: IndexedChunkId,
  indexedSourceId: IndexedSourceId,
  chunkIndex: NonNegativeInt,
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  content: BoundedString(64_000),
  contentFingerprint: BoundedNonEmptyString(255),
  tokenEstimate: NonNegativeInt,
  symbolMetadata: Schema.NullOr(Schema.Unknown),
  embeddingStatus: EmbeddingStatus,
  embeddingProvider: Schema.NullOr(BoundedNonEmptyString(255)),
  embeddingModel: Schema.NullOr(BoundedNonEmptyString(255)),
  embeddingDimensions: Schema.NullOr(PositiveInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IndexedChunk = typeof IndexedChunk.Type;

export const MemorySelectionReason = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals([
    "query_relevance",
    "scope_proximity",
    "trust",
    "source_authority",
    "branch_applicability",
    "recency",
    "freshness",
    "pinned",
    "lexical",
    "semantic",
  ]),
  summary: BoundedString(1_000),
  scoreContribution: Schema.Number,
});
export type MemorySelectionReason = typeof MemorySelectionReason.Type;

export const MemoryRetrievalRecord = Schema.Struct({
  id: MemoryRetrievalRecordId,
  agentRunId: Schema.NullOr(AgentRunId),
  threadId: Schema.NullOr(ThreadId),
  messageId: Schema.NullOr(MessageId),
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  branchName: Schema.NullOr(BoundedString(1_024)),
  query: BoundedString(16_000),
  retrievalMode: MemoryRetrievalMode,
  selectedMemoryIds: Schema.Array(MemoryEntryId),
  selectedChunkIds: Schema.Array(IndexedChunkId),
  excludedCandidateCount: NonNegativeInt,
  tokenEstimate: NonNegativeInt,
  rankingMetadata: Schema.Unknown,
  status: Schema.Literals(["completed", "disabled", "unavailable", "failed"]),
  errorSummary: Schema.NullOr(BoundedString(4_000)),
  createdAt: IsoDateTime,
});
export type MemoryRetrievalRecord = typeof MemoryRetrievalRecord.Type;

export const MemoryLifecycleRecord = Schema.Struct({
  id: MemoryLifecycleRecordId,
  memoryEntryId: MemoryEntryId,
  action: Schema.Literals([
    "created",
    "updated",
    "activated",
    "marked_stale",
    "verified",
    "superseded",
    "disputed",
    "rejected",
    "archived",
    "restored",
    "pinned",
    "unpinned",
    "scope_changed",
    "source_added",
  ]),
  previousStatus: Schema.NullOr(MemoryEntryStatus),
  nextStatus: Schema.NullOr(MemoryEntryStatus),
  actorType: MemoryCreatedByType,
  actorId: Schema.NullOr(TrimmedNonEmptyString),
  reason: Schema.NullOr(BoundedString(4_000)),
  createdAt: IsoDateTime,
});
export type MemoryLifecycleRecord = typeof MemoryLifecycleRecord.Type;

export const MemoryIndexOperation = Schema.Struct({
  id: MemoryIndexOperationId,
  projectId: ProjectId,
  operationType: MemoryIndexOperationType,
  status: MemoryIndexOperationStatus,
  branchName: Schema.NullOr(BoundedString(1_024)),
  commitHash: Schema.NullOr(BoundedString(255)),
  processedSources: NonNegativeInt,
  changedSources: NonNegativeInt,
  skippedSources: NonNegativeInt,
  failedSources: NonNegativeInt,
  errorSummary: Schema.NullOr(BoundedString(4_000)),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type MemoryIndexOperation = typeof MemoryIndexOperation.Type;

export const MemorySettings = Schema.Struct({
  projectId: ProjectId,
  enabled: Schema.Boolean,
  automaticProposalGeneration: Schema.Boolean,
  automaticAuthoritativeIndexing: Schema.Boolean,
  repositoryExclusions: Schema.Array(BoundedNonEmptyString(4_096)),
  maximumIndexedFileSizeBytes: PositiveInt,
  contextTokenBudget: NonNegativeInt,
  lexicalOnly: Schema.Boolean,
  semanticRetrievalEnabled: Schema.Boolean,
  embeddingProviderKind: EmbeddingProviderKind,
  embeddingProviderId: Schema.NullOr(BoundedNonEmptyString(255)),
  embeddingModel: Schema.NullOr(BoundedNonEmptyString(255)),
  embeddingDimensions: Schema.NullOr(PositiveInt),
  remoteCodeUploadAcceptedAt: Schema.NullOr(IsoDateTime),
  proposalRetentionDays: PositiveInt,
  staleMemoryBehavior: MemoryStaleBehavior,
  indexingPaused: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MemorySettings = typeof MemorySettings.Type;

export const CreateMemoryEntryInput = Schema.Struct({
  ...MemoryScope.fields,
  type: MemoryEntryType,
  title: BoundedNonEmptyString(500),
  content: BoundedNonEmptyString(64_000),
  structuredData: Schema.NullOr(Schema.Unknown),
  trustLevel: MemoryTrustLevel,
  confidence: Confidence,
  creationMode: MemoryCreationMode,
  createdByType: MemoryCreatedByType,
  createdById: Schema.NullOr(TrimmedNonEmptyString),
  sources: Schema.Array(MemorySourceDraft),
  pinned: Schema.Boolean,
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type CreateMemoryEntryInput = typeof CreateMemoryEntryInput.Type;

export const UpdateMemoryEntryInput = Schema.Struct({
  memoryEntryId: MemoryEntryId,
  title: Schema.optionalKey(BoundedNonEmptyString(500)),
  content: Schema.optionalKey(BoundedNonEmptyString(64_000)),
  structuredData: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  type: Schema.optionalKey(MemoryEntryType),
  trustLevel: Schema.optionalKey(MemoryTrustLevel),
  confidence: Schema.optionalKey(Confidence),
  scope: Schema.optionalKey(MemoryScope),
  pinned: Schema.optionalKey(Schema.Boolean),
  expiresAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  reason: Schema.NullOr(BoundedString(4_000)),
  actorType: MemoryCreatedByType,
  actorId: Schema.NullOr(TrimmedNonEmptyString),
});
export type UpdateMemoryEntryInput = typeof UpdateMemoryEntryInput.Type;

export const MemoryEntryActionInput = Schema.Struct({
  memoryEntryId: MemoryEntryId,
  action: Schema.Literals([
    "activate",
    "mark_stale",
    "dispute",
    "reject",
    "archive",
    "restore",
    "pin",
    "unpin",
    "verify",
  ]),
  reason: Schema.NullOr(BoundedString(4_000)),
  actorType: MemoryCreatedByType,
  actorId: Schema.NullOr(TrimmedNonEmptyString),
});
export type MemoryEntryActionInput = typeof MemoryEntryActionInput.Type;

export const SupersedeMemoryEntryInput = Schema.Struct({
  supersededMemoryEntryId: MemoryEntryId,
  replacementMemoryEntryId: MemoryEntryId,
  reason: BoundedNonEmptyString(4_000),
  actorType: MemoryCreatedByType,
  actorId: Schema.NullOr(TrimmedNonEmptyString),
});
export type SupersedeMemoryEntryInput = typeof SupersedeMemoryEntryInput.Type;

export const CreateMemoryRelationInput = Schema.Struct({
  fromMemoryEntryId: MemoryEntryId,
  toMemoryEntryId: MemoryEntryId,
  relationType: MemoryRelationType,
});
export type CreateMemoryRelationInput = typeof CreateMemoryRelationInput.Type;

export const CreateMemoryProposalInput = Schema.Struct({
  scopeType: MemoryScopeType,
  scopeId: Schema.NullOr(TrimmedNonEmptyString),
  projectId: ProjectId,
  branchName: Schema.NullOr(BoundedNonEmptyString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  proposedType: MemoryEntryType,
  proposedTitle: BoundedNonEmptyString(500),
  proposedContent: BoundedNonEmptyString(64_000),
  proposedStructuredData: Schema.NullOr(Schema.Unknown),
  proposedTrustLevel: MemoryTrustLevel,
  confidence: Confidence,
  extractionSource: BoundedNonEmptyString(255),
  sources: Schema.Array(MemorySourceDraft),
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type CreateMemoryProposalInput = typeof CreateMemoryProposalInput.Type;

export const ReviewMemoryProposalInput = Schema.Struct({
  proposalId: MemoryProposalId,
  action: Schema.Literals([
    "accept",
    "edit_and_accept",
    "reject",
    "mark_duplicate",
    "defer",
    "merge",
  ]),
  reviewedBy: TrimmedNonEmptyString,
  rejectionReason: Schema.NullOr(BoundedString(4_000)),
  duplicateOfMemoryEntryId: Schema.NullOr(MemoryEntryId),
  mergeIntoMemoryEntryId: Schema.NullOr(MemoryEntryId),
  editedEntry: Schema.NullOr(CreateMemoryEntryInput),
});
export type ReviewMemoryProposalInput = typeof ReviewMemoryProposalInput.Type;

export const MemoryListFilter = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  scopeTypes: Schema.Array(MemoryScopeType),
  types: Schema.Array(MemoryEntryType),
  statuses: Schema.Array(MemoryEntryStatus),
  trustLevels: Schema.Array(MemoryTrustLevel),
  sourceTypes: Schema.Array(MemorySourceType),
  branchName: Schema.NullOr(BoundedString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  query: BoundedString(4_000),
  createdAfter: Schema.NullOr(IsoDateTime),
  staleOnly: Schema.Boolean,
  pinnedOnly: Schema.Boolean,
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type MemoryListFilter = typeof MemoryListFilter.Type;

export const MemoryProposalListFilter = Schema.Struct({
  projectId: ProjectId,
  statuses: Schema.Array(MemoryProposalStatus),
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type MemoryProposalListFilter = typeof MemoryProposalListFilter.Type;

export const MemoryEntryPage = Schema.Struct({
  entries: Schema.Array(MemoryEntry),
  total: NonNegativeInt,
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type MemoryEntryPage = typeof MemoryEntryPage.Type;

export const MemoryProposalPage = Schema.Struct({
  proposals: Schema.Array(MemoryProposal),
  total: NonNegativeInt,
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type MemoryProposalPage = typeof MemoryProposalPage.Type;

export const IndexedSourcePage = Schema.Struct({
  sources: Schema.Array(IndexedSource),
  total: NonNegativeInt,
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type IndexedSourcePage = typeof IndexedSourcePage.Type;

export const MemoryRetrievalRecordPage = Schema.Struct({
  records: Schema.Array(MemoryRetrievalRecord),
  total: NonNegativeInt,
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type MemoryRetrievalRecordPage = typeof MemoryRetrievalRecordPage.Type;

export const MemoryEntryDetail = Schema.Struct({
  entry: MemoryEntry,
  sources: Schema.Array(MemorySource),
  relations: Schema.Array(MemoryRelation),
  lifecycle: Schema.Array(MemoryLifecycleRecord),
  retrievalCount: NonNegativeInt,
});
export type MemoryEntryDetail = typeof MemoryEntryDetail.Type;

export const MemoryIndexStatus = Schema.Struct({
  projectId: ProjectId,
  status: Schema.Literals([
    "not_indexed",
    "indexing",
    "partial",
    "current",
    "stale",
    "failed",
    "paused",
    "recovering",
  ]),
  currentBranch: Schema.NullOr(BoundedString(1_024)),
  currentCommit: Schema.NullOr(BoundedString(255)),
  indexedFiles: NonNegativeInt,
  indexedChunks: NonNegativeInt,
  skippedPaths: NonNegativeInt,
  failedFiles: NonNegativeInt,
  indexSizeBytes: NonNegativeInt,
  embeddingStatus: EmbeddingStatus,
  lastIndexedAt: Schema.NullOr(IsoDateTime),
  currentOperation: Schema.NullOr(MemoryIndexOperation),
});
export type MemoryIndexStatus = typeof MemoryIndexStatus.Type;

export const MemoryIndexRequest = Schema.Struct({
  projectId: ProjectId,
  operationType: MemoryIndexOperationType,
  branchName: Schema.NullOr(BoundedString(1_024)),
});
export type MemoryIndexRequest = typeof MemoryIndexRequest.Type;

export const IndexedSourceListInput = Schema.Struct({
  projectId: ProjectId,
  statuses: Schema.Array(IndexedSourceStatus),
  pathPrefix: Schema.NullOr(BoundedString(4_096)),
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type IndexedSourceListInput = typeof IndexedSourceListInput.Type;

export const AddMemorySourceInput = Schema.Struct({
  memoryEntryId: MemoryEntryId,
  source: MemorySourceDraft,
});
export type AddMemorySourceInput = typeof AddMemorySourceInput.Type;

export const MemoryRetrievalListInput = Schema.Struct({
  projectId: ProjectId,
  agentRunId: Schema.NullOr(AgentRunId),
  threadId: Schema.NullOr(ThreadId),
  limit: PositiveInt,
  offset: NonNegativeInt,
});
export type MemoryRetrievalListInput = typeof MemoryRetrievalListInput.Type;

export const MemorySearchInput = Schema.Struct({
  projectId: ProjectId,
  branchName: Schema.NullOr(BoundedString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  query: BoundedString(16_000),
  mode: MemoryRetrievalMode,
  pathPrefix: Schema.NullOr(BoundedString(4_096)),
  types: Schema.Array(MemoryEntryType),
  statuses: Schema.Array(MemoryEntryStatus),
  minimumTrust: Schema.NullOr(MemoryTrustLevel),
  tokenBudget: NonNegativeInt,
  limit: PositiveInt,
});
export type MemorySearchInput = typeof MemorySearchInput.Type;

export const MemoryCitation = Schema.Struct({
  sourceType: MemorySourceType,
  sourceIdentifier: BoundedNonEmptyString(4_096),
  path: Schema.NullOr(BoundedString(4_096)),
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  commitHash: Schema.NullOr(BoundedString(255)),
  branchName: Schema.NullOr(BoundedString(1_024)),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  verificationRunId: Schema.NullOr(VerificationRunId),
  githubRecordType: Schema.NullOr(BoundedString(100)),
  githubRecordId: Schema.NullOr(BoundedString(255)),
  freshness: Schema.Literals(["current", "changed", "missing", "unresolved"]),
});
export type MemoryCitation = typeof MemoryCitation.Type;

export const RetrievedMemory = Schema.Struct({
  entry: MemoryEntry,
  citation: Schema.NullOr(MemoryCitation),
  score: Schema.Number,
  selectionReasons: Schema.Array(MemorySelectionReason),
});
export type RetrievedMemory = typeof RetrievedMemory.Type;

export const RetrievedSourceExcerpt = Schema.Struct({
  indexedChunkId: IndexedChunkId,
  path: BoundedNonEmptyString(4_096),
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  commitHash: Schema.NullOr(BoundedString(255)),
  branchName: Schema.NullOr(BoundedString(1_024)),
  content: BoundedString(16_000),
  tokenEstimate: NonNegativeInt,
  score: Schema.Number,
  selectionReasons: Schema.Array(MemorySelectionReason),
});
export type RetrievedSourceExcerpt = typeof RetrievedSourceExcerpt.Type;

export const MemoryUncertainty = Schema.Struct({
  memoryId: Schema.NullOr(MemoryEntryId),
  indexedChunkId: Schema.NullOr(IndexedChunkId),
  reason: BoundedNonEmptyString(2_000),
});
export type MemoryUncertainty = typeof MemoryUncertainty.Type;

export const AgentMemoryContextPackage = Schema.Struct({
  scope: Schema.Struct({
    projectId: ProjectId,
    branch: Schema.NullOr(BoundedString(1_024)),
    missionId: Schema.NullOr(MissionId),
    taskId: Schema.NullOr(MissionTaskId),
  }),
  memories: Schema.Array(RetrievedMemory),
  sourceExcerpts: Schema.Array(RetrievedSourceExcerpt),
  uncertainties: Schema.Array(MemoryUncertainty),
  tokenEstimate: NonNegativeInt,
  retrievalMode: MemoryRetrievalMode,
  auditRecordId: Schema.NullOr(MemoryRetrievalRecordId),
});
export type AgentMemoryContextPackage = typeof AgentMemoryContextPackage.Type;

export const MemorySearchResult = Schema.Struct({
  context: AgentMemoryContextPackage,
  totalCandidateCount: NonNegativeInt,
  excludedCandidateCount: NonNegativeInt,
});
export type MemorySearchResult = typeof MemorySearchResult.Type;

export const MemoryWorkspaceSnapshot = Schema.Struct({
  projectId: ProjectId,
  settings: MemorySettings,
  indexStatus: MemoryIndexStatus,
  activeMemoryCount: NonNegativeInt,
  proposalCount: NonNegativeInt,
  staleMemoryCount: NonNegativeInt,
  conflictCount: NonNegativeInt,
  lastRetrievalAt: Schema.NullOr(IsoDateTime),
});
export type MemoryWorkspaceSnapshot = typeof MemoryWorkspaceSnapshot.Type;

export const UpdateMemorySettingsInput = Schema.Struct({
  projectId: ProjectId,
  enabled: Schema.optionalKey(Schema.Boolean),
  automaticProposalGeneration: Schema.optionalKey(Schema.Boolean),
  automaticAuthoritativeIndexing: Schema.optionalKey(Schema.Boolean),
  repositoryExclusions: Schema.optionalKey(Schema.Array(BoundedNonEmptyString(4_096))),
  maximumIndexedFileSizeBytes: Schema.optionalKey(PositiveInt),
  contextTokenBudget: Schema.optionalKey(NonNegativeInt),
  lexicalOnly: Schema.optionalKey(Schema.Boolean),
  semanticRetrievalEnabled: Schema.optionalKey(Schema.Boolean),
  embeddingProviderKind: Schema.optionalKey(EmbeddingProviderKind),
  embeddingProviderId: Schema.optionalKey(Schema.NullOr(BoundedNonEmptyString(255))),
  embeddingModel: Schema.optionalKey(Schema.NullOr(BoundedNonEmptyString(255))),
  embeddingDimensions: Schema.optionalKey(Schema.NullOr(PositiveInt)),
  remoteCodeUploadAcceptedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  proposalRetentionDays: Schema.optionalKey(PositiveInt),
  staleMemoryBehavior: Schema.optionalKey(MemoryStaleBehavior),
  indexingPaused: Schema.optionalKey(Schema.Boolean),
});
export type UpdateMemorySettingsInput = typeof UpdateMemorySettingsInput.Type;

export const MemoryExportBundle = Schema.Struct({
  version: Schema.Literal(1),
  exportedAt: IsoDateTime,
  projectId: Schema.NullOr(ProjectId),
  entries: Schema.Array(MemoryEntryDetail),
  proposals: Schema.Array(MemoryProposal),
  settings: Schema.NullOr(MemorySettings),
});
export type MemoryExportBundle = typeof MemoryExportBundle.Type;

export const MemoryImportInput = Schema.Struct({
  bundle: MemoryExportBundle,
  targetProjectId: Schema.NullOr(ProjectId),
  conflictPolicy: Schema.Literals(["skip", "propose", "import_inactive"]),
  importedBy: TrimmedNonEmptyString,
});
export type MemoryImportInput = typeof MemoryImportInput.Type;

export const MemoryImportResult = Schema.Struct({
  importedMemoryIds: Schema.Array(MemoryEntryId),
  proposedMemoryIds: Schema.Array(MemoryProposalId),
  skippedCount: NonNegativeInt,
});
export type MemoryImportResult = typeof MemoryImportResult.Type;

/** Reference-sized audit events. Chunks, excerpts, claims, and embeddings stay in dedicated tables. */
export const MemoryOrchestrationEventType = Schema.Literals([
  "memory.entry_created",
  "memory.entry_updated",
  "memory.entry_activated",
  "memory.entry_marked_stale",
  "memory.entry_superseded",
  "memory.entry_disputed",
  "memory.entry_rejected",
  "memory.entry_archived",
  "memory.source_added",
  "memory.source_changed",
  "memory.source_missing",
  "memory.proposal_created",
  "memory.proposal_accepted",
  "memory.proposal_edited_and_accepted",
  "memory.proposal_rejected",
  "memory.proposal_marked_duplicate",
  "memory.contradiction_detected",
  "memory.contradiction_resolved",
  "memory.index_requested",
  "memory.index_started",
  "memory.index_source_completed",
  "memory.index_source_failed",
  "memory.index_completed",
  "memory.index_interrupted",
  "memory.embedding_started",
  "memory.embedding_completed",
  "memory.embedding_failed",
  "memory.embedding_provider_changed",
  "memory.retrieval_started",
  "memory.retrieval_completed",
  "memory.retrieval_failed",
  "memory.feedback_received",
]);
export type MemoryOrchestrationEventType = typeof MemoryOrchestrationEventType.Type;

export const MemoryEventReferencePayload = Schema.Struct({
  aggregateId: MemoryAggregateId,
  projectId: Schema.NullOr(ProjectId),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  memoryEntryId: Schema.NullOr(MemoryEntryId),
  memorySourceId: Schema.NullOr(MemorySourceId),
  proposalId: Schema.NullOr(MemoryProposalId),
  indexedSourceId: Schema.NullOr(IndexedSourceId),
  indexOperationId: Schema.NullOr(MemoryIndexOperationId),
  retrievalRecordId: Schema.NullOr(MemoryRetrievalRecordId),
  contradictionGroupId: Schema.NullOr(BoundedString(255)),
  embeddingProvider: Schema.NullOr(BoundedString(255)),
  embeddingModel: Schema.NullOr(BoundedString(255)),
  summary: Schema.NullOr(BoundedString(2_000)),
  occurredAt: IsoDateTime,
});
export type MemoryEventReferencePayload = typeof MemoryEventReferencePayload.Type;

export class MemoryValidationError extends Schema.TaggedErrorClass<MemoryValidationError>()(
  "MemoryValidationError",
  {
    message: BoundedNonEmptyString(4_000),
    field: Schema.NullOr(BoundedString(255)),
  },
) {}

export class MemoryNotFoundError extends Schema.TaggedErrorClass<MemoryNotFoundError>()(
  "MemoryNotFoundError",
  {
    entityType: Schema.Literals(["entry", "source", "proposal", "index", "retrieval"]),
    entityId: TrimmedNonEmptyString,
  },
) {}

export class MemoryConflictError extends Schema.TaggedErrorClass<MemoryConflictError>()(
  "MemoryConflictError",
  {
    message: BoundedNonEmptyString(4_000),
    conflictingMemoryIds: Schema.Array(MemoryEntryId),
  },
) {}

export class MemoryUnavailableError extends Schema.TaggedErrorClass<MemoryUnavailableError>()(
  "MemoryUnavailableError",
  {
    reason: Schema.Literals(["disabled", "index_unavailable", "semantic_unavailable", "offline"]),
    message: BoundedNonEmptyString(4_000),
  },
) {}
