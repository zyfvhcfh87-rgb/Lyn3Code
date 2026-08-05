import {
  AgentRunId,
  MissionId,
  MissionTaskId,
  ModelProfileId,
  ProjectId,
  ProviderProfileId,
  UsageRecordId,
  type UsageRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { buildAnalyticsExportRows } from "./UsageAnalyticsWorkspaceService.ts";

const now = "2026-08-04T10:00:00.000Z";

describe("analytics export privacy", () => {
  it("exports bounded metrics and lineage references without prompt or source content", () => {
    const usage: UsageRecord = {
      id: UsageRecordId.make("usage-1"),
      sourceEventId: "provider-event-1",
      sourceTurnId: "provider-turn-1",
      projectId: ProjectId.make("project-1"),
      missionId: MissionId.make("mission-1"),
      taskId: MissionTaskId.make("task-1"),
      agentRunId: AgentRunId.make("run-1"),
      parentAgentRunId: null,
      routingDecisionId: null,
      providerProfileId: ProviderProfileId.make("provider-1"),
      modelProfileId: ModelProfileId.make("provider-1:model-1"),
      capabilitySnapshotId: null,
      providerRequestId: "secret-provider-request",
      providerResponseId: "secret-provider-response",
      usageSource: "provider_reported",
      usageConfidence: "confirmed",
      state: "final",
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      totalTokens: 15,
      requestCount: 1,
      toolCallCount: null,
      providerRoundTripCount: null,
      startedAt: now,
      completedAt: now,
      recordedAt: now,
      reconciledAt: now,
    };
    const rows = buildAnalyticsExportRows({
      usage: [usage],
      costs: [],
      performance: [],
      outcomes: [],
      missionOutcomes: [],
    });
    const serialized = JSON.stringify(rows);
    const usageRow = rows.find(({ recordType }) => recordType === "usage");

    expect(rows.some(({ recordType }) => recordType === "metric_definition")).toBe(true);
    expect(usageRow).toMatchObject({
      schemaVersion: 1,
      metricVersion: 1,
      value: 15,
      unit: "tokens",
      provenance: "provider_reported",
      attribution: "exclusive_root_run",
    });
    expect(serialized).not.toContain("secret-provider-request");
    expect(serialized).not.toContain("secret-provider-response");
    expect(serialized).not.toContain("sourceEventId");
    expect(serialized).not.toContain("prompt");
  });
});
