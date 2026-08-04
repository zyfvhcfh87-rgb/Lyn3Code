import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectId, RoutingDecisionId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ModelCapabilitySnapshot,
  ModelCapabilitySnapshotId,
  ModelProfileId,
  ROUTING_POLICY_SCOPE_PRECEDENCE,
  RoutingDecision,
  RoutingOverride,
  RoutingOverrideId,
  RoutingPolicy,
  RoutingPolicyId,
  RoutingRule,
  RoutingRuleId,
  TaskRoutingAssessmentId,
} from "./routing.ts";

const now = "2026-08-03T12:00:00.000Z";
const providerId = ProviderInstanceId.make("codex-work");
const modelId = ModelProfileId.make("codex-work:gpt-5.6");
const snapshotId = ModelCapabilitySnapshotId.make("snapshot-1");

const decodePolicy = Schema.decodeUnknownSync(RoutingPolicy);
const decodeRule = Schema.decodeUnknownSync(RoutingRule);
const decodeCapabilitySnapshot = Schema.decodeUnknownSync(ModelCapabilitySnapshot);
const decodeOverride = Schema.decodeUnknownSync(RoutingOverride);
const decodeDecision = Schema.decodeUnknownSync(RoutingDecision);

it("validates singleton scopes and explicit policy precedence", () => {
  assert.strictEqual(ROUTING_POLICY_SCOPE_PRECEDENCE.global, 0);
  assert.strictEqual(ROUTING_POLICY_SCOPE_PRECEDENCE.agent_role, 2);
  assert.strictEqual(ROUTING_POLICY_SCOPE_PRECEDENCE.project, 3);
  assert.strictEqual(ROUTING_POLICY_SCOPE_PRECEDENCE.mission, 4);
  assert.strictEqual(ROUTING_POLICY_SCOPE_PRECEDENCE.task, 5);

  assert.doesNotThrow(() =>
    decodePolicy({
      id: RoutingPolicyId.make("global-policy"),
      scopeType: "user",
      scopeId: null,
      name: "Current user defaults",
      description: "Environment-wide until durable users exist.",
      priority: 0,
      isEnabled: true,
      defaultProviderProfileId: providerId,
      defaultModelProfileId: modelId,
      defaultReasoningLevel: "medium",
      fallbackMode: "same_provider",
      privacyMode: "inherit",
      budgetMode: "balanced",
      createdAt: now,
      updatedAt: now,
    }),
  );
  assert.throws(() =>
    decodePolicy({
      id: RoutingPolicyId.make("bad-global"),
      scopeType: "global",
      scopeId: "not-the-singleton",
      name: "Invalid",
      description: "",
      priority: 0,
      isEnabled: true,
      defaultProviderProfileId: null,
      defaultModelProfileId: null,
      defaultReasoningLevel: null,
      fallbackMode: "none",
      privacyMode: "inherit",
      budgetMode: "inherit",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

it("distinguishes unknown capability facts and validates reasoning snapshots", () => {
  const snapshot = decodeCapabilitySnapshot({
    id: snapshotId,
    modelProfileId: modelId,
    snapshotVersion: 1,
    source: "provider_reported",
    capabilities: {
      toolCalling: "supported",
      structuredOutput: "supported",
      visionInput: "unknown",
      audioInput: "unsupported",
      fileInput: "supported",
      streaming: "supported",
      reasoningControl: "supported",
      parallelToolCalls: "unknown",
      codeEditing: "supported",
      longContext: "supported",
      systemInstructions: "supported",
      promptCaching: "unknown",
    },
    contextLimits: {
      maximumInputTokens: 128_000,
      maximumOutputTokens: null,
      recommendedWorkingContext: 96_000,
      supportsAutomaticCompaction: "unknown",
    },
    reasoningOptions: {
      supportedLevels: ["low", "medium", "high"],
      defaultLevel: "medium",
      supportsDynamicReasoning: "supported",
    },
    toolSupport: { repository_search: "supported" },
    modalitySupport: { image: "unknown" },
    outputSupport: { json: "supported" },
    privacyMetadata: { trainingUse: "unknown" },
    capturedAt: now,
    expiresAt: null,
  });
  assert.strictEqual(snapshot.capabilities.visionInput, "unknown");

  assert.throws(() =>
    decodeCapabilitySnapshot({
      ...snapshot,
      reasoningOptions: {
        supportedLevels: ["low"],
        defaultLevel: "high",
        supportsDynamicReasoning: "supported",
      },
    }),
  );
});

it("rejects contradictory rules and empty overrides", () => {
  const baseRule = {
    id: RoutingRuleId.make("rule-1"),
    routingPolicyId: RoutingPolicyId.make("policy-1"),
    name: "Implementation",
    description: "",
    priority: 0,
    isEnabled: true,
    conditions: {
      taskTypes: ["implementation"],
      agentRoles: ["implementer"],
      complexities: [],
      repositoryLanguages: [],
      changedFilePatterns: [],
      requiredModalities: [],
      requiredTools: [],
      minimumContextTokens: null,
      privacyClassifications: [],
      missionStatuses: [],
      verificationFailureCategories: [],
      providerStatuses: [],
      rateLimitStates: [],
      manualPinState: "any",
    },
    requirements: {
      requiredProviderProfileIds: [providerId],
      excludedProviderProfileIds: [],
      requiredModelProfileIds: [],
      excludedModelProfileIds: [],
      minimumCapabilities: ["code_editing"],
      reasoningLevel: "medium",
      maximumContextTarget: null,
      fallbackChain: [],
      maximumRetries: 1,
    },
    preferences: {
      preferredProviderProfileIds: [],
      preferredModelProfileIds: [],
      preferredCapabilities: [],
      preferLocal: false,
      preferLowLatency: false,
      preferLowCost: false,
    },
    result: {
      providerProfileId: providerId,
      modelProfileId: null,
      reasoningLevel: "medium",
      fallbackMode: "same_provider",
      allowDeprecatedModel: false,
    },
    createdAt: now,
    updatedAt: now,
  } as const;
  assert.doesNotThrow(() => decodeRule(baseRule));
  assert.throws(() =>
    decodeRule({
      ...baseRule,
      requirements: {
        ...baseRule.requirements,
        excludedProviderProfileIds: [providerId],
      },
    }),
  );

  assert.throws(() =>
    decodeOverride({
      id: RoutingOverrideId.make("override-empty"),
      scopeType: "project",
      scopeId: ProjectId.make("project-1"),
      providerProfileId: null,
      modelProfileId: null,
      reasoningLevel: null,
      fallbackMode: null,
      expiresAt: null,
      reason: "Nothing selected",
      createdBy: "maintainer",
      createdAt: now,
      revokedAt: null,
    }),
  );
});

it("requires coherent immutable decision lifecycle fields", () => {
  const decision = {
    id: RoutingDecisionId.make("decision-1"),
    projectId: ProjectId.make("project-1"),
    missionId: null,
    taskId: null,
    missionAgentId: null,
    agentRunId: null,
    assessmentId: TaskRoutingAssessmentId.make("assessment-1"),
    decisionType: "automatic",
    selectedProviderProfileId: providerId,
    selectedModelProfileId: modelId,
    selectedCapabilitySnapshotId: snapshotId,
    selectedReasoningLevel: "high",
    manualProviderPin: false,
    manualModelPin: false,
    manualReasoningPin: false,
    fallbackPlan: [],
    candidateSummary: {
      consideredCount: 1,
      eligibleCount: 1,
      persistedCandidateIds: [],
      truncated: false,
    },
    selectionExplanation: "Only eligible model.",
    constraintsSnapshot: {
      requiredCapabilities: ["code_editing"],
      preferredCapabilities: [],
      requiredTools: [],
      requiredModalities: [],
      minimumContextTokens: null,
      maximumContextTarget: null,
      privacyClassification: "normal",
      localOnly: false,
      maximumRetries: 0,
      contextStrategy: "full",
      estimatedContextTokens: null,
    },
    policySnapshot: {
      policyIds: [],
      overrideIds: [],
      effectiveFallbackMode: "none",
      effectivePrivacyMode: "inherit",
      effectiveBudgetMode: "inherit",
    },
    status: "planned",
    createdAt: now,
    appliedAt: null,
    terminalAt: null,
    failureSummary: null,
    supersededById: null,
  } as const;
  assert.doesNotThrow(() => decodeDecision(decision));
  assert.throws(() =>
    decodeDecision({
      ...decision,
      status: "applied",
    }),
  );
});
