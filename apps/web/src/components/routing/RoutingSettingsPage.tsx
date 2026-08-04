import { useAtomValue } from "@effect/atom-react";
import {
  IsoDateTime,
  MissionId,
  ModelCapabilitySnapshotId,
  ModelProfileId,
  ProviderInstanceId,
  RoutingOverrideId,
  RoutingPolicyId,
  RoutingRuleId,
  type EnvironmentId,
  type ModelCapabilitySnapshot,
  type ProjectId,
  type RoutingPolicy,
  type RoutingRegistrySnapshot,
  type RoutingRule,
  type RoutingSimulationResult,
  type RoutingSimulationInput,
  type RoutingWorkspaceSnapshot,
} from "@t3tools/contracts";
import {
  includeUnavailableRoutingPin,
  indexRoutingRegistry,
} from "@t3tools/client-runtime/state/routing";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useProjects } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { useMissionBoardState } from "../../state/missions";
import { routingEnvironment } from "../../state/routing";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { SettingsPageContainer } from "../settings/settingsLayout";
import { toastManager } from "../ui/toast";
import { RoutingSettings } from "./RoutingSettings";
import {
  routingSimulatorRequiresWriteAccess,
  type CapabilityCorrectionDraft,
  type CapabilityKnowledge,
  type RoutingDecisionDetailView,
  type RoutingModelView,
  type RoutingOverrideDraft,
  type RoutingOverrideView,
  type RoutingPolicyDraft,
  type RoutingProviderView,
  type RoutingRoleDefaultDraft,
  type RoutingSelectOption,
  type RoutingSimulatorDraft,
} from "./routingView";

const REASONING_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "extra_high", label: "Extra high" },
];

const CAPABILITY_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  { value: "tool_calling", label: "Tool calling" },
  { value: "structured_output", label: "Structured output" },
  { value: "vision_input", label: "Vision input" },
  { value: "audio_input", label: "Audio input" },
  { value: "file_input", label: "File input" },
  { value: "streaming", label: "Streaming" },
  { value: "reasoning_control", label: "Reasoning control" },
  { value: "parallel_tool_calls", label: "Parallel tool calls" },
  { value: "code_editing", label: "Code editing" },
  { value: "long_context", label: "Long context" },
  { value: "system_instructions", label: "System instructions" },
  { value: "prompt_caching", label: "Prompt caching" },
];

const ROLE_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  { value: "coordinator", label: "Coordinator" },
  { value: "implementer", label: "Implementer" },
  { value: "researcher", label: "Researcher" },
  { value: "reviewer", label: "Reviewer" },
  { value: "verifier", label: "Verifier" },
  { value: "memory_extractor", label: "Memory extractor" },
  { value: "repair_agent", label: "Repair agent" },
  { value: "custom", label: "Custom" },
];

const ROLE_DEFAULT_DEFINITIONS = [
  { role: "coordinator", label: "Coordinator" },
  { role: "implementer", label: "Implementer" },
  { role: "researcher", label: "Researcher" },
  { role: "reviewer", label: "Reviewer" },
  { role: "verifier", label: "Verifier" },
  { role: "repair_agent", label: "Repair agent" },
  { role: "memory_extractor", label: "Memory extractor" },
] as const;

const TASK_TYPE_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
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
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const COMPLEXITY_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  "trivial",
  "low",
  "medium",
  "high",
  "very_high",
  "unknown",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const PRIVACY_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  "public",
  "normal",
  "sensitive",
  "restricted",
  "local_only",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const FALLBACK_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  "none",
  "same_model_retry",
  "same_provider",
  "configured_chain",
  "any_compatible",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const OVERRIDE_SCOPE_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  { value: "global", label: "Global" },
  { value: "user", label: "Current user" },
  { value: "project", label: "Project" },
];

const EMPTY_POLICY_DRAFT: RoutingPolicyDraft = {
  scope: "project",
  defaultProviderId: null,
  defaultModelId: null,
  defaultReasoningLevel: null,
  privacyMode: "inherit",
  fallbackMode: "any_compatible",
  localPreference: false,
  requiredCapabilities: [],
  preferredProviderIds: [],
  excludedProviderIds: [],
  fallbackModelIds: [],
};

function capabilityKnowledge(state: string): CapabilityKnowledge {
  if (state === "supported") return true;
  if (state === "unsupported") return false;
  return null;
}

function modelCapabilityLines(
  capability: ModelCapabilitySnapshot | undefined,
): ReadonlyArray<string> {
  if (!capability) return ["Capability metadata unknown"];
  return [
    `Source: ${capability.source.replaceAll("_", " ")}`,
    ...Object.entries(capability.capabilities).map(
      ([name, value]) => `${name.replaceAll(/([A-Z])/g, " $1").toLocaleLowerCase()}: ${value}`,
    ),
  ];
}

function isUnconditionalRoutingRule(rule: RoutingRule): boolean {
  const conditions = rule.conditions;
  return (
    conditions.taskTypes.length === 0 &&
    conditions.agentRoles.length === 0 &&
    conditions.complexities.length === 0 &&
    conditions.repositoryLanguages.length === 0 &&
    conditions.changedFilePatterns.length === 0 &&
    conditions.requiredModalities.length === 0 &&
    conditions.requiredTools.length === 0 &&
    conditions.minimumContextTokens === null &&
    conditions.privacyClassifications.length === 0 &&
    conditions.missionStatuses.length === 0 &&
    conditions.verificationFailureCategories.length === 0 &&
    conditions.providerStatuses.length === 0 &&
    conditions.rateLimitStates.length === 0 &&
    conditions.manualPinState === "any"
  );
}

