import * as NodeCrypto from "node:crypto";

import {
  CostRecord,
  CostRecordId,
  type AnalyticsSettings,
  type RunPerformanceRecord,
  type SubscriptionAttributionRule,
  type UsageRecord,
} from "@t3tools/contracts";

import { addDecimal, divideDecimal, multiplyDecimal, subtractDecimal } from "./DecimalMoney.ts";

interface RunBasis {
  readonly usage: UsageRecord;
  readonly tokenCount: number | null;
  readonly activeMilliseconds: number | null;
}

export interface SubscriptionAttributionResult {
  readonly status: "allocated" | "disabled" | "withheld";
  readonly revision: string;
  readonly records: ReadonlyArray<CostRecord>;
  readonly withheldReason: string | null;
}

const occurredAt = (usage: UsageRecord): string =>
  usage.completedAt ?? usage.startedAt ?? usage.recordedAt;

const hash = (value: string): string => NodeCrypto.createHash("sha256").update(value).digest("hex");

const eligibleRuns = (input: {
  readonly rule: SubscriptionAttributionRule;
  readonly usage: ReadonlyArray<UsageRecord>;
  readonly performance: ReadonlyArray<RunPerformanceRecord>;
}): ReadonlyArray<RunBasis> => {
  const performanceByRun = new Map<string, RunPerformanceRecord>(
    input.performance.map((row) => [row.agentRunId, row]),
  );
  const grouped = new Map<string, Array<UsageRecord>>();
  for (const usage of input.usage) {
    const timestamp = occurredAt(usage);
    if (
      usage.state === "provisional" ||
      usage.providerProfileId !== input.rule.providerProfileId ||
      (input.rule.modelProfileId !== null && usage.modelProfileId !== input.rule.modelProfileId) ||
      timestamp < input.rule.periodStart ||
      timestamp >= input.rule.periodEnd
    ) {
      continue;
    }
    const rows = grouped.get(usage.agentRunId) ?? [];
    rows.push(usage);
    grouped.set(usage.agentRunId, rows);
  }
  return [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([agentRunId, rows]) => ({
      usage: rows.toSorted((left, right) => occurredAt(left).localeCompare(occurredAt(right)))[0]!,
      tokenCount: rows.some(({ totalTokens }) => totalTokens === null)
        ? null
        : rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0),
      activeMilliseconds: performanceByRun.get(agentRunId)?.activeDurationMilliseconds ?? null,
    }));
};

const basisFor = (
  rule: SubscriptionAttributionRule,
  run: RunBasis,
): { readonly quantity: number | null; readonly divisor: string } => {
  switch (rule.mode) {
    case "flat_monthly_by_runs":
      return { quantity: 1, divisor: "1" };
    case "flat_monthly_by_tokens":
      return { quantity: run.tokenCount, divisor: "1" };
    case "flat_monthly_by_active_time":
      return { quantity: run.activeMilliseconds, divisor: "1" };
    case "manual_fixed_internal_rate":
      switch (rule.fixedRateUnit) {
        case "per_run":
          return { quantity: 1, divisor: "1" };
        case "per_million_tokens":
          return { quantity: run.tokenCount, divisor: "1000000" };
        case "per_active_hour":
          return { quantity: run.activeMilliseconds, divisor: "3600000" };
        case null:
          return { quantity: null, divisor: "1" };
      }
  }
};

const revisionFor = (
  rule: SubscriptionAttributionRule,
  runs: ReadonlyArray<RunBasis>,
  reason: string | null,
): string =>
  hash(
    JSON.stringify({
      rule,
      reason,
      runs: runs.map(({ usage, tokenCount, activeMilliseconds }) => ({
        runId: usage.agentRunId,
        usageIds: usage.id,
        tokenCount,
        activeMilliseconds,
      })),
    }),
  );

