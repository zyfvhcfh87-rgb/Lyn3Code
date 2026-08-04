import { describe, expect, it } from "@effect/vitest";
import {
  AgentRoleRoutingProfileId,
  ModelCapabilitySnapshotId,
  ModelProfileId,
  ProjectId,
  ProviderDriverKind,
  ProviderHealthRecordId,
  ProviderInstanceId,
  RoutingPolicyId,
  RoutingRuleId,
  type AgentRoleRoutingProfile,
  type RoutingCapabilities,
  type RoutingPolicy,
  type RoutingRule,
} from "@t3tools/contracts";

import type { DeterministicTaskAssessment } from "./TaskAssessment.ts";
import {
  resolveEffectiveRoutingPolicy,
  routeTask,
  simulateRouting,
  type RoutingEngineCandidate,
  type RoutingEngineInput,
} from "./RoutingEngine.ts";

const NOW = "2026-08-03T10:00:00.000Z";
const HEALTH_EXPIRY = "2026-08-03T10:05:00.000Z";
const driver = ProviderDriverKind.make("test-driver");

const assessment = (
  overrides: Partial<DeterministicTaskAssessment> = {},
): DeterministicTaskAssessment => ({
  agentRole: "implementer",
  taskType: "implementation",
  complexity: "medium",
  requiredModelCapabilities: ["tool_calling"],
  requiredHarnessCapabilities: ["codeEditing", "toolExecution"],
  preferredModelCapabilities: [],
  requiredTools: [],
  requiredModalities: [],
  estimatedContextTokens: 2_000,
  privacyClassification: "normal",
  writeAccessRequired: true,
  visionRequired: false,
  structuredOutputRequired: false,
  recommendedReasoningLevel: "high",
  source: "deterministic",
  explanation: "fixture",
  evidence: [],
  ...overrides,
});

const allSupportedCapabilities = (
  overrides: Partial<RoutingCapabilities> = {},
): RoutingCapabilities => ({
  toolCalling: "supported",
  structuredOutput: "supported",
  visionInput: "supported",
  audioInput: "supported",
  fileInput: "supported",
  streaming: "supported",
  reasoningControl: "supported",
  parallelToolCalls: "supported",
  codeEditing: "supported",
  longContext: "supported",
  systemInstructions: "supported",
  promptCaching: "supported",
  ...overrides,
});

const candidate = (
  providerName: string,
  modelName: string,
  options: {
    readonly local?: boolean;
    readonly approvedRemote?: boolean;
    readonly capabilities?: Partial<RoutingCapabilities>;
    readonly context?: number | null;
    readonly healthExpiresAt?: string;
    readonly rateLimitState?: "clear" | "approaching" | "limited" | "unknown";
    readonly healthStatus?: "available" | "degraded" | "rate_limited" | "offline";
    readonly modelStatus?: "available" | "unavailable" | "deprecated" | "unknown";
    readonly deprecated?: boolean;
    readonly concurrency?: {
      readonly providerActiveSessions: number;
      readonly providerMaximumSessions: number | null;
      readonly modelActiveSessions: number;
      readonly modelMaximumSessions: number | null;
    };
    readonly reasoningLevels?: ReadonlyArray<"low" | "medium" | "high" | "extra_high">;
  } = {},
): RoutingEngineCandidate => {
  const providerId = ProviderInstanceId.make(providerName);
  const modelId = ModelProfileId.make(`${providerName}:${modelName}`);
  return {
    provider: {
      id: providerId,
      providerType: driver,
      displayName: providerName,
      accountReference: null,
      endpointClass: options.local ? "local_runtime" : "official_cloud",
      status: "available",
      isEnabled: true,
      isLocal: options.local ?? false,
      supportsModelDiscovery: true,
      configurationMetadata: {},
      createdAt: NOW,
      updatedAt: NOW,
      lastValidatedAt: NOW,
    },
    model: {
      id: modelId,
      providerProfileId: providerId,
      providerModelId: modelName,
      displayName: modelName,
      family: null,
      version: null,
      releaseChannel: null,
      status: options.modelStatus ?? "available",
      isEnabled: true,
      isDeprecated: options.deprecated ?? false,
      discoveredAutomatically: true,
      maximumConcurrentSessions: options.concurrency?.modelMaximumSessions ?? null,
      createdAt: NOW,
      updatedAt: NOW,
      lastDiscoveredAt: NOW,
    },
    capabilitySnapshot: {
      id: ModelCapabilitySnapshotId.make(`${providerName}:${modelName}:capabilities:1`),
      modelProfileId: modelId,
      snapshotVersion: 1,
      source: "provider_reported",
      capabilities: allSupportedCapabilities(options.capabilities),
      contextLimits: {
        maximumInputTokens: options.context === undefined ? 100_000 : options.context,
        maximumOutputTokens: 8_000,
        recommendedWorkingContext: 50_000,
        supportsAutomaticCompaction: "unknown",
      },
      reasoningOptions: {
        supportedLevels: [...(options.reasoningLevels ?? ["low", "medium", "high", "extra_high"])],
        defaultLevel: "medium",
        supportsDynamicReasoning: "supported",
      },
      toolSupport: {},
      modalitySupport: {},
      outputSupport: {},
      privacyMetadata: {},
      capturedAt: NOW,
      expiresAt: null,
    },
    providerHealth: {
      id: ProviderHealthRecordId.make(`${providerName}:health`),
      providerProfileId: providerId,
      status: options.healthStatus ?? "available",
      latencyMilliseconds: 100,
      rateLimitState: options.rateLimitState ?? "clear",
      errorCategory: null,
      observedAt: NOW,
      expiresAt: options.healthExpiresAt ?? HEALTH_EXPIRY,
    },
    harnessCapabilities: {
      toolExecution: "supported",
      codeEditing: "supported",
      streaming: "supported",
      structuredOutput: "supported",
      attachmentInput: "supported",
    },
    approvedRemote: options.approvedRemote ?? false,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
  };
};

