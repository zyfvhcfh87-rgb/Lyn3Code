import {
  AgentRunId,
  AnalyticsCurrency,
  MissionId,
  ModelProfileId,
  ProviderProfileId,
  RunPerformanceRecord,
  RunPerformanceRecordId,
  TaskOutcomeRecord,
  TaskOutcomeRecordId,
  MissionTaskId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  METRIC_CATALOGUE_V1,
  calculateCostPerOutcome,
  calculateFallbackRate,
  calculateFirstPassVerificationRate,
  calculateHumanAcceptanceRate,
  calculateProviderFailureRate,
  calculateRepairRate,
} from "./MetricCatalogue.ts";

const now = "2026-01-01T00:00:00.000Z";
const missionId = MissionId.make("mission-metrics");

const taskOutcome = (input: {
  readonly id: string;
  readonly firstPass: boolean | null;
  readonly repairAttempts: number;
  readonly humanDisposition?:
    | "accepted"
    | "accepted_with_edits"
    | "rejected"
    | "abandoned"
    | "not_reviewed"
    | "unknown";
}) =>
  TaskOutcomeRecord.make({
    id: TaskOutcomeRecordId.make(`outcome-${input.id}`),
    taskId: MissionTaskId.make(input.id),
    missionId,
    status: "completed",
    implementationCompleted: true,
    verificationResult: "passed",
    integrationResult: null,
    humanDisposition: input.humanDisposition ?? "accepted",
    reverted: false,
    firstPassVerification: input.firstPass,
    repairAttemptCount: input.repairAttempts,
    agentRunCount: 1,
    totalWallClockDurationMilliseconds: null,
    totalActiveAgentDurationMilliseconds: null,
    createdAt: now,
    updatedAt: now,
    finalizedAt: now,
  });

const run = (input: {
  readonly id: string;
  readonly status: "queued" | "running" | "finalized" | "finalization_failed";
  readonly completion:
    | "completed"
    | "failed_provider"
    | "failed_transport"
    | "fallback_superseded"
    | "unknown";
  readonly fallbackCount?: number;
}) =>
  RunPerformanceRecord.make({
    id: RunPerformanceRecordId.make(`performance-${input.id}`),
    agentRunId: AgentRunId.make(input.id),
    taskId: null,
    missionId,
    providerProfileId: ProviderProfileId.make("provider-metrics"),
    modelProfileId: ModelProfileId.make("model-metrics"),
    reasoningLevel: null,
    queuedDurationMilliseconds: null,
    startupDurationMilliseconds: null,
    firstOutputLatencyMilliseconds: null,
    activeDurationMilliseconds: null,
    wallClockDurationMilliseconds: null,
    status: input.status,
    completionCategory: input.completion,
    fallbackCount: input.fallbackCount ?? 0,
    providerRetryCount: 0,
    toolFailureCount: 0,
    contextReductionApplied: false,
    cancelledBy: null,
    createdAt: now,
    updatedAt: now,
    finalizedAt: input.status === "finalized" ? now : null,
  });

describe("MetricCatalogue", () => {
  it("publishes explicit v1 denominators", () => {
    expect(
      METRIC_CATALOGUE_V1.find(({ key }) => key === "first_pass_verification_rate")?.denominator,
    ).toContain("firstPassVerification is not null");
    expect(
      METRIC_CATALOGUE_V1.find(({ key }) => key === "provider_failure_rate")?.denominator,
    ).toContain("All finalized started runs");
    expect(
      METRIC_CATALOGUE_V1.find(({ key }) => key === "fallback_rate_per_started_run")?.denominator,
    ).toContain("progressed beyond queued");
  });

  it("uses observable first-pass tasks for both first-pass and repair rates", () => {
    const outcomes = [
      taskOutcome({ id: "task-a", firstPass: true, repairAttempts: 0 }),
      taskOutcome({ id: "task-b", firstPass: false, repairAttempts: 2 }),
      taskOutcome({ id: "task-c", firstPass: null, repairAttempts: 0 }),
    ];

    expect(calculateFirstPassVerificationRate(outcomes)).toMatchObject({
      value: "0.5",
      numeratorCount: 1,
      denominatorCount: 2,
      missingCount: 1,
    });
    expect(calculateRepairRate(outcomes)).toMatchObject({
      value: "0.5",
      numeratorCount: 1,
      denominatorCount: 2,
      missingCount: 1,
    });
  });

  it("counts every explicit human disposition in the acceptance denominator", () => {
    const outcomes = [
      taskOutcome({
        id: "accepted",
        firstPass: true,
        repairAttempts: 0,
        humanDisposition: "accepted",
      }),
      taskOutcome({
        id: "edited",
        firstPass: true,
        repairAttempts: 0,
        humanDisposition: "accepted_with_edits",
      }),
      taskOutcome({
        id: "rejected",
        firstPass: false,
        repairAttempts: 0,
        humanDisposition: "rejected",
      }),
      taskOutcome({
        id: "abandoned",
        firstPass: false,
        repairAttempts: 0,
        humanDisposition: "abandoned",
      }),
      taskOutcome({
        id: "not-reviewed",
        firstPass: null,
        repairAttempts: 0,
        humanDisposition: "not_reviewed",
      }),
      taskOutcome({
        id: "unknown-disposition",
        firstPass: null,
        repairAttempts: 0,
        humanDisposition: "unknown",
      }),
    ];

    expect(calculateHumanAcceptanceRate(outcomes)).toMatchObject({
      value: "0.5",
      numeratorCount: 2,
      denominatorCount: 4,
      missingCount: 2,
    });
  });

  it("includes every finalized run but excludes unstarted runs from rate denominators", () => {
    const runs = [
      run({ id: "run-provider-failed", status: "finalized", completion: "failed_provider" }),
      run({ id: "run-transport-failed", status: "finalized", completion: "failed_transport" }),
      run({ id: "run-fallback", status: "finalized", completion: "completed", fallbackCount: 1 }),
      run({ id: "run-finalized-unknown", status: "finalized", completion: "unknown" }),
      run({ id: "run-queued", status: "queued", completion: "unknown" }),
    ];

    expect(calculateProviderFailureRate(runs)).toMatchObject({
      value: "0.5",
      numeratorCount: 2,
      denominatorCount: 4,
    });
    expect(calculateFallbackRate(runs)).toMatchObject({
      value: "0.25",
      numeratorCount: 1,
      denominatorCount: 4,
    });
  });

  it("emits separate currency cost-per-outcome values and reports missing cost", () => {
    const usd = AnalyticsCurrency.make("USD");
    const eur = AnalyticsCurrency.make("EUR");
    expect(
      calculateCostPerOutcome(
        [{ amount: "6", currency: usd }, { amount: "4", currency: eur }, null],
        2,
      ),
    ).toEqual([
      { currency: eur, value: "2", outcomeCount: 2, missingCostCount: 1 },
      { currency: usd, value: "3", outcomeCount: 2, missingCostCount: 1 },
    ]);
  });
});
