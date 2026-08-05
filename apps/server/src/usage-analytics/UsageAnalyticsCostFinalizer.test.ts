import {
  AgentRunId,
  AnalyticsCurrency,
  MissionId,
  ModelProfileId,
  PricingSnapshot,
  PricingSnapshotId,
  ProjectId,
  ProviderProfileId,
  UsageRecord,
  UsageRecordId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  buildFinalizedUsageCostRecord,
  selectFinalizationPricingSnapshot,
  type UsageCostFinalizationInput,
} from "./UsageAnalyticsCostFinalizer.ts";

const providerProfileId = ProviderProfileId.make("provider-finalizer");
const modelProfileId = ModelProfileId.make("model-finalizer");
const agentRunId = AgentRunId.make("run-finalizer");
const usd = AnalyticsCurrency.make("USD");

const usage = (state: "provisional" | "final" | "reconciled" | "unknown" = "final") =>
  UsageRecord.make({
    id: UsageRecordId.make("usage-finalizer"),
    sourceEventId: "usage-event-finalizer",
    sourceTurnId: null,
    projectId: ProjectId.make("project-finalizer"),
    missionId: MissionId.make("mission-finalizer"),
    taskId: null,
    agentRunId,
    parentAgentRunId: null,
    routingDecisionId: null,
    providerProfileId,
    modelProfileId,
    capabilitySnapshotId: null,
    providerRequestId: null,
    providerResponseId: null,
    usageSource: state === "unknown" ? "unknown" : "provider_reported",
    usageConfidence: state === "unknown" ? "unknown" : "confirmed",
    state,
    inputTokens: state === "unknown" ? null : 1_000_000,
    outputTokens: state === "unknown" ? null : 0,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    cacheReadTokens: null,
    totalTokens: state === "unknown" ? null : 1_000_000,
    requestCount: state === "unknown" ? null : 1,
    toolCallCount: null,
    providerRoundTripCount: null,
    startedAt: "2026-01-14T23:00:00.000Z",
    completedAt: "2026-01-15T00:00:00.000Z",
    recordedAt: "2026-01-15T00:00:00.000Z",
    reconciledAt: null,
  });

const pricing = (input: {
  readonly id: string;
  readonly source: "official_catalog" | "subscription_plan" | "user_configured";
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly inputRate: string;
  readonly currency?: "USD" | "EUR";
}) =>
  PricingSnapshot.make({
    id: PricingSnapshotId.make(input.id),
    providerProfileId,
    modelProfileId,
    currency: AnalyticsCurrency.make(input.currency ?? "USD"),
    pricingSource: input.source,
    pricingVersion: input.id,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    inputTokenRate: input.inputRate,
    outputTokenRate: "0",
    reasoningTokenRate: null,
    cachedInputRate: null,
    cacheWriteRate: null,
    cacheReadRate: null,
    requestRate: null,
    toolRateMetadata: {},
    billingUnit: "per_million_tokens",
    confidence: "confirmed",
    metadata: {},
    createdAt: input.effectiveFrom,
  });

const input = (
  overrides: Partial<UsageCostFinalizationInput> = {},
): UsageCostFinalizationInput => ({
  usage: usage(),
  pricingSnapshots: [],
  pricingSourcePriority: [
    "provider_reported",
    "official_catalog",
    "user_configured",
    "subscription_plan",
    "unknown",
  ],
  defaultReportingCurrency: usd,
  localComputeHourlyRate: null,
  isLocalProvider: false,
  activeDurationMilliseconds: 3_600_000,
  ...overrides,
});

describe("UsageAnalyticsCostFinalizer", () => {
  it("binds finalized usage to the immutable snapshot effective at usage time", () => {
    const oldPrice = pricing({
      id: "price-old",
      source: "official_catalog",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-02-01T00:00:00.000Z",
      inputRate: "2",
    });
    const newPrice = pricing({
      id: "price-new",
      source: "official_catalog",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      effectiveTo: null,
      inputRate: "9",
    });
    const finalization = input({ pricingSnapshots: [newPrice, oldPrice] });

    expect(selectFinalizationPricingSnapshot(finalization)?.id).toBe(oldPrice.id);
    const record = buildFinalizedUsageCostRecord(finalization);
    expect(record).toMatchObject({
      pricingSnapshotId: oldPrice.id,
      amount: "2",
      sourceKey: `calculated-usage:${usage().id}`,
      calculationMethod: "pricing_catalog_calculated",
      costType: "api_usage",
    });
    expect(buildFinalizedUsageCostRecord(finalization)).toEqual(record);
  });

  it("falls back to an effective non-default currency when the default is not yet effective", () => {
    const futureUsd = pricing({
      id: "price-future-usd",
      source: "official_catalog",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      effectiveTo: null,
      inputRate: "9",
    });
    const currentEur = pricing({
      id: "price-current-eur",
      source: "official_catalog",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      inputRate: "3",
      currency: "EUR",
    });
    const finalization = input({ pricingSnapshots: [futureUsd, currentEur] });

    expect(selectFinalizationPricingSnapshot(finalization)?.id).toBe(currentEur.id);
    expect(buildFinalizedUsageCostRecord(finalization)).toMatchObject({
      amount: "3",
      currency: AnalyticsCurrency.make("EUR"),
    });
  });

  it("uses configured source priority but withholds subscription money for the rule allocator", () => {
    const official = pricing({
      id: "price-official",
      source: "official_catalog",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      inputRate: "9",
    });
    const subscription = pricing({
      id: "price-subscription",
      source: "subscription_plan",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      inputRate: "2",
    });
    const record = buildFinalizedUsageCostRecord(
      input({
        pricingSnapshots: [official, subscription],
        pricingSourcePriority: ["subscription_plan", "official_catalog"],
      }),
    );

    expect(record).toMatchObject({
      pricingSnapshotId: subscription.id,
      amount: null,
      costType: "subscription_attribution",
      calculationMethod: "subscription_backed",
      isSubscriptionBacked: true,
      missingPricingDimensions: ["subscription_attribution_rule"],
    });
    expect(record?.costType).not.toBe("provider_reported");
  });

  it("keeps unconfigured local compute unknown instead of zero", () => {
    const unknown = buildFinalizedUsageCostRecord(input({ isLocalProvider: true }));
    const configured = buildFinalizedUsageCostRecord(
      input({ isLocalProvider: true, localComputeHourlyRate: "2.5" }),
    );

    expect(unknown).toMatchObject({
      amount: null,
      costType: "local_compute_estimate",
      calculationMethod: "unknown",
      sourceKey: `local-compute:${agentRunId}`,
    });
    expect(configured).toMatchObject({
      amount: "2.5",
      costType: "local_compute_estimate",
      calculationMethod: "user_configured_rate",
    });
  });

  it("does not invent a cost record for provisional or unavailable usage", () => {
    expect(buildFinalizedUsageCostRecord(input({ usage: usage("provisional") }))).toBeNull();
    expect(buildFinalizedUsageCostRecord(input({ usage: usage("unknown") }))).toBeNull();
  });

  it("persists an explicit unknown amount when remote pricing is unavailable", () => {
    expect(buildFinalizedUsageCostRecord(input())).toMatchObject({
      amount: null,
      currency: usd,
      costType: "unknown",
      missingPricingDimensions: ["pricing_snapshot"],
    });
  });
});
