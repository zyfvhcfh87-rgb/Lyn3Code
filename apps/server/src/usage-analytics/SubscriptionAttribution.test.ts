import {
  AgentRunId,
  AnalyticsCurrency,
  ModelProfileId,
  MissionId,
  ProjectId,
  ProviderProfileId,
  RunPerformanceRecord,
  RunPerformanceRecordId,
  SubscriptionAttributionRule,
  SubscriptionAttributionRuleId,
  UsageRecord,
  UsageRecordId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { allocateSubscriptionCosts } from "./SubscriptionAttribution.ts";

const providerProfileId = ProviderProfileId.make("subscription-provider");
const modelProfileId = ModelProfileId.make("subscription-model");
const projectId = ProjectId.make("subscription-project");
const missionId = MissionId.make("subscription-mission");
const periodStart = "2026-01-01T00:00:00.000Z";
const periodEnd = "2026-02-01T00:00:00.000Z";
const calculatedAt = "2026-02-02T00:00:00.000Z";

const rule = (overrides: Partial<SubscriptionAttributionRule> = {}) =>
  SubscriptionAttributionRule.make({
    id: SubscriptionAttributionRuleId.make("subscription-rule"),
    providerProfileId,
    modelProfileId: null,
    label: "January team plan",
    mode: "flat_monthly_by_runs",
    periodStart,
    periodEnd,
    currency: AnalyticsCurrency.make("USD"),
    monthlyAmount: "30",
    fixedInternalRate: null,
    fixedRateUnit: null,
    createdAt: periodStart,
    ...overrides,
  });

const usage = (run: string, tokens: number | null) =>
  UsageRecord.make({
    id: UsageRecordId.make(`usage-${run}`),
    sourceEventId: `event-${run}`,
    sourceTurnId: null,
    projectId,
    missionId,
    taskId: null,
    agentRunId: AgentRunId.make(run),
    parentAgentRunId: null,
    routingDecisionId: null,
    providerProfileId,
    modelProfileId,
    capabilitySnapshotId: null,
    providerRequestId: null,
    providerResponseId: null,
    usageSource: tokens === null ? "unknown" : "provider_reported",
    usageConfidence: tokens === null ? "unknown" : "confirmed",
    state: tokens === null ? "unknown" : "final",
    inputTokens: tokens,
    outputTokens: 0,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    cacheReadTokens: null,
    totalTokens: tokens,
    requestCount: 1,
    toolCallCount: null,
    providerRoundTripCount: null,
    startedAt: "2026-01-15T00:00:00.000Z",
    completedAt: "2026-01-15T00:01:00.000Z",
    recordedAt: "2026-01-15T00:01:00.000Z",
    reconciledAt: null,
  });

const performance = (run: string, activeDurationMilliseconds: number | null) =>
  RunPerformanceRecord.make({
    id: RunPerformanceRecordId.make(`performance-${run}`),
    agentRunId: AgentRunId.make(run),
    taskId: null,
    missionId,
    providerProfileId,
    modelProfileId,
    reasoningLevel: null,
    queuedDurationMilliseconds: null,
    startupDurationMilliseconds: null,
    firstOutputLatencyMilliseconds: null,
    activeDurationMilliseconds,
    wallClockDurationMilliseconds: null,
    status: "finalized",
    completionCategory: "completed",
    fallbackCount: 0,
    providerRetryCount: 0,
    toolFailureCount: 0,
    contextReductionApplied: false,
    cancelledBy: null,
    createdAt: periodStart,
    updatedAt: calculatedAt,
    finalizedAt: calculatedAt,
  });

const allocate = (
  input: {
    rule?: SubscriptionAttributionRule;
    mode?: "none" | SubscriptionAttributionRule["mode"];
    usage?: ReadonlyArray<UsageRecord>;
    performance?: ReadonlyArray<RunPerformanceRecord>;
    calculatedAt?: string;
  } = {},
) =>
  allocateSubscriptionCosts({
    rule: input.rule ?? rule(),
    configuredMode: input.mode ?? "flat_monthly_by_runs",
    usage: input.usage ?? [usage("run-a", 100), usage("run-b", 200), usage("run-c", 300)],
    performance: input.performance ?? [],
    calculatedAt: input.calculatedAt ?? calculatedAt,
  });

describe("SubscriptionAttribution", () => {
  it("keeps subscription activity monetary-free by default", () => {
    expect(allocate({ mode: "none" })).toMatchObject({
      status: "disabled",
      records: [],
      withheldReason: "subscription_attribution_disabled",
    });
  });

  it("implements Scenario 5 as an explicit accounting estimate", () => {
    const result = allocate();
    expect(result.status).toBe("allocated");
    expect(result.records.map(({ amount }) => amount)).toEqual(["10", "10", "10"]);
    expect(result.records[0]).toMatchObject({
      costType: "subscription_attribution",
      calculationMethod: "subscription_backed",
      isEstimated: true,
      isSubscriptionBacked: true,
      confidence: "medium",
      pricingSnapshotId: null,
      calculationBreakdown: [
        { dimension: "subscription_accounting_allocation:flat_monthly_by_runs" },
      ],
    });
  });

  it("allocates closed flat plans by tokens or active time without a rounding leak", () => {
    const byTokens = rule({ mode: "flat_monthly_by_tokens" });
    expect(
      allocate({ rule: byTokens, mode: byTokens.mode }).records.map(({ amount }) => amount),
    ).toEqual(["5", "10", "15"]);

    const byTime = rule({ mode: "flat_monthly_by_active_time" });
    expect(
      allocate({
        rule: byTime,
        mode: byTime.mode,
        usage: [usage("run-a", 100), usage("run-b", 200)],
        performance: [performance("run-a", 3_600_000), performance("run-b", 7_200_000)],
      }).records.map(({ amount }) => amount),
    ).toEqual(["10", "20"]);
  });

  it("supports an explicit manual fixed internal rate and unit", () => {
    const fixed = rule({
      mode: "manual_fixed_internal_rate",
      monthlyAmount: null,
      fixedInternalRate: "2.5",
      fixedRateUnit: "per_active_hour",
    });
    const result = allocate({
      rule: fixed,
      mode: fixed.mode,
      usage: [usage("run-a", 100), usage("run-b", 200)],
      performance: [performance("run-a", 3_600_000), performance("run-b", 1_800_000)],
    });
    expect(result.records.map(({ amount }) => amount)).toEqual(["2.5", "1.25"]);
    expect(result.records[0]?.calculationMethod).toBe("user_configured_rate");
  });

  it("withholds money for an open period or incomplete shared denominator", () => {
    const open = allocate({ calculatedAt: "2026-01-20T00:00:00.000Z" });
    expect(open.records.every(({ amount }) => amount === null)).toBe(true);
    expect(open.withheldReason).toBe("subscription_period_open");

    const byTokens = rule({ mode: "flat_monthly_by_tokens" });
    const incomplete = allocate({
      rule: byTokens,
      mode: byTokens.mode,
      usage: [usage("run-a", 100), usage("run-b", null)],
    });
    expect(incomplete.records.every(({ amount }) => amount === null)).toBe(true);
    expect(incomplete.records[1]?.calculationBreakdown[0]?.quantity).toBeNull();
    expect(incomplete.withheldReason).toBe("subscription_allocation_basis_incomplete");
  });

  it("is deterministic and revises closed-period allocations when late activity arrives", () => {
    const initial = allocate({ usage: [usage("run-a", 100), usage("run-b", 200)] });
    const repeated = allocate({ usage: [usage("run-b", 200), usage("run-a", 100)] });
    expect(repeated).toEqual(initial);

    const revised = allocate({
      usage: [usage("run-a", 100), usage("run-b", 200), usage("run-c", 300)],
    });
    expect(revised.revision).not.toBe(initial.revision);
    expect(initial.records.map(({ amount }) => amount)).toEqual(["15", "15"]);
    expect(revised.records.map(({ amount }) => amount)).toEqual(["10", "10", "10"]);
  });
});
