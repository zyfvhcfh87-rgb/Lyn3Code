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
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const BoundedString = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));
const BoundedNonEmptyString = (maximumLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maximumLength));
const BoundedStringArray = (maximumItems: number, maximumItemLength = 1_024) =>
  Schema.Array(BoundedNonEmptyString(maximumItemLength)).check(Schema.isMaxLength(maximumItems));
const BoundedUnknownRecord = Schema.Record(BoundedNonEmptyString(128), Schema.Unknown);

/** A configured provider instance is the stable provider identity used by routing. */
export const ProviderProfileId = ProviderInstanceId;
export type ProviderProfileId = typeof ProviderProfileId.Type;
export const ModelProfileId = entityId("ModelProfileId");
export type ModelProfileId = typeof ModelProfileId.Type;
export const ModelCapabilitySnapshotId = entityId("ModelCapabilitySnapshotId");
export type ModelCapabilitySnapshotId = typeof ModelCapabilitySnapshotId.Type;
export const RoutingPolicyId = entityId("RoutingPolicyId");
export type RoutingPolicyId = typeof RoutingPolicyId.Type;
export const RoutingRuleId = entityId("RoutingRuleId");
export type RoutingRuleId = typeof RoutingRuleId.Type;
export const AgentRoleRoutingProfileId = entityId("AgentRoleRoutingProfileId");
export type AgentRoleRoutingProfileId = typeof AgentRoleRoutingProfileId.Type;
export const TaskRoutingAssessmentId = entityId("TaskRoutingAssessmentId");
export type TaskRoutingAssessmentId = typeof TaskRoutingAssessmentId.Type;
export const RoutingCandidateRecordId = entityId("RoutingCandidateRecordId");
export type RoutingCandidateRecordId = typeof RoutingCandidateRecordId.Type;
export const ProviderHealthRecordId = entityId("ProviderHealthRecordId");
export type ProviderHealthRecordId = typeof ProviderHealthRecordId.Type;
export const RoutingOverrideId = entityId("RoutingOverrideId");
export type RoutingOverrideId = typeof RoutingOverrideId.Type;
export const RoutedRunOutcomeId = entityId("RoutedRunOutcomeId");
export type RoutedRunOutcomeId = typeof RoutedRunOutcomeId.Type;

export { RoutingDecisionId };

export const RoutingReasoningLevel = Schema.Literals(["low", "medium", "high", "extra_high"]);
export type RoutingReasoningLevel = typeof RoutingReasoningLevel.Type;

/** Unknown is distinct from unsupported so critical requirements can fail closed. */
export const RoutingCapabilityState = Schema.Literals(["supported", "unsupported", "unknown"]);
export type RoutingCapabilityState = typeof RoutingCapabilityState.Type;

export const RoutingCapabilityName = Schema.Literals([
  "tool_calling",
  "structured_output",
  "vision_input",
  "audio_input",
  "file_input",
  "streaming",
  "reasoning_control",
  "parallel_tool_calls",
  "code_editing",
  "long_context",
  "system_instructions",
  "prompt_caching",
]);
export type RoutingCapabilityName = typeof RoutingCapabilityName.Type;

export const RoutingCapabilities = Schema.Struct({
  toolCalling: RoutingCapabilityState,
  structuredOutput: RoutingCapabilityState,
  visionInput: RoutingCapabilityState,
  audioInput: RoutingCapabilityState,
  fileInput: RoutingCapabilityState,
  streaming: RoutingCapabilityState,
  reasoningControl: RoutingCapabilityState,
  parallelToolCalls: RoutingCapabilityState,
  codeEditing: RoutingCapabilityState,
  longContext: RoutingCapabilityState,
  systemInstructions: RoutingCapabilityState,
  promptCaching: RoutingCapabilityState,
});
export type RoutingCapabilities = typeof RoutingCapabilities.Type;

export const RoutingContextLimits = Schema.Struct({
  maximumInputTokens: Schema.NullOr(PositiveInt),
  maximumOutputTokens: Schema.NullOr(PositiveInt),
  recommendedWorkingContext: Schema.NullOr(PositiveInt),
  supportsAutomaticCompaction: RoutingCapabilityState,
});
export type RoutingContextLimits = typeof RoutingContextLimits.Type;

