import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RoutingRegistryPanel } from "./RoutingRegistryPanel";
import { RoutingRoleDefaultsPanel } from "./RoutingRoleDefaultsPanel";
import {
  capabilityKnowledgeLabel,
  routingDecisionTypeLabel,
  routingSimulatorRequiresWriteAccess,
} from "./routingView";

describe("routing registry presentation", () => {
  it("keeps unknown capabilities distinct from unsupported capabilities", () => {
    expect(capabilityKnowledgeLabel(null)).toBe("Unknown");
    expect(capabilityKnowledgeLabel(false)).toBe("Unsupported");
  });

  it("labels automatic and pinned routing decisions", () => {
    expect(routingDecisionTypeLabel("automatic")).toBe("Automatic");
    expect(routingDecisionTypeLabel("manual")).toBe("Manually pinned");
    expect(routingDecisionTypeLabel("policy_pinned")).toBe("Policy pinned");
    expect(routingDecisionTypeLabel("recovery")).toBe("Recovery reroute");
  });

  it("derives simulator write access from the visible code-editing requirement", () => {
    expect(
      routingSimulatorRequiresWriteAccess({
        requiredCapabilities: ["tool_calling", "code_editing"],
      }),
    ).toBe(true);
    expect(
      routingSimulatorRequiresWriteAccess({
        requiredCapabilities: ["structured_output"],
      }),
    ).toBe(false);
  });

  it("shows stale discovery and unknown capability provenance", () => {
    const markup = renderToStaticMarkup(
      <RoutingRegistryPanel
        providers={[
          {
            id: "local-codex",
            name: "Local Codex",
            connectionType: "local runtime",
            accountIdentity: null,
            enabled: true,
            isLocal: true,
            authenticationState: "authenticated",
            availability: "available",
            rateLimitState: "ok",
            lastValidatedAt: null,
            isHealthStale: true,
          },
        ]}
        models={[
          {
            id: "local-codex:gpt-test",
            providerId: "local-codex",
            providerName: "Local Codex",
            name: "GPT Test",
            enabled: true,
            availability: "unknown",
            releaseChannel: null,
            deprecated: false,
            reasoningLevels: [],
            maximumInputTokens: null,
            maximumConcurrentSessions: null,
            toolCalling: null,
            structuredOutput: false,
            visionInput: true,
            modalities: [],
            capabilitySource: "unknown",
            lastDiscoveredAt: null,
            isDiscoveryStale: true,
            hasManualOverrides: false,
          },
        ]}
        isRefreshing={false}
        onRefresh={() => undefined}
        onManageCredentials={() => undefined}
        isProviderSaving={() => false}
        isModelSaving={() => false}
        isCapabilitySaving={() => false}
        onProviderEnabledChange={() => undefined}
        onModelEnabledChange={() => undefined}
        onModelDeprecatedChange={() => undefined}
        onModelConcurrencyChange={() => undefined}
        onSaveCapabilityCorrection={() => undefined}
      />,
    );

    expect(markup).toContain("Stale health");
    expect(markup).toContain("Stale discovery");
    expect(markup).toContain("Tools: Unknown");
    expect(markup).toContain("Structured output: Unsupported");
    expect(markup).toContain("Source: unknown");
  });

  it("keeps unavailable role defaults visible", () => {
    const markup = renderToStaticMarkup(
      <RoutingRoleDefaultsPanel
        drafts={[
          {
            role: "reviewer",
            label: "Reviewer",
            providerId: "removed-provider",
            modelId: "removed-model",
            reasoningLevel: "high",
            fallbackMode: "none",
          },
        ]}
        providerOptions={[
          { value: "removed-provider", label: "Removed provider", unavailable: true },
        ]}
        modelOptions={[{ value: "removed-model", label: "Removed model", unavailable: true }]}
        reasoningOptions={[{ value: "high", label: "High" }]}
        fallbackOptions={[{ value: "none", label: "None" }]}
        isSaving={() => false}
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(markup).toContain("Reviewer");
    expect(markup).toContain("Removed provider");
    expect(markup).toContain("Unavailable");
  });
});
