import { describe, expect, it } from "@effect/vitest";
import {
  ModelCapabilitySnapshotId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import type { ProviderDriverMetadata } from "../provider/ProviderDriver.ts";
import { normalizeProviderSnapshot } from "./RoutingRegistry.ts";

const instanceId = ProviderInstanceId.make("opencode-personal");
const driver = ProviderDriverKind.make("opencode");
const metadata: ProviderDriverMetadata = {
  displayName: "OpenCode",
  endpointClass: "custom",
  executionLocality: "configurable",
  supportsModelDiscovery: true,
  modelMetadataSource: "provider_reported",
  harnessCapabilities: {
    toolExecution: "supported",
    codeEditing: "supported",
    streaming: "supported",
    structuredOutput: "unknown",
    attachmentInput: "unknown",
  },
  concurrency: {
    maximumConcurrentSessions: 3,
    source: "official_configuration",
  },
};

const snapshot = (
  checkedAt: string,
  modelSlugs = ["remote/model", "custom/model"],
): ServerProvider => ({
  instanceId,
  driver,
  displayName: "Personal endpoint",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: {
    status: "authenticated",
    label: "secret-label",
    email: "private@example.test",
  },
  checkedAt,
  availability: "available",
  models: modelSlugs.map((slug) => ({
    slug,
    name: slug,
    isCustom: slug.startsWith("custom"),
    capabilities: {
      optionDescriptors: [
        {
          id: "contextWindow",
          label: "Context",
          type: "select",
          options: [
            { id: "200k", label: "200k", isDefault: true },
            { id: "1m", label: "1m" },
          ],
        },
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
        },
      ],
    },
  })),
  slashCommands: [],
  skills: [],
});

describe("RoutingRegistry normalization", () => {
  it("allowlists safe metadata and keeps configurable endpoints non-local", () => {
    const normalized = normalizeProviderSnapshot({
      snapshot: snapshot("2026-08-03T10:00:00.000Z"),
      metadata,
    });

    expect(normalized.profile.isLocal).toBe(false);
    expect(normalized.profile.accountReference).toBeNull();
    expect(normalized.profile.configurationMetadata).toMatchObject({
      executionLocality: "configurable",
      maximumConcurrentSessions: 3,
      concurrencySource: "official_configuration",
    });
    expect(JSON.stringify(normalized.profile.configurationMetadata)).not.toContain("secret-label");
    expect(JSON.stringify(normalized.profile.configurationMetadata)).not.toContain(
      "private@example.test",
    );
  });

  it("labels capability provenance and leaves absent critical facts unknown", () => {
    const normalized = normalizeProviderSnapshot({
      snapshot: snapshot("2026-08-03T10:00:00.000Z"),
      metadata,
    });
    const discovered = normalized.models.find(
      (model) => model.profile.providerModelId === "remote/model",
    );
    const custom = normalized.models.find(
      (model) => model.profile.providerModelId === "custom/model",
    );

    expect(discovered?.capabilitySnapshot.source).toBe("provider_reported");
    expect(custom?.capabilitySnapshot.source).toBe("unknown");
    expect(discovered?.capabilitySnapshot.capabilities.toolCalling).toBe("unknown");
    expect(discovered?.capabilitySnapshot.contextLimits).toMatchObject({
      maximumInputTokens: 1_000_000,
      recommendedWorkingContext: 200_000,
    });
    expect(discovered?.capabilitySnapshot.reasoningOptions.supportedLevels).toEqual([
      "low",
      "high",
    ]);
  });

  it("preserves disappearing models as unavailable and reuses unchanged snapshots", () => {
    const first = normalizeProviderSnapshot({
      snapshot: snapshot("2026-08-03T10:00:00.000Z"),
      metadata,
    });
    const second = normalizeProviderSnapshot({
      snapshot: snapshot("2026-08-03T11:00:00.000Z", ["remote/model"]),
      metadata,
      previousProvider: first.profile,
      previousModels: first.models.map(({ profile, capabilitySnapshot }) => ({
        profile,
        capabilitySnapshot,
      })),
    });

    const currentBefore = first.models.find(
      (model) => model.profile.providerModelId === "remote/model",
    );
    const currentAfter = second.models.find(
      (model) => model.profile.providerModelId === "remote/model",
    );
    const disappeared = second.models.find(
      (model) => model.profile.providerModelId === "custom/model",
    );
    expect(currentAfter?.capabilitySnapshot.id).toBe(currentBefore?.capabilitySnapshot.id);
    expect(disappeared?.profile.status).toBe("unavailable");
  });

  it("keeps manual capability corrections authoritative across discovery refreshes", () => {
    const first = normalizeProviderSnapshot({
      snapshot: snapshot("2026-08-03T10:00:00.000Z"),
      metadata,
    });
    const discovered = first.models.find(
      (model) => model.profile.providerModelId === "remote/model",
    );
    expect(discovered).toBeDefined();
    if (!discovered) return;

    const manualSnapshot = {
      ...discovered.capabilitySnapshot,
      id: ModelCapabilitySnapshotId.make("remote-model-manual-capabilities-2"),
      snapshotVersion: 2,
      source: "manual_override" as const,
      capabilities: {
        ...discovered.capabilitySnapshot.capabilities,
        toolCalling: "supported" as const,
      },
    };
    const refreshed = normalizeProviderSnapshot({
      snapshot: snapshot("2026-08-03T11:00:00.000Z"),
      metadata,
      previousProvider: first.profile,
      previousModels: first.models.map(({ profile, capabilitySnapshot }) => ({
        profile,
        capabilitySnapshot:
          profile.id === discovered.profile.id ? manualSnapshot : capabilitySnapshot,
      })),
    });
    const refreshedModel = refreshed.models.find(
      (model) => model.profile.id === discovered.profile.id,
    );

    expect(refreshedModel?.capabilitySnapshot).toEqual(manualSnapshot);
  });
});
