import {
  AgentRunId,
  AnalyticsCurrency,
  CostRecord,
  CostRecordId,
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
  attributeRunTreeCosts,
  attributeRunTreeUsage,
  calculateCatalogCost,
  calculateLocalComputeCost,
  calculateUsageCosts,
  pricingReferenceIsStale,
  selectPricingSnapshot,
} from "./CostCalculator.ts";

const now = "2026-01-15T00:00:00.000Z";
const providerProfileId = ProviderProfileId.make("provider-cost");
const modelProfileId = ModelProfileId.make("model-cost");
const usd = AnalyticsCurrency.make("USD");

const usage = UsageRecord.make({
  id: UsageRecordId.make("usage-cost"),
  sourceEventId: "event-cost",
  sourceTurnId: null,
  projectId: ProjectId.make("project-cost"),
  missionId: null,
  taskId: null,
  agentRunId: AgentRunId.make("run-cost"),
  parentAgentRunId: null,
  routingDecisionId: null,
  providerProfileId,
  modelProfileId,
  capabilitySnapshotId: null,
  providerRequestId: null,
  providerResponseId: null,
  usageSource: "provider_reported",
  usageConfidence: "confirmed",
  state: "final",
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  reasoningTokens: null,
  cachedInputTokens: 200_000,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  totalTokens: 1_500_000,
  requestCount: 1,
  toolCallCount: 0,
  providerRoundTripCount: 1,
  startedAt: now,
  completedAt: now,
  recordedAt: now,
  reconciledAt: null,
});

const pricing = (input: {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly inputTokenRate: string;
}) =>
  PricingSnapshot.make({
    id: PricingSnapshotId.make(input.id),
    providerProfileId,
    modelProfileId,
    currency: usd,
    pricingSource: "official_catalog",
    pricingVersion: input.id,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    inputTokenRate: input.inputTokenRate,
    outputTokenRate: "4",
    reasoningTokenRate: null,
    cachedInputRate: "1",
    cacheWriteRate: null,
    cacheReadRate: null,
    requestRate: "0.5",
    toolRateMetadata: {},
    billingUnit: "per_million_tokens",
    confidence: "confirmed",
    metadata: {},
    createdAt: input.effectiveFrom,
  });

