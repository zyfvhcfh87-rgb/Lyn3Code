import * as Schema from "effect/Schema";

import {
  AgentRunId,
  IsoDateTime,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RoutingDecisionId,
  ThreadId,
} from "./baseSchemas.ts";
import { AgentRoleKind, AgentRunPurpose } from "./mission.ts";
import { RuntimeMode } from "./orchestration.ts";
import {
  AgentRoleRoutingProfile,
  ModelCapabilitySnapshot,
  ModelProfile,
  ModelProfileId,
  ProviderHealthRecord,
  ProviderProfile,
  ProviderProfileId,
  RoutedRunOutcome,
  RoutingCandidateRecord,
  RoutingCapabilityName,
  RoutingDecision,
  RoutingFallbackMode,
  RoutingOverride,
  RoutingOverrideId,
  RoutingPolicy,
  RoutingPolicyId,
  RoutingPrivacyClassification,
  RoutingReasoningLevel,
  RoutingRule,
  RoutingRuleId,
  RoutingTaskComplexity,
  RoutingTaskType,
  TaskRoutingAssessment,
} from "./routing.ts";

const BoundedString = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));

export class RoutingRpcError extends Schema.TaggedErrorClass<RoutingRpcError>()("RoutingRpcError", {
  reason: Schema.Literals([
    "not_found",
    "invalid_scope",
    "invalid_policy",
    "invalid_override",
    "no_eligible_candidate",
    "incompatible_pin",
    "context_incompatible",
    "privacy_violation",
    "provider_unavailable",
    "concurrency_exhausted",
    "cancelled",
    "persistence_error",
    "orchestration_error",
    "registry_unavailable",
  ]),
  message: BoundedString(4_000),
  retryable: Schema.Boolean,
}) {}

export const RoutingRegistrySnapshot = Schema.Struct({
  providers: Schema.Array(ProviderProfile),
  models: Schema.Array(ModelProfile),
  capabilitySnapshots: Schema.Array(ModelCapabilitySnapshot),
  health: Schema.Array(ProviderHealthRecord),
  refreshedAt: IsoDateTime,
});
export type RoutingRegistrySnapshot = typeof RoutingRegistrySnapshot.Type;

export const RoutingWorkspaceScope = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.optional(Schema.NullOr(MissionId)),
  taskId: Schema.optional(Schema.NullOr(MissionTaskId)),
  missionAgentId: Schema.optional(Schema.NullOr(MissionAgentId)),
});
export type RoutingWorkspaceScope = typeof RoutingWorkspaceScope.Type;

export const RoutingWorkspaceSnapshot = Schema.Struct({
  scope: RoutingWorkspaceScope,
  policies: Schema.Array(RoutingPolicy),
  rules: Schema.Array(RoutingRule),
  roleProfiles: Schema.Array(AgentRoleRoutingProfile),
  overrides: Schema.Array(RoutingOverride),
  assessments: Schema.Array(TaskRoutingAssessment),
  decisions: Schema.Array(RoutingDecision),
  outcomes: Schema.Array(RoutedRunOutcome),
  refreshedAt: IsoDateTime,
});
export type RoutingWorkspaceSnapshot = typeof RoutingWorkspaceSnapshot.Type;

export const RoutingHistoryInput = Schema.Struct({
  ...RoutingWorkspaceScope.fields,
  cursor: Schema.optional(NonNegativeInt),
  limit: Schema.optional(PositiveInt),
});
export type RoutingHistoryInput = typeof RoutingHistoryInput.Type;

export const RoutingHistoryPage = Schema.Struct({
  decisions: Schema.Array(RoutingDecision),
  nextCursor: Schema.NullOr(NonNegativeInt),
  hasMore: Schema.Boolean,
});
export type RoutingHistoryPage = typeof RoutingHistoryPage.Type;

