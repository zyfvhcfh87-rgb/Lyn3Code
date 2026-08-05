import {
  ANALYTICS_METRIC_VERSION,
  type AnalyticsConfidence,
  type MissionOutcomeRecord,
  type RunPerformanceRecord,
  type TaskOutcomeRecord,
} from "@t3tools/contracts";

import { divideDecimal, sumMoneyByCurrency, type DecimalMoney } from "./DecimalMoney.ts";

export const PROVIDER_FAILURE_RATE_KEY = "provider_failure_rate" as const;

export type CanonicalMetricKey =
  | "cost_per_verified_task_implementation"
  | "cost_per_verified_task_inclusive"
  | "cost_per_merged_mission"
  | "first_pass_verification_rate"
  | "repair_rate"
  | "human_acceptance_rate"
  | typeof PROVIDER_FAILURE_RATE_KEY
  | "fallback_rate_per_started_run";

export interface MetricDefinition {
  readonly key: CanonicalMetricKey;
  readonly version: typeof ANALYTICS_METRIC_VERSION;
  readonly unit: "currency_per_outcome" | "ratio";
  readonly numerator: string;
  readonly denominator: string;
}

export interface CalculatedMetric {
  readonly value: string | null;
  readonly unit: string;
  readonly confidence: AnalyticsConfidence;
  readonly sampleSize: number;
  readonly missingCount: number;
  readonly estimatedCount: number;
  readonly numeratorCount: number;
  readonly denominatorCount: number;
}

export interface CostPerOutcomeMetric {
  readonly currency: DecimalMoney["currency"];
  readonly value: string | null;
  readonly outcomeCount: number;
  readonly missingCostCount: number;
}

/** Meanings are append-only: changing a numerator or denominator requires version 2. */
export const METRIC_CATALOGUE_V1: ReadonlyArray<MetricDefinition> = [
  {
    key: "cost_per_verified_task_implementation",
    version: ANALYTICS_METRIC_VERSION,
    unit: "currency_per_outcome",
    numerator: "Known direct implementation-run cost attributed to verified tasks, by currency.",
    denominator: "Tasks whose final verification result is passed or passed_with_warnings.",
  },
  {
    key: "cost_per_verified_task_inclusive",
    version: ANALYTICS_METRIC_VERSION,
    unit: "currency_per_outcome",
    numerator: "Known inclusive root-run cost, including descendant runs, for verified tasks.",
    denominator: "Tasks whose final verification result is passed or passed_with_warnings.",
  },
  {
    key: "cost_per_merged_mission",
    version: ANALYTICS_METRIC_VERSION,
    unit: "currency_per_outcome",
    numerator: "Known mission-attributed cost for merged missions, by currency.",
    denominator: "Mission outcomes with pullRequestMerged equal to true.",
  },
  {
    key: "first_pass_verification_rate",
    version: ANALYTICS_METRIC_VERSION,
    unit: "ratio",
    numerator: "Observable task outcomes whose firstPassVerification is true.",
    denominator: "Task outcomes whose firstPassVerification is not null.",
  },
  {
    key: "repair_rate",
    version: ANALYTICS_METRIC_VERSION,
    unit: "ratio",
    numerator: "Observable first-pass task outcomes with one or more repair attempts.",
    denominator: "Task outcomes whose firstPassVerification is not null.",
  },
  {
    key: "human_acceptance_rate",
    version: ANALYTICS_METRIC_VERSION,
    unit: "ratio",
    numerator: "Reviewed task outcomes accepted with or without edits.",
    denominator:
      "Task outcomes with accepted, accepted_with_edits, rejected, or abandoned disposition.",
  },
  {
    key: PROVIDER_FAILURE_RATE_KEY,
    version: ANALYTICS_METRIC_VERSION,
    unit: "ratio",
    numerator: "Finalized runs whose completion category is failed_provider or failed_transport.",
    denominator: "All finalized started runs, including unknown completion categories.",
  },
  {
    key: "fallback_rate_per_started_run",
    version: ANALYTICS_METRIC_VERSION,
    unit: "ratio",
    numerator: "Started runs with fallbackCount above zero or fallback_superseded completion.",
    denominator: "Run performance records whose status progressed beyond queued.",
  },
];

