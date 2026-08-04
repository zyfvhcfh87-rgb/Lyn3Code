export type CapabilityKnowledge = boolean | null;

/** UI projection only. Routing contracts remain the source of truth. */
export interface RoutingProviderView {
  readonly id: string;
  readonly name: string;
  readonly connectionType: string;
  readonly accountIdentity: string | null;
  readonly enabled: boolean;
  readonly isLocal: boolean;
  readonly authenticationState: string;
  readonly availability: string;
  readonly rateLimitState: string;
  readonly lastValidatedAt: string | null;
  readonly isHealthStale: boolean;
}

/** UI projection only. Unknown capability values are represented by `null`. */
export interface RoutingModelView {
  readonly id: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly availability: string;
  readonly releaseChannel: string | null;
  readonly deprecated: boolean;
  readonly reasoningLevels: ReadonlyArray<string>;
  readonly maximumInputTokens: number | null;
  readonly maximumConcurrentSessions: number | null;
  readonly toolCalling: CapabilityKnowledge;
  readonly structuredOutput: CapabilityKnowledge;
  readonly visionInput: CapabilityKnowledge;
  readonly modalities: ReadonlyArray<string>;
  readonly capabilitySource: string;
  readonly lastDiscoveredAt: string | null;
  readonly isDiscoveryStale: boolean;
  readonly hasManualOverrides: boolean;
}

export interface RoutingCandidateView {
  readonly id: string;
  readonly providerName: string;
  readonly modelName: string;
  readonly eligible: boolean;
  readonly score: number | null;
  readonly reasons: ReadonlyArray<string>;
}

export interface RoutingDecisionSummaryView {
  readonly id: string;
  readonly providerName: string;
  readonly modelName: string;
  readonly reasoningLevel: string | null;
  readonly decisionType: string;
}

export interface RoutingDecisionDetailView extends RoutingDecisionSummaryView {
  readonly role: string;
  readonly taskType: string;
  readonly complexity: string;
  readonly requiredCapabilities: ReadonlyArray<string>;
  readonly policySources: ReadonlyArray<string>;
  readonly manualOverrides: ReadonlyArray<string>;
  readonly selectionReasons: ReadonlyArray<string>;
  readonly fallbackPlan: ReadonlyArray<string>;
  readonly candidates: ReadonlyArray<RoutingCandidateView>;
  readonly capabilitySnapshot: ReadonlyArray<string>;
  readonly providerHealthSnapshot: ReadonlyArray<string>;
  readonly reroutingHistory: ReadonlyArray<string>;
}

export interface RoutingSelectOption {
  readonly value: string;
  readonly label: string;
  readonly unavailable?: boolean;
}

export interface RoutingPolicyDraft {
  readonly scope: string;
  readonly defaultProviderId: string | null;
  readonly defaultModelId: string | null;
  readonly defaultReasoningLevel: string | null;
  readonly privacyMode: string;
  readonly fallbackMode: string;
  readonly localPreference: boolean;
  readonly requiredCapabilities: ReadonlyArray<string>;
  readonly preferredProviderIds: ReadonlyArray<string>;
  readonly excludedProviderIds: ReadonlyArray<string>;
  readonly fallbackModelIds: ReadonlyArray<string>;
}

export interface RoutingSimulatorDraft {
  readonly projectId: string;
  readonly missionId: string | null;
  readonly role: string;
  readonly taskType: string;
  readonly taskDescription: string;
  readonly complexity: string;
  readonly privacyMode: string;
  readonly requiredCapabilities: ReadonlyArray<string>;
  readonly expectedContextTokens: number | null;
  readonly providerPin: string | null;
  readonly modelPin: string | null;
}

export const routingSimulatorRequiresWriteAccess = (
  draft: Pick<RoutingSimulatorDraft, "requiredCapabilities">,
) => draft.requiredCapabilities.includes("code_editing");

export interface MissionRoutingPolicyDraft {
  readonly inheritProjectPolicy: boolean;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly reasoningLevel: string | null;
  readonly privacyMode: string;
  readonly disableFallback: boolean;
  readonly maximumConcurrentRemoteAgents: number;
  readonly restrictedProviderIds: ReadonlyArray<string>;
}

export interface RoutingRoleDefaultDraft {
  readonly role: string;
  readonly label: string;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly reasoningLevel: string | null;
  readonly fallbackMode: string;
}

export interface TaskRoutingAssessmentView {
  readonly id: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly taskType: string;
  readonly complexity: string;
  readonly source: string;
  readonly explanation: string;
  readonly requiredCapabilities: ReadonlyArray<string>;
  readonly estimatedContextTokens: number | null;
  readonly privacyClassification: string;
  readonly fallbackPlan: ReadonlyArray<string>;
  readonly providerPin: string | null;
  readonly modelPin: string | null;
  readonly reasoningPin: string | null;
}

export interface RoutingOverrideView {
  readonly id: string;
  readonly scope: string;
  readonly scopeLabel: string;
  readonly providerLabel: string | null;
  readonly modelLabel: string | null;
  readonly reasoningLevel: string | null;
  readonly fallbackMode: string | null;
  readonly expiresAt: string | null;
  readonly reason: string;
  readonly unavailable: boolean;
}

export interface RoutingOverrideDraft {
  readonly scope: string;
  readonly scopeId: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly reasoningLevel: string | null;
  readonly fallbackMode: string | null;
  readonly expiresAt: string | null;
  readonly reason: string;
}

export interface CapabilityCorrectionDraft {
  readonly toolCalling: CapabilityKnowledge;
  readonly structuredOutput: CapabilityKnowledge;
  readonly visionInput: CapabilityKnowledge;
  readonly maximumInputTokens: number | null;
}

export function capabilityKnowledgeLabel(value: CapabilityKnowledge): string {
  if (value === true) return "Supported";
  if (value === false) return "Unsupported";
  return "Unknown";
}

export function routingDecisionTypeLabel(value: string): string {
  switch (value) {
    case "manual":
      return "Manually pinned";
    case "policy_pinned":
      return "Policy pinned";
    case "fallback":
      return "Fallback";
    case "recovery":
      return "Recovery reroute";
    case "retry":
      return "Retry";
    default:
      return "Automatic";
  }
}

export function routingStatusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function routingTokenLimitLabel(value: number | null): string {
  if (value === null) return "Unknown";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}
