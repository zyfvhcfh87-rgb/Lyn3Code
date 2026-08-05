import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MissionId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  VerificationProfileId,
  VerificationRunId,
} from "./baseSchemas.ts";
import { PullRequestRecordId, RepositoryConnectionId } from "./github.ts";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const BoundedString = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));
const BoundedNonEmptyString = (maximumLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maximumLength));
const Digest = BoundedNonEmptyString(255);
const SourceCommit = BoundedNonEmptyString(255);
const NullableError = Schema.NullOr(BoundedString(4_000));

export const DeliveryMetadataValue = Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Number,
  BoundedString(2_048),
]);
export type DeliveryMetadataValue = typeof DeliveryMetadataValue.Type;

/** Public, secret-free metadata suitable for durable storage and audit output. */
export const DeliveryPublicMetadata = Schema.Record(
  BoundedNonEmptyString(128),
  DeliveryMetadataValue,
);
export type DeliveryPublicMetadata = typeof DeliveryPublicMetadata.Type;

export const DeliveryPolicyId = entityId("DeliveryPolicyId");
export type DeliveryPolicyId = typeof DeliveryPolicyId.Type;
export const MergeReadinessAssessmentId = entityId("MergeReadinessAssessmentId");
export type MergeReadinessAssessmentId = typeof MergeReadinessAssessmentId.Type;
export const DeliveryApprovalRequestId = entityId("DeliveryApprovalRequestId");
export type DeliveryApprovalRequestId = typeof DeliveryApprovalRequestId.Type;
export const ApprovalDecisionId = entityId("ApprovalDecisionId");
export type ApprovalDecisionId = typeof ApprovalDecisionId.Type;
export const MergeExecutionId = entityId("MergeExecutionId");
export type MergeExecutionId = typeof MergeExecutionId.Type;
export const ReleaseConfigurationId = entityId("ReleaseConfigurationId");
export type ReleaseConfigurationId = typeof ReleaseConfigurationId.Type;
export const ReleasePlanId = entityId("ReleasePlanId");
export type ReleasePlanId = typeof ReleasePlanId.Type;
export const ReleaseArtifactId = entityId("ReleaseArtifactId");
export type ReleaseArtifactId = typeof ReleaseArtifactId.Type;
export const DeploymentEnvironmentId = entityId("DeploymentEnvironmentId");
export type DeploymentEnvironmentId = typeof DeploymentEnvironmentId.Type;
export const DeploymentPlanId = entityId("DeploymentPlanId");
export type DeploymentPlanId = typeof DeploymentPlanId.Type;
export const DeploymentExecutionId = entityId("DeploymentExecutionId");
export type DeploymentExecutionId = typeof DeploymentExecutionId.Type;
export const DeploymentValidationRunId = entityId("DeploymentValidationRunId");
export type DeploymentValidationRunId = typeof DeploymentValidationRunId.Type;
export const RollbackPlanId = entityId("RollbackPlanId");
export type RollbackPlanId = typeof RollbackPlanId.Type;
export const RollbackExecutionId = entityId("RollbackExecutionId");
export type RollbackExecutionId = typeof RollbackExecutionId.Type;
export const DeliveryAuditEntryId = entityId("DeliveryAuditEntryId");
export type DeliveryAuditEntryId = typeof DeliveryAuditEntryId.Type;
export const DeliveryAggregateId = entityId("DeliveryAggregateId");
export type DeliveryAggregateId = typeof DeliveryAggregateId.Type;

export const DeliveryOrchestrationEventType = Schema.Literals([
  "delivery.readiness_requested",
  "delivery.readiness_completed",
  "delivery.readiness_invalidated",
  "delivery.blocked",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.expired",
  "approval.cancelled",
  "approval.superseded",
  "merge.requested",
  "merge.started",
  "merge.completed",
  "merge.failed",
  "merge.cancelled",
  "merge.stale",
  "merge.branch_cleanup_requested",
  "merge.branch_cleaned",
  "release.plan_created",
  "release.plan_updated",
  "release.approval_requested",
  "release.approved",
  "release.build_started",
  "release.artifact_created",
  "release.artifact_failed",
  "release.tag_created",
  "release.publication_started",
  "release.published",
  "release.failed",
  "release.cancelled",
  "deployment.environment_created",
  "deployment.plan_created",
  "deployment.approval_requested",
  "deployment.started",
  "deployment.provider_status_changed",
  "deployment.validation_started",
  "deployment.validation_passed",
  "deployment.validation_failed",
  "deployment.succeeded",
  "deployment.failed",
  "deployment.cancelled",
  "deployment.interrupted",
  "rollback.plan_created",
  "rollback.approval_requested",
  "rollback.started",
  "rollback.validation_started",
  "rollback.completed",
  "rollback.failed",
  "delivery.freeze_started",
  "delivery.freeze_ended",
  "delivery.override_applied",
]);
export type DeliveryOrchestrationEventType = typeof DeliveryOrchestrationEventType.Type;