function policyDraftFromWorkspace(workspace: RoutingWorkspaceSnapshot): RoutingPolicyDraft {
  const policy = workspace.policies
    .filter((candidate) => candidate.scopeType === "project")
    .toSorted(
      (left, right) =>
        right.priority - left.priority || right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  const rule = policy
    ? workspace.rules
        .filter(
          (candidate) =>
            candidate.routingPolicyId === policy.id && isUnconditionalRoutingRule(candidate),
        )
        .toSorted((left, right) => right.priority - left.priority)[0]
    : undefined;
  return {
    ...EMPTY_POLICY_DRAFT,
    defaultProviderId: policy?.defaultProviderProfileId ?? null,
    defaultModelId: policy?.defaultModelProfileId ?? null,
    defaultReasoningLevel: policy?.defaultReasoningLevel ?? null,
    privacyMode: policy?.privacyMode ?? "inherit",
    fallbackMode: policy?.fallbackMode ?? "any_compatible",
    localPreference: rule?.preferences.preferLocal ?? false,
    requiredCapabilities: rule?.requirements.minimumCapabilities ?? [],
    preferredProviderIds: rule?.preferences.preferredProviderProfileIds ?? [],
    excludedProviderIds: rule?.requirements.excludedProviderProfileIds ?? [],
    fallbackModelIds: rule?.requirements.fallbackChain ?? [],
  };
}

function roleDefaultDrafts(
  workspace: RoutingWorkspaceSnapshot,
  overrides: Readonly<Record<string, RoutingRoleDefaultDraft>>,
): ReadonlyArray<RoutingRoleDefaultDraft> {
  return ROLE_DEFAULT_DEFINITIONS.map(({ role, label }) => {
    const override = overrides[role];
    if (override) return override;
    const projectPolicy = workspace.policies.find(
      (candidate) =>
        candidate.scopeType === "project" && candidate.scopeId === workspace.scope.projectId,
    );
    const rule = projectPolicy
      ? workspace.rules
          .filter(
            (candidate) =>
              candidate.routingPolicyId === projectPolicy.id &&
              candidate.conditions.agentRoles.includes(
                role as RoutingRule["conditions"]["agentRoles"][number],
              ),
          )
          .toSorted((left, right) => right.priority - left.priority)[0]
      : undefined;
    return {
      role,
      label,
      providerId: rule?.result.providerProfileId ?? null,
      modelId: rule?.result.modelProfileId ?? null,
      reasoningLevel: rule?.result.reasoningLevel ?? null,
      fallbackMode: rule?.result.fallbackMode ?? "any_compatible",
    };
  });
}

function policyValidationErrors(draft: RoutingPolicyDraft): ReadonlyArray<string> {
  const errors: string[] = [];
  const excluded = new Set(draft.excludedProviderIds);
  const conflict = draft.preferredProviderIds.find((providerId) => excluded.has(providerId));
  if (conflict) errors.push("A provider cannot be both preferred and excluded.");
  if (draft.defaultProviderId && excluded.has(draft.defaultProviderId)) {
    errors.push("The default provider cannot also be excluded.");
  }
  if (draft.fallbackMode === "configured_chain" && draft.fallbackModelIds.length === 0) {
    errors.push("Configured-chain fallback needs at least one fallback model.");
  }
  return errors;
}

function routingProviderViews(
  registry: RoutingRegistrySnapshot,
): ReadonlyArray<RoutingProviderView> {
  const { healthByProviderId } = indexRoutingRegistry(registry);
  const now = Date.now();
  return registry.providers.map((provider) => {
    const health = healthByProviderId.get(provider.id);
    const authState =
      provider.status === "authentication_required" || provider.status === "credentials_expired"
        ? provider.status
        : "unknown";
    return {
      id: provider.id,
      name: provider.displayName,
      connectionType: provider.endpointClass.replaceAll("_", " "),
      accountIdentity: provider.accountReference,
      enabled: provider.isEnabled,
      isLocal: provider.isLocal,
      authenticationState: authState,
      availability: health?.status ?? provider.status,
      rateLimitState: health?.rateLimitState ?? "unknown",
      lastValidatedAt: provider.lastValidatedAt,
      isHealthStale: health
        ? Date.parse(health.expiresAt) <= now
        : provider.lastValidatedAt === null,
    };
  });
}

function routingModelViews(registry: RoutingRegistrySnapshot): ReadonlyArray<RoutingModelView> {
  const index = indexRoutingRegistry(registry);
  const providerById = new Map(
    registry.providers.map((provider) => [provider.id, provider] as const),
  );
  const now = Date.now();
  return registry.models.map((model) => {
    const capability = index.capabilityByModelId.get(model.id);
    return {
      id: model.id,
      providerId: model.providerProfileId,
      providerName:
        providerById.get(model.providerProfileId)?.displayName ?? model.providerProfileId,
      name: model.displayName,
      enabled: model.isEnabled,
      availability: model.status,
      releaseChannel: model.releaseChannel,
      deprecated: model.isDeprecated,
      reasoningLevels: capability?.reasoningOptions.supportedLevels ?? [],
      maximumInputTokens: capability?.contextLimits.maximumInputTokens ?? null,
      maximumConcurrentSessions: model.maximumConcurrentSessions,
      toolCalling: capabilityKnowledge(capability?.capabilities.toolCalling ?? "unknown"),
      structuredOutput: capabilityKnowledge(capability?.capabilities.structuredOutput ?? "unknown"),
      visionInput: capabilityKnowledge(capability?.capabilities.visionInput ?? "unknown"),
      modalities: capability
        ? Object.entries(capability.modalitySupport)
            .filter(([, state]) => state === "supported")
            .map(([name]) => name)
        : [],
      capabilitySource: capability?.source ?? "unknown",
      lastDiscoveredAt: model.lastDiscoveredAt,
      isDiscoveryStale:
        capability?.expiresAt !== null && capability?.expiresAt !== undefined
          ? Date.parse(capability.expiresAt) <= now
          : model.lastDiscoveredAt === null,
      hasManualOverrides: capability?.source === "manual_override",
    };
  });
}

function selectOptionsFromRegistry(registry: RoutingRegistrySnapshot, draft: RoutingPolicyDraft) {
  const providerOptions = registry.providers.map((provider) => ({
    value: provider.id,
    label: provider.displayName,
    unavailable:
      !provider.isEnabled || (provider.status !== "available" && provider.status !== "degraded"),
  }));
  const withDefaultProvider = includeUnavailableRoutingPin(
    providerOptions,
    draft.defaultProviderId,
    (value) => ({ value, label: value, unavailable: true }),
  );
  const modelOptions = registry.models.map((model) => ({
    value: model.id,
    label: `${model.displayName} · ${registry.providers.find((provider) => provider.id === model.providerProfileId)?.displayName ?? model.providerProfileId}`,
    unavailable:
      !model.isEnabled ||
      model.status === "disabled" ||
      model.status === "unavailable" ||
      model.status === "unknown",
  }));
  const withDefaultModel = includeUnavailableRoutingPin(
    modelOptions,
    draft.defaultModelId,
    (value) => ({ value, label: value, unavailable: true }),
  );
  return {
    providerOptions: draft.preferredProviderIds.concat(draft.excludedProviderIds).reduce(
      (options, pin) =>
        includeUnavailableRoutingPin(options, pin, (value) => ({
          value,
          label: value,
          unavailable: true,
        })),
      withDefaultProvider,
    ),
    modelOptions: draft.fallbackModelIds.reduce(
      (options, pin) =>
        includeUnavailableRoutingPin(options, pin, (value) => ({
          value,
          label: value,
          unavailable: true,
        })),
      withDefaultModel,
    ),
  };
}

function overrideViews(
  workspace: RoutingWorkspaceSnapshot,
  registry: RoutingRegistrySnapshot,
): ReadonlyArray<RoutingOverrideView> {
  const providers = new Map(registry.providers.map((provider) => [provider.id, provider] as const));
  const models = new Map(registry.models.map((model) => [model.id, model] as const));
  return workspace.overrides
    .filter((override) => override.revokedAt === null)
    .map((override) => {
      const provider = override.providerProfileId
        ? providers.get(override.providerProfileId)
        : undefined;
      const model = override.modelProfileId ? models.get(override.modelProfileId) : undefined;
      return {
        id: override.id,
        scope: override.scopeType,
        scopeLabel: `${override.scopeType.replaceAll("_", " ")}${override.scopeId ? ` · ${override.scopeId}` : ""}`,
        providerLabel: override.providerProfileId
          ? (provider?.displayName ?? override.providerProfileId)
          : null,
        modelLabel: override.modelProfileId
          ? (model?.displayName ?? override.modelProfileId)
          : null,
        reasoningLevel: override.reasoningLevel,
        fallbackMode: override.fallbackMode,
        expiresAt: override.expiresAt,
        reason: override.reason,
        unavailable:
          (override.providerProfileId !== null && (!provider || provider.status !== "available")) ||
          (override.modelProfileId !== null && (!model || model.status !== "available")),
      };
    });
}

function simulationDecisionView(
  result: RoutingSimulationResult,
  registry: RoutingRegistrySnapshot,
  workspace: RoutingWorkspaceSnapshot,
  pinned: boolean,
): RoutingDecisionDetailView {
  const providers = new Map(registry.providers.map((provider) => [provider.id, provider] as const));
  const models = new Map(registry.models.map((model) => [model.id, model] as const));
  const index = indexRoutingRegistry(registry);
  const providerId = result.selectedProviderProfileId;
  const modelId = result.selectedModelProfileId;
  const capability = modelId ? index.capabilityByModelId.get(modelId) : undefined;
  const health = providerId ? index.healthByProviderId.get(providerId) : undefined;
  return {
    id: "simulation",
    providerName: providerId
      ? (providers.get(providerId)?.displayName ?? providerId)
      : "No provider",
    modelName: modelId ? (models.get(modelId)?.displayName ?? modelId) : "No eligible model",
    reasoningLevel: result.selectedReasoningLevel,
    decisionType: pinned ? "manual" : "automatic",
    role: result.assessment.agentRole,
    taskType: result.assessment.taskType,
    complexity: result.assessment.complexity,
    requiredCapabilities: result.assessment.requiredCapabilities,
    policySources: workspace.policies.map((policy) => policy.name),
    manualOverrides: pinned ? ["Simulator manual pin"] : [],
    selectionReasons: result.explanation ? [result.explanation] : [],
    fallbackPlan: [],
    candidates: result.candidates.map((candidate) => ({
      id: `${candidate.providerProfileId}:${candidate.modelProfileId}`,
      providerName:
        providers.get(candidate.providerProfileId)?.displayName ?? candidate.providerProfileId,
      modelName: models.get(candidate.modelProfileId)?.displayName ?? candidate.modelProfileId,
      eligible: candidate.eligible,
      score: candidate.score,
      reasons: candidate.eligible ? candidate.preferenceReasons : candidate.rejectionReasons,
    })),
    capabilitySnapshot: modelCapabilityLines(capability),
    providerHealthSnapshot: health
      ? [
          `Status: ${health.status}`,
          `Rate limit: ${health.rateLimitState}`,
          `Observed: ${health.observedAt}`,
        ]
      : ["Provider health unknown"],
    reroutingHistory: [],
  };
}

function ProjectRoutingSettings({
  environmentId,
  projectId,
  projectOptions,
  onProjectChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectOptions: ReadonlyArray<RoutingSelectOption>;
  readonly onProjectChange: (projectId: string) => void;
}) {
  const navigate = useNavigate();
  const board = useMissionBoardState({ environmentId, projectId });
  const registryResult = useAtomValue(
    routingEnvironment.registryAtom({ environmentId, input: {} }),
  );
  const workspaceResult = useAtomValue(
    routingEnvironment.workspaceSubscriptionAtom({ environmentId, input: { projectId } }),
  );
  const savePolicyCommand = useAtomCommand(routingEnvironment.savePolicy, { reportFailure: false });
  const saveRuleCommand = useAtomCommand(routingEnvironment.saveRule, { reportFailure: false });
  const saveOverrideCommand = useAtomCommand(routingEnvironment.saveOverride, {
    reportFailure: false,
  });
  const revokeOverrideCommand = useAtomCommand(routingEnvironment.revokeOverride, {
    reportFailure: false,
  });
  const refreshRegistryCommand = useAtomCommand(routingEnvironment.refreshRegistry, {
    reportFailure: false,
  });
  const saveProviderProfileCommand = useAtomCommand(routingEnvironment.saveProviderProfile, {
    reportFailure: false,
  });
  const saveModelProfileCommand = useAtomCommand(routingEnvironment.saveModelProfile, {
    reportFailure: false,
  });
  const saveCapabilitySnapshotCommand = useAtomCommand(routingEnvironment.saveCapabilitySnapshot, {
    reportFailure: false,
  });
  const simulateCommand = useAtomCommand(routingEnvironment.simulate, { reportFailure: false });
  const [optimisticRegistry, setOptimisticRegistry] = useState<RoutingRegistrySnapshot | null>(
    null,
  );
  const [policyDraftOverride, setPolicyDraftOverride] = useState<RoutingPolicyDraft | null>(null);
  const [roleDraftOverrides, setRoleDraftOverrides] = useState<
    Readonly<Record<string, RoutingRoleDefaultDraft>>
  >({});
  const [simulation, setSimulation] = useState<RoutingDecisionDetailView | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [savingModelId, setSavingModelId] = useState<string | null>(null);
  const [savingCapabilityModelId, setSavingCapabilityModelId] = useState<string | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [revokingOverrideId, setRevokingOverrideId] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const registry = optimisticRegistry ?? Option.getOrNull(AsyncResult.value(registryResult));
  const workspace = Option.getOrNull(AsyncResult.value(workspaceResult));

  if (registryResult._tag === "Failure" || workspaceResult._tag === "Failure") {
    return (
      <SettingsPageContainer>
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>Routing data is unavailable</AlertTitle>
          <AlertDescription>
            The server could not provide the routing registry or project workspace. No settings were
            changed.
          </AlertDescription>
        </Alert>
      </SettingsPageContainer>
    );
  }
  if (!registry || !workspace) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground" role="status">
          Loading routing registry and policy…
        </p>
      </SettingsPageContainer>
    );
  }

  const serverPolicyDraft = policyDraftFromWorkspace(workspace);
  const policyDraft = policyDraftOverride ?? serverPolicyDraft;
  const roleDrafts = roleDefaultDrafts(workspace, roleDraftOverrides);
  const validationErrors = policyValidationErrors(policyDraft);
  const registryOptions = selectOptionsFromRegistry(registry, policyDraft);
  const providerOptions = roleDrafts.reduce(
    (options, draft) =>
      includeUnavailableRoutingPin(options, draft.providerId, (value) => ({
        value,
        label: value,
        unavailable: true,
      })),
    registryOptions.providerOptions,
  );
  const modelOptions = roleDrafts.reduce(
    (options, draft) =>
      includeUnavailableRoutingPin(options, draft.modelId, (value) => ({
        value,
        label: value,
        unavailable: true,
      })),
    registryOptions.modelOptions,
  );
  const missionOptions = Option.match(board.snapshot, {
    onNone: () => [] as ReadonlyArray<RoutingSelectOption>,
    onSome: (snapshot) =>
      snapshot.missions.map((summary) => ({
        value: summary.mission.id,
        label: summary.mission.title,
      })),
  });
  const initialSimulatorDraft: RoutingSimulatorDraft = {
    projectId,
    missionId: null,
    role: "implementer",
    taskType: "implementation",
    taskDescription: "",
    complexity: "medium",
    privacyMode: "normal",
    requiredCapabilities: ["tool_calling", "code_editing"],
    expectedContextTokens: null,
    providerPin: null,
    modelPin: null,
  };
  const overrideDraft: RoutingOverrideDraft = {
    scope: "project",
    scopeId: projectId,
    providerId: null,
    modelId: null,
    reasoningLevel: null,
    fallbackMode: null,
    expiresAt: null,
    reason: "",
  };

  const savePolicy = async () => {
    const now = IsoDateTime.make(new Date().toISOString());
    const existingPolicy = workspace.policies.find(
      (candidate) => candidate.scopeType === "project" && candidate.scopeId === projectId,
    );
    const policy: RoutingPolicy = {
      id: existingPolicy?.id ?? RoutingPolicyId.make(`project-${projectId}-${randomUUID()}`),
      scopeType: "project",
      scopeId: projectId,
      name: existingPolicy?.name ?? "Project routing policy",
      description: existingPolicy?.description ?? "Project routing defaults and constraints.",
      priority: existingPolicy?.priority ?? 100,
      isEnabled: true,
      defaultProviderProfileId: policyDraft.defaultProviderId
        ? ProviderInstanceId.make(policyDraft.defaultProviderId)
        : null,
      defaultModelProfileId: policyDraft.defaultModelId
        ? ModelProfileId.make(policyDraft.defaultModelId)
        : null,
      defaultReasoningLevel:
        policyDraft.defaultReasoningLevel as RoutingPolicy["defaultReasoningLevel"],
      fallbackMode: policyDraft.fallbackMode as RoutingPolicy["fallbackMode"],
      privacyMode: policyDraft.privacyMode as RoutingPolicy["privacyMode"],
      budgetMode: existingPolicy?.budgetMode ?? "balanced",
      createdAt: existingPolicy?.createdAt ?? now,
      updatedAt: now,
    };
    const existingRule = workspace.rules.find(
      (candidate) =>
        candidate.routingPolicyId === policy.id && isUnconditionalRoutingRule(candidate),
    );
    const rule: RoutingRule = {
      id: existingRule?.id ?? RoutingRuleId.make(`project-rule-${projectId}-${randomUUID()}`),
      routingPolicyId: policy.id,
      name: existingRule?.name ?? "Project routing preferences",
      description: existingRule?.description ?? "Structured project-level routing preferences.",
      priority: existingRule?.priority ?? 100,
      isEnabled: true,
      conditions: existingRule?.conditions ?? {
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
        ...(existingRule?.requirements ?? {
          requiredProviderProfileIds: [],
          requiredModelProfileIds: [],
          excludedModelProfileIds: [],
          reasoningLevel: null,
          maximumContextTarget: null,
          maximumRetries: 0,
        }),
        excludedProviderProfileIds: policyDraft.excludedProviderIds.map((id) =>
          ProviderInstanceId.make(id),
        ),
        minimumCapabilities:
          policyDraft.requiredCapabilities as RoutingRule["requirements"]["minimumCapabilities"],
        fallbackChain: policyDraft.fallbackModelIds.map((id) => ModelProfileId.make(id)),
      },
      preferences: {
        ...(existingRule?.preferences ?? {
          preferredModelProfileIds: [],
          preferredCapabilities: [],
          preferLowLatency: false,
          preferLowCost: false,
        }),
        preferredProviderProfileIds: policyDraft.preferredProviderIds.map((id) =>
          ProviderInstanceId.make(id),
        ),
        preferLocal: policyDraft.localPreference,
      },
      result: existingRule?.result ?? {
        providerProfileId: null,
        modelProfileId: null,
        reasoningLevel: null,
        fallbackMode: null,
        allowDeprecatedModel: false,
      },
      createdAt: existingRule?.createdAt ?? now,
      updatedAt: now,
    };

    setIsSavingPolicy(true);
    try {
      const policyResult = await savePolicyCommand({ environmentId, input: { policy } });
      if (policyResult._tag === "Failure") {
        toastManager.add({ type: "error", title: "Routing policy was not saved" });
        return;
      }
      const ruleResult = await saveRuleCommand({ environmentId, input: { rule } });
      if (ruleResult._tag === "Failure") {
        toastManager.add({
          type: "warning",
          title: "Routing defaults saved, but rule preferences were rejected",
        });
        return;
      }
      setPolicyDraftOverride(null);
      toastManager.add({ type: "success", title: "Routing policy saved" });
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const saveRoleDefault = async (role: string) => {
    const draft = roleDrafts.find((candidate) => candidate.role === role);
    if (!draft) return;
    const existingProjectPolicy = workspace.policies.find(
      (candidate) => candidate.scopeType === "project" && candidate.scopeId === projectId,
    );
    const now = IsoDateTime.make(new Date().toISOString());
    const projectPolicy: RoutingPolicy = existingProjectPolicy ?? {
      id: RoutingPolicyId.make(`project-${projectId}-${randomUUID()}`),
      scopeType: "project",
      scopeId: projectId,
      name: "Project routing policy",
      description: "Project routing defaults and constraints.",
      priority: 100,
      isEnabled: true,
      defaultProviderProfileId: policyDraft.defaultProviderId
        ? ProviderInstanceId.make(policyDraft.defaultProviderId)
        : null,
      defaultModelProfileId: policyDraft.defaultModelId
        ? ModelProfileId.make(policyDraft.defaultModelId)
        : null,
      defaultReasoningLevel:
        policyDraft.defaultReasoningLevel as RoutingPolicy["defaultReasoningLevel"],
      fallbackMode: policyDraft.fallbackMode as RoutingPolicy["fallbackMode"],
      privacyMode: policyDraft.privacyMode as RoutingPolicy["privacyMode"],
      budgetMode: "balanced",
      createdAt: now,
      updatedAt: now,
    };
    const existingRule = workspace.rules.find(
      (candidate) =>
        candidate.routingPolicyId === projectPolicy.id &&
        candidate.conditions.agentRoles.includes(
          role as RoutingRule["conditions"]["agentRoles"][number],
        ),
    );
    const rule: RoutingRule = {
      id:
        existingRule?.id ?? RoutingRuleId.make(`project-${projectId}-role-${role}-${randomUUID()}`),
      routingPolicyId: projectPolicy.id,
      name: existingRule?.name ?? `Role default: ${role}`,
      description:
        existingRule?.description ??
        `Project routing defaults for ${draft.label.toLocaleLowerCase()}.`,
      priority: existingRule?.priority ?? 250,
      isEnabled: true,
      conditions: {
        ...(existingRule?.conditions ?? {
          taskTypes: [],
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
        }),
        agentRoles: [role as RoutingRule["conditions"]["agentRoles"][number]],
      },
      requirements: existingRule?.requirements ?? {
        requiredProviderProfileIds: [],
        excludedProviderProfileIds: [],
        requiredModelProfileIds: [],
        excludedModelProfileIds: [],
        minimumCapabilities: [],
        reasoningLevel: null,
        maximumContextTarget: null,
        fallbackChain: [],
        maximumRetries: 0,
      },
      preferences: existingRule?.preferences ?? {
        preferredProviderProfileIds: [],
        preferredModelProfileIds: [],
        preferredCapabilities: [],
        preferLocal: false,
        preferLowLatency: false,
        preferLowCost: false,
      },
      result: {
        providerProfileId: draft.providerId ? ProviderInstanceId.make(draft.providerId) : null,
        modelProfileId: draft.modelId ? ModelProfileId.make(draft.modelId) : null,
        reasoningLevel: draft.reasoningLevel as RoutingRule["result"]["reasoningLevel"],
        fallbackMode: draft.fallbackMode as RoutingRule["result"]["fallbackMode"],
        allowDeprecatedModel: existingRule?.result.allowDeprecatedModel ?? false,
      },
      createdAt: existingRule?.createdAt ?? now,
      updatedAt: now,
    };
    setSavingRole(role);
    try {
      if (!existingProjectPolicy) {
        const policyResult = await savePolicyCommand({
          environmentId,
          input: { policy: projectPolicy },
        });
        if (policyResult._tag === "Failure") {
          toastManager.add({ type: "error", title: "Project routing policy was not saved" });
          return;
        }
      }
      const ruleResult = await saveRuleCommand({ environmentId, input: { rule } });
      if (ruleResult._tag === "Failure") {
        toastManager.add({ type: "error", title: `${draft.label} routing was not saved` });
        return;
      }
      setRoleDraftOverrides((current) => {
        const { [role]: _saved, ...remaining } = current;
        return remaining;
      });
      toastManager.add({ type: "success", title: `${draft.label} routing saved` });
    } finally {
      setSavingRole(null);
    }
  };

  const saveOverride = async (draft: RoutingOverrideDraft) => {
    const now = IsoDateTime.make(new Date().toISOString());
    const scopeId = draft.scope === "global" || draft.scope === "user" ? null : projectId;
    setIsSavingOverride(true);
    try {
      const result = await saveOverrideCommand({
        environmentId,
        input: {
          override: {
            id: RoutingOverrideId.make(`override-${randomUUID()}`),
            scopeType: draft.scope as "global" | "user" | "project",
            scopeId,
            providerProfileId: draft.providerId ? ProviderInstanceId.make(draft.providerId) : null,
            modelProfileId: draft.modelId ? ModelProfileId.make(draft.modelId) : null,
            reasoningLevel: draft.reasoningLevel as "low" | "medium" | "high" | "extra_high" | null,
            fallbackMode: draft.fallbackMode as RoutingPolicy["fallbackMode"] | null,
            expiresAt: draft.expiresAt
              ? IsoDateTime.make(new Date(draft.expiresAt).toISOString())
              : null,
            reason: draft.reason.trim(),
            createdBy: "user",
            createdAt: now,
            revokedAt: null,
          },
        },
      });
      toastManager.add({
        type: result._tag === "Success" ? "success" : "error",
        title:
          result._tag === "Success" ? "Routing override added" : "Routing override was not saved",
      });
    } finally {
      setIsSavingOverride(false);
    }
  };

  const revokeOverride = async (overrideId: string) => {
    setRevokingOverrideId(overrideId);
    try {
      const result = await revokeOverrideCommand({
        environmentId,
        input: {
          overrideId: RoutingOverrideId.make(overrideId),
          revokedAt: IsoDateTime.make(new Date().toISOString()),
        },
      });
      toastManager.add({
        type: result._tag === "Success" ? "success" : "error",
        title:
          result._tag === "Success" ? "Routing override revoked" : "Override could not be revoked",
      });
    } finally {
      setRevokingOverrideId(null);
    }
  };

  const setProviderEnabled = async (providerId: string, enabled: boolean) => {
    const provider = registry.providers.find((candidate) => candidate.id === providerId);
    if (!provider) return;
    const now = IsoDateTime.make(new Date().toISOString());
    setSavingProviderId(providerId);
    try {
      const result = await saveProviderProfileCommand({
        environmentId,
        input: {
          provider: {
            ...provider,
            isEnabled: enabled,
            status: enabled
              ? provider.status === "disabled"
                ? "degraded"
                : provider.status
              : "disabled",
            updatedAt: now,
          },
        },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Provider routing state was not saved" });
        return;
      }
      setOptimisticRegistry((current) => {
        const source = current ?? registry;
        return {
          ...source,
          providers: source.providers.map((candidate) =>
            candidate.id === result.value.provider.id ? result.value.provider : candidate,
          ),
        };
      });
      toastManager.add({
        type: "success",
        title: enabled ? "Provider enabled for routing" : "Provider disabled for routing",
      });
    } finally {
      setSavingProviderId(null);
    }
  };

  const saveModelChanges = async (
    modelId: string,
    change: {
      readonly isEnabled?: boolean;
      readonly isDeprecated?: boolean;
      readonly maximumConcurrentSessions?: number | null;
    },
  ) => {
    const model = registry.models.find((candidate) => candidate.id === modelId);
    if (!model) return;
    const isEnabled = change.isEnabled ?? model.isEnabled;
    const isDeprecated = change.isDeprecated ?? model.isDeprecated;
    const maximumConcurrentSessions =
      change.maximumConcurrentSessions === undefined
        ? model.maximumConcurrentSessions
        : change.maximumConcurrentSessions;
    const status = !isEnabled
      ? "disabled"
      : isDeprecated
        ? "deprecated"
        : model.status === "disabled" || model.status === "deprecated"
          ? "unknown"
          : model.status;
    setSavingModelId(modelId);
    try {
      const result = await saveModelProfileCommand({
        environmentId,
        input: {
          model: {
            ...model,
            isEnabled,
            isDeprecated,
            maximumConcurrentSessions,
            status,
            updatedAt: IsoDateTime.make(new Date().toISOString()),
          },
        },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Model routing state was not saved" });
        return;
      }
      setOptimisticRegistry((current) => {
        const source = current ?? registry;
        return {
          ...source,
          models: source.models.map((candidate) =>
            candidate.id === result.value.model.id ? result.value.model : candidate,
          ),
        };
      });
      toastManager.add({ type: "success", title: "Model routing state saved" });
    } finally {
      setSavingModelId(null);
    }
  };

  const saveCapabilityCorrection = async (modelId: string, draft: CapabilityCorrectionDraft) => {
    const model = registry.models.find((candidate) => candidate.id === modelId);
    if (!model) return;
    const current = indexRoutingRegistry(registry).capabilityByModelId.get(model.id);
    const unknownCapabilities: ModelCapabilitySnapshot["capabilities"] = {
      toolCalling: "unknown",
      structuredOutput: "unknown",
      visionInput: "unknown",
      audioInput: "unknown",
      fileInput: "unknown",
      streaming: "unknown",
      reasoningControl: "unknown",
      parallelToolCalls: "unknown",
      codeEditing: "unknown",
      longContext: "unknown",
      systemInstructions: "unknown",
      promptCaching: "unknown",
    };
    const capabilityState = (value: boolean | null) =>
      value === true
        ? ("supported" as const)
        : value === false
          ? ("unsupported" as const)
          : ("unknown" as const);
    const capturedAt = IsoDateTime.make(new Date().toISOString());
    const capabilitySnapshot: ModelCapabilitySnapshot = {
      id: ModelCapabilitySnapshotId.make(`manual-${model.id}-${randomUUID()}`),
      modelProfileId: model.id,
      snapshotVersion: (current?.snapshotVersion ?? 0) + 1,
      source: "manual_override",
      capabilities: {
        ...(current?.capabilities ?? unknownCapabilities),
        toolCalling: capabilityState(draft.toolCalling),
        structuredOutput: capabilityState(draft.structuredOutput),
        visionInput: capabilityState(draft.visionInput),
      },
      contextLimits: {
        ...(current?.contextLimits ?? {
          maximumInputTokens: null,
          maximumOutputTokens: null,
          recommendedWorkingContext: null,
          supportsAutomaticCompaction: "unknown",
        }),
        maximumInputTokens:
          draft.maximumInputTokens !== null && draft.maximumInputTokens > 0
            ? Math.floor(draft.maximumInputTokens)
            : null,
      },
      reasoningOptions: current?.reasoningOptions ?? {
        supportedLevels: [],
        defaultLevel: null,
        supportsDynamicReasoning: "unknown",
      },
      toolSupport: current?.toolSupport ?? {},
      modalitySupport: current?.modalitySupport ?? {},
      outputSupport: current?.outputSupport ?? {},
      privacyMetadata: current?.privacyMetadata ?? {},
      capturedAt,
      expiresAt: null,
    };
    setSavingCapabilityModelId(modelId);
    try {
      const result = await saveCapabilitySnapshotCommand({
        environmentId,
        input: { capabilitySnapshot },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Capability correction was not saved" });
        return;
      }
      setOptimisticRegistry((optimistic) => {
        const source = optimistic ?? registry;
        return {
          ...source,
          capabilitySnapshots: [...source.capabilitySnapshots, result.value.capabilitySnapshot],
        };
      });
      toastManager.add({ type: "success", title: "Manual capability correction saved" });
    } finally {
      setSavingCapabilityModelId(null);
    }
  };

  const simulate = async (draft: RoutingSimulatorDraft) => {
    setIsSimulating(true);
    setSimulation(null);
    setSimulationError(null);
    try {
      const result = await simulateCommand({
        environmentId,
        input: {
          projectId,
          missionId: draft.missionId ? MissionId.make(draft.missionId) : null,
          taskId: null,
          missionAgentId: null,
          assessment: {
            roleKind: draft.role as RoutingSimulationInput["assessment"]["roleKind"],
            taskType: draft.taskType as RoutingSimulationResult["assessment"]["taskType"],
            complexity: draft.complexity as RoutingSimulationResult["assessment"]["complexity"],
            title: draft.taskDescription.slice(0, 2_000),
            description: draft.taskDescription,
            requiredCapabilities:
              draft.requiredCapabilities as RoutingSimulationInput["assessment"]["requiredCapabilities"],
            estimatedSourceTokens: draft.expectedContextTokens,
            privacyClassification:
              draft.privacyMode as RoutingSimulationResult["assessment"]["privacyClassification"],
            writeAccessRequired: routingSimulatorRequiresWriteAccess(draft),
          },
          pins: {
            providerProfileId: draft.providerPin
              ? ProviderInstanceId.make(draft.providerPin)
              : null,
            modelProfileId: draft.modelPin ? ModelProfileId.make(draft.modelPin) : null,
          },
        },
      });
      if (result._tag === "Failure") {
        setSimulationError(
          "The routing engine rejected this combination. Review the required capabilities, context, privacy mode, and pins.",
        );
        return;
      }
      setSimulation(
        simulationDecisionView(
          result.value,
          registry,
          workspace,
          draft.providerPin !== null || draft.modelPin !== null,
        ),
      );
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <RoutingSettings
      selectedProjectId={projectId}
      onSelectedProjectIdChange={onProjectChange}
      providers={routingProviderViews(registry)}
      models={routingModelViews(registry)}
      isRefreshing={isRefreshing}
      onRefresh={() => {
        setIsRefreshing(true);
        void refreshRegistryCommand({
          environmentId,
          input: { providerProfileId: null },
        }).then((result) => {
          setIsRefreshing(false);
          if (result._tag === "Success") setOptimisticRegistry(result.value);
          else toastManager.add({ type: "error", title: "Routing registry refresh failed" });
        });
      }}
      onManageCredentials={() => void navigate({ to: "/settings/providers" })}
      isProviderSaving={(providerId) => savingProviderId === providerId}
      isModelSaving={(modelId) => savingModelId === modelId}
      isCapabilitySaving={(modelId) => savingCapabilityModelId === modelId}
      onProviderEnabledChange={(providerId, enabled) =>
        void setProviderEnabled(providerId, enabled)
      }
      onModelEnabledChange={(modelId, enabled) =>
        void saveModelChanges(modelId, { isEnabled: enabled })
      }
      onModelDeprecatedChange={(modelId, deprecated) =>
        void saveModelChanges(modelId, { isDeprecated: deprecated })
      }
      onModelConcurrencyChange={(modelId, maximumConcurrentSessions) =>
        void saveModelChanges(modelId, { maximumConcurrentSessions })
      }
      onSaveCapabilityCorrection={(modelId, draft) => void saveCapabilityCorrection(modelId, draft)}
      policyDraft={policyDraft}
      providerOptions={providerOptions}
      modelOptions={modelOptions}
      reasoningOptions={REASONING_OPTIONS}
      capabilityOptions={CAPABILITY_OPTIONS}
      policyValidationErrors={validationErrors}
      isSavingPolicy={isSavingPolicy}
      onPolicyChange={setPolicyDraftOverride}
      onSavePolicy={() => void savePolicy()}
      roleDrafts={roleDrafts}
      isSavingRole={(role) => savingRole === role}
      onRoleChange={(draft) =>
        setRoleDraftOverrides((current) => ({ ...current, [draft.role]: draft }))
      }
      onSaveRole={(role) => void saveRoleDefault(role)}
      overrideDraft={overrideDraft}
      overrides={overrideViews(workspace, registry)}
      overrideScopeOptions={OVERRIDE_SCOPE_OPTIONS}
      fallbackOptions={FALLBACK_OPTIONS}
      overrideValidationErrors={[]}
      isSavingOverride={isSavingOverride}
      isRevokingOverride={(overrideId) => overrideId === revokingOverrideId}
      onSaveOverride={(draft) => void saveOverride(draft)}
      onRevokeOverride={(overrideId) => void revokeOverride(overrideId)}
      simulatorDraft={initialSimulatorDraft}
      projectOptions={projectOptions}
      missionOptions={missionOptions}
      roleOptions={ROLE_OPTIONS}
      taskTypeOptions={TASK_TYPE_OPTIONS}
      complexityOptions={COMPLEXITY_OPTIONS}
      privacyOptions={PRIVACY_OPTIONS}
      simulatorResult={simulation}
      simulatorError={simulationError}
      isSimulating={isSimulating}
      onSimulate={(draft) => void simulate(draft)}
    />
  );
}

export function RoutingSettingsPage() {
  const primaryEnvironment = usePrimaryEnvironment();
  const allProjects = useProjects();
  const projects = useMemo(
    () =>
      primaryEnvironment
        ? allProjects.filter(
            (project) => project.environmentId === primaryEnvironment.environmentId,
          )
        : [],
    [allProjects, primaryEnvironment],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;

  if (!primaryEnvironment || !selectedProject) {
    return (
      <SettingsPageContainer>
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>No project available for routing</AlertTitle>
          <AlertDescription>
            Connect an environment and add a project before configuring project routing.
          </AlertDescription>
        </Alert>
      </SettingsPageContainer>
    );
  }

  const projectOptions = projects.map((project) => ({ value: project.id, label: project.title }));
  return (
    <ProjectRoutingSettings
      key={`${primaryEnvironment.environmentId}:${selectedProject.id}`}
      environmentId={primaryEnvironment.environmentId}
      projectId={selectedProject.id}
      projectOptions={projectOptions}
      onProjectChange={setSelectedProjectId}
    />
  );
}
