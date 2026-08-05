import {
  CostRecord,
  CostRecordId,
  type AnalyticsCurrency,
  type AnalyticsSettings,
  type PricingSnapshot,
  type PricingSource,
  type UsageRecord,
} from "@t3tools/contracts";

import {
  calculateCatalogCost,
  calculateLocalComputeCost,
  selectPricingSnapshot,
} from "./CostCalculator.ts";

export interface UsageCostFinalizationInput {
  readonly usage: UsageRecord;
  readonly pricingSnapshots: ReadonlyArray<PricingSnapshot>;
  readonly pricingSourcePriority: AnalyticsSettings["pricingSourcePriority"];
  readonly defaultReportingCurrency: AnalyticsCurrency;
  readonly localComputeHourlyRate: string | null;
  readonly isLocalProvider: boolean;
  readonly activeDurationMilliseconds: number | null;
}

const occurredAtFor = (usage: UsageRecord): string =>
  usage.completedAt ?? usage.startedAt ?? usage.recordedAt;

const sourceRank = (source: PricingSource, priority: ReadonlyArray<PricingSource>): number => {
  const index = priority.indexOf(source);
  return index === -1 ? priority.length : index;
};

export const selectFinalizationPricingSnapshot = (
  input: UsageCostFinalizationInput,
): PricingSnapshot | null => {
  const occurredAt = occurredAtFor(input.usage);
  const candidates = input.pricingSnapshots.filter(
    (snapshot) =>
      snapshot.providerProfileId === input.usage.providerProfileId &&
      snapshot.modelProfileId === input.usage.modelProfileId,
  );
  const defaultCurrencyCandidates = candidates.filter(
    ({ currency }) => currency === input.defaultReportingCurrency,
  );
  const selectFrom = (pool: ReadonlyArray<PricingSnapshot>): PricingSnapshot | null => {
    const sources = [...new Set(pool.map(({ pricingSource }) => pricingSource))].toSorted(
      (left, right) =>
        sourceRank(left, input.pricingSourcePriority) -
          sourceRank(right, input.pricingSourcePriority) || left.localeCompare(right),
    );
    for (const source of sources) {
      const snapshot = selectPricingSnapshot(
        pool.filter(({ pricingSource }) => pricingSource === source),
        {
          providerProfileId: input.usage.providerProfileId,
          modelProfileId: input.usage.modelProfileId,
          occurredAt,
        },
      );
      if (snapshot !== null) return snapshot;
    }
    return null;
  };
  return selectFrom(defaultCurrencyCandidates) ?? selectFrom(candidates);
};

const hasObservableUsage = (usage: UsageRecord): boolean =>
  [
    usage.inputTokens,
    usage.outputTokens,
    usage.reasoningTokens,
    usage.cachedInputTokens,
    usage.cacheWriteTokens,
    usage.cacheReadTokens,
    usage.totalTokens,
    usage.requestCount,
  ].some((value) => value !== null);

/**
 * Builds the one immutable calculated cost attributable to finalized usage.
 * Provider-reported cost is deliberately not an input: it remains a separate lane.
 */
export const buildFinalizedUsageCostRecord = (
  input: UsageCostFinalizationInput,
): CostRecord | null => {
  if (
    (input.usage.state !== "final" && input.usage.state !== "reconciled") ||
    !hasObservableUsage(input.usage)
  ) {
    return null;
  }

  const pricing = selectFinalizationPricingSnapshot(input);
  const localFallback = pricing === null && input.isLocalProvider;
  const calculated =
    pricing !== null
      ? calculateCatalogCost(input.usage, pricing)
      : localFallback
        ? calculateLocalComputeCost({
            activeDurationMilliseconds: input.activeDurationMilliseconds,
            hourlyRate: input.localComputeHourlyRate,
            currency: input.defaultReportingCurrency,
          })
        : calculateCatalogCost(input.usage, null);
  const sourceKey = localFallback
    ? `local-compute:${input.usage.agentRunId}`
    : `calculated-usage:${input.usage.id}`;
  const id = CostRecordId.make(`cost:${sourceKey}`);

  return CostRecord.make({
    id,
    sourceKey,
    usageRecordId: input.usage.id,
    agentRunId: input.usage.agentRunId,
    projectId: input.usage.projectId,
    missionId: input.usage.missionId,
    taskId: input.usage.taskId,
    providerProfileId: input.usage.providerProfileId,
    modelProfileId: input.usage.modelProfileId,
    pricingSnapshotId: calculated.pricingSnapshotId,
    amount: calculated.amount,
    currency: calculated.currency ?? input.defaultReportingCurrency,
    costType: calculated.costType,
    calculationMethod: calculated.calculationMethod,
    confidence: calculated.confidence,
    isEstimated: calculated.isEstimated,
    isSubscriptionBacked: calculated.isSubscriptionBacked,
    calculationBreakdown: calculated.calculationBreakdown.flatMap((component) =>
      component.quantity === null
        ? []
        : [
            {
              dimension: component.dimension,
              quantity: component.quantity,
              rate: component.rate,
              billingUnit: component.billingUnit,
              subtotal: component.subtotal,
              missing: component.missing,
            },
          ],
    ),
    missingPricingDimensions: calculated.missingPricingDimensions,
    createdAt: input.usage.completedAt ?? input.usage.recordedAt,
  });
};