export const DeliveryEventReferencePayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  resourceType: BoundedNonEmptyString(128),
  resourceId: DeliveryAggregateId,
  sourceCommit: Schema.NullOr(SourceCommit),
  summary: BoundedNonEmptyString(2_000),
  occurredAt: IsoDateTime,
});
export type DeliveryEventReferencePayload = typeof DeliveryEventReferencePayload.Type;

export const ApprovalType = Schema.Literals([
  "merge",
  "release",
  "deployment",
  "production_deployment",
  "rollback",
  "destructive_cleanup",
]);
export type ApprovalType = typeof ApprovalType.Type;
export const DeliveryOperationType = ApprovalType;
export type DeliveryOperationType = ApprovalType;

export const DeliveryPlanStatus = Schema.Literals([
  "draft",
  "pending_approval",
  "approved",
  "executing",
  "completed",
  "superseded",
  "cancelled",
  "failed",
  "interrupted",
]);
export type DeliveryPlanStatus = typeof DeliveryPlanStatus.Type;

export const DeliveryExecutionStatus = Schema.Literals([
  "queued",
  "preparing",
  "running",
  "validating",
  "succeeded",
  "succeeded_with_warnings",
  "failed",
  "cancelled",
  "interrupted",
  "indeterminate",
  "rolled_back",
]);
export type DeliveryExecutionStatus = typeof DeliveryExecutionStatus.Type;

export const ApprovalRequestStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "superseded",
  "cancelled",
  "expired",
]);
export type ApprovalRequestStatus = typeof ApprovalRequestStatus.Type;
export const ApprovalDecisionValue = Schema.Literals(["approve", "reject", "request_changes"]);
export type ApprovalDecisionValue = typeof ApprovalDecisionValue.Type;
export const MergeStrategy = Schema.Literals(["merge_commit", "squash", "rebase"]);
export type MergeStrategy = typeof MergeStrategy.Type;
export const MergeMethod = MergeStrategy;
export type MergeMethod = MergeStrategy;
export const DeploymentStrategy = Schema.Literals([
  "standard",
  "rolling",
  "canary",
  "blue_green",
  "provider_default",
  "custom",
]);
export type DeploymentStrategy = typeof DeploymentStrategy.Type;

export const DeliveryWindow = Schema.Struct({
  name: BoundedNonEmptyString(255),
  timezone: BoundedNonEmptyString(128),
  startsAt: BoundedNonEmptyString(64),
  endsAt: BoundedNonEmptyString(64),
});
export type DeliveryWindow = typeof DeliveryWindow.Type;

export const MergeDeliveryPolicy = Schema.Struct({
  requiredLocalVerificationProfiles: Schema.Array(VerificationProfileId),
  requireCurrentVerificationFingerprint: Schema.Boolean,
  requireRemoteChecks: Schema.Boolean,
  requireBranchProtectionCompliance: Schema.Boolean,
  requiredApprovalCount: NonNegativeInt,
  requiredReviewerTeams: Schema.Array(BoundedNonEmptyString(255)),
  requireResolvedThreads: Schema.Boolean,
  allowDraftMerge: Schema.Boolean,
  allowMergeWithWarnings: Schema.Boolean,
  allowAutomaticMerge: Schema.Boolean,
  allowedMergeStrategies: Schema.Array(MergeStrategy),
  allowedTargetBranches: Schema.Array(BoundedNonEmptyString(1_024)),
});
export type MergeDeliveryPolicy = typeof MergeDeliveryPolicy.Type;
export const ReleaseDeliveryPolicy = Schema.Struct({
  requiresApproval: Schema.Boolean,
  requiredApprovalCount: NonNegativeInt,
  allowedChannels: Schema.Array(BoundedNonEmptyString(128)),
  deliveryWindows: Schema.Array(DeliveryWindow),
  freezeWindows: Schema.Array(DeliveryWindow),
});
export type ReleaseDeliveryPolicy = typeof ReleaseDeliveryPolicy.Type;
export const DeploymentDeliveryPolicy = Schema.Struct({
  requiresApproval: Schema.Boolean,
  productionRequiresApproval: Schema.Boolean,
  productionApprovalCount: NonNegativeInt,
  allowedStrategies: Schema.Array(DeploymentStrategy),
  deliveryWindows: Schema.Array(DeliveryWindow),
  freezeWindows: Schema.Array(DeliveryWindow),
});
export type DeploymentDeliveryPolicy = typeof DeploymentDeliveryPolicy.Type;
export const RollbackDeliveryPolicy = Schema.Struct({
  requiresApproval: Schema.Boolean,
  allowAutomaticRollback: Schema.Boolean,
  maxAutomaticRollbacks: NonNegativeInt,
  destructiveCleanupRequiresApproval: Schema.Boolean,
});
export type RollbackDeliveryPolicy = typeof RollbackDeliveryPolicy.Type;