const costRecord = (input: {
  readonly rule: SubscriptionAttributionRule;
  readonly run: RunBasis;
  readonly revision: string;
  readonly amount: string | null;
  readonly quantity: number | null;
  readonly missingReason: string | null;
}): CostRecord => {
  const identity = hash(`${input.rule.id}|${input.revision}|${input.run.usage.agentRunId}`);
  const rate =
    input.rule.mode === "manual_fixed_internal_rate"
      ? input.rule.fixedInternalRate
      : input.rule.monthlyAmount;
  return CostRecord.make({
    id: CostRecordId.make(`subscription-allocation:${identity}`),
    sourceKey: `subscription-accounting-allocation:${identity}`,
    usageRecordId: null,
    agentRunId: input.run.usage.agentRunId,
    projectId: input.run.usage.projectId,
    missionId: input.run.usage.missionId,
    taskId: input.run.usage.taskId,
    providerProfileId: input.run.usage.providerProfileId,
    modelProfileId: input.run.usage.modelProfileId,
    pricingSnapshotId: null,
    amount: input.amount,
    currency: input.rule.currency,
    costType: "subscription_attribution",
    calculationMethod:
      input.rule.mode === "manual_fixed_internal_rate"
        ? "user_configured_rate"
        : "subscription_backed",
    confidence: input.amount === null ? "unknown" : "medium",
    isEstimated: true,
    isSubscriptionBacked: true,
    calculationBreakdown: [
      {
        dimension: `subscription_accounting_allocation:${input.rule.mode}`,
        quantity: input.quantity === null ? null : input.quantity.toString(),
        rate,
        billingUnit: input.rule.mode === "manual_fixed_internal_rate" ? "custom" : "flat_period",
        subtotal: input.amount,
        missing: input.amount === null,
      },
    ],
    missingPricingDimensions: input.missingReason === null ? [] : [input.missingReason],
    createdAt: input.rule.periodStart,
  });
};

/**
 * Allocates explicit user-configured subscription money. Flat-plan modes wait for a
 * closed period so a partial denominator cannot create misleading accounting values.
 */
export const allocateSubscriptionCosts = (input: {
  readonly rule: SubscriptionAttributionRule;
  readonly configuredMode: AnalyticsSettings["subscriptionAttributionMode"];
  readonly usage: ReadonlyArray<UsageRecord>;
  readonly performance: ReadonlyArray<RunPerformanceRecord>;
  readonly calculatedAt: string;
}): SubscriptionAttributionResult => {
  const runs = eligibleRuns(input);
  if (input.configuredMode === "none" || input.configuredMode !== input.rule.mode) {
    return {
      status: "disabled",
      revision: revisionFor(input.rule, runs, "subscription_attribution_disabled"),
      records: [],
      withheldReason: "subscription_attribution_disabled",
    };
  }
  if (runs.length === 0) {
    return {
      status: "withheld",
      revision: revisionFor(input.rule, runs, "subscription_period_has_no_activity"),
      records: [],
      withheldReason: "subscription_period_has_no_activity",
    };
  }

  const flatMode = input.rule.mode !== "manual_fixed_internal_rate";
  const periodOpen = input.calculatedAt < input.rule.periodEnd;
  const bases = runs.map((run) => ({ run, ...basisFor(input.rule, run) }));
  const missingBasis = bases.some(({ quantity }) => quantity === null);
  const totalUnits = bases.reduce((total, { quantity }) => total + (quantity ?? 0), 0);
  const withheldReason =
    periodOpen && flatMode
      ? "subscription_period_open"
      : missingBasis
        ? "subscription_allocation_basis_incomplete"
        : totalUnits <= 0
          ? "subscription_allocation_denominator_zero"
          : null;
  const revision = revisionFor(input.rule, runs, withheldReason);
  if (withheldReason !== null) {
    return {
      status: "withheld",
      revision,
      records: bases.map(({ run, quantity }) =>
        costRecord({
          rule: input.rule,
          run,
          revision,
          amount: null,
          quantity,
          missingReason: withheldReason,
        }),
      ),
      withheldReason,
    };
  }

  const amounts: Array<string> = [];
  if (flatMode) {
    let allocated = "0";
    for (const [index, { quantity }] of bases.entries()) {
      const amount =
        index === bases.length - 1
          ? subtractDecimal(input.rule.monthlyAmount!, allocated)
          : divideDecimal(
              multiplyDecimal(input.rule.monthlyAmount!, (quantity ?? 0).toString()),
              totalUnits.toString(),
            );
      amounts.push(amount);
      allocated = addDecimal(allocated, amount);
    }
  } else {
    for (const { quantity, divisor } of bases) {
      amounts.push(
        divideDecimal(
          multiplyDecimal(input.rule.fixedInternalRate!, (quantity ?? 0).toString()),
          divisor,
        ),
      );
    }
  }

  return {
    status: "allocated",
    revision,
    records: bases.map(({ run, quantity }, index) =>
      costRecord({
        rule: input.rule,
        run,
        revision,
        amount: amounts[index]!,
        quantity,
        missingReason: null,
      }),
    ),
    withheldReason: null,
  };
};