const policy = (id: string, overrides: Partial<RoutingPolicy> = {}): RoutingPolicy => ({
  id: RoutingPolicyId.make(id),
  scopeType: "global",
  scopeId: null,
  name: id,
  description: "fixture",
  priority: 0,
  isEnabled: true,
  defaultProviderProfileId: null,
  defaultModelProfileId: null,
  defaultReasoningLevel: null,
  fallbackMode: "none",
  privacyMode: "remote_allowed",
  budgetMode: "unrestricted",
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const rule = (
  id: string,
  routingPolicyId: RoutingPolicy["id"],
  overrides: {
    readonly requirements?: Partial<RoutingRule["requirements"]>;
    readonly preferences?: Partial<RoutingRule["preferences"]>;
    readonly result?: Partial<RoutingRule["result"]>;
  } = {},
): RoutingRule => ({
  id: RoutingRuleId.make(id),
  routingPolicyId,
  name: id,
  description: "fixture",
  priority: 0,
  isEnabled: true,
  conditions: {
    taskTypes: [],
    agentRoles: [],
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
    requiredProviderProfileIds: [],
    excludedProviderProfileIds: [],
    requiredModelProfileIds: [],
    excludedModelProfileIds: [],
    minimumCapabilities: [],
    reasoningLevel: null,
    maximumContextTarget: null,
    fallbackChain: [],
    maximumRetries: 0,
    ...overrides.requirements,
  },
  preferences: {
    preferredProviderProfileIds: [],
    preferredModelProfileIds: [],
    preferredCapabilities: [],
    preferLocal: false,
    preferLowLatency: false,
    preferLowCost: false,
    ...overrides.preferences,
  },
  result: {
    providerProfileId: null,
    modelProfileId: null,
    reasoningLevel: null,
    fallbackMode: null,
    allowDeprecatedModel: false,
    ...overrides.result,
  },
  createdAt: NOW,
  updatedAt: NOW,
});

const input = (
  candidates: ReadonlyArray<RoutingEngineCandidate>,
  overrides: Partial<RoutingEngineInput> = {},
): RoutingEngineInput => ({
  assessment: assessment(),
  scope: {
    projectId: "project",
    missionId: "mission",
    taskId: "task",
  },
  candidates,
  policies: [policy("global")],
  rules: [],
  now: NOW,
  ...overrides,
});

describe("RoutingEngine", () => {
  it("resolves task, mission, project, role, user, global precedence", () => {
    const candidates = [
      candidate("provider", "global"),
      candidate("provider", "role"),
      candidate("provider", "project"),
      candidate("provider", "mission"),
      candidate("provider", "task"),
    ];
    const modelId = (name: string) => ModelProfileId.make(`provider:${name}`);
    const policies = [
      policy("global", { defaultModelProfileId: modelId("global") }),
      policy("user", {
        scopeType: "user",
        defaultModelProfileId: modelId("global"),
      }),
      policy("role", {
        scopeType: "agent_role",
        scopeId: "implementer",
        defaultModelProfileId: modelId("role"),
      }),
      policy("project", {
        scopeType: "project",
        scopeId: "project",
        defaultModelProfileId: modelId("project"),
      }),
      policy("mission", {
        scopeType: "mission",
        scopeId: "mission",
        defaultModelProfileId: modelId("mission"),
      }),
      policy("task", {
        scopeType: "task",
        scopeId: "task",
        defaultModelProfileId: modelId("task"),
      }),
    ];

    const routed = routeTask(input(candidates, { policies }));
    expect(routed.selected?.candidate.model.id).toBe(modelId("task"));
    expect(resolveEffectiveRoutingPolicy(input(candidates, { policies })).policyIds).toEqual([
      RoutingPolicyId.make("task"),
      RoutingPolicyId.make("mission"),
      RoutingPolicyId.make("project"),
      RoutingPolicyId.make("role"),
      RoutingPolicyId.make("user"),
      RoutingPolicyId.make("global"),
    ]);
  });

  it("uses role reasoning defaults between project and user policy scopes", () => {
    const global = policy("global", { defaultReasoningLevel: "low" });
    const roleProfile: AgentRoleRoutingProfile = {
      id: AgentRoleRoutingProfileId.make("implementer-profile"),
      projectId: ProjectId.make("project"),
      roleKind: "implementer",
      routingPolicyId: global.id,
      preferredCapabilities: [],
      requiredCapabilities: [],
      defaultReasoningLevel: "high",
      allowFallback: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const effective = resolveEffectiveRoutingPolicy(
      input([candidate("provider", "model")], {
        policies: [global],
        roleProfiles: [roleProfile],
      }),
    );

    expect(effective.reasoningLevel).toBe("high");
  });

  it("respects an explicit provider-default reasoning pin", () => {
    const routed = routeTask(
      input([candidate("provider", "model")], {
        currentPin: { reasoningLevel: null },
      }),
    );

    expect(routed.effectivePolicy.manualReasoningPin).toBe(true);
    expect(routed.selected?.selectedReasoningLevel).toBeNull();
  });

  it("fails a manual model pin closed when its required capability is unknown", () => {
    const pinned = candidate("a", "pinned", { capabilities: { visionInput: "unknown" } });
    const compatible = candidate("b", "compatible");
    const routed = routeTask(
      input([pinned, compatible], {
        assessment: assessment({
          requiredModelCapabilities: ["tool_calling", "vision_input"],
          visionRequired: true,
        }),
        currentPin: { modelProfileId: pinned.model.id },
      }),
    );

    expect(routed.status).toBe("no_eligible_candidate");
    expect(
      routed.evaluations.find((evaluation) => evaluation.candidate.model.id === pinned.model.id)
        ?.rejectionReasons,
    ).toContain("required_model_capability_not_supported:vision_input");
  });

  it("enforces local-only routing even against a manual remote pin", () => {
    const remote = candidate("a-remote", "model");
    const local = candidate("b-local", "model", { local: true });
    const localPolicy = policy("local-only", { privacyMode: "local_only" });

    expect(
      routeTask(input([remote, local], { policies: [localPolicy] })).selected?.candidate.provider
        .id,
    ).toBe(local.provider.id);
    const pinned = routeTask(
      input([remote, local], {
        policies: [localPolicy],
        currentPin: { modelProfileId: remote.model.id },
      }),
    );
    expect(pinned.status).toBe("no_eligible_candidate");
    expect(pinned.evaluations[0]?.rejectionReasons).toContain("privacy_requires_local_provider");
  });

  it("filters unknown context, stale health, rate limits, and exhausted concurrency", () => {
    const unknownContext = candidate("a", "unknown-context", { context: null });
    const stale = candidate("b", "stale", {
      healthExpiresAt: "2026-08-03T09:59:59.000Z",
    });
    const limited = candidate("c", "limited", { rateLimitState: "limited" });
    const saturated = candidate("d", "saturated", {
      concurrency: {
        providerActiveSessions: 2,
        providerMaximumSessions: 2,
        modelActiveSessions: 0,
        modelMaximumSessions: null,
      },
    });
    const tooSmall = candidate("e", "too-small", { context: 1_000 });
    const modelSaturated = candidate("g", "model-saturated", {
      concurrency: {
        providerActiveSessions: 1,
        providerMaximumSessions: 4,
        modelActiveSessions: 1,
        modelMaximumSessions: 1,
      },
    });
    const healthy = candidate("f", "healthy", {
      concurrency: {
        providerActiveSessions: 1,
        providerMaximumSessions: 2,
        modelActiveSessions: 0,
        modelMaximumSessions: null,
      },
    });
    const routed = routeTask(
      input([unknownContext, stale, limited, saturated, tooSmall, modelSaturated, healthy]),
    );
    const reasons = new Map(
      routed.evaluations.map((evaluation) => [
        evaluation.candidate.model.providerModelId,
        evaluation.rejectionReasons,
      ]),
    );

    expect(routed.selected?.candidate.model.id).toBe(healthy.model.id);
    expect(reasons.get("unknown-context")).toContain("context_capacity_unknown");
    expect(reasons.get("stale")).toContain("provider_health_stale");
    expect(reasons.get("limited")).toContain("provider_rate_limited");
    expect(reasons.get("saturated")).toContain("provider_concurrency_exhausted");
    expect(reasons.get("model-saturated")).toContain("model_concurrency_exhausted");
    expect(reasons.get("too-small")).toContain("context_capacity_insufficient:1000<2000");
  });

  it("fails closed when a corrected assessment has no context estimate", () => {
    const routed = routeTask(
      input([candidate("provider", "model")], {
        assessment: { ...assessment(), estimatedContextTokens: null },
      }),
    );

    expect(routed.status).toBe("no_eligible_candidate");
    expect(routed.evaluations[0]?.rejectionReasons).toContain("task_context_estimate_unknown");
  });

  it("detects aggregate rule conflicts instead of silently choosing", () => {
    const global = policy("global");
    const providerId = ProviderInstanceId.make("provider");
    const conflict = rule("conflict", global.id, {
      requirements: {
        requiredProviderProfileIds: [providerId],
        excludedProviderProfileIds: [providerId],
      },
    });
    const routed = routeTask(
      input([candidate("provider", "model")], { policies: [global], rules: [conflict] }),
    );

    expect(routed.status).toBe("conflict");
    expect(routed.effectivePolicy.conflicts[0]).toContain("both required and excluded");
  });

  it("avoids deprecated models automatically but permits an explicit compatible pin", () => {
    const deprecated = candidate("a", "old", {
      deprecated: true,
      modelStatus: "deprecated",
    });
    const current = candidate("b", "current");

    expect(routeTask(input([deprecated, current])).selected?.candidate.model.id).toBe(
      current.model.id,
    );
    expect(
      routeTask(
        input([deprecated, current], { currentPin: { modelProfileId: deprecated.model.id } }),
      ).selected?.candidate.model.id,
    ).toBe(deprecated.model.id);
  });

  it("builds bounded compatible fallback plans and keeps manual pins terminal by default", () => {
    const candidates = [candidate("a", "first"), candidate("b", "second"), candidate("c", "third")];
    const fallbackPolicy = policy("fallback", { fallbackMode: "any_compatible" });
    const retryRule = rule("bounded-retries", fallbackPolicy.id, {
      requirements: { maximumRetries: 99 },
    });
    const routed = routeTask(
      input(candidates, {
        policies: [fallbackPolicy],
        rules: [retryRule],
        maximumFallbackSteps: 1,
      }),
    );
    expect(routed.fallbackPlan).toHaveLength(1);
    expect(routed.fallbackPlan[0]?.maximumAttempts).toBe(3);
    expect(routed.fallbackPlan[0]?.reason).toContain("next highest-ranked compatible");

    const pinned = routeTask(
      input(candidates, {
        policies: [fallbackPolicy],
        currentPin: { modelProfileId: candidates[0]!.model.id },
      }),
    );
    expect(pinned.fallbackPlan).toEqual([]);
  });

  it("lets an explicit current-run fallback pin override saved fallback policy", () => {
    const first = candidate("provider", "first");
    const second = candidate("provider", "second");
    const disabled = routeTask(
      input([first, second], {
        policies: [policy("saved-fallback", { fallbackMode: "any_compatible" })],
        currentPin: { modelProfileId: first.model.id, fallbackMode: "none" },
      }),
    );
    const enabled = routeTask(
      input([first, second], {
        policies: [policy("saved-none")],
        currentPin: { modelProfileId: first.model.id, fallbackMode: "same_provider" },
      }),
    );

    expect(disabled.fallbackPlan).toEqual([]);
    expect(enabled.fallbackPlan[0]?.modelProfileId).toBe(second.model.id);
  });

  it("preserves configured fallback-chain order", () => {
    const first = candidate("provider", "first");
    const second = candidate("provider", "second");
    const third = candidate("provider", "third");
    const configured = policy("configured", {
      defaultModelProfileId: first.model.id,
      fallbackMode: "configured_chain",
    });
    const configuredRule = rule("chain", configured.id, {
      requirements: { fallbackChain: [third.model.id, second.model.id] },
    });
    const routed = routeTask(
      input([first, second, third], {
        policies: [configured],
        rules: [configuredRule],
      }),
    );

    expect(routed.fallbackPlan.map((step) => step.modelProfileId)).toEqual([
      third.model.id,
      second.model.id,
    ]);
  });

  it("uses stable identifiers as the final tie-break and simulation calls production routing", () => {
    const deterministicInput = input([
      candidate("b-provider", "model"),
      candidate("a-provider", "model"),
    ]);
    const routed = routeTask(deterministicInput);

    expect(routed.selected?.candidate.provider.id).toBe(ProviderInstanceId.make("a-provider"));
    expect(simulateRouting(deterministicInput)).toEqual(routed);
  });
});