export const RoutingManualPins = Schema.Struct({
  providerProfileId: Schema.optional(Schema.NullOr(ProviderProfileId)),
  modelProfileId: Schema.optional(Schema.NullOr(ModelProfileId)),
  reasoningLevel: Schema.optional(Schema.NullOr(RoutingReasoningLevel)),
  fallbackMode: Schema.optional(Schema.NullOr(RoutingFallbackMode)),
});
export type RoutingManualPins = typeof RoutingManualPins.Type;

export const RoutingTaskAssessmentDraft = Schema.Struct({
  roleKind: AgentRoleKind,
  taskType: Schema.optional(Schema.NullOr(RoutingTaskType)),
  complexity: Schema.optional(Schema.NullOr(RoutingTaskComplexity)),
  title: BoundedString(2_000),
  description: BoundedString(16_000),
  repositoryLanguages: Schema.optional(Schema.Array(BoundedString(128))),
  affectedFiles: Schema.optional(Schema.Array(BoundedString(1_024))),
  requiredTools: Schema.optional(Schema.Array(BoundedString(256))),
  requiredCapabilities: Schema.optional(Schema.Array(RoutingCapabilityName)),
  preferredCapabilities: Schema.optional(Schema.Array(RoutingCapabilityName)),
  attachmentKinds: Schema.optional(
    Schema.Array(Schema.Literals(["image", "audio", "file", "other"])),
  ),
  estimatedMemoryTokens: Schema.optional(Schema.NullOr(NonNegativeInt)),
  estimatedSourceTokens: Schema.optional(Schema.NullOr(NonNegativeInt)),
  predecessorHandoffTokens: Schema.optional(Schema.NullOr(NonNegativeInt)),
  verificationFailureTokens: Schema.optional(Schema.NullOr(NonNegativeInt)),
  expectedOutputTokens: Schema.optional(Schema.NullOr(NonNegativeInt)),
  privacyClassification: Schema.optional(RoutingPrivacyClassification),
  writeAccessRequired: Schema.Boolean,
  visionRequired: Schema.optional(Schema.Boolean),
  structuredOutputRequired: Schema.optional(Schema.Boolean),
  architectureChange: Schema.optional(Schema.Boolean),
  databaseMigration: Schema.optional(Schema.Boolean),
  securitySensitive: Schema.optional(Schema.Boolean),
  unknownRepositoryArea: Schema.optional(Schema.Boolean),
  crossPackageImpact: Schema.optional(Schema.Boolean),
  dependencyCount: Schema.optional(NonNegativeInt),
  verificationBreadth: Schema.optional(Schema.Literals(["narrow", "focused", "broad"])),
});
export type RoutingTaskAssessmentDraft = typeof RoutingTaskAssessmentDraft.Type;

export const RoutingSimulationInput = Schema.Struct({
  ...RoutingWorkspaceScope.fields,
  assessment: RoutingTaskAssessmentDraft,
  pins: Schema.optional(RoutingManualPins),
  now: Schema.optional(IsoDateTime),
});
export type RoutingSimulationInput = typeof RoutingSimulationInput.Type;

export const RoutingSimulationCandidate = Schema.Struct({
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  eligible: Schema.Boolean,
  score: Schema.NullOr(Schema.Number),
  rejectionReasons: Schema.Array(BoundedString(1_000)),
  preferenceReasons: Schema.Array(BoundedString(1_000)),
  staleCapabilitySnapshot: Schema.Boolean,
});
export type RoutingSimulationCandidate = typeof RoutingSimulationCandidate.Type;

export const RoutingSimulationResult = Schema.Struct({
  selectedProviderProfileId: Schema.NullOr(ProviderProfileId),
  selectedModelProfileId: Schema.NullOr(ModelProfileId),
  selectedReasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  candidates: Schema.Array(RoutingSimulationCandidate),
  explanation: BoundedString(8_000),
  contextCompatible: Schema.Boolean,
  contextStrategy: BoundedString(128),
  assessment: TaskRoutingAssessment,
});
export type RoutingSimulationResult = typeof RoutingSimulationResult.Type;