export const RoutingReasoningOptions = Schema.Struct({
  supportedLevels: Schema.Array(RoutingReasoningLevel).check(Schema.isMaxLength(4)),
  defaultLevel: Schema.NullOr(RoutingReasoningLevel),
  supportsDynamicReasoning: RoutingCapabilityState,
}).check(
  Schema.makeFilter((options) =>
    options.defaultLevel === null || options.supportedLevels.includes(options.defaultLevel)
      ? true
      : "default reasoning level must be listed in supportedLevels",
  ),
);
export type RoutingReasoningOptions = typeof RoutingReasoningOptions.Type;

export const RoutingCapabilityMap = Schema.Record(
  BoundedNonEmptyString(128),
  RoutingCapabilityState,
);
export type RoutingCapabilityMap = typeof RoutingCapabilityMap.Type;

export const ProviderProfileStatus = Schema.Literals([
  "available",
  "degraded",
  "rate_limited",
  "authentication_required",
  "credentials_expired",
  "offline",
  "disabled",
  "unsupported",
  "error",
]);
export type ProviderProfileStatus = typeof ProviderProfileStatus.Type;

export const ProviderEndpointClass = Schema.Literals([
  "official_cloud",
  "compatible_api",
  "local_runtime",
  "enterprise_gateway",
  "custom",
]);
export type ProviderEndpointClass = typeof ProviderEndpointClass.Type;

export const ProviderProfile = Schema.Struct({
  id: ProviderProfileId,
  providerType: ProviderDriverKind,
  displayName: BoundedNonEmptyString(256),
  accountReference: Schema.NullOr(BoundedNonEmptyString(512)),
  endpointClass: ProviderEndpointClass,
  status: ProviderProfileStatus,
  isEnabled: Schema.Boolean,
  isLocal: Schema.Boolean,
  supportsModelDiscovery: Schema.Boolean,
  /** Allowlisted non-secret metadata only. */
  configurationMetadata: BoundedUnknownRecord,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastValidatedAt: Schema.NullOr(IsoDateTime),
});
export type ProviderProfile = typeof ProviderProfile.Type;

export const ModelProfileStatus = Schema.Literals([
  "available",
  "unavailable",
  "deprecated",
  "preview",
  "unknown",
  "disabled",
]);
export type ModelProfileStatus = typeof ModelProfileStatus.Type;

