import {
  ROUTING_POLICY_SCOPE_PRECEDENCE,
  type AgentRoleRoutingProfile,
  type ModelCapabilitySnapshot,
  type ModelProfile,
  type ModelProfileId,
  type ProviderHealthRecord,
  type ProviderProfile,
  type ProviderProfileId,
  type RoutingBudgetMode,
  type RoutingCapabilityName,
  type RoutingFallbackMode,
  type RoutingFallbackStep,
  type RoutingOverride,
  type RoutingPolicy,
  type RoutingPolicyId,
  type RoutingPolicyScopeType,
  type RoutingPrivacyMode,
  type RoutingReasoningLevel,
  type RoutingRule,
  type RoutingTaskComplexity,
  type RoutingTaskType,
} from "@t3tools/contracts";

import type { ProviderHarnessCapabilities } from "../provider/ProviderDriver.ts";
import type { RoutingAssessmentForEngine } from "./TaskAssessment.ts";

const SCOPE_PRECEDENCE: Readonly<Record<RoutingPolicyScopeType, number>> =
  ROUTING_POLICY_SCOPE_PRECEDENCE;

const CAPABILITY_KEYS: Readonly<
  Record<RoutingCapabilityName, keyof ModelCapabilitySnapshot["capabilities"] | null>
> = {
  tool_calling: "toolCalling",
  structured_output: "structuredOutput",
  vision_input: "visionInput",
  audio_input: "audioInput",
  file_input: "fileInput",
  streaming: "streaming",
  reasoning_control: "reasoningControl",
  parallel_tool_calls: "parallelToolCalls",
  code_editing: "codeEditing",
  long_context: "longContext",
  system_instructions: "systemInstructions",
  prompt_caching: "promptCaching",
};

export interface RoutingEngineCandidate {
  readonly provider: ProviderProfile;
  readonly model: ModelProfile;
  readonly capabilitySnapshot: ModelCapabilitySnapshot;
  readonly providerHealth: ProviderHealthRecord | null;
  readonly harnessCapabilities: ProviderHarnessCapabilities;
  /** Explicit administrator approval for a remote endpoint handling restricted work. */
  readonly approvedRemote: boolean;
  /** Runtime occupancy. A null limit means no authoritative limit is known. */
  readonly concurrency?: {
    readonly providerActiveSessions: number;
    readonly providerMaximumSessions: number | null;
    readonly modelActiveSessions: number;
    readonly modelMaximumSessions: number | null;
  };
  readonly suitableAgentRoles?: ReadonlyArray<RoutingAssessmentForEngine["agentRole"]>;
  readonly suitableTaskTypes?: ReadonlyArray<RoutingTaskType>;
}

export interface RoutingScopeContext {
  readonly projectId: string;
  readonly missionId?: string | null;
  readonly taskId?: string | null;
  readonly missionStatus?: string | null;
  readonly repositoryLanguages?: ReadonlyArray<string>;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly verificationFailureCategory?: string | null;
}

export interface ManualRoutingPin {
  readonly providerProfileId?: ProviderProfileId | null;
  readonly modelProfileId?: ModelProfileId | null;
  readonly reasoningLevel?: RoutingReasoningLevel | null;
  readonly fallbackMode?: RoutingFallbackMode | null;
  /** Manual pins are terminal unless the user explicitly opts into fallback. */
  readonly allowFallback?: boolean;
}

export interface RoutingEngineInput {
  readonly assessment: RoutingAssessmentForEngine;
  readonly scope: RoutingScopeContext;
  readonly candidates: ReadonlyArray<RoutingEngineCandidate>;
  readonly policies: ReadonlyArray<RoutingPolicy>;
  readonly rules: ReadonlyArray<RoutingRule>;
  readonly overrides?: ReadonlyArray<RoutingOverride>;
  readonly roleProfiles?: ReadonlyArray<AgentRoleRoutingProfile>;
  readonly currentPin?: ManualRoutingPin | null;
  readonly now: string;
  /** Defense in depth; persisted fallback plans are bounded by contract separately. */
  readonly maximumFallbackSteps?: number;
}