export const metricDefinition = (key: CanonicalMetricKey): MetricDefinition => {
  const definition = METRIC_CATALOGUE_V1.find((candidate) => candidate.key === key);
  if (definition === undefined) throw new RangeError(`Unknown v1 analytics metric: ${key}`);
  return definition;
};

const ratioMetric = (input: {
  readonly numerator: number;
  readonly denominator: number;
  readonly missing: number;
}): CalculatedMetric => ({
  value:
    input.denominator === 0
      ? null
      : divideDecimal(input.numerator.toString(), input.denominator.toString()),
  unit: "ratio",
  confidence: input.denominator === 0 ? "unknown" : input.missing === 0 ? "confirmed" : "medium",
  sampleSize: input.denominator,
  missingCount: input.missing,
  estimatedCount: 0,
  numeratorCount: input.numerator,
  denominatorCount: input.denominator,
});

export const calculateFirstPassVerificationRate = (
  outcomes: ReadonlyArray<TaskOutcomeRecord>,
): CalculatedMetric => {
  const observable = outcomes.filter(({ firstPassVerification }) => firstPassVerification !== null);
  return ratioMetric({
    numerator: observable.filter(({ firstPassVerification }) => firstPassVerification === true)
      .length,
    denominator: observable.length,
    missing: outcomes.length - observable.length,
  });
};

export const calculateRepairRate = (
  outcomes: ReadonlyArray<TaskOutcomeRecord>,
): CalculatedMetric => {
  const observable = outcomes.filter(({ firstPassVerification }) => firstPassVerification !== null);
  return ratioMetric({
    numerator: observable.filter(({ repairAttemptCount }) => repairAttemptCount > 0).length,
    denominator: observable.length,
    missing: outcomes.length - observable.length,
  });
};

export const calculateHumanAcceptanceRate = (
  outcomes: ReadonlyArray<TaskOutcomeRecord>,
): CalculatedMetric => {
  const reviewed = outcomes.filter(({ humanDisposition }) =>
    ["accepted", "accepted_with_edits", "rejected", "abandoned"].includes(humanDisposition),
  );
  return ratioMetric({
    numerator: reviewed.filter(({ humanDisposition }) =>
      ["accepted", "accepted_with_edits"].includes(humanDisposition),
    ).length,
    denominator: reviewed.length,
    missing: outcomes.length - reviewed.length,
  });
};

export const calculateProviderFailureRate = (
  runs: ReadonlyArray<RunPerformanceRecord>,
): CalculatedMetric => {
  const finalized = runs.filter(({ status }) => status === "finalized");
  return ratioMetric({
    numerator: finalized.filter(
      ({ completionCategory }) =>
        completionCategory === "failed_provider" || completionCategory === "failed_transport",
    ).length,
    denominator: finalized.length,
    missing: runs.length - finalized.length,
  });
};

export const calculateFallbackRate = (
  runs: ReadonlyArray<RunPerformanceRecord>,
): CalculatedMetric => {
  const started = runs.filter(({ status }) => status !== "queued");
  return ratioMetric({
    numerator: started.filter(
      ({ fallbackCount, completionCategory }) =>
        fallbackCount > 0 || completionCategory === "fallback_superseded",
    ).length,
    denominator: started.length,
    missing: runs.length - started.length,
  });
};

export const countVerifiedTasks = (outcomes: ReadonlyArray<TaskOutcomeRecord>): number =>
  outcomes.filter(
    ({ verificationResult }) =>
      verificationResult === "passed" || verificationResult === "passed_with_warnings",
  ).length;

export const countMergedMissions = (outcomes: ReadonlyArray<MissionOutcomeRecord>): number =>
  outcomes.filter(({ pullRequestMerged }) => pullRequestMerged).length;

/**
 * Calculates independent per-currency values. Unknown amounts are counted and
 * never replaced with zero; consumers can therefore withhold incomplete metrics.
 */
export const calculateCostPerOutcome = (
  costs: ReadonlyArray<DecimalMoney | null>,
  outcomeCount: number,
): ReadonlyArray<CostPerOutcomeMetric> => {
  const totals = sumMoneyByCurrency(costs.filter((cost): cost is DecimalMoney => cost !== null));
  const missingCostCount = costs.filter((cost) => cost === null).length;
  return totals.map(({ currency, amount }) => ({
    currency,
    value: outcomeCount === 0 ? null : divideDecimal(amount, outcomeCount.toString()),
    outcomeCount,
    missingCostCount,
  }));
};