describe("CostCalculator", () => {
  it("selects historical pricing by half-open effective interval", () => {
    const oldPrice = pricing({
      id: "pricing-old",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-02-01T00:00:00.000Z",
      inputTokenRate: "2",
    });
    const newPrice = pricing({
      id: "pricing-new",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      effectiveTo: null,
      inputTokenRate: "3",
    });

    expect(
      selectPricingSnapshot([newPrice, oldPrice], {
        providerProfileId,
        modelProfileId,
        occurredAt: "2026-01-31T23:59:59.999Z",
      })?.id,
    ).toBe(oldPrice.id);
    expect(
      selectPricingSnapshot([oldPrice, newPrice], {
        providerProfileId,
        modelProfileId,
        occurredAt: "2026-02-01T00:00:00.000Z",
      })?.id,
    ).toBe(newPrice.id);
  });

  it("validates historical pricing against usage time instead of calculation time", () => {
    const oldPrice = pricing({
      id: "pricing-historical",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-02-01T00:00:00.000Z",
      inputTokenRate: "2",
    });
    const cost = CostRecord.make({
      id: CostRecordId.make("cost-historical"),
      sourceKey: "usage-cost:calculated",
      usageRecordId: usage.id,
      agentRunId: usage.agentRunId,
      projectId: usage.projectId,
      missionId: null,
      taskId: null,
      providerProfileId,
      modelProfileId,
      pricingSnapshotId: oldPrice.id,
      amount: "4.3",
      currency: usd,
      costType: "api_usage",
      calculationMethod: "pricing_catalog_calculated",
      confidence: "confirmed",
      isEstimated: true,
      isSubscriptionBacked: false,
      calculationBreakdown: [],
      missingPricingDimensions: [],
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    expect(pricingReferenceIsStale(cost, usage, oldPrice)).toBe(false);
    expect(pricingReferenceIsStale(cost, null, oldPrice)).toBe(true);
  });

  it("calculates exact catalogue cost while keeping provider cost separate", () => {
    const snapshot = pricing({
      id: "pricing-calc",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      inputTokenRate: "2",
    });
    expect(calculateCatalogCost(usage, snapshot).amount).toBe("4.3");

    const result = calculateUsageCosts({
      usage,
      pricingSnapshots: [snapshot],
      providerReportedCost: { amount: "4.1", currency: usd },
    });
    expect(result.providerReported?.amount).toBe("4.1");
    expect(result.providerReported?.costType).toBe("provider_reported");
    expect(result.calculated.amount).toBe("4.3");
    expect(result.calculated.costType).toBe("api_usage");
  });

  it("prices per-request snapshots without treating token rates as request rates", () => {
    const snapshot = PricingSnapshot.make({
      ...pricing({
        id: "pricing-request",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputTokenRate: "999",
      }),
      billingUnit: "per_request",
      requestRate: "2.5",
    });

    expect(calculateCatalogCost(usage, snapshot)).toMatchObject({
      amount: "2.5",
      costType: "api_usage",
      missingPricingDimensions: [],
      calculationBreakdown: [{ dimension: "requests", quantity: "1", subtotal: "2.5" }],
    });
  });

  it("withholds subscription snapshot money until an explicit attribution rule runs", () => {
    const snapshot = PricingSnapshot.make({
      ...pricing({
        id: "pricing-flat-subscription",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputTokenRate: "25",
      }),
      pricingSource: "subscription_plan",
      billingUnit: "flat_period",
    });

    expect(calculateCatalogCost(usage, snapshot)).toMatchObject({
      amount: null,
      costType: "subscription_attribution",
      calculationMethod: "subscription_backed",
      isSubscriptionBacked: true,
      pricingSnapshotId: snapshot.id,
      missingPricingDimensions: ["subscription_attribution_rule"],
    });
  });

  it("returns unknown for an unconfigured local rate", () => {
    expect(
      calculateLocalComputeCost({
        activeDurationMilliseconds: 3_600_000,
        hourlyRate: null,
        currency: usd,
      }).amount,
    ).toBeNull();
    expect(
      calculateLocalComputeCost({
        activeDurationMilliseconds: 1_800_000,
        hourlyRate: "2.5",
        currency: usd,
      }).amount,
    ).toBe("1.25");
  });

  it("attributes exclusive and inclusive run-tree cost without mixing currencies", () => {
    const eur = AnalyticsCurrency.make("EUR");
    const attribution = attributeRunTreeCosts(
      [
        { runId: "root", parentRunId: null },
        { runId: "child", parentRunId: "root" },
      ],
      [
        { runId: "root", amount: "1", currency: usd },
        { runId: "child", amount: "2", currency: usd },
        { runId: "child", amount: "3", currency: eur },
        { runId: "child", amount: null, currency: usd },
      ],
    );
    const root = attribution.find(({ runId }) => runId === "root")!;

    expect(root.exclusive).toEqual([{ amount: "1", currency: usd }]);
    expect(root.inclusive).toEqual([
      { amount: "3", currency: eur },
      { amount: "3", currency: usd },
    ]);
    expect(root.inclusiveUnknownCount).toBe(1);
  });

  it("sums one coordinator and two subagents exactly once", () => {
    const attribution = attributeRunTreeCosts(
      [
        { runId: "coordinator", parentRunId: null },
        { runId: "subagent-one", parentRunId: "coordinator" },
        { runId: "subagent-two", parentRunId: "coordinator" },
        // Replayed relationship rows must not duplicate a descendant.
        { runId: "subagent-two", parentRunId: "coordinator" },
      ],
      [
        { runId: "coordinator", amount: "1", currency: usd },
        { runId: "subagent-one", amount: "2", currency: usd },
        { runId: "subagent-two", amount: "3", currency: usd },
      ],
    );

    expect(attribution).toHaveLength(3);
    expect(attribution.find(({ runId }) => runId === "coordinator")).toMatchObject({
      exclusive: [{ amount: "1", currency: usd }],
      inclusive: [{ amount: "6", currency: usd }],
      exclusiveUnknownCount: 0,
      inclusiveUnknownCount: 0,
      cycleDetected: false,
    });
    expect(attribution.find(({ runId }) => runId === "subagent-one")).toMatchObject({
      exclusive: [{ amount: "2", currency: usd }],
      inclusive: [{ amount: "2", currency: usd }],
    });
    expect(attribution.find(({ runId }) => runId === "subagent-two")).toMatchObject({
      exclusive: [{ amount: "3", currency: usd }],
      inclusive: [{ amount: "3", currency: usd }],
    });

    const usageAttribution = attributeRunTreeUsage(
      [
        { runId: "coordinator", parentRunId: null },
        { runId: "subagent-one", parentRunId: "coordinator" },
        { runId: "subagent-two", parentRunId: "coordinator" },
        { runId: "subagent-two", parentRunId: "coordinator" },
      ],
      [
        { runId: "coordinator", totalTokens: 100 },
        { runId: "subagent-one", totalTokens: 200 },
        { runId: "subagent-two", totalTokens: 300 },
      ],
    );
    expect(usageAttribution).toHaveLength(3);
    expect(usageAttribution.find(({ runId }) => runId === "coordinator")).toMatchObject({
      exclusiveTotalTokens: 100,
      inclusiveTotalTokens: 600,
      exclusiveUnknownCount: 0,
      inclusiveUnknownCount: 0,
      cycleDetected: false,
    });
  });
});
