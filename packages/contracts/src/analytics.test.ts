import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ANALYTICS_METRIC_KEYS,
  ANALYTICS_METRIC_VERSION,
  AnalyticsDecimal,
  AnalyticsSettings,
  ExchangeRateSnapshot,
  HumanDispositionRecord,
  HumanDispositionRecordInput,
  SubscriptionAttributionRule,
  UsageRecord,
} from "./analytics.ts";

const now = "2026-08-04T12:00:00.000Z";
const decodeAnalyticsDecimal = Schema.decodeUnknownSync(AnalyticsDecimal);
const decodeAnalyticsSettings = Schema.decodeUnknownSync(AnalyticsSettings);
const decodeExchangeRateSnapshot = Schema.decodeUnknownSync(ExchangeRateSnapshot);
const decodeHumanDispositionRecord = Schema.decodeUnknownSync(HumanDispositionRecord);
const decodeHumanDispositionRecordInput = Schema.decodeUnknownSync(HumanDispositionRecordInput);
const decodeSubscriptionAttributionRule = Schema.decodeUnknownSync(SubscriptionAttributionRule);
const decodeUsageRecord = Schema.decodeUnknownSync(UsageRecord);

it("keeps analytics money decimal-safe and rejects ambiguous wire values", () => {
  assert.strictEqual(decodeAnalyticsDecimal("0.000001"), "0.000001");
  assert.strictEqual(
    decodeAnalyticsDecimal("123456789012345678.123456789012345678"),
    "123456789012345678.123456789012345678",
  );
  assert.throws(() => decodeAnalyticsDecimal(0.1));
  assert.throws(() => decodeAnalyticsDecimal("NaN"));
  assert.throws(() => decodeAnalyticsDecimal("1e-6"));
});

it("preserves unavailable usage as null instead of inventing zero", () => {
  const usage = decodeUsageRecord({
    id: "usage-unknown-1",
    sourceEventId: "provider-event-1",
    sourceTurnId: null,
    projectId: "project-1",
    missionId: null,
    taskId: null,
    agentRunId: "run-1",
    parentAgentRunId: null,
    routingDecisionId: null,
    providerProfileId: "provider-1",
    modelProfileId: "provider-1:unknown",
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
    requestCount: 1,
    toolCallCount: null,
    providerRoundTripCount: null,
    startedAt: null,
    completedAt: null,
    recordedAt: now,
    reconciledAt: null,
  });

  assert.strictEqual(usage.totalTokens, null);
  assert.strictEqual(usage.inputTokens, null);
  assert.strictEqual(usage.toolCallCount, null);
  assert.strictEqual(usage.providerRoundTripCount, null);
  assert.strictEqual(usage.usageSource, "unknown");
});

it("requires explicit, source-bound human dispositions", () => {
  const input = decodeHumanDispositionRecordInput({
    taskId: "task-1",
    disposition: "accepted",
    actor: "maintainer@example.test",
    markedAt: now,
    reason: null,
    sourceFingerprint: "git:abc123",
  });
  assert.strictEqual(input.disposition, "accepted");
  assert.throws(() => decodeHumanDispositionRecordInput({ ...input, disposition: "not_reviewed" }));

  assert.throws(() =>
    decodeHumanDispositionRecord({
      id: "human-disposition-1",
      taskOutcomeRecordId: "task-outcome-1",
      missionId: "mission-1",
      ...input,
      sourceChangedAfterDisposition: false,
      sourceChangedAt: now,
    }),
  );
});

it("makes raw prompt storage impossible in analytics settings", () => {
  const settings = decodeAnalyticsSettings({
    enabled: true,
    detailRetentionDays: 90,
    aggregateRetentionDays: null,
    exportRetentionDays: 30,
    pricingSourcePriority: ["provider_reported", "official_catalog", "user_configured"],
    defaultReportingCurrency: "USD",
    subscriptionAttributionMode: "none",
    localComputeHourlyRate: null,
    outcomeObservationWindowDays: 30,
    minimumComparisonSampleSize: 5,
    forecastMethod: "current_period_run_rate",
    detailLevel: "standard",
    storePromptContent: false,
    updatedAt: now,
  });

  assert.strictEqual(settings.storePromptContent, false);
  assert.throws(() => decodeAnalyticsSettings({ ...settings, storePromptContent: true }));
});

it("requires explicit money, periods, and units for subscription accounting rules", () => {
  const flat = decodeSubscriptionAttributionRule({
    id: "subscription-rule-flat",
    providerProfileId: "provider-1",
    modelProfileId: null,
    label: "Team plan January",
    mode: "flat_monthly_by_runs",
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-02-01T00:00:00.000Z",
    currency: "USD",
    monthlyAmount: "30",
    fixedInternalRate: null,
    fixedRateUnit: null,
    createdAt: now,
  });
  assert.strictEqual(flat.monthlyAmount, "30");
  assert.throws(() => decodeSubscriptionAttributionRule({ ...flat, monthlyAmount: null }));
  assert.throws(() =>
    decodeSubscriptionAttributionRule({
      ...flat,
      periodStart: flat.periodEnd,
      periodEnd: flat.periodStart,
    }),
  );

  const fixed = decodeSubscriptionAttributionRule({
    ...flat,
    id: "subscription-rule-fixed",
    mode: "manual_fixed_internal_rate",
    monthlyAmount: null,
    fixedInternalRate: "2.5",
    fixedRateUnit: "per_active_hour",
  });
  assert.strictEqual(fixed.fixedRateUnit, "per_active_hour");
  assert.throws(() => decodeSubscriptionAttributionRule({ ...fixed, fixedRateUnit: null }));
});

it("requires a positive effective-dated manual exchange rate", () => {
  const snapshot = decodeExchangeRateSnapshot({
    id: "exchange-rate-eur-usd",
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    rate: "1.2",
    source: "user_configured",
    effectiveAt: now,
    createdAt: now,
  });
  assert.strictEqual(snapshot.rate, "1.2");
  assert.throws(() => decodeExchangeRateSnapshot({ ...snapshot, rate: "0" }));
  assert.throws(() =>
    decodeExchangeRateSnapshot({ ...snapshot, quoteCurrency: snapshot.baseCurrency }),
  );
});

it("pins the canonical metric catalogue to version one", () => {
  assert.strictEqual(ANALYTICS_METRIC_VERSION, 1);
  assert.deepStrictEqual(ANALYTICS_METRIC_KEYS, [
    "cost_per_verified_task_implementation",
    "cost_per_verified_task_inclusive",
    "cost_per_merged_mission",
    "first_pass_verification_rate",
    "repair_rate",
    "human_acceptance_rate",
    "provider_failure_rate",
    "fallback_rate_per_started_run",
  ]);
});