export interface EffectiveRoutingPolicy {
  readonly policyIds: ReadonlyArray<RoutingPolicyId>;
  readonly overrideIds: ReadonlyArray<RoutingOverride["id"]>;
  readonly matchedRuleIds: ReadonlyArray<RoutingRule["id"]>;
  readonly defaultProviderProfileId: ProviderProfileId | null;
  readonly defaultModelProfileId: ModelProfileId | null;
  readonly pinnedProviderProfileId: ProviderProfileId | null;
  readonly pinnedModelProfileId: ModelProfileId | null;
  readonly reasoningLevel: RoutingReasoningLevel | null;
  readonly reasoningLevelIsRequired: boolean;
  readonly fallbackMode: RoutingFallbackMode;
  readonly privacyMode: RoutingPrivacyMode;
  readonly budgetMode: RoutingBudgetMode;
  readonly requiredProviderProfileIds: ReadonlyArray<ProviderProfileId>;
  readonly excludedProviderProfileIds: ReadonlyArray<ProviderProfileId>;
  readonly requiredModelProfileIds: ReadonlyArray<ModelProfileId>;
  readonly excludedModelProfileIds: ReadonlyArray<ModelProfileId>;
  readonly requiredCapabilities: ReadonlyArray<RoutingCapabilityName>;
  readonly preferredProviderProfileIds: ReadonlyArray<ProviderProfileId>;
  readonly preferredModelProfileIds: ReadonlyArray<ModelProfileId>;
  readonly preferredCapabilities: ReadonlyArray<RoutingCapabilityName>;
  readonly preferLocal: boolean;
  readonly preferLowLatency: boolean;
  readonly preferLowCost: boolean;
  readonly allowDeprecatedModel: boolean;
  readonly fallbackChain: ReadonlyArray<ModelProfileId>;
  readonly maximumRetries: number;
  readonly roleAllowsFallback: boolean;
  readonly manualProviderPin: boolean;
  readonly manualModelPin: boolean;
  readonly manualReasoningPin: boolean;
  readonly manualFallbackAllowed: boolean;
  readonly conflicts: ReadonlyArray<string>;
}

export interface RoutingCandidateEvaluation {
  readonly candidate: RoutingEngineCandidate;
  readonly eligible: boolean;
  readonly score: number | null;
  readonly scoreComponents: Readonly<Record<string, number>>;
  readonly rejectionReasons: ReadonlyArray<string>;
  readonly preferenceReasons: ReadonlyArray<string>;
  readonly selectedReasoningLevel: RoutingReasoningLevel | null;
}

export interface RoutingEngineResult {
  readonly status: "selected" | "no_eligible_candidate" | "conflict";
  readonly selected: RoutingCandidateEvaluation | null;
  readonly evaluations: ReadonlyArray<RoutingCandidateEvaluation>;
  readonly effectivePolicy: EffectiveRoutingPolicy;
  readonly fallbackPlan: ReadonlyArray<RoutingFallbackStep>;
  readonly explanation: string;
}

const uniqueSorted = <Value extends string>(values: Iterable<Value>): ReadonlyArray<Value> =>
  [...new Set(values)].toSorted((left, right) => left.localeCompare(right));

