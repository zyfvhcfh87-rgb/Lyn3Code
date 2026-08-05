import { describe, expect, it } from "@effect/vitest";
import {
  AgentRunId,
  MissionId,
  MissionTaskId,
  ModelProfileId,
  ProviderProfileId,
  RunPerformanceRecordId,
  type RoutingReasoningLevel,
  type RunPerformanceRecord,
} from "@t3tools/contracts";

import { comparisonRows } from "./UsageAnalyticsWorkspaceService.ts";

const performance = (
  id: string,
  reasoningLevel: RoutingReasoningLevel | null,
  taskId: string | null = null,
): RunPerformanceRecord => ({
  id: RunPerformanceRecordId.make(`performance:${id}`),
  agentRunId: AgentRunId.make(id),
  taskId: taskId === null ? null : MissionTaskId.make(taskId),
  missionId: MissionId.make("mission-1"),
  providerProfileId: ProviderProfileId.make("provider-1"),
  modelProfileId: ModelProfileId.make("model-1"),
  reasoningLevel,
  queuedDurationMilliseconds: 1,
  startupDurationMilliseconds: null,
  firstOutputLatencyMilliseconds: null,
  activeDurationMilliseconds: 10,
  wallClockDurationMilliseconds: 11,
  status: "finalized",
  completionCategory: "completed",
  fallbackCount: 0,
  providerRetryCount: 0,
  toolFailureCount: 0,
  contextReductionApplied: false,
  cancelledBy: null,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:01.000Z",
  finalizedAt: "2026-08-04T00:00:01.000Z",
});

describe("UsageAnalyticsWorkspaceService comparisons", () => {
  it("segments explicit and provider-default reasoning levels without ranking them", () => {
    const rows = comparisonRows({
      performance: [performance("run-low", "low"), performance("run-default", null)],
      usage: [],
      costs: [],
      outcomes: [],
      minimumSampleSize: 2,
    });

    expect(rows.find((row) => row.scopeId === "low")).toMatchObject({
      scopeType: "reasoning",
      runCount: 1,
      insufficientSample: true,
    });
    expect(rows.find((row) => row.scopeId === "provider_default")).toMatchObject({
      scopeType: "reasoning",
      runCount: 1,
      insufficientSample: true,
    });
  });

  it("segments durable agent roles with deterministic sample and missing-data labels", () => {
    const runOne = performance("run-implementer-one", "medium", "task-1");
    const runTwo = performance("run-implementer-two", "medium", "task-2");
    const reviewer = performance("run-reviewer", "high", "task-3");
    const rows = comparisonRows({
      performance: [runOne, runTwo, reviewer],
      usage: [],
      costs: [],
      outcomes: [],
      agentRolesByRun: new Map([
        [runOne.agentRunId, { scopeId: "role-implementer", label: "Implementer" }],
        [runTwo.agentRunId, { scopeId: "role-implementer", label: "Implementer" }],
        [reviewer.agentRunId, { scopeId: "kind:reviewer", label: "reviewer" }],
      ]),
      minimumSampleSize: 2,
    });

    expect(rows.find((row) => row.scopeId === "role-implementer")).toMatchObject({
      scopeType: "agent_role",
      label: "Implementer",
      taskCount: 2,
      runCount: 2,
      missingDataRatio: 1,
      insufficientSample: false,
    });
    expect(rows.find((row) => row.scopeId === "kind:reviewer")).toMatchObject({
      scopeType: "agent_role",
      label: "reviewer",
      taskCount: 1,
      runCount: 1,
      missingDataRatio: 1,
      insufficientSample: true,
    });
  });
});
