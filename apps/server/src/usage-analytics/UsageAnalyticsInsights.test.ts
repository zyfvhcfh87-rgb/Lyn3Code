import {
  AgentRunId,
  AnalyticsCurrency,
  MissionId,
  MissionTaskId,
  ModelProfileId,
  ProjectId,
  ProviderProfileId,
  RunPerformanceRecordId,
  TaskOutcomeRecordId,
  UsageRecordId,
  type RunPerformanceRecord,
  type TaskOutcomeRecord,
  type UsageRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  deriveAnalyticsAlerts,
  deriveAnalyticsRecommendations,
  type AnalyticsInsightInput,
} from "./UsageAnalyticsInsights.ts";

const now = "2026-08-04T10:00:00.000Z";
const missionId = MissionId.make("mission-1");
const taskId = MissionTaskId.make("task-1");
const providerProfileId = ProviderProfileId.make("provider-1");
const modelProfileId = ModelProfileId.make("provider-1:model-1");

const performance = (
  index: number,
  completionCategory: RunPerformanceRecord["completionCategory"],
): RunPerformanceRecord => ({
  id: RunPerformanceRecordId.make(`performance-${index}`),
  agentRunId: AgentRunId.make(`run-${index}`),
  taskId,
  missionId,
  providerProfileId,
  modelProfileId,
  reasoningLevel: "medium",
  queuedDurationMilliseconds: 1,
  startupDurationMilliseconds: 1,
  firstOutputLatencyMilliseconds: 1,
  activeDurationMilliseconds: 1,
  wallClockDurationMilliseconds: 1,
  status: "finalized",
  completionCategory,
  fallbackCount: 0,
  providerRetryCount: 0,
  toolFailureCount: 0,
  contextReductionApplied: false,
  cancelledBy: null,
  createdAt: now,
  updatedAt: now,
  finalizedAt: now,
});

const outcome = (repairAttemptCount: number): TaskOutcomeRecord => ({
  id: TaskOutcomeRecordId.make(`outcome-${repairAttemptCount}`),
  taskId,
  missionId,
  status: "completed",
  implementationCompleted: true,
  verificationResult: "passed",
  integrationResult: "integrated",
  humanDisposition: "not_reviewed",
  reverted: false,
  firstPassVerification: repairAttemptCount === 0,
  repairAttemptCount,
  agentRunCount: 1,
  totalWallClockDurationMilliseconds: 1,
  totalActiveAgentDurationMilliseconds: 1,
  createdAt: now,
  updatedAt: now,
  finalizedAt: now,
});

const unknownUsage: UsageRecord = {
  id: UsageRecordId.make("usage-1"),
  sourceEventId: "event-1",
  sourceTurnId: null,
  projectId: ProjectId.make("project-1"),
  missionId,
  taskId,
  agentRunId: AgentRunId.make("run-1"),
  parentAgentRunId: null,
  routingDecisionId: null,
  providerProfileId,
  modelProfileId,
  capabilitySnapshotId: null,
  providerRequestId: null,
  providerResponseId: null,
  usageSource: "unknown",
  usageConfidence: "unknown",
  state: "unknown",
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  cachedInputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  totalTokens: null,
  requestCount: null,
  toolCallCount: null,
  providerRoundTripCount: null,
  startedAt: now,
  completedAt: now,
  recordedAt: now,
  reconciledAt: null,
};

const fixture = (overrides: Partial<AnalyticsInsightInput> = {}): AnalyticsInsightInput => ({
  usage: [],
  costs: [],
  pricing: [],
  performance: [],
  outcomes: [],
  minimumSampleSize: 3,
  observedAt: now,
  ...overrides,
});

describe("UsageAnalyticsInsights", () => {
  it("emits deduplicated quality and retry alerts without inventing values", () => {
    const alerts = deriveAnalyticsAlerts(
      fixture({
        usage: [unknownUsage],
        outcomes: [
          outcome(1),
          { ...outcome(1), id: TaskOutcomeRecordId.make("outcome-2") },
          { ...outcome(0), id: TaskOutcomeRecordId.make("outcome-3") },
        ],
      }),
    );
    expect(alerts.map(({ category }) => category)).toEqual([
      "usage_data_incomplete",
      "verification_retry_spike",
    ]);
    expect(new Set(alerts.map(({ deduplicationKey }) => deduplicationKey)).size).toBe(2);
  });

  it("creates a non-binding provider recommendation only above the sample threshold", () => {
    const runs = [
      performance(1, "failed_provider"),
      performance(2, "failed_transport"),
      performance(3, "completed"),
    ];
    const recommendations = deriveAnalyticsRecommendations(fixture({ performance: runs }));
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.sampleSize).toBe(3);
    expect(recommendations[0]?.metricKeys).toEqual(["provider_failure_rate"]);
    expect(recommendations[0]?.evidence).toContain("No routing setting was changed");
    expect(deriveAnalyticsRecommendations(fixture({ performance: runs.slice(0, 2) }))).toEqual([]);
  });

  it("highlights provider and catalogue discrepancies without replacing either amount", () => {
    const costs = [
      {
        agentRunId: AgentRunId.make("run-cost"),
        currency: AnalyticsCurrency.make("USD"),
        costType: "provider_reported",
        amount: "1.20",
        createdAt: now,
      },
      {
        agentRunId: AgentRunId.make("run-cost"),
        currency: AnalyticsCurrency.make("USD"),
        costType: "api_usage",
        amount: "1.00",
        createdAt: now,
      },
    ] as unknown as AnalyticsInsightInput["costs"];

    const alerts = deriveAnalyticsAlerts(fixture({ costs }));
    const discrepancy = alerts.find(({ category }) => category === "provider_cost_discrepancy:USD");
    expect(discrepancy?.detail).toContain("neither amount replaced the other");
  });
});
