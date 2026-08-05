import type {
  AnalyticsConfidence,
  AnalyticsCurrency,
  CostCalculationMethod,
  CostRecord,
  CostType,
  PricingBillingUnit,
  PricingSnapshot,
  UsageRecord,
} from "@t3tools/contracts";

import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumMoneyByCurrency,
  type DecimalMoney,
} from "./DecimalMoney.ts";

export interface CostComponentCalculation {
  readonly dimension: string;
  readonly quantity: string | null;
  readonly rate: string | null;
  readonly billingUnit: PricingBillingUnit;
  readonly subtotal: string | null;
  readonly missing: boolean;
}

export interface CalculatedCost {
  readonly amount: string | null;
  readonly currency: AnalyticsCurrency | null;
  readonly costType: CostType;
  readonly calculationMethod: CostCalculationMethod;
  readonly confidence: AnalyticsConfidence;
  readonly isEstimated: boolean;
  readonly isSubscriptionBacked: boolean;
  readonly pricingSnapshotId: PricingSnapshot["id"] | null;
  readonly calculationBreakdown: ReadonlyArray<CostComponentCalculation>;
  readonly missingPricingDimensions: ReadonlyArray<string>;
}

export interface ProviderReportedCostInput {
  readonly amount: string | null;
  readonly currency: AnalyticsCurrency;
  readonly confidence?: AnalyticsConfidence;
}

export interface UsageCostCalculationInput {
  readonly usage: UsageRecord;
  readonly pricingSnapshots: ReadonlyArray<PricingSnapshot>;
  readonly providerReportedCost?: ProviderReportedCostInput | null;
}

export interface UsageCostCalculationResult {
  readonly providerReported: CalculatedCost | null;
  readonly calculated: CalculatedCost;
}

export interface RunTreeNode {
  readonly runId: string;
  readonly parentRunId: string | null;
}

export interface RunTreeCost {
  readonly runId: string;
  readonly amount: string | null;
  readonly currency: AnalyticsCurrency;
}

export interface RunCostAttribution {
  readonly runId: string;
  readonly exclusive: ReadonlyArray<DecimalMoney>;
  readonly inclusive: ReadonlyArray<DecimalMoney>;
  readonly exclusiveUnknownCount: number;
  readonly inclusiveUnknownCount: number;
  readonly cycleDetected: boolean;
}

export interface RunTreeUsage {
  readonly runId: string;
  readonly totalTokens: number | null;
}

export interface RunUsageAttribution {
  readonly runId: string;
  readonly exclusiveTotalTokens: number | null;
  readonly inclusiveTotalTokens: number | null;
  readonly exclusiveUnknownCount: number;
  readonly inclusiveUnknownCount: number;
  readonly cycleDetected: boolean;
}