export const DeliveryPolicy = Schema.Struct({
  id: DeliveryPolicyId,
  projectId: ProjectId,
  name: BoundedNonEmptyString(255),
  description: BoundedString(4_000),
  isDefault: Schema.Boolean,
  version: PositiveInt,
  policyDigest: Digest,
  enabled: Schema.Boolean,
  mergePolicy: MergeDeliveryPolicy,
  releasePolicy: ReleaseDeliveryPolicy,
  deploymentPolicy: DeploymentDeliveryPolicy,
  rollbackPolicy: RollbackDeliveryPolicy,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DeliveryPolicy = typeof DeliveryPolicy.Type;

export const MergeReadinessResult = Schema.Literals([
  "ready",
  "ready_with_warnings",
  "blocked",
  "unknown",
  "stale",
]);
export type MergeReadinessResult = typeof MergeReadinessResult.Type;
export const ReadinessLaneState = Schema.Literals([
  "passed",
  "warning",
  "blocked",
  "unknown",
  "stale",
]);
export type ReadinessLaneState = typeof ReadinessLaneState.Type;
export const MergeReadinessLaneStates = Schema.Struct({
  localVerification: ReadinessLaneState,
  remoteChecks: ReadinessLaneState,
  reviews: ReadinessLaneState,
  threads: ReadinessLaneState,
  mergeability: ReadinessLaneState,
  branchProtection: ReadinessLaneState,
  secretScan: ReadinessLaneState,
  deliveryWindow: ReadinessLaneState,
});
export type MergeReadinessLaneStates = typeof MergeReadinessLaneStates.Type;
export const MergeReadinessEvidenceSnapshot = Schema.Struct({
  headSha: SourceCommit,
  baseSha: SourceCommit,
  strategy: MergeStrategy,
  requiredChecks: Schema.Array(BoundedNonEmptyString(255)),
  passedChecks: Schema.Array(BoundedNonEmptyString(255)),
  pendingChecks: Schema.Array(BoundedNonEmptyString(255)),
  failedChecks: Schema.Array(BoundedNonEmptyString(255)),
  approvals: NonNegativeInt,
  requiredApprovals: NonNegativeInt,
  changesRequested: Schema.Boolean,
  unresolvedBlockingThreads: NonNegativeInt,
  branchProtectionObservedAt: Schema.NullOr(IsoDateTime),
  localVerificationEvidence: Schema.Array(BoundedNonEmptyString(1_024)),
  secretScanEvidence: Schema.Array(BoundedNonEmptyString(1_024)),
  deliveryWindowPolicyReference: Schema.NullOr(BoundedNonEmptyString(1_024)),
});
export type MergeReadinessEvidenceSnapshot = typeof MergeReadinessEvidenceSnapshot.Type;

export const MergeReadinessAssessment = Schema.Struct({
  id: MergeReadinessAssessmentId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  repositoryConnectionId: RepositoryConnectionId,
  pullRequestRecordId: PullRequestRecordId,
  deliveryPolicyId: DeliveryPolicyId,
  policyDigest: Digest,
  headSha: SourceCommit,
  baseSha: SourceCommit,
  sourceCommit: SourceCommit,
  sourceFingerprint: Digest,
  verificationRunId: Schema.NullOr(VerificationRunId),
  result: MergeReadinessResult,
  states: MergeReadinessLaneStates,
  blockingReasons: Schema.Array(BoundedNonEmptyString(2_000)),
  warningReasons: Schema.Array(BoundedNonEmptyString(2_000)),
  evidenceSnapshot: MergeReadinessEvidenceSnapshot,
  observedAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  invalidatedAt: Schema.NullOr(IsoDateTime),
});
export type MergeReadinessAssessment = typeof MergeReadinessAssessment.Type;

export const ApprovalRequest = Schema.Struct({
  id: DeliveryApprovalRequestId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  deliveryPolicyId: DeliveryPolicyId,
  approvalType: ApprovalType,
  targetType: BoundedNonEmptyString(128),
  targetId: BoundedNonEmptyString(512),
  planDigest: Digest,
  sourceCommit: SourceCommit,
  status: ApprovalRequestStatus,
  requiredDecisionCount: PositiveInt,
  policySnapshot: DeliveryPublicMetadata,
  contextSnapshot: DeliveryPublicMetadata,
  requestedBy: BoundedNonEmptyString(255),
  requestedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type ApprovalRequest = typeof ApprovalRequest.Type;

export const ApprovalDecision = Schema.Struct({
  id: ApprovalDecisionId,
  approvalRequestId: DeliveryApprovalRequestId,
  actorId: BoundedNonEmptyString(255),
  actorType: Schema.Literals(["user", "team", "system"]),
  decision: ApprovalDecisionValue,
  reason: Schema.NullOr(BoundedString(2_000)),
  planDigest: Digest,
  sourceCommit: SourceCommit,
  decidedAt: IsoDateTime,
});
export type ApprovalDecision = typeof ApprovalDecision.Type;

export const MergeExecution = Schema.Struct({
  id: MergeExecutionId,
  idempotencyKey: BoundedNonEmptyString(512),
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  repositoryConnectionId: RepositoryConnectionId,
  pullRequestRecordId: PullRequestRecordId,
  readinessAssessmentId: MergeReadinessAssessmentId,
  approvalRequestId: Schema.NullOr(DeliveryApprovalRequestId),
  deliveryPolicyId: DeliveryPolicyId,
  mergeStrategy: MergeStrategy,
  expectedHeadSha: SourceCommit,
  expectedBaseSha: SourceCommit,
  sourceCommit: SourceCommit,
  status: DeliveryExecutionStatus,
  remoteMergeSha: Schema.NullOr(SourceCommit),
  errorCode: Schema.NullOr(BoundedNonEmptyString(128)),
  errorMessage: NullableError,
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type MergeExecution = typeof MergeExecution.Type;

export const ReleaseConfiguration = Schema.Struct({
  id: ReleaseConfigurationId,
  projectId: ProjectId,
  name: BoundedNonEmptyString(255),
  provider: BoundedNonEmptyString(128),
  repository: BoundedNonEmptyString(1_024),
  releaseChannel: BoundedNonEmptyString(128),
  tagPattern: BoundedNonEmptyString(255),
  artifactGlobs: Schema.Array(BoundedNonEmptyString(1_024)),
  versionStrategy: Schema.Literals([
    "manual",
    "semantic_explicit",
    "semantic_from_changes",
    "calendar",
    "repository_script",
  ]),
  versionSource: Schema.Literals(["package", "git_tag", "manifest", "manual", "custom"]),
  changelogMode: Schema.Literals(["generated", "provided", "none"]),
  artifactConfiguration: DeliveryPublicMetadata,
  githubReleaseEnabled: Schema.Boolean,
  packagePublishingEnabled: Schema.Boolean,
  enabled: Schema.Boolean,
  version: PositiveInt,
  configurationDigest: Digest,
  publicMetadata: DeliveryPublicMetadata,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReleaseConfiguration = typeof ReleaseConfiguration.Type;

export const ReleasePlan = Schema.Struct({
  id: ReleasePlanId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  releaseConfigurationId: ReleaseConfigurationId,
  deliveryPolicyId: DeliveryPolicyId,
  planDigest: Digest,
  sourceCommit: SourceCommit,
  version: BoundedNonEmptyString(255),
  tagName: BoundedNonEmptyString(255),
  releaseName: BoundedNonEmptyString(512),
  sourceBranch: BoundedNonEmptyString(1_024),
  changeSummary: BoundedString(8_000),
  changelogDraft: BoundedString(32_000),
  releaseNotesDraft: BoundedString(32_000),
  includedMissions: Schema.Array(MissionId),
  includedPullRequests: Schema.Array(PullRequestRecordId),
  artifactPlan: DeliveryPublicMetadata,
  publicationPlan: DeliveryPublicMetadata,
  status: DeliveryPlanStatus,
  approvalRequestId: Schema.NullOr(DeliveryApprovalRequestId),
  approvedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ReleasePlan = typeof ReleasePlan.Type;

export const ReleaseArtifactStatus = Schema.Literals([
  "planned",
  "collected",
  "published",
  "failed",
]);
export const ReleaseArtifact = Schema.Struct({
  id: ReleaseArtifactId,
  releasePlanId: ReleasePlanId,
  name: BoundedNonEmptyString(512),
  relativePath: BoundedNonEmptyString(1_024),
  artifactType: BoundedNonEmptyString(128),
  checksum: Schema.NullOr(Digest),
  sizeBytes: Schema.NullOr(NonNegativeInt),
  contentType: Schema.NullOr(BoundedNonEmptyString(255)),
  sourceCommit: SourceCommit,
  status: ReleaseArtifactStatus,
  remoteUrl: Schema.NullOr(BoundedNonEmptyString(2_048)),
  createdAt: IsoDateTime,
  publishedAt: Schema.NullOr(IsoDateTime),
});
export type ReleaseArtifact = typeof ReleaseArtifact.Type;

export const DeploymentEnvironmentTier = Schema.Literals([
  "local",
  "development",
  "staging",
  "production",
]);
export const DeploymentEnvironmentKind = Schema.Literals([
  "preview",
  "development",
  "staging",
  "production",
  "custom",
]);
export const DeploymentEnvironmentStatus = Schema.Literals(["active", "inactive", "unavailable"]);
export const DeploymentEnvironment = Schema.Struct({
  id: DeploymentEnvironmentId,
  projectId: ProjectId,
  name: BoundedNonEmptyString(255),
  tier: DeploymentEnvironmentTier,
  kind: DeploymentEnvironmentKind,
  provider: BoundedNonEmptyString(128),
  providerType: BoundedNonEmptyString(128),
  providerConnectionReference: Schema.NullOr(BoundedNonEmptyString(1_024)),
  externalRef: Schema.NullOr(BoundedNonEmptyString(1_024)),
  status: DeploymentEnvironmentStatus,
  protected: Schema.Boolean,
  requiresApproval: Schema.Boolean,
  requiredApprovalCount: NonNegativeInt,
  configurationDigest: Digest,
  publicMetadata: DeliveryPublicMetadata,
  windowPolicy: DeliveryPublicMetadata,
  configurationMetadata: DeliveryPublicMetadata,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DeploymentEnvironment = typeof DeploymentEnvironment.Type;

export const DeploymentPlan = Schema.Struct({
  id: DeploymentPlanId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  releasePlanId: Schema.NullOr(ReleasePlanId),
  deploymentEnvironmentId: DeploymentEnvironmentId,
  deliveryPolicyId: DeliveryPolicyId,
  planDigest: Digest,
  sourceCommit: SourceCommit,
  sourceType: Schema.Literals(["release", "commit", "branch", "artifact", "provider"]),
  sourceReference: BoundedNonEmptyString(1_024),
  strategy: DeploymentStrategy,
  configuration: DeliveryPublicMetadata,
  configurationSnapshot: DeliveryPublicMetadata,
  validationProfileId: Schema.NullOr(VerificationProfileId),
  rollbackPlanId: Schema.NullOr(RollbackPlanId),
  status: DeliveryPlanStatus,
  approvalRequestId: Schema.NullOr(DeliveryApprovalRequestId),
  approvedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DeploymentPlan = typeof DeploymentPlan.Type;

export const DeploymentExecution = Schema.Struct({
  id: DeploymentExecutionId,
  deploymentPlanId: DeploymentPlanId,
  idempotencyKey: BoundedNonEmptyString(512),
  attemptNumber: PositiveInt,
  sourceCommit: SourceCommit,
  status: DeliveryExecutionStatus,
  providerState: DeliveryPublicMetadata,
  remoteExecutionId: Schema.NullOr(BoundedNonEmptyString(512)),
  endpoint: Schema.NullOr(BoundedNonEmptyString(2_048)),
  deploymentUrl: Schema.NullOr(BoundedNonEmptyString(2_048)),
  logReference: Schema.NullOr(BoundedNonEmptyString(2_048)),
  errorCode: Schema.NullOr(BoundedNonEmptyString(128)),
  errorMessage: NullableError,
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type DeploymentExecution = typeof DeploymentExecution.Type;

export const DeploymentValidationStatus = Schema.Literals([
  "pending",
  "running",
  "passed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const DeploymentValidationRun = Schema.Struct({
  id: DeploymentValidationRunId,
  deploymentExecutionId: DeploymentExecutionId,
  kind: BoundedNonEmptyString(128),
  status: DeploymentValidationStatus,
  result: Schema.NullOr(Schema.Literals(["passed", "passed_with_warnings", "failed", "unknown"])),
  sourceCommit: SourceCommit,
  evidence: DeliveryPublicMetadata,
  errorMessage: NullableError,
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type DeploymentValidationRun = typeof DeploymentValidationRun.Type;

export const RollbackPlan = Schema.Struct({
  id: RollbackPlanId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  deploymentExecutionId: DeploymentExecutionId,
  deploymentEnvironmentId: DeploymentEnvironmentId,
  deliveryPolicyId: DeliveryPolicyId,
  targetDeploymentExecutionId: Schema.NullOr(DeploymentExecutionId),
  planDigest: Digest,
  sourceCommit: SourceCommit,
  restoreSourceCommit: SourceCommit,
  rollbackType: Schema.Literals([
    "provider_rollback",
    "previous_release",
    "previous_deployment",
    "git_revert",
    "redeploy_known_good",
    "manual",
  ]),
  targetReference: BoundedNonEmptyString(1_024),
  reversibility: Schema.Literals(["reversible", "best_effort", "irreversible", "unknown"]),
  requiresApproval: Schema.Boolean,
  reason: BoundedNonEmptyString(2_000),
  status: DeliveryPlanStatus,
  approvalRequestId: Schema.NullOr(DeliveryApprovalRequestId),
  approvedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RollbackPlan = typeof RollbackPlan.Type;

export const RollbackExecution = Schema.Struct({
  id: RollbackExecutionId,
  rollbackPlanId: RollbackPlanId,
  idempotencyKey: BoundedNonEmptyString(512),
  sourceCommit: SourceCommit,
  status: DeliveryExecutionStatus,
  remoteExecutionId: Schema.NullOr(BoundedNonEmptyString(512)),
  resultReference: Schema.NullOr(BoundedNonEmptyString(2_048)),
  errorCode: Schema.NullOr(BoundedNonEmptyString(128)),
  errorMessage: NullableError,
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type RollbackExecution = typeof RollbackExecution.Type;

export const DeliveryAuditActorType = Schema.Literals(["user", "system"]);
export const DeliveryAuditEntry = Schema.Struct({
  id: DeliveryAuditEntryId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  aggregateType: BoundedNonEmptyString(128),
  aggregateId: BoundedNonEmptyString(512),
  action: BoundedNonEmptyString(255),
  actorType: DeliveryAuditActorType,
  actorId: Schema.NullOr(BoundedNonEmptyString(255)),
  sourceCommit: Schema.NullOr(SourceCommit),
  publicMetadata: DeliveryPublicMetadata,
  occurredAt: IsoDateTime,
});
export type DeliveryAuditEntry = typeof DeliveryAuditEntry.Type;

export const DeliveryWorkspaceSnapshot = Schema.Struct({
  projectId: ProjectId,
  policies: Schema.Array(DeliveryPolicy),
  mergeReadinessAssessments: Schema.Array(MergeReadinessAssessment),
  approvalRequests: Schema.Array(ApprovalRequest),
  approvalDecisions: Schema.Array(ApprovalDecision),
  mergeExecutions: Schema.Array(MergeExecution),
  releaseConfigurations: Schema.Array(ReleaseConfiguration),
  releasePlans: Schema.Array(ReleasePlan),
  releaseArtifacts: Schema.Array(ReleaseArtifact),
  deploymentEnvironments: Schema.Array(DeploymentEnvironment),
  deploymentPlans: Schema.Array(DeploymentPlan),
  deploymentExecutions: Schema.Array(DeploymentExecution),
  deploymentValidationRuns: Schema.Array(DeploymentValidationRun),
  rollbackPlans: Schema.Array(RollbackPlan),
  rollbackExecutions: Schema.Array(RollbackExecution),
  auditEntries: Schema.Array(DeliveryAuditEntry),
  capturedAt: IsoDateTime,
});
export type DeliveryWorkspaceSnapshot = typeof DeliveryWorkspaceSnapshot.Type;

const ErrorMessage = BoundedNonEmptyString(2_000);
export class DeliveryValidationError extends Schema.TaggedErrorClass<DeliveryValidationError>()(
  "DeliveryValidationError",
  { message: ErrorMessage },
) {}
export class DeliveryNotFoundError extends Schema.TaggedErrorClass<DeliveryNotFoundError>()(
  "DeliveryNotFoundError",
  { entity: BoundedNonEmptyString(128), id: BoundedNonEmptyString(512) },
) {}
export class DeliveryConflictError extends Schema.TaggedErrorClass<DeliveryConflictError>()(
  "DeliveryConflictError",
  { message: ErrorMessage },
) {}
export class DeliveryUnavailableError extends Schema.TaggedErrorClass<DeliveryUnavailableError>()(
  "DeliveryUnavailableError",
  { message: ErrorMessage },
) {}

export const DeliveryListInput = Schema.Struct({
  projectId: ProjectId,
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(250)),
  offset: NonNegativeInt,
});
export type DeliveryListInput = typeof DeliveryListInput.Type;
export const DeliveryRecoveryListInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(250)),
});
export type DeliveryRecoveryListInput = typeof DeliveryRecoveryListInput.Type;

export const DeliveryWorkspaceInput = Schema.Struct({ projectId: ProjectId });
export type DeliveryWorkspaceInput = typeof DeliveryWorkspaceInput.Type;
export const SavePolicyInput = Schema.Struct({ policy: DeliveryPolicy });
export type SavePolicyInput = typeof SavePolicyInput.Type;
export const SaveReleaseConfigurationInput = Schema.Struct({ configuration: ReleaseConfiguration });
export type SaveReleaseConfigurationInput = typeof SaveReleaseConfigurationInput.Type;
export const SaveDeploymentEnvironmentInput = Schema.Struct({ environment: DeploymentEnvironment });
export type SaveDeploymentEnvironmentInput = typeof SaveDeploymentEnvironmentInput.Type;
export const ProposeReleasePlanInput = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  releaseConfigurationId: ReleaseConfigurationId,
  deliveryPolicyId: DeliveryPolicyId,
  bump: Schema.NullOr(Schema.Literals(["major", "minor", "patch"])),
  requestedVersion: Schema.NullOr(BoundedNonEmptyString(255)),
  releaseNotesSupplement: Schema.NullOr(BoundedString(8_000)),
  requestedBy: BoundedNonEmptyString(255),
});
export type ProposeReleasePlanInput = typeof ProposeReleasePlanInput.Type;
export const ProposeDeploymentPlanInput = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  releasePlanId: Schema.NullOr(ReleasePlanId),
  deploymentEnvironmentId: DeploymentEnvironmentId,
  deliveryPolicyId: DeliveryPolicyId,
  strategy: DeploymentStrategy,
  validationProfileId: Schema.NullOr(VerificationProfileId),
  requestedBy: BoundedNonEmptyString(255),
});
export type ProposeDeploymentPlanInput = typeof ProposeDeploymentPlanInput.Type;
export const AssessMergeInput = Schema.Struct({
  projectId: ProjectId,
  policyId: DeliveryPolicyId,
  repositoryConnectionId: RepositoryConnectionId,
  pullRequestNumber: PositiveInt,
  missionId: Schema.NullOr(MissionId),
  expectedHeadSha: SourceCommit,
  expectedBaseSha: SourceCommit,
  strategy: MergeStrategy,
  secretScan: Schema.Struct({
    status: Schema.Literals(["passed", "failed", "not_configured", "unknown"]),
    evidence: Schema.Array(BoundedNonEmptyString(1_024)),
  }),
  deliveryWindow: Schema.Struct({
    state: Schema.Literals(["allowed", "outside_window", "freeze", "unknown"]),
    policyReference: Schema.NullOr(BoundedNonEmptyString(1_024)),
  }),
});
export type AssessMergeInput = typeof AssessMergeInput.Type;
export const RequestApprovalInput = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  policyId: DeliveryPolicyId,
  approvalType: ApprovalType,
  targetType: BoundedNonEmptyString(128),
  targetId: BoundedNonEmptyString(512),
  planDigest: Digest,
  sourceCommit: SourceCommit,
  requiredDecisionCount: PositiveInt,
  policySnapshot: DeliveryPublicMetadata,
  contextSnapshot: DeliveryPublicMetadata,
  requestedBy: BoundedNonEmptyString(255),
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type RequestApprovalInput = typeof RequestApprovalInput.Type;
export const DecideApprovalInput = Schema.Struct({
  approvalRequestId: DeliveryApprovalRequestId,
  decision: ApprovalDecisionValue,
  actorType: Schema.Literals(["user", "team", "system"]),
  actorId: BoundedNonEmptyString(255),
  reason: Schema.NullOr(BoundedString(2_000)),
  decidedAt: IsoDateTime,
});
export type DecideApprovalInput = typeof DecideApprovalInput.Type;
export const ExecuteMergeInput = Schema.Struct({
  readinessAssessmentId: MergeReadinessAssessmentId,
  requestedBy: BoundedNonEmptyString(255),
});
export type ExecuteMergeInput = typeof ExecuteMergeInput.Type;
export const PublishReleaseInput = Schema.Struct({
  releasePlanId: ReleasePlanId,
  repositoryConnectionId: RepositoryConnectionId,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
});
export type PublishReleaseInput = typeof PublishReleaseInput.Type;
export const ExecuteDeploymentInput = Schema.Struct({
  deploymentPlanId: DeploymentPlanId,
  requestedBy: BoundedNonEmptyString(255),
});
export type ExecuteDeploymentInput = typeof ExecuteDeploymentInput.Type;
export const CancelDeploymentInput = Schema.Struct({
  deploymentExecutionId: DeploymentExecutionId,
  requestedBy: BoundedNonEmptyString(255),
  reason: BoundedNonEmptyString(2_000),
});
export type CancelDeploymentInput = typeof CancelDeploymentInput.Type;
export const ExecuteRollbackInput = Schema.Struct({
  rollbackPlanId: RollbackPlanId,
  requestedBy: BoundedNonEmptyString(255),
});
export type ExecuteRollbackInput = typeof ExecuteRollbackInput.Type;

export const DeliveryPolicySaveInput = SavePolicyInput;
export type DeliveryPolicySaveInput = typeof DeliveryPolicySaveInput.Type;
export const MergeReadinessAssessmentSaveInput = Schema.Struct({
  assessment: MergeReadinessAssessment,
});
export type MergeReadinessAssessmentSaveInput = typeof MergeReadinessAssessmentSaveInput.Type;
export const ApprovalRequestSaveInput = Schema.Struct({ request: ApprovalRequest });
export type ApprovalRequestSaveInput = typeof ApprovalRequestSaveInput.Type;
export const RecordApprovalDecisionInput = Schema.Struct({ decision: ApprovalDecision });
export type RecordApprovalDecisionInput = typeof RecordApprovalDecisionInput.Type;
export const MergeExecutionSaveInput = Schema.Struct({ execution: MergeExecution });
export type MergeExecutionSaveInput = typeof MergeExecutionSaveInput.Type;
export const ReleaseConfigurationSaveInput = SaveReleaseConfigurationInput;
export type ReleaseConfigurationSaveInput = typeof ReleaseConfigurationSaveInput.Type;
export const ReleasePlanSaveInput = Schema.Struct({ plan: ReleasePlan });
export type ReleasePlanSaveInput = typeof ReleasePlanSaveInput.Type;
export const ReleaseArtifactSaveInput = Schema.Struct({ artifact: ReleaseArtifact });
export type ReleaseArtifactSaveInput = typeof ReleaseArtifactSaveInput.Type;
export const DeploymentEnvironmentSaveInput = SaveDeploymentEnvironmentInput;
export type DeploymentEnvironmentSaveInput = typeof DeploymentEnvironmentSaveInput.Type;
export const DeploymentPlanSaveInput = Schema.Struct({ plan: DeploymentPlan });
export type DeploymentPlanSaveInput = typeof DeploymentPlanSaveInput.Type;
export const DeploymentExecutionSaveInput = Schema.Struct({ execution: DeploymentExecution });
export type DeploymentExecutionSaveInput = typeof DeploymentExecutionSaveInput.Type;
export const DeploymentValidationRunSaveInput = Schema.Struct({ run: DeploymentValidationRun });
export type DeploymentValidationRunSaveInput = typeof DeploymentValidationRunSaveInput.Type;
export const RollbackPlanSaveInput = Schema.Struct({ plan: RollbackPlan });
export type RollbackPlanSaveInput = typeof RollbackPlanSaveInput.Type;
export const RollbackExecutionSaveInput = Schema.Struct({ execution: RollbackExecution });
export type RollbackExecutionSaveInput = typeof RollbackExecutionSaveInput.Type;
export const DeliveryAuditEntryAppendInput = Schema.Struct({ entry: DeliveryAuditEntry });
export type DeliveryAuditEntryAppendInput = typeof DeliveryAuditEntryAppendInput.Type;

export const ApprovalDecisionResult = Schema.Struct({
  request: ApprovalRequest,
  decisions: Schema.Array(ApprovalDecision),
});
export type ApprovalDecisionResult = typeof ApprovalDecisionResult.Type;