export const RoutingStartMissionInput = Schema.Struct({
  missionId: MissionId,
  taskId: Schema.optional(MissionTaskId),
  missionAgentId: Schema.optional(MissionAgentId),
  runtimeMode: RuntimeMode,
  purpose: Schema.optional(AgentRunPurpose),
  pins: Schema.optional(RoutingManualPins),
  requestedAt: IsoDateTime,
});
export type RoutingStartMissionInput = typeof RoutingStartMissionInput.Type;

export const RoutingStartMissionResult = Schema.Struct({
  routingDecisionId: RoutingDecisionId,
  agentRunId: AgentRunId,
  threadId: ThreadId,
  decision: RoutingDecision,
});
export type RoutingStartMissionResult = typeof RoutingStartMissionResult.Type;

export const RoutingSavePolicyInput = Schema.Struct({ policy: RoutingPolicy });
export type RoutingSavePolicyInput = typeof RoutingSavePolicyInput.Type;
export const RoutingSaveRuleInput = Schema.Struct({ rule: RoutingRule });
export type RoutingSaveRuleInput = typeof RoutingSaveRuleInput.Type;
export const RoutingSaveOverrideInput = Schema.Struct({ override: RoutingOverride });
export type RoutingSaveOverrideInput = typeof RoutingSaveOverrideInput.Type;
export const RoutingRevokeOverrideInput = Schema.Struct({
  overrideId: RoutingOverrideId,
  revokedAt: IsoDateTime,
});
export type RoutingRevokeOverrideInput = typeof RoutingRevokeOverrideInput.Type;
export const RoutingSaveAssessmentInput = Schema.Struct({ assessment: TaskRoutingAssessment });
export type RoutingSaveAssessmentInput = typeof RoutingSaveAssessmentInput.Type;
export const RoutingSaveProviderProfileInput = Schema.Struct({ provider: ProviderProfile });
export type RoutingSaveProviderProfileInput = typeof RoutingSaveProviderProfileInput.Type;
export const RoutingSaveModelProfileInput = Schema.Struct({ model: ModelProfile });
export type RoutingSaveModelProfileInput = typeof RoutingSaveModelProfileInput.Type;
export const RoutingSaveCapabilitySnapshotInput = Schema.Struct({
  capabilitySnapshot: ModelCapabilitySnapshot,
});
export type RoutingSaveCapabilitySnapshotInput = typeof RoutingSaveCapabilitySnapshotInput.Type;
export const RoutingRefreshRegistryInput = Schema.Struct({
  providerProfileId: Schema.optional(Schema.NullOr(ProviderProfileId)),
});
export type RoutingRefreshRegistryInput = typeof RoutingRefreshRegistryInput.Type;

export const RoutingPolicyMutationResult = Schema.Struct({ policy: RoutingPolicy });
export const RoutingRuleMutationResult = Schema.Struct({ rule: RoutingRule });
export const RoutingOverrideMutationResult = Schema.Struct({ override: RoutingOverride });
export const RoutingAssessmentMutationResult = Schema.Struct({ assessment: TaskRoutingAssessment });
export const RoutingProviderProfileMutationResult = Schema.Struct({ provider: ProviderProfile });
export const RoutingModelProfileMutationResult = Schema.Struct({ model: ModelProfile });
export const RoutingCapabilitySnapshotMutationResult = Schema.Struct({
  capabilitySnapshot: ModelCapabilitySnapshot,
});
export const RoutingDecisionLookupInput = Schema.Struct({ routingDecisionId: RoutingDecisionId });
export const RoutingPolicyLookupInput = Schema.Struct({ routingPolicyId: RoutingPolicyId });
export const RoutingRuleLookupInput = Schema.Struct({ routingRuleId: RoutingRuleId });
export const RoutingDecisionDetail = Schema.Struct({
  decision: RoutingDecision,
  candidates: Schema.Array(RoutingCandidateRecord),
  outcome: Schema.NullOr(RoutedRunOutcome),
});
export type RoutingDecisionDetail = typeof RoutingDecisionDetail.Type;