const parsedTime = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Selects the latest snapshot whose half-open effective interval contains the usage time. */
export const selectPricingSnapshot = (
  snapshots: ReadonlyArray<PricingSnapshot>,
  input: Pick<UsageRecord, "providerProfileId" | "modelProfileId"> & {
    readonly occurredAt: string;
  },
): PricingSnapshot | null => {
  const occurredAt = parsedTime(input.occurredAt);
  if (occurredAt === null) return null;
  return (
    snapshots
      .filter((snapshot) => {
        if (
          snapshot.providerProfileId !== input.providerProfileId ||
          snapshot.modelProfileId !== input.modelProfileId
        ) {
          return false;
        }
        const effectiveFrom = parsedTime(snapshot.effectiveFrom);
        const effectiveTo = snapshot.effectiveTo === null ? null : parsedTime(snapshot.effectiveTo);
        return (
          effectiveFrom !== null &&
          effectiveFrom <= occurredAt &&
          (snapshot.effectiveTo === null || (effectiveTo !== null && occurredAt < effectiveTo))
        );
      })
      .toSorted(
        (left, right) =>
          right.effectiveFrom.localeCompare(left.effectiveFrom) ||
          right.createdAt.localeCompare(left.createdAt) ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
};

/** Verifies the immutable cost reference against the usage time, not recalculation time. */
export const pricingReferenceIsStale = (
  cost: CostRecord,
  usage: UsageRecord | null,
  pricing: PricingSnapshot | null,
): boolean => {
  if (cost.pricingSnapshotId === null) return false;
  if (usage === null || pricing === null || pricing.id !== cost.pricingSnapshotId) return true;
  if (
    pricing.providerProfileId !== usage.providerProfileId ||
    pricing.modelProfileId !== usage.modelProfileId
  ) {
    return true;
  }
  const occurredAt = parsedTime(usage.completedAt ?? usage.startedAt ?? usage.recordedAt);
  const effectiveFrom = parsedTime(pricing.effectiveFrom);
  const effectiveTo = pricing.effectiveTo === null ? null : parsedTime(pricing.effectiveTo);
  return (
    occurredAt === null ||
    effectiveFrom === null ||
    occurredAt < effectiveFrom ||
    (pricing.effectiveTo !== null && (effectiveTo === null || occurredAt >= effectiveTo))
  );
};

const tokenDivisor = (billingUnit: PricingBillingUnit): string | null => {
  switch (billingUnit) {
    case "per_token":
      return "1";
    case "per_thousand_tokens":
      return "1000";
    case "per_million_tokens":
      return "1000000";
    default:
      return null;
  }
};

const safeExclusiveQuantity = (
  total: number | null,
  nested: number | null,
  nestedRate: string | null,
): number | null => {
  if (total === null || nestedRate === null) return total;
  if (nested === null) return null;
  return Math.max(0, total - nested);
};

const component = (input: {
  readonly dimension: string;
  readonly quantity: number | null;
  readonly rate: string | null;
  readonly billingUnit: PricingBillingUnit;
  readonly divisor: string | null;
}): CostComponentCalculation | null => {
  const quantity = input.quantity === null ? null : input.quantity.toString();
  if (quantity === null && input.rate === null) return null;
  if (quantity === "0") {
    return { ...input, quantity, subtotal: "0", missing: false };
  }
  if (quantity === null || input.rate === null || input.divisor === null) {
    return { ...input, quantity, subtotal: null, missing: true };
  }
  return {
    ...input,
    quantity,
    subtotal: divideDecimal(multiplyDecimal(quantity, input.rate), input.divisor),
    missing: false,
  };
};

const unknownCalculatedCost = (
  currency: AnalyticsCurrency | null,
  missingPricingDimensions: ReadonlyArray<string>,
): CalculatedCost => ({
  amount: null,
  currency,
  costType: "unknown",
  calculationMethod: "unknown",
  confidence: "unknown",
  isEstimated: true,
  isSubscriptionBacked: false,
  pricingSnapshotId: null,
  calculationBreakdown: [],
  missingPricingDimensions,
});

const unavailableCatalogCost = (
  pricing: PricingSnapshot,
  missingPricingDimensions: ReadonlyArray<string>,
): CalculatedCost => {
  const subscriptionBacked = pricing.pricingSource === "subscription_plan";
  return {
    amount: null,
    currency: pricing.currency,
    costType: subscriptionBacked ? "subscription_attribution" : "api_usage",
    calculationMethod:
      pricing.pricingSource === "user_configured"
        ? "user_configured_rate"
        : subscriptionBacked
          ? "subscription_backed"
          : "pricing_catalog_calculated",
    confidence: "unknown",
    isEstimated: true,
    isSubscriptionBacked: subscriptionBacked,
    pricingSnapshotId: pricing.id,
    calculationBreakdown: [],
    missingPricingDimensions,
  };
};

export const calculateCatalogCost = (
  usage: UsageRecord,
  pricing: PricingSnapshot | null,
): CalculatedCost => {
  if (pricing === null) {
    return unknownCalculatedCost(null, ["pricing_snapshot"]);
  }

  if (pricing.pricingSource === "subscription_plan") {
    return unavailableCatalogCost(pricing, ["subscription_attribution_rule"]);
  }

  if (pricing.billingUnit === "per_request") {
    const requestComponent = component({
      dimension: "requests",
      quantity: usage.requestCount,
      rate: pricing.requestRate,
      billingUnit: "per_request",
      divisor: "1",
    });
    if (requestComponent === null || requestComponent.missing) {
      return {
        ...unavailableCatalogCost(pricing, ["requests"]),
        calculationBreakdown: requestComponent === null ? [] : [requestComponent],
      };
    }
    return {
      ...unavailableCatalogCost(pricing, []),
      amount: requestComponent.subtotal,
      confidence: pricing.confidence,
      calculationBreakdown: [requestComponent],
    };
  }

  const divisor = tokenDivisor(pricing.billingUnit);
  if (divisor === null) {
    return unavailableCatalogCost(pricing, [`billing_unit:${pricing.billingUnit}`]);
  }
  const components = [
    component({
      dimension: "input_tokens",
      quantity: safeExclusiveQuantity(
        usage.inputTokens,
        usage.cachedInputTokens,
        pricing.cachedInputRate,
      ),
      rate: pricing.inputTokenRate,
      billingUnit: pricing.billingUnit,
      divisor,
    }),
    pricing.cachedInputRate === null
      ? null
      : component({
          dimension: "cached_input_tokens",
          quantity: usage.cachedInputTokens,
          rate: pricing.cachedInputRate,
          billingUnit: pricing.billingUnit,
          divisor,
        }),
    component({
      dimension: "output_tokens",
      quantity: safeExclusiveQuantity(
        usage.outputTokens,
        usage.reasoningTokens,
        pricing.reasoningTokenRate,
      ),
      rate: pricing.outputTokenRate,
      billingUnit: pricing.billingUnit,
      divisor,
    }),
    pricing.reasoningTokenRate === null
      ? null
      : component({
          dimension: "reasoning_tokens",
          quantity: usage.reasoningTokens,
          rate: pricing.reasoningTokenRate,
          billingUnit: pricing.billingUnit,
          divisor,
        }),
    pricing.cacheWriteRate === null
      ? null
      : component({
          dimension: "cache_write_tokens",
          quantity: usage.cacheWriteTokens,
          rate: pricing.cacheWriteRate,
          billingUnit: pricing.billingUnit,
          divisor,
        }),
    pricing.cacheReadRate === null
      ? null
      : component({
          dimension: "cache_read_tokens",
          quantity: usage.cacheReadTokens,
          rate: pricing.cacheReadRate,
          billingUnit: pricing.billingUnit,
          divisor,
        }),
    pricing.requestRate === null
      ? null
      : component({
          dimension: "requests",
          quantity: usage.requestCount,
          rate: pricing.requestRate,
          billingUnit: "per_request",
          divisor: "1",
        }),
  ].filter((value): value is CostComponentCalculation => value !== null);
  const missingPricingDimensions = components
    .filter(({ missing }) => missing)
    .map(({ dimension }) => dimension);
  const amount =
    missingPricingDimensions.length > 0
      ? null
      : (components
          .map(({ subtotal }) => subtotal)
          .filter((value): value is string => value !== null)
          .reduce(addDecimal, "0") ?? null);
  return {
    amount,
    currency: pricing.currency,
    costType: "api_usage",
    calculationMethod:
      pricing.pricingSource === "user_configured"
        ? "user_configured_rate"
        : "pricing_catalog_calculated",
    confidence: amount === null ? "unknown" : pricing.confidence,
    isEstimated: true,
    isSubscriptionBacked: false,
    pricingSnapshotId: pricing.id,
    calculationBreakdown: components,
    missingPricingDimensions,
  };
};

export const providerReportedCost = (input: ProviderReportedCostInput): CalculatedCost => ({
  amount: input.amount,
  currency: input.currency,
  costType: "provider_reported",
  calculationMethod: "provider_reported",
  confidence: input.amount === null ? "unknown" : (input.confidence ?? "confirmed"),
  isEstimated: false,
  isSubscriptionBacked: false,
  pricingSnapshotId: null,
  calculationBreakdown: [],
  missingPricingDimensions: input.amount === null ? ["provider_reported_amount"] : [],
});

export const calculateUsageCosts = (
  input: UsageCostCalculationInput,
): UsageCostCalculationResult => {
  const occurredAt = input.usage.completedAt ?? input.usage.startedAt ?? input.usage.recordedAt;
  const pricing = selectPricingSnapshot(input.pricingSnapshots, {
    providerProfileId: input.usage.providerProfileId,
    modelProfileId: input.usage.modelProfileId,
    occurredAt,
  });
  return {
    providerReported:
      input.providerReportedCost === null || input.providerReportedCost === undefined
        ? null
        : providerReportedCost(input.providerReportedCost),
    calculated: calculateCatalogCost(input.usage, pricing),
  };
};

/** Local compute is unknown until a user explicitly configures an hourly rate. */
export const calculateLocalComputeCost = (input: {
  readonly activeDurationMilliseconds: number | null;
  readonly hourlyRate: string | null;
  readonly currency: AnalyticsCurrency;
}): CalculatedCost => {
  if (input.activeDurationMilliseconds === null || input.hourlyRate === null) {
    return {
      ...unknownCalculatedCost(input.currency, ["local_compute_hourly_rate_or_duration"]),
      costType: "local_compute_estimate",
    };
  }
  return {
    amount: divideDecimal(
      multiplyDecimal(input.activeDurationMilliseconds.toString(), input.hourlyRate),
      "3600000",
    ),
    currency: input.currency,
    costType: "local_compute_estimate",
    calculationMethod: "user_configured_rate",
    confidence: "medium",
    isEstimated: true,
    isSubscriptionBacked: false,
    pricingSnapshotId: null,
    calculationBreakdown: [],
    missingPricingDimensions: [],
  };
};

const totalsFor = (costs: ReadonlyArray<RunTreeCost>): ReadonlyArray<DecimalMoney> =>
  sumMoneyByCurrency(
    costs.flatMap((cost) =>
      cost.amount === null ? [] : [{ amount: cost.amount, currency: cost.currency }],
    ),
  );

/**
 * Exclusive attribution contains only a run's direct cost. Inclusive attribution
 * adds descendants, but still emits one independent total per currency.
 */
export const attributeRunTreeCosts = (
  nodes: ReadonlyArray<RunTreeNode>,
  costs: ReadonlyArray<RunTreeCost>,
): ReadonlyArray<RunCostAttribution> => {
  const uniqueNodes = new Map<string, RunTreeNode>();
  for (const node of nodes) {
    if (!uniqueNodes.has(node.runId)) uniqueNodes.set(node.runId, node);
  }
  const children = new Map<string, Array<string>>();
  for (const node of uniqueNodes.values()) {
    if (node.parentRunId === null) continue;
    const current = children.get(node.parentRunId) ?? [];
    if (!current.includes(node.runId)) current.push(node.runId);
    children.set(node.parentRunId, current);
  }
  for (const childRunIds of children.values())
    childRunIds.sort((left, right) => left.localeCompare(right));
  const costsByRun = new Map<string, Array<RunTreeCost>>();
  for (const cost of costs) {
    const current = costsByRun.get(cost.runId) ?? [];
    current.push(cost);
    costsByRun.set(cost.runId, current);
  }

  const collect = (
    runId: string,
    path: ReadonlySet<string>,
  ): { readonly costs: ReadonlyArray<RunTreeCost>; readonly cycleDetected: boolean } => {
    if (path.has(runId)) return { costs: [], cycleDetected: true };
    const nextPath = new Set(path).add(runId);
    const descendants = (children.get(runId) ?? []).map((child) => collect(child, nextPath));
    return {
      costs: [
        ...(costsByRun.get(runId) ?? []),
        ...descendants.flatMap(({ costs: value }) => value),
      ],
      cycleDetected: descendants.some(({ cycleDetected }) => cycleDetected),
    };
  };

  return [...uniqueNodes.values()].map((node) => {
    const exclusiveCosts = costsByRun.get(node.runId) ?? [];
    const inclusive = collect(node.runId, new Set());
    return {
      runId: node.runId,
      exclusive: totalsFor(exclusiveCosts),
      inclusive: totalsFor(inclusive.costs),
      exclusiveUnknownCount: exclusiveCosts.filter(({ amount }) => amount === null).length,
      inclusiveUnknownCount: inclusive.costs.filter(({ amount }) => amount === null).length,
      cycleDetected: inclusive.cycleDetected,
    };
  });
};

/** Aggregates normalized usage deltas across the same run tree without counting replayed nodes twice. */
export const attributeRunTreeUsage = (
  nodes: ReadonlyArray<RunTreeNode>,
  usage: ReadonlyArray<RunTreeUsage>,
): ReadonlyArray<RunUsageAttribution> => {
  const uniqueNodes = new Map<string, RunTreeNode>();
  for (const node of nodes) {
    if (!uniqueNodes.has(node.runId)) uniqueNodes.set(node.runId, node);
  }
  const children = new Map<string, Array<string>>();
  for (const node of uniqueNodes.values()) {
    if (node.parentRunId === null) continue;
    const current = children.get(node.parentRunId) ?? [];
    if (!current.includes(node.runId)) current.push(node.runId);
    children.set(node.parentRunId, current);
  }
  for (const childRunIds of children.values()) {
    childRunIds.sort((left, right) => left.localeCompare(right));
  }
  const usageByRun = new Map<string, Array<RunTreeUsage>>();
  for (const record of usage) {
    const current = usageByRun.get(record.runId) ?? [];
    current.push(record);
    usageByRun.set(record.runId, current);
  }
  const collect = (
    runId: string,
    path: ReadonlySet<string>,
  ): { readonly usage: ReadonlyArray<RunTreeUsage>; readonly cycleDetected: boolean } => {
    if (path.has(runId)) return { usage: [], cycleDetected: true };
    const nextPath = new Set(path).add(runId);
    const descendants = (children.get(runId) ?? []).map((child) => collect(child, nextPath));
    return {
      usage: [
        ...(usageByRun.get(runId) ?? []),
        ...descendants.flatMap(({ usage: records }) => records),
      ],
      cycleDetected: descendants.some(({ cycleDetected }) => cycleDetected),
    };
  };
  const total = (records: ReadonlyArray<RunTreeUsage>): number | null => {
    const known = records.flatMap(({ totalTokens }) => (totalTokens === null ? [] : [totalTokens]));
    return known.length === 0 ? null : known.reduce((sum, tokens) => sum + tokens, 0);
  };

  return [...uniqueNodes.values()].map((node) => {
    const exclusive = usageByRun.get(node.runId) ?? [];
    const inclusive = collect(node.runId, new Set());
    return {
      runId: node.runId,
      exclusiveTotalTokens: total(exclusive),
      inclusiveTotalTokens: total(inclusive.usage),
      exclusiveUnknownCount: exclusive.filter(({ totalTokens }) => totalTokens === null).length,
      inclusiveUnknownCount: inclusive.usage.filter(({ totalTokens }) => totalTokens === null)
        .length,
      cycleDetected: inclusive.cycleDetected,
    };
  });
};

/** Remaining headroom is useful to both budget and forecast callers without number coercion. */
export const remainingAmount = (limit: string, current: string): string =>
  compareDecimal(current, limit) >= 0 ? "0" : subtractDecimal(limit, current);
