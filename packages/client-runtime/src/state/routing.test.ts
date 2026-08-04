import {
  IsoDateTime,
  ModelCapabilitySnapshotId,
  ModelProfileId,
  ProviderHealthRecordId,
  ProviderInstanceId,
  type RoutingRegistrySnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { includeUnavailableRoutingPin, indexRoutingRegistry } from "./routing.ts";

const providerId = ProviderInstanceId.make("codex-personal");
const modelId = ModelProfileId.make("codex-personal:gpt-test");

const snapshot = {
  providers: [],
  models: [],
  capabilitySnapshots: [
    {
      id: ModelCapabilitySnapshotId.make("capability-old"),
      modelProfileId: modelId,
      snapshotVersion: 1,
      source: "unknown",
      capabilities: {
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
      },
      contextLimits: {
        maximumInputTokens: null,
        maximumOutputTokens: null,
        recommendedWorkingContext: null,
        supportsAutomaticCompaction: "unknown",
      },
      reasoningOptions: {
        supportedLevels: [],
        defaultLevel: null,
        supportsDynamicReasoning: "unknown",
      },
      toolSupport: {},
      modalitySupport: {},
      outputSupport: {},
      privacyMetadata: {},
      capturedAt: IsoDateTime.make("2026-08-01T00:00:00.000Z"),
      expiresAt: null,
    },
    {
      id: ModelCapabilitySnapshotId.make("capability-current"),
      modelProfileId: modelId,
      snapshotVersion: 2,
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
        longContext: "unknown",
        systemInstructions: "supported",
        promptCaching: "unknown",
      },
      contextLimits: {
        maximumInputTokens: 128_000,
        maximumOutputTokens: null,
        recommendedWorkingContext: null,
        supportsAutomaticCompaction: "unknown",
      },
      reasoningOptions: {
        supportedLevels: ["medium", "high"],
        defaultLevel: "medium",
        supportsDynamicReasoning: "supported",
      },
      toolSupport: {},
      modalitySupport: {},
      outputSupport: {},
      privacyMetadata: {},
      capturedAt: IsoDateTime.make("2026-08-02T00:00:00.000Z"),
      expiresAt: null,
    },
  ],
  health: [
    {
      id: ProviderHealthRecordId.make("health-old"),
      providerProfileId: providerId,
      status: "degraded",
      latencyMilliseconds: null,
      rateLimitState: "unknown",
      errorCategory: null,
      observedAt: IsoDateTime.make("2026-08-01T00:00:00.000Z"),
      expiresAt: IsoDateTime.make("2026-08-01T00:01:00.000Z"),
    },
    {
      id: ProviderHealthRecordId.make("health-current"),
      providerProfileId: providerId,
      status: "available",
      latencyMilliseconds: 42,
      rateLimitState: "clear",
      errorCategory: null,
      observedAt: IsoDateTime.make("2026-08-02T00:00:00.000Z"),
      expiresAt: IsoDateTime.make("2026-08-02T00:01:00.000Z"),
    },
  ],
  refreshedAt: IsoDateTime.make("2026-08-02T00:00:00.000Z"),
} satisfies RoutingRegistrySnapshot;

describe("routing registry state", () => {
  it("indexes the latest immutable capability and health snapshots", () => {
    const index = indexRoutingRegistry(snapshot);

    expect(index.capabilityByModelId.get(modelId)?.snapshotVersion).toBe(2);
    expect(index.capabilityByModelId.get(modelId)?.capabilities.toolCalling).toBe("supported");
    expect(index.healthByProviderId.get(providerId)?.status).toBe("available");
  });

  it("preserves an unavailable saved pin without duplicating a discovered option", () => {
    const options = [{ value: "current", label: "Current" }];

    expect(
      includeUnavailableRoutingPin(options, "removed", (value) => ({
        value,
        label: value,
        unavailable: true,
      })),
    ).toEqual([
      { value: "current", label: "Current" },
      { value: "removed", label: "removed", unavailable: true },
    ]);
    expect(
      includeUnavailableRoutingPin(options, "current", (value) => ({ value, label: value })),
    ).toBe(options);
  });
});