const uniqueInOrder = <Value extends string>(values: Iterable<Value>): ReadonlyArray<Value> => {
  const seen = new Set<Value>();
  const result: Array<Value> = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const scopeIdFor = (
  scopeType: RoutingPolicyScopeType,
  input: RoutingEngineInput,
): string | null | undefined => {
  switch (scopeType) {
    case "global":
    case "user":
      return null;
    case "agent_role":
      return input.assessment.agentRole;
    case "project":
      return input.scope.projectId;
    case "mission":
      return input.scope.missionId;
    case "task":
      return input.scope.taskId;
  }
};

const scopeApplies = (
  scoped: { readonly scopeType: RoutingPolicyScopeType; readonly scopeId: string | null },
  input: RoutingEngineInput,
) => {
  const expected = scopeIdFor(scoped.scopeType, input);
  return expected !== undefined && expected === scoped.scopeId;
};

const bySpecificityThenPriority = (left: RoutingPolicy, right: RoutingPolicy) =>
  SCOPE_PRECEDENCE[right.scopeType] - SCOPE_PRECEDENCE[left.scopeType] ||
  right.priority - left.priority ||
  left.id.localeCompare(right.id);

const byOverrideSpecificity = (left: RoutingOverride, right: RoutingOverride) =>
  SCOPE_PRECEDENCE[right.scopeType] - SCOPE_PRECEDENCE[left.scopeType] ||
  right.createdAt.localeCompare(left.createdAt) ||
  left.id.localeCompare(right.id);

const normalized = (value: string) => value.trim().toLowerCase();

const containsAny = (needles: ReadonlyArray<string>, haystack: ReadonlyArray<string>) => {
  if (needles.length === 0) return true;
  const normalizedHaystack = new Set(haystack.map(normalized));
  return needles.some((value) => normalizedHaystack.has(normalized(value)));
};

const containsAll = (needles: ReadonlyArray<string>, haystack: ReadonlyArray<string>) => {
  const normalizedHaystack = new Set(haystack.map(normalized));
  return needles.every((value) => normalizedHaystack.has(normalized(value)));
};

const globMatches = (pattern: string, path: string) => {
  const normalizedPattern = pattern.replaceAll("\\", "/").toLowerCase();
  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  let expression = "";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern.charAt(index);
    if (character === "*") {
      if (normalizedPattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`, "u").test(normalizedPath);
};

const ruleMatches = (rule: RoutingRule, input: RoutingEngineInput) => {
  const conditions = rule.conditions;
  const pin = input.currentPin;
  const isPinned =
    pin !== null &&
    pin !== undefined &&
    (pin.providerProfileId !== undefined ||
      pin.modelProfileId !== undefined ||
      pin.reasoningLevel !== undefined ||
      pin.fallbackMode !== undefined);
  if (
    conditions.taskTypes.length > 0 &&
    !conditions.taskTypes.includes(input.assessment.taskType)
  ) {
    return false;
  }
  if (
    conditions.agentRoles.length > 0 &&
    !conditions.agentRoles.includes(input.assessment.agentRole)
  ) {
    return false;
  }
  if (
    conditions.complexities.length > 0 &&
    !conditions.complexities.includes(input.assessment.complexity as RoutingTaskComplexity)
  ) {
    return false;
  }
  if (
    !containsAny(conditions.repositoryLanguages, input.scope.repositoryLanguages ?? []) ||
    !containsAll(conditions.requiredModalities, input.assessment.requiredModalities) ||
    !containsAll(conditions.requiredTools, input.assessment.requiredTools)
  ) {
    return false;
  }
  if (
    conditions.changedFilePatterns.length > 0 &&
    !conditions.changedFilePatterns.some((pattern) =>
      (input.scope.changedFiles ?? []).some((path) => globMatches(pattern, path)),
    )
  ) {
    return false;
  }
  if (
    conditions.minimumContextTokens !== null &&
    (input.assessment.estimatedContextTokens === null ||
      input.assessment.estimatedContextTokens < conditions.minimumContextTokens)
  ) {
    return false;
  }
  if (
    conditions.privacyClassifications.length > 0 &&
    !conditions.privacyClassifications.includes(input.assessment.privacyClassification)
  ) {
    return false;
  }
  if (
    !containsAny(
      conditions.missionStatuses,
      input.scope.missionStatus === null || input.scope.missionStatus === undefined
        ? []
        : [input.scope.missionStatus],
    ) ||
    !containsAny(
      conditions.verificationFailureCategories,
      input.scope.verificationFailureCategory === null ||
        input.scope.verificationFailureCategory === undefined
        ? []
        : [input.scope.verificationFailureCategory],
    )
  ) {
    return false;
  }
  if (
    conditions.providerStatuses.length > 0 &&
    !input.candidates.some((candidate) =>
      conditions.providerStatuses.includes(
        candidate.providerHealth?.status ?? candidate.provider.status,
      ),
    )
  ) {
    return false;
  }
  if (
    conditions.rateLimitStates.length > 0 &&
    !input.candidates.some(
      (candidate) =>
        candidate.providerHealth !== null &&
        conditions.rateLimitStates.includes(candidate.providerHealth.rateLimitState),
    )
  ) {
    return false;
  }
  return (
    conditions.manualPinState === "any" ||
    (conditions.manualPinState === "pinned" && isPinned) ||
    (conditions.manualPinState === "unpinned" && !isPinned)
  );
};

const activeOverride = (override: RoutingOverride, input: RoutingEngineInput, now: number) =>
  override.revokedAt === null &&
  (override.expiresAt === null || Date.parse(override.expiresAt) > now) &&
  scopeApplies(override, input);

const firstDefined = <Value>(values: Iterable<Value | null | undefined>): Value | null => {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
};

const roleProfileFor = (input: RoutingEngineInput) =>
  (input.roleProfiles ?? [])
    .filter(
      (profile) =>
        profile.roleKind === input.assessment.agentRole &&
        (profile.projectId === null || profile.projectId === input.scope.projectId),
    )
    .toSorted((left, right) => {
      const projectDifference = Number(right.projectId !== null) - Number(left.projectId !== null);
      return (
        projectDifference ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id)
      );
    })[0];

const overlap = <Value extends string>(left: ReadonlyArray<Value>, right: ReadonlyArray<Value>) => {
  const values = new Set(right);
  return left.filter((value) => values.has(value));
};

/** Resolve all policy inputs without reading time, environment, or mutable state. */
export const resolveEffectiveRoutingPolicy = (
  input: RoutingEngineInput,
): EffectiveRoutingPolicy => {
  const now = Date.parse(input.now);
  const policies = input.policies
    .filter((policy) => policy.isEnabled && scopeApplies(policy, input))
    .toSorted(bySpecificityThenPriority);
  const policyIds = new Set(policies.map((policy) => policy.id));
  const rules = input.rules
    .filter(
      (rule) => rule.isEnabled && policyIds.has(rule.routingPolicyId) && ruleMatches(rule, input),
    )
    .toSorted((left, right) => {
      const leftPolicy = policies.find((policy) => policy.id === left.routingPolicyId);
      const rightPolicy = policies.find((policy) => policy.id === right.routingPolicyId);
      const specificity =
        SCOPE_PRECEDENCE[rightPolicy?.scopeType ?? "global"] -
        SCOPE_PRECEDENCE[leftPolicy?.scopeType ?? "global"];
      return specificity || right.priority - left.priority || left.id.localeCompare(right.id);
    });
  const overrides = (input.overrides ?? [])
    .filter((override) => activeOverride(override, input, now))
    .toSorted(byOverrideSpecificity);
  const roleProfile = roleProfileFor(input);
  const pin = input.currentPin ?? null;
  const manualProviderPin =
    pin !== null && pin.providerProfileId !== undefined && pin.providerProfileId !== null;
  const manualModelPin =
    pin !== null && pin.modelProfileId !== undefined && pin.modelProfileId !== null;
  const manualReasoningPin = pin !== null && pin.reasoningLevel !== undefined;

  const policyPrivacy = policies.find((policy) => policy.privacyMode !== "inherit")?.privacyMode;
  const policyBudget = policies.find((policy) => policy.budgetMode !== "inherit")?.budgetMode;
  const ruleProvider = firstDefined(rules.map((rule) => rule.result.providerProfileId));
  const ruleModel = firstDefined(rules.map((rule) => rule.result.modelProfileId));
  const ruleReasoning = firstDefined(
    rules.flatMap((rule) => [rule.result.reasoningLevel, rule.requirements.reasoningLevel]),
  );
  const overrideProvider = firstDefined(overrides.map((override) => override.providerProfileId));
  const overrideModel = firstDefined(overrides.map((override) => override.modelProfileId));
  const overrideReasoning = firstDefined(overrides.map((override) => override.reasoningLevel));
  const overrideFallback = firstDefined(overrides.map((override) => override.fallbackMode));
  const requiredProviderProfileIds = uniqueSorted(
    rules.flatMap((rule) => rule.requirements.requiredProviderProfileIds),
  );
  const excludedProviderProfileIds = uniqueSorted(
    rules.flatMap((rule) => rule.requirements.excludedProviderProfileIds),
  );
  const requiredModelProfileIds = uniqueSorted(
    rules.flatMap((rule) => rule.requirements.requiredModelProfileIds),
  );
  const excludedModelProfileIds = uniqueSorted(
    rules.flatMap((rule) => rule.requirements.excludedModelProfileIds),
  );
  const requiredCapabilities = uniqueSorted([
    ...input.assessment.requiredModelCapabilities,
    ...(roleProfile?.requiredCapabilities ?? []),
    ...rules.flatMap((rule) => rule.requirements.minimumCapabilities),
  ]);
  const preferredCapabilities = uniqueSorted([
    ...input.assessment.preferredModelCapabilities,
    ...(roleProfile?.preferredCapabilities ?? []),
    ...rules.flatMap((rule) => rule.preferences.preferredCapabilities),
  ]);
  const conflicts: Array<string> = [];
  for (const providerId of overlap(requiredProviderProfileIds, excludedProviderProfileIds)) {
    conflicts.push(`Provider ${providerId} is both required and excluded.`);
  }
  for (const modelId of overlap(requiredModelProfileIds, excludedModelProfileIds)) {
    conflicts.push(`Model ${modelId} is both required and excluded.`);
  }

  const pinnedProviderProfileId = manualProviderPin
    ? (pin?.providerProfileId ?? null)
    : (overrideProvider ?? ruleProvider);
  const pinnedModelProfileId = manualModelPin
    ? (pin?.modelProfileId ?? null)
    : (overrideModel ?? ruleModel);
  const pinnedCandidate =
    pinnedModelProfileId === null
      ? undefined
      : input.candidates.find((candidate) => candidate.model.id === pinnedModelProfileId);
  if (
    pinnedProviderProfileId !== null &&
    pinnedCandidate !== undefined &&
    pinnedCandidate.provider.id !== pinnedProviderProfileId
  ) {
    conflicts.push(
      `Pinned model ${pinnedModelProfileId} does not belong to pinned provider ${pinnedProviderProfileId}.`,
    );
  }
  if (
    pinnedProviderProfileId !== null &&
    excludedProviderProfileIds.includes(pinnedProviderProfileId)
  ) {
    conflicts.push(`Pinned provider ${pinnedProviderProfileId} is excluded by policy.`);
  }
  if (pinnedModelProfileId !== null && excludedModelProfileIds.includes(pinnedModelProfileId)) {
    conflicts.push(`Pinned model ${pinnedModelProfileId} is excluded by policy.`);
  }

  const higherScopeReasoning = firstDefined(
    policies
      .filter((policy) => SCOPE_PRECEDENCE[policy.scopeType] > SCOPE_PRECEDENCE.agent_role)
      .map((policy) => policy.defaultReasoningLevel),
  );
  const roleScopeReasoning = firstDefined(
    policies
      .filter((policy) => policy.scopeType === "agent_role")
      .map((policy) => policy.defaultReasoningLevel),
  );
  const lowerScopeReasoning = firstDefined(
    policies
      .filter((policy) => SCOPE_PRECEDENCE[policy.scopeType] < SCOPE_PRECEDENCE.agent_role)
      .map((policy) => policy.defaultReasoningLevel),
  );
  const reasoningLevel = manualReasoningPin
    ? (pin?.reasoningLevel ?? null)
    : (overrideReasoning ??
      ruleReasoning ??
      higherScopeReasoning ??
      roleProfile?.defaultReasoningLevel ??
      roleScopeReasoning ??
      lowerScopeReasoning ??
      null);
  const fallbackMode =
    pin?.fallbackMode ??
    overrideFallback ??
    firstDefined(rules.map((rule) => rule.result.fallbackMode)) ??
    policies[0]?.fallbackMode ??
    "none";

  return {
    policyIds: policies.map((policy) => policy.id),
    overrideIds: overrides.map((override) => override.id),
    matchedRuleIds: rules.map((rule) => rule.id),
    defaultProviderProfileId: firstDefined(
      policies.map((policy) => policy.defaultProviderProfileId),
    ),
    defaultModelProfileId: firstDefined(policies.map((policy) => policy.defaultModelProfileId)),
    pinnedProviderProfileId,
    pinnedModelProfileId,
    reasoningLevel,
    reasoningLevelIsRequired: reasoningLevel !== null,
    fallbackMode,
    privacyMode: policyPrivacy ?? "remote_allowed",
    budgetMode: policyBudget ?? "unrestricted",
    requiredProviderProfileIds,
    excludedProviderProfileIds,
    requiredModelProfileIds,
    excludedModelProfileIds,
    requiredCapabilities,
    preferredProviderProfileIds: uniqueSorted(
      rules.flatMap((rule) => rule.preferences.preferredProviderProfileIds),
    ),
    preferredModelProfileIds: uniqueSorted(
      rules.flatMap((rule) => rule.preferences.preferredModelProfileIds),
    ),
    preferredCapabilities,
    preferLocal:
      policyPrivacy === "local_preferred" || rules.some((rule) => rule.preferences.preferLocal),
    preferLowLatency: rules.some((rule) => rule.preferences.preferLowLatency),
    preferLowCost: rules.some((rule) => rule.preferences.preferLowCost),
    allowDeprecatedModel: rules.some((rule) => rule.result.allowDeprecatedModel),
    fallbackChain: uniqueInOrder(rules.flatMap((rule) => rule.requirements.fallbackChain)),
    maximumRetries: Math.max(0, ...rules.map((rule) => rule.requirements.maximumRetries)),
    roleAllowsFallback: roleProfile?.allowFallback ?? true,
    manualProviderPin,
    manualModelPin,
    manualReasoningPin,
    manualFallbackAllowed:
      pin?.fallbackMode !== undefined && pin.fallbackMode !== null
        ? pin.fallbackMode !== "none"
        : pin?.allowFallback === true,
    conflicts: uniqueSorted(conflicts),
  };
};

const capabilityIsSupported = (snapshot: ModelCapabilitySnapshot, name: RoutingCapabilityName) => {
  const key = CAPABILITY_KEYS[name];
  return key !== null && snapshot.capabilities[key] === "supported";
};

const dateIsAfter = (value: string, threshold: number) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > threshold;
};

const privacyRejects = (
  candidate: RoutingEngineCandidate,
  policy: EffectiveRoutingPolicy,
  assessment: RoutingAssessmentForEngine,
) => {
  if (assessment.privacyClassification === "local_only" || policy.privacyMode === "local_only") {
    return candidate.provider.isLocal ? null : "privacy_requires_local_provider";
  }
  if (
    assessment.privacyClassification === "restricted" ||
    policy.privacyMode === "approved_remote_only"
  ) {
    return candidate.provider.isLocal || candidate.approvedRemote
      ? null
      : "privacy_requires_local_or_approved_remote_provider";
  }
  return null;
};

const selectedReasoningFor = (
  candidate: RoutingEngineCandidate,
  policy: EffectiveRoutingPolicy,
  assessment: RoutingAssessmentForEngine,
): RoutingReasoningLevel | null => {
  if (policy.manualReasoningPin && policy.reasoningLevel === null) return null;
  if (policy.reasoningLevel !== null) return policy.reasoningLevel;
  return candidate.capabilitySnapshot.reasoningOptions.supportedLevels.includes(
    assessment.recommendedReasoningLevel,
  )
    ? assessment.recommendedReasoningLevel
    : null;
};

const evaluateCandidate = (
  candidate: RoutingEngineCandidate,
  input: RoutingEngineInput,
  policy: EffectiveRoutingPolicy,
  now: number,
): RoutingCandidateEvaluation => {
  const rejectionReasons: Array<string> = [];
  const preferenceReasons: Array<string> = [];
  const scoreComponents: Record<string, number> = {};
  const reject = (reason: string) => rejectionReasons.push(reason);

  if (!candidate.provider.isEnabled || candidate.provider.status === "disabled") {
    reject("provider_disabled");
  } else if (
    candidate.provider.status !== "available" &&
    candidate.provider.status !== "degraded"
  ) {
    reject(`provider_${candidate.provider.status}`);
  }
  if (!candidate.model.isEnabled || candidate.model.status === "disabled") {
    reject("model_disabled");
  } else if (candidate.model.status === "unavailable" || candidate.model.status === "unknown") {
    reject(`model_${candidate.model.status}`);
  }
  if (candidate.model.providerProfileId !== candidate.provider.id) {
    reject("model_provider_identity_mismatch");
  }
  if (
    candidate.concurrency !== undefined &&
    candidate.concurrency.providerMaximumSessions !== null &&
    candidate.concurrency.providerActiveSessions >= candidate.concurrency.providerMaximumSessions
  ) {
    reject("provider_concurrency_exhausted");
  }
  if (
    candidate.concurrency !== undefined &&
    candidate.concurrency.modelMaximumSessions !== null &&
    candidate.concurrency.modelActiveSessions >= candidate.concurrency.modelMaximumSessions
  ) {
    reject("model_concurrency_exhausted");
  }
  if (
    (candidate.model.isDeprecated || candidate.model.status === "deprecated") &&
    !policy.allowDeprecatedModel &&
    policy.pinnedModelProfileId !== candidate.model.id
  ) {
    reject("model_deprecated");
  }
  if (candidate.capabilitySnapshot.modelProfileId !== candidate.model.id) {
    reject("capability_snapshot_model_mismatch");
  }
  if (
    candidate.capabilitySnapshot.expiresAt !== null &&
    !dateIsAfter(candidate.capabilitySnapshot.expiresAt, now)
  ) {
    reject("capability_snapshot_stale");
  }
  if (candidate.providerHealth === null) {
    reject("provider_health_missing");
  } else {
    if (!dateIsAfter(candidate.providerHealth.expiresAt, now)) reject("provider_health_stale");
    if (candidate.providerHealth.providerProfileId !== candidate.provider.id) {
      reject("provider_health_identity_mismatch");
    }
    if (
      candidate.providerHealth.status !== "available" &&
      candidate.providerHealth.status !== "degraded"
    ) {
      reject(`provider_health_${candidate.providerHealth.status}`);
    }
    if (candidate.providerHealth.rateLimitState === "limited") reject("provider_rate_limited");
  }

  if (
    policy.pinnedProviderProfileId !== null &&
    candidate.provider.id !== policy.pinnedProviderProfileId
  ) {
    reject("provider_does_not_match_pin");
  }
  if (policy.pinnedModelProfileId !== null && candidate.model.id !== policy.pinnedModelProfileId) {
    reject("model_does_not_match_pin");
  }
  if (
    policy.requiredProviderProfileIds.length > 0 &&
    !policy.requiredProviderProfileIds.includes(candidate.provider.id)
  ) {
    reject("provider_not_in_required_set");
  }
  if (policy.excludedProviderProfileIds.includes(candidate.provider.id))
    reject("provider_excluded");
  if (
    policy.requiredModelProfileIds.length > 0 &&
    !policy.requiredModelProfileIds.includes(candidate.model.id)
  ) {
    reject("model_not_in_required_set");
  }
  if (policy.excludedModelProfileIds.includes(candidate.model.id)) reject("model_excluded");
  const privacyReason = privacyRejects(candidate, policy, input.assessment);
  if (privacyReason !== null) reject(privacyReason);

  for (const capability of policy.requiredCapabilities) {
    if (!capabilityIsSupported(candidate.capabilitySnapshot, capability)) {
      reject(`required_model_capability_not_supported:${capability}`);
    }
  }
  for (const capability of input.assessment.requiredHarnessCapabilities) {
    if (candidate.harnessCapabilities[capability] !== "supported") {
      reject(`required_harness_capability_not_supported:${capability}`);
    }
  }

  const contextTarget = Math.max(
    input.assessment.estimatedContextTokens ?? 0,
    ...input.rules
      .filter((rule) => policy.matchedRuleIds.includes(rule.id))
      .map((rule) => rule.requirements.maximumContextTarget ?? 0),
  );
  const maximumContext = candidate.capabilitySnapshot.contextLimits.maximumInputTokens;
  if (input.assessment.estimatedContextTokens === null) {
    reject("task_context_estimate_unknown");
  } else if (maximumContext === null) {
    reject("context_capacity_unknown");
  } else if (maximumContext < contextTarget) {
    reject(`context_capacity_insufficient:${maximumContext}<${contextTarget}`);
  }
  const selectedReasoningLevel = selectedReasoningFor(candidate, policy, input.assessment);
  if (
    policy.reasoningLevelIsRequired &&
    selectedReasoningLevel !== null &&
    !candidate.capabilitySnapshot.reasoningOptions.supportedLevels.includes(selectedReasoningLevel)
  ) {
    reject(`reasoning_level_not_supported:${selectedReasoningLevel}`);
  }

  if (rejectionReasons.length > 0) {
    return {
      candidate,
      eligible: false,
      score: null,
      scoreComponents,
      rejectionReasons: uniqueSorted(rejectionReasons),
      preferenceReasons,
      selectedReasoningLevel,
    };
  }

  const addScore = (name: string, score: number, reason?: string) => {
    scoreComponents[name] = score;
    if (score !== 0 && reason !== undefined) preferenceReasons.push(reason);
  };
  addScore(
    "policy_default_provider",
    candidate.provider.id === policy.defaultProviderProfileId ? 30 : 0,
    "policy_default_provider",
  );
  addScore(
    "policy_default_model",
    candidate.model.id === policy.defaultModelProfileId ? 50 : 0,
    "policy_default_model",
  );
  addScore(
    "preferred_provider",
    policy.preferredProviderProfileIds.includes(candidate.provider.id) ? 25 : 0,
    "preferred_provider",
  );
  addScore(
    "preferred_model",
    policy.preferredModelProfileIds.includes(candidate.model.id) ? 40 : 0,
    "preferred_model",
  );
  addScore(
    "role_suitability",
    candidate.suitableAgentRoles?.includes(input.assessment.agentRole) === true ? 20 : 0,
    "role_suitability",
  );
  addScore(
    "task_suitability",
    candidate.suitableTaskTypes?.includes(input.assessment.taskType) === true ? 20 : 0,
    "task_suitability",
  );
  addScore(
    "recommended_reasoning",
    selectedReasoningLevel === input.assessment.recommendedReasoningLevel ? 12 : 0,
    "recommended_reasoning",
  );
  const preferredCapabilityCount = policy.preferredCapabilities.filter((capability) =>
    capabilityIsSupported(candidate.capabilitySnapshot, capability),
  ).length;
  addScore(
    "preferred_capabilities",
    Math.min(20, preferredCapabilityCount * 5),
    preferredCapabilityCount > 0 ? "preferred_capabilities" : undefined,
  );
  const headroom =
    maximumContext === null
      ? 0
      : Math.max(
          0,
          Math.min(15, Math.round(((maximumContext - contextTarget) / maximumContext) * 15)),
        );
  addScore("context_headroom", headroom, "context_headroom");
  addScore(
    "provider_health",
    candidate.providerHealth?.status === "available" ? 10 : 2,
    "provider_health",
  );
  addScore(
    "rate_limit_headroom",
    candidate.providerHealth?.rateLimitState === "clear"
      ? 5
      : candidate.providerHealth?.rateLimitState === "approaching"
        ? -3
        : 0,
    "rate_limit_headroom",
  );
  const latency = candidate.providerHealth?.latencyMilliseconds;
  addScore(
    "latency",
    policy.preferLowLatency && latency !== null && latency !== undefined
      ? latency <= 500
        ? 10
        : latency <= 1_500
          ? 5
          : 0
      : 0,
    "low_latency",
  );
  addScore(
    "locality",
    (policy.preferLocal || policy.privacyMode === "local_preferred") && candidate.provider.isLocal
      ? 15
      : 0,
    "local_preference",
  );
  // Cost has no trustworthy normalized input yet. Keeping the named zero
  // component makes the limitation inspectable without inventing prices.
  addScore("cost", 0);

  return {
    candidate,
    eligible: true,
    score: Object.values(scoreComponents).reduce((sum, value) => sum + value, 0),
    scoreComponents,
    rejectionReasons: [],
    preferenceReasons: uniqueSorted(preferenceReasons),
    selectedReasoningLevel,
  };
};

const compareEvaluations = (left: RoutingCandidateEvaluation, right: RoutingCandidateEvaluation) =>
  (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY) ||
  left.candidate.provider.id.localeCompare(right.candidate.provider.id) ||
  left.candidate.model.id.localeCompare(right.candidate.model.id);

const fallbackPlanFor = (
  selected: RoutingCandidateEvaluation,
  rankedEligible: ReadonlyArray<RoutingCandidateEvaluation>,
  policy: EffectiveRoutingPolicy,
  maximumFallbackSteps: number,
): ReadonlyArray<RoutingFallbackStep> => {
  if (
    maximumFallbackSteps <= 0 ||
    policy.fallbackMode === "none" ||
    !policy.roleAllowsFallback ||
    ((policy.manualModelPin || policy.manualProviderPin) && !policy.manualFallbackAllowed)
  ) {
    return [];
  }
  const attempts = Math.min(3, Math.max(1, policy.maximumRetries || 1));
  const step = (evaluation: RoutingCandidateEvaluation, reason: string): RoutingFallbackStep => ({
    providerProfileId: evaluation.candidate.provider.id,
    modelProfileId: evaluation.candidate.model.id,
    reasoningLevel: evaluation.selectedReasoningLevel,
    maximumAttempts: attempts,
    reason,
  });
  if (policy.fallbackMode === "same_model_retry") {
    return [
      step(selected, "Retry the selected provider and model after a transient failure."),
    ].slice(0, maximumFallbackSteps);
  }

  const alternates = rankedEligible.filter(
    (evaluation) => evaluation.candidate.model.id !== selected.candidate.model.id,
  );
  if (policy.fallbackMode === "same_provider") {
    return alternates
      .filter((evaluation) => evaluation.candidate.provider.id === selected.candidate.provider.id)
      .slice(0, maximumFallbackSteps)
      .map((evaluation) => step(evaluation, "Use the next eligible model from the same provider."));
  }
  if (policy.fallbackMode === "configured_chain") {
    const byModel = new Map(
      alternates.map((evaluation) => [evaluation.candidate.model.id, evaluation]),
    );
    return policy.fallbackChain
      .flatMap((modelId) => {
        const evaluation = byModel.get(modelId);
        return evaluation === undefined ? [] : [evaluation];
      })
      .slice(0, maximumFallbackSteps)
      .map((evaluation) =>
        step(evaluation, "Use the next eligible model in the configured chain."),
      );
  }
  return alternates
    .slice(0, maximumFallbackSteps)
    .map((evaluation) => step(evaluation, "Use the next highest-ranked compatible candidate."));
};

const boundedExplanation = (value: string) => value.slice(0, 8_000);

const fallbackEligibleEvaluations = (
  input: RoutingEngineInput,
  policy: EffectiveRoutingPolicy,
  selected: RoutingCandidateEvaluation,
  now: number,
): ReadonlyArray<RoutingCandidateEvaluation> => {
  if (policy.fallbackMode === "none" || policy.fallbackMode === "same_model_retry") {
    return [selected];
  }
  const fallbackPolicy: EffectiveRoutingPolicy = {
    ...policy,
    // Pins select the first run. A configured fallback mode is the explicit
    // permission to consider alternates after an eligible execution failure.
    pinnedModelProfileId: null,
    pinnedProviderProfileId:
      policy.fallbackMode === "same_provider" ? selected.candidate.provider.id : null,
  };
  return input.candidates
    .map((candidate) => evaluateCandidate(candidate, input, fallbackPolicy, now))
    .filter((evaluation) => evaluation.eligible)
    .toSorted(compareEvaluations);
};

/** Deterministic, side-effect-free routing. Equal inputs always produce equal outputs. */
export const routeTask = (input: RoutingEngineInput): RoutingEngineResult => {
  const effectivePolicy = resolveEffectiveRoutingPolicy(input);
  const now = Date.parse(input.now);
  const evaluations = input.candidates
    .map((candidate) => evaluateCandidate(candidate, input, effectivePolicy, now))
    .toSorted((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      return compareEvaluations(left, right);
    });
  if (effectivePolicy.conflicts.length > 0) {
    return {
      status: "conflict",
      selected: null,
      evaluations,
      effectivePolicy,
      fallbackPlan: [],
      explanation: boundedExplanation(
        `Routing policy conflict across policies [${effectivePolicy.policyIds.join(", ")}] and rules [${effectivePolicy.matchedRuleIds.join(", ")}]: ${effectivePolicy.conflicts.join(" ")}`,
      ),
    };
  }

  const selected = evaluations.find((evaluation) => evaluation.eligible) ?? null;
  if (selected === null) {
    const rejectionSummary = evaluations
      .slice(0, 8)
      .map(
        (evaluation) =>
          `${evaluation.candidate.provider.displayName}/${evaluation.candidate.model.displayName}: ${evaluation.rejectionReasons.join(", ")}`,
      )
      .join("; ");
    return {
      status: "no_eligible_candidate",
      selected: null,
      evaluations,
      effectivePolicy,
      fallbackPlan: [],
      explanation: boundedExplanation(
        `No eligible model. Required capabilities: ${effectivePolicy.requiredCapabilities.join(", ") || "none"}; privacy: ${input.assessment.privacyClassification}/${effectivePolicy.privacyMode}; context: ${input.assessment.estimatedContextTokens === null ? "estimate required" : `at least ${input.assessment.estimatedContextTokens} tokens`}; provider health must be current. Candidates: ${rejectionSummary || "none registered"}. Possible actions: estimate or reduce optional context, configure a compatible model, refresh provider health, or change the explicit pin/privacy policy.`,
      ),
    };
  }

  const maximumFallbackSteps = Math.max(0, Math.min(16, input.maximumFallbackSteps ?? 2));
  const fallbackCandidates = fallbackEligibleEvaluations(input, effectivePolicy, selected, now);
  const fallbackPlan = fallbackPlanFor(
    selected,
    fallbackCandidates,
    effectivePolicy,
    maximumFallbackSteps,
  );
  return {
    status: "selected",
    selected,
    evaluations,
    effectivePolicy,
    fallbackPlan,
    explanation: boundedExplanation(
      `Selected ${selected.candidate.provider.displayName}/${selected.candidate.model.displayName}/${selected.selectedReasoningLevel ?? "provider_default"} with policy score ${selected.score}. Required capabilities: ${effectivePolicy.requiredCapabilities.join(", ") || "none"}; context: ${input.assessment.estimatedContextTokens} tokens; privacy: ${input.assessment.privacyClassification}/${effectivePolicy.privacyMode}. Preferences: ${selected.preferenceReasons.join(", ") || "none"}. Fallback: ${fallbackPlan.length === 0 ? "none" : `${fallbackPlan.length} bounded step(s)`}.`,
    ),
  };
};

/** Simulation deliberately calls the production pure function. */
export const simulateRouting = (input: RoutingEngineInput): RoutingEngineResult => routeTask(input);