export const ModelProfile = Schema.Struct({
  id: ModelProfileId,
  providerProfileId: ProviderProfileId,
  providerModelId: BoundedNonEmptyString(512),
  displayName: BoundedNonEmptyString(512),
  family: Schema.NullOr(BoundedNonEmptyString(256)),
  version: Schema.NullOr(BoundedNonEmptyString(256)),
  releaseChannel: Schema.NullOr(BoundedNonEmptyString(128)),
  status: ModelProfileStatus,
  isEnabled: Schema.Boolean,
  isDeprecated: Schema.Boolean,
  discoveredAutomatically: Schema.Boolean,
  /** Null when the provider exposes no authoritative model-specific session limit. */
  maximumConcurrentSessions: Schema.NullOr(PositiveInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastDiscoveredAt: Schema.NullOr(IsoDateTime),
});
export type ModelProfile = typeof ModelProfile.Type;

export const CapabilitySnapshotSource = Schema.Literals([
  "provider_reported",
  "official_configuration",
  "manual_override",
  "runtime_probe",
  "inferred",
  "unknown",
]);
export type CapabilitySnapshotSource = typeof CapabilitySnapshotSource.Type;

export const ModelCapabilitySnapshot = Schema.Struct({
  id: ModelCapabilitySnapshotId,
  modelProfileId: ModelProfileId,
  snapshotVersion: PositiveInt,
  source: CapabilitySnapshotSource,
  capabilities: RoutingCapabilities,
  contextLimits: RoutingContextLimits,
  reasoningOptions: RoutingReasoningOptions,
  toolSupport: RoutingCapabilityMap,
  modalitySupport: RoutingCapabilityMap,
  outputSupport: RoutingCapabilityMap,
  privacyMetadata: BoundedUnknownRecord,
  capturedAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type ModelCapabilitySnapshot = typeof ModelCapabilitySnapshot.Type;

export const RoutingPolicyScopeType = Schema.Literals([
  "global",
  "user",
  "project",
  "mission",
  "agent_role",
  "task",
]);
export type RoutingPolicyScopeType = typeof RoutingPolicyScopeType.Type;

export const RoutingPrivacyMode = Schema.Literals([
  "inherit",
  "remote_allowed",
  "approved_remote_only",
  "local_preferred",
  "local_only",
]);
export type RoutingPrivacyMode = typeof RoutingPrivacyMode.Type;

export const RoutingFallbackMode = Schema.Literals([
  "none",
  "same_model_retry",
  "same_provider",
  "configured_chain",
  "any_compatible",
]);
export type RoutingFallbackMode = typeof RoutingFallbackMode.Type;

export const RoutingBudgetMode = Schema.Literals([
  "inherit",
  "unrestricted",
  "economy",
  "balanced",
  "quality_first",
  "configured_limit",
]);
export type RoutingBudgetMode = typeof RoutingBudgetMode.Type;

const policyScopeIsValid = (scope: {
  readonly scopeType: RoutingPolicyScopeType;
  readonly scopeId: string | null;
}) =>
  scope.scopeType === "global" || scope.scopeType === "user"
    ? scope.scopeId === null
    : scope.scopeId !== null;

export const RoutingPolicy = Schema.Struct({
  id: RoutingPolicyId,
  scopeType: RoutingPolicyScopeType,
  /** Null for the environment-wide global and current-user singleton scopes. */
  scopeId: Schema.NullOr(BoundedNonEmptyString(512)),
  name: BoundedNonEmptyString(256),
  description: BoundedString(4_000),
  priority: NonNegativeInt,
  isEnabled: Schema.Boolean,
  defaultProviderProfileId: Schema.NullOr(ProviderProfileId),
  defaultModelProfileId: Schema.NullOr(ModelProfileId),
  defaultReasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  fallbackMode: RoutingFallbackMode,
  privacyMode: RoutingPrivacyMode,
  budgetMode: RoutingBudgetMode,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).check(
  Schema.makeFilter((policy) =>
    policyScopeIsValid(policy)
      ? true
      : "global and user scopes must use the environment singleton; other scopes require scopeId",
  ),
);
export type RoutingPolicy = typeof RoutingPolicy.Type;

export const RoutingAgentRoleKind = Schema.Literals([
  "coordinator",
  "implementer",
  "researcher",
  "reviewer",
  "verifier",
  "memory_extractor",
  "repair_agent",
  "custom",
]);
export type RoutingAgentRoleKind = typeof RoutingAgentRoleKind.Type;

export const RoutingTaskType = Schema.Literals([
  "planning",
  "architecture",
  "implementation",
  "refactor",
  "bug_fix",
  "test_authoring",
  "verification",
  "review",
  "security_review",
  "performance_review",
  "research",
  "documentation",
  "memory_extraction",
  "github_workflow",
  "conflict_resolution",
  "repair",
  "custom",
]);
export type RoutingTaskType = typeof RoutingTaskType.Type;

export const RoutingTaskComplexity = Schema.Literals([
  "trivial",
  "low",
  "medium",
  "high",
  "very_high",
  "unknown",
]);
export type RoutingTaskComplexity = typeof RoutingTaskComplexity.Type;

export const RoutingPrivacyClassification = Schema.Literals([
  "public",
  "normal",
  "sensitive",
  "restricted",
  "local_only",
]);
export type RoutingPrivacyClassification = typeof RoutingPrivacyClassification.Type;

export const RoutingManualPinState = Schema.Literals(["any", "pinned", "unpinned"]);
export type RoutingManualPinState = typeof RoutingManualPinState.Type;

export const RoutingRuleConditions = Schema.Struct({
  taskTypes: Schema.Array(RoutingTaskType).check(Schema.isMaxLength(32)),
  agentRoles: Schema.Array(RoutingAgentRoleKind).check(Schema.isMaxLength(16)),
  complexities: Schema.Array(RoutingTaskComplexity).check(Schema.isMaxLength(8)),
  repositoryLanguages: BoundedStringArray(64, 128),
  changedFilePatterns: BoundedStringArray(128, 1_024),
  requiredModalities: BoundedStringArray(32, 128),
  requiredTools: BoundedStringArray(128, 256),
  minimumContextTokens: Schema.NullOr(PositiveInt),
  privacyClassifications: Schema.Array(RoutingPrivacyClassification).check(Schema.isMaxLength(8)),
  missionStatuses: BoundedStringArray(16, 64),
  verificationFailureCategories: BoundedStringArray(32, 128),
  providerStatuses: Schema.Array(ProviderProfileStatus).check(Schema.isMaxLength(16)),
  rateLimitStates: BoundedStringArray(16, 128),
  manualPinState: RoutingManualPinState,
});
export type RoutingRuleConditions = typeof RoutingRuleConditions.Type;

export const RoutingRuleRequirements = Schema.Struct({
  requiredProviderProfileIds: Schema.Array(ProviderProfileId).check(Schema.isMaxLength(32)),
  excludedProviderProfileIds: Schema.Array(ProviderProfileId).check(Schema.isMaxLength(32)),
  requiredModelProfileIds: Schema.Array(ModelProfileId).check(Schema.isMaxLength(64)),
  excludedModelProfileIds: Schema.Array(ModelProfileId).check(Schema.isMaxLength(64)),
  minimumCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  maximumContextTarget: Schema.NullOr(PositiveInt),
  fallbackChain: Schema.Array(ModelProfileId).check(Schema.isMaxLength(16)),
  maximumRetries: NonNegativeInt,
});
export type RoutingRuleRequirements = typeof RoutingRuleRequirements.Type;

export const RoutingRulePreferences = Schema.Struct({
  preferredProviderProfileIds: Schema.Array(ProviderProfileId).check(Schema.isMaxLength(32)),
  preferredModelProfileIds: Schema.Array(ModelProfileId).check(Schema.isMaxLength(64)),
  preferredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  preferLocal: Schema.Boolean,
  preferLowLatency: Schema.Boolean,
  preferLowCost: Schema.Boolean,
});
export type RoutingRulePreferences = typeof RoutingRulePreferences.Type;

export const RoutingRuleResult = Schema.Struct({
  providerProfileId: Schema.NullOr(ProviderProfileId),
  modelProfileId: Schema.NullOr(ModelProfileId),
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  fallbackMode: Schema.NullOr(RoutingFallbackMode),
  allowDeprecatedModel: Schema.Boolean,
});
export type RoutingRuleResult = typeof RoutingRuleResult.Type;

const containsOverlap = <Value>(left: ReadonlyArray<Value>, right: ReadonlyArray<Value>) => {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
};

export const RoutingRule = Schema.Struct({
  id: RoutingRuleId,
  routingPolicyId: RoutingPolicyId,
  name: BoundedNonEmptyString(256),
  description: BoundedString(4_000),
  priority: NonNegativeInt,
  isEnabled: Schema.Boolean,
  conditions: RoutingRuleConditions,
  requirements: RoutingRuleRequirements,
  preferences: RoutingRulePreferences,
  result: RoutingRuleResult,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).check(
  Schema.makeFilter((rule) => {
    if (
      containsOverlap(
        rule.requirements.requiredProviderProfileIds,
        rule.requirements.excludedProviderProfileIds,
      )
    ) {
      return "a provider cannot be both required and excluded";
    }
    if (
      containsOverlap(
        rule.requirements.requiredModelProfileIds,
        rule.requirements.excludedModelProfileIds,
      )
    ) {
      return "a model cannot be both required and excluded";
    }
    if (
      rule.result.providerProfileId !== null &&
      rule.requirements.excludedProviderProfileIds.includes(rule.result.providerProfileId)
    ) {
      return "the selected provider cannot be excluded";
    }
    if (
      rule.result.modelProfileId !== null &&
      rule.requirements.excludedModelProfileIds.includes(rule.result.modelProfileId)
    ) {
      return "the selected model cannot be excluded";
    }
    return true;
  }),
);
export type RoutingRule = typeof RoutingRule.Type;

export const AgentRoleRoutingProfile = Schema.Struct({
  id: AgentRoleRoutingProfileId,
  projectId: Schema.NullOr(ProjectId),
  roleKind: RoutingAgentRoleKind,
  routingPolicyId: RoutingPolicyId,
  preferredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  requiredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  defaultReasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  allowFallback: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentRoleRoutingProfile = typeof AgentRoleRoutingProfile.Type;

export const TaskRoutingAssessmentSource = Schema.Literals(["manual", "inferred", "system"]);
export type TaskRoutingAssessmentSource = typeof TaskRoutingAssessmentSource.Type;

export const TaskRoutingAssessment = Schema.Struct({
  id: TaskRoutingAssessmentId,
  taskId: MissionTaskId,
  agentRole: RoutingAgentRoleKind,
  taskType: RoutingTaskType,
  complexity: RoutingTaskComplexity,
  requiredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  preferredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  estimatedContextTokens: Schema.NullOr(PositiveInt),
  privacyClassification: RoutingPrivacyClassification,
  writeAccessRequired: Schema.Boolean,
  visionRequired: Schema.Boolean,
  structuredOutputRequired: Schema.Boolean,
  assessmentSource: TaskRoutingAssessmentSource,
  assessmentExplanation: BoundedString(8_000),
  version: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  supersededById: Schema.NullOr(TaskRoutingAssessmentId),
});
export type TaskRoutingAssessment = typeof TaskRoutingAssessment.Type;

export const RoutingDecisionType = Schema.Literals([
  "automatic",
  "manual",
  "policy_pinned",
  "fallback",
  "retry",
  "recovery",
]);
export type RoutingDecisionType = typeof RoutingDecisionType.Type;

export const RoutingDecisionStatus = Schema.Literals([
  "planned",
  "applied",
  "superseded",
  "failed",
  "cancelled",
]);
export type RoutingDecisionStatus = typeof RoutingDecisionStatus.Type;

export const RoutingFallbackStep = Schema.Struct({
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  maximumAttempts: PositiveInt,
  reason: BoundedString(1_000),
});
export type RoutingFallbackStep = typeof RoutingFallbackStep.Type;

export const RoutingCandidateSummary = Schema.Struct({
  consideredCount: NonNegativeInt,
  eligibleCount: NonNegativeInt,
  persistedCandidateIds: Schema.Array(RoutingCandidateRecordId).check(Schema.isMaxLength(64)),
  truncated: Schema.Boolean,
});
export type RoutingCandidateSummary = typeof RoutingCandidateSummary.Type;

export const RoutingConstraintsSnapshot = Schema.Struct({
  requiredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  preferredCapabilities: Schema.Array(RoutingCapabilityName).check(Schema.isMaxLength(16)),
  requiredTools: BoundedStringArray(128, 256),
  requiredModalities: BoundedStringArray(32, 128),
  minimumContextTokens: Schema.NullOr(PositiveInt),
  maximumContextTarget: Schema.NullOr(PositiveInt),
  privacyClassification: RoutingPrivacyClassification,
  localOnly: Schema.Boolean,
  maximumRetries: NonNegativeInt,
  contextStrategy: BoundedNonEmptyString(128),
  estimatedContextTokens: Schema.NullOr(PositiveInt),
  /** Budget left for optional memory/source retrieval after required context is reserved. */
  optionalContextTokenBudget: Schema.optional(NonNegativeInt),
});
export type RoutingConstraintsSnapshot = typeof RoutingConstraintsSnapshot.Type;

export const RoutingPolicySnapshot = Schema.Struct({
  policyIds: Schema.Array(RoutingPolicyId).check(Schema.isMaxLength(32)),
  overrideIds: Schema.Array(RoutingOverrideId).check(Schema.isMaxLength(32)),
  effectiveFallbackMode: RoutingFallbackMode,
  effectivePrivacyMode: RoutingPrivacyMode,
  effectiveBudgetMode: RoutingBudgetMode,
});
export type RoutingPolicySnapshot = typeof RoutingPolicySnapshot.Type;

export const RoutingDecision = Schema.Struct({
  id: RoutingDecisionId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  missionAgentId: Schema.NullOr(MissionAgentId),
  agentRunId: Schema.NullOr(AgentRunId),
  assessmentId: TaskRoutingAssessmentId,
  decisionType: RoutingDecisionType,
  selectedProviderProfileId: ProviderProfileId,
  selectedModelProfileId: ModelProfileId,
  selectedCapabilitySnapshotId: ModelCapabilitySnapshotId,
  selectedReasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  manualProviderPin: Schema.Boolean,
  manualModelPin: Schema.Boolean,
  manualReasoningPin: Schema.Boolean,
  fallbackPlan: Schema.Array(RoutingFallbackStep).check(Schema.isMaxLength(16)),
  candidateSummary: RoutingCandidateSummary,
  selectionExplanation: BoundedNonEmptyString(8_000),
  constraintsSnapshot: RoutingConstraintsSnapshot,
  policySnapshot: RoutingPolicySnapshot,
  status: RoutingDecisionStatus,
  createdAt: IsoDateTime,
  appliedAt: Schema.NullOr(IsoDateTime),
  terminalAt: Schema.NullOr(IsoDateTime),
  failureSummary: Schema.NullOr(BoundedString(4_000)),
  supersededById: Schema.NullOr(RoutingDecisionId),
}).check(
  Schema.makeFilter((decision) => {
    if (decision.taskId !== null && decision.missionId === null) {
      return "task-scoped routing decisions require a mission";
    }
    if (decision.status === "applied" && decision.appliedAt === null) {
      return "applied routing decisions require appliedAt";
    }
    if (decision.status === "superseded" && decision.supersededById === null) {
      return "superseded routing decisions require supersededById";
    }
    return true;
  }),
);
export type RoutingDecision = typeof RoutingDecision.Type;

export const RoutingCandidateRecord = Schema.Struct({
  id: RoutingCandidateRecordId,
  routingDecisionId: RoutingDecisionId,
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  eligible: Schema.Boolean,
  score: Schema.NullOr(Schema.Number),
  rejectionReasons: BoundedStringArray(32, 1_000),
  preferenceReasons: BoundedStringArray(32, 1_000),
  capabilitySnapshotId: ModelCapabilitySnapshotId,
  createdAt: IsoDateTime,
});
export type RoutingCandidateRecord = typeof RoutingCandidateRecord.Type;

export const ProviderRateLimitState = Schema.Literals([
  "clear",
  "approaching",
  "limited",
  "unknown",
]);
export type ProviderRateLimitState = typeof ProviderRateLimitState.Type;

export const ProviderHealthRecord = Schema.Struct({
  id: ProviderHealthRecordId,
  providerProfileId: ProviderProfileId,
  status: ProviderProfileStatus,
  latencyMilliseconds: Schema.NullOr(NonNegativeInt),
  rateLimitState: ProviderRateLimitState,
  errorCategory: Schema.NullOr(BoundedNonEmptyString(256)),
  observedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type ProviderHealthRecord = typeof ProviderHealthRecord.Type;

export const RoutingOverride = Schema.Struct({
  id: RoutingOverrideId,
  scopeType: RoutingPolicyScopeType,
  scopeId: Schema.NullOr(BoundedNonEmptyString(512)),
  providerProfileId: Schema.NullOr(ProviderProfileId),
  modelProfileId: Schema.NullOr(ModelProfileId),
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  fallbackMode: Schema.NullOr(RoutingFallbackMode),
  expiresAt: Schema.NullOr(IsoDateTime),
  reason: BoundedNonEmptyString(4_000),
  createdBy: BoundedNonEmptyString(512),
  createdAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
}).check(
  Schema.makeFilter((override) => {
    if (!policyScopeIsValid(override)) {
      return "global and user scopes must use the environment singleton; other scopes require scopeId";
    }
    return override.providerProfileId !== null ||
      override.modelProfileId !== null ||
      override.reasoningLevel !== null ||
      override.fallbackMode !== null
      ? true
      : "a routing override must override at least one setting";
  }),
);
export type RoutingOverride = typeof RoutingOverride.Type;

export const RoutedRunCompletionState = Schema.Literals([
  "running",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export type RoutedRunCompletionState = typeof RoutedRunCompletionState.Type;

export const RoutedRunVerificationResult = Schema.Literals([
  "not_run",
  "passed",
  "failed",
  "overridden",
  "unknown",
]);
export type RoutedRunVerificationResult = typeof RoutedRunVerificationResult.Type;

export const RoutedRunHumanDisposition = Schema.Literals(["accepted", "rejected"]);
export type RoutedRunHumanDisposition = typeof RoutedRunHumanDisposition.Type;

export const RoutedRunOutcome = Schema.Struct({
  id: RoutedRunOutcomeId,
  routingDecisionId: RoutingDecisionId,
  agentRunId: AgentRunId,
  taskType: RoutingTaskType,
  complexity: RoutingTaskComplexity,
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  completionState: RoutedRunCompletionState,
  fallbackUsed: Schema.Boolean,
  interrupted: Schema.Boolean,
  verificationResult: RoutedRunVerificationResult,
  retryCount: NonNegativeInt,
  userOverride: Schema.Boolean,
  humanDisposition: Schema.NullOr(RoutedRunHumanDisposition),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RoutedRunOutcome = typeof RoutedRunOutcome.Type;

export const ROUTING_POLICY_SCOPE_PRECEDENCE: Readonly<Record<RoutingPolicyScopeType, number>> = {
  global: 0,
  user: 1,
  agent_role: 2,
  project: 3,
  mission: 4,
  task: 5,
};
