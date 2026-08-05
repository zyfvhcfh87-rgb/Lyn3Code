import {
  AnalyticsForecast,
  type AnalyticsConfidence,
  type AnalyticsCurrency,
  type AnalyticsForecastMethod,
} from "@t3tools/contracts";

import { divideDecimal, multiplyDecimal, sumDecimals } from "./DecimalMoney.ts";

export interface ForecastObservation {
  readonly value: string | null;
  readonly observedAt: string;
  readonly estimated: boolean;
  readonly currency?: AnalyticsCurrency | null;
}

export interface ForecastInput {
  readonly metricKey: AnalyticsForecast["metricKey"];
  readonly unit: AnalyticsForecast["unit"];
  readonly method: AnalyticsForecastMethod;
  readonly observationStart: AnalyticsForecast["observationStart"];
  readonly observationEnd: AnalyticsForecast["observationEnd"];
  readonly asOf: string;
  readonly observations: ReadonlyArray<ForecastObservation>;
  readonly scheduledValues?: ReadonlyArray<ForecastObservation>;
  readonly minimumSampleSize: number;
  /** Required to turn a trailing per-observation average into a period total. */
  readonly expectedSampleCount?: number | null;
}

interface ForecastCalculation {
  readonly value: string | null;
  readonly withheldReason: string | null;
  readonly methodDetail: string;
}

const timestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const observedCurrencies = (
  observations: ReadonlyArray<ForecastObservation>,
): ReadonlyArray<AnalyticsCurrency> =>
  [
    ...new Set(
      observations.flatMap(({ currency, value }) =>
        value !== null && currency !== null && currency !== undefined ? [currency] : [],
      ),
    ),
  ].toSorted();

const calculateCurrentPeriodRunRate = (input: {
  readonly total: string;
  readonly observationStart: number;
  readonly observationEnd: number;
  readonly asOf: number;
}): ForecastCalculation => {
  const observedUntil = Math.min(input.asOf, input.observationEnd);
  const elapsed = observedUntil - input.observationStart;
  const period = input.observationEnd - input.observationStart;
  if (elapsed <= 0 || period <= 0) {
    return {
      value: null,
      withheldReason: "The forecast period has not begun or has an invalid duration.",
      methodDetail: "Run-rate extrapolation was not possible.",
    };
  }
  return {
    value: divideDecimal(multiplyDecimal(input.total, period.toString()), elapsed.toString()),
    withheldReason: null,
    methodDetail: `Run-rate extrapolation uses ${elapsed} of ${period} elapsed milliseconds.`,
  };
};

const calculateTrailingAverage = (input: {
  readonly total: string;
  readonly sampleSize: number;
  readonly expectedSampleCount: number | null;
}): ForecastCalculation => {
  if (input.expectedSampleCount === null || input.expectedSampleCount <= 0) {
    return {
      value: null,
      withheldReason: "Trailing-average forecasting requires a positive expected sample count.",
      methodDetail: "No expected period volume was configured.",
    };
  }
  return {
    value: divideDecimal(
      multiplyDecimal(input.total, input.expectedSampleCount.toString()),
      input.sampleSize.toString(),
    ),
    withheldReason: null,
    methodDetail: `Trailing average from ${input.sampleSize} observations scaled to ${input.expectedSampleCount} expected observations.`,
  };
};

const confidenceFor = (input: {
  readonly withheld: boolean;
  readonly completeness: number;
  readonly includesEstimated: boolean;
  readonly sampleSize: number;
  readonly minimumSampleSize: number;
}): AnalyticsConfidence => {
  if (input.withheld) return "unknown";
  if (
    input.completeness === 1 &&
    !input.includesEstimated &&
    input.sampleSize >= input.minimumSampleSize * 2
  ) {
    return "high";
  }
  if (input.completeness >= 0.75 && input.sampleSize >= input.minimumSampleSize) return "medium";
  return "low";
};

/**
 * Forecasts only when the method's inputs and the configured minimum sample are
 * satisfied. Every withholding decision is returned as user-visible evidence.
 */
export const forecastMetric = (input: ForecastInput): AnalyticsForecast => {
  const start = timestamp(input.observationStart);
  const end = timestamp(input.observationEnd);
  const asOf = timestamp(input.asOf);
  const source =
    input.method === "scheduled_mission_estimate"
      ? (input.scheduledValues ?? [])
      : input.observations;
  const inWindow = source.filter(({ observedAt }) => {
    const time = timestamp(observedAt);
    return (
      time !== null &&
      start !== null &&
      end !== null &&
      time >= start &&
      time < end &&
      (input.method === "scheduled_mission_estimate" || (asOf !== null && time <= asOf))
    );
  });
  const known = inWindow.filter(
    (observation): observation is ForecastObservation & { readonly value: string } =>
      observation.value !== null,
  );
  const completeness = inWindow.length === 0 ? 0 : known.length / inWindow.length;
  const includesEstimated = known.some(({ estimated }) => estimated);
  const currencies = observedCurrencies(known);
  const total = sumDecimals(known.map(({ value }) => value));
  const sampleWithheldReason =
    known.length < input.minimumSampleSize
      ? `Forecast withheld: ${known.length} known samples; minimum is ${input.minimumSampleSize}.`
      : null;
  const currencyWithheldReason =
    currencies.length > 1
      ? `Forecast withheld: mixed currencies (${currencies.join(", ")}) require explicit conversion.`
      : null;
  const invalidDateReason =
    start === null || end === null || asOf === null
      ? "Forecast withheld: observation dates are invalid."
      : null;

  let calculation: ForecastCalculation;
  if (
    invalidDateReason !== null ||
    sampleWithheldReason !== null ||
    currencyWithheldReason !== null
  ) {
    calculation = {
      value: null,
      withheldReason: invalidDateReason ?? sampleWithheldReason ?? currencyWithheldReason,
      methodDetail: "No extrapolation was performed.",
    };
  } else if (total === null) {
    calculation = {
      value: null,
      withheldReason: "Forecast withheld: no known observations are available.",
      methodDetail: "No extrapolation was performed.",
    };
  } else if (input.method === "current_period_run_rate") {
    calculation = calculateCurrentPeriodRunRate({
      total,
      observationStart: start!,
      observationEnd: end!,
      asOf: asOf!,
    });
  } else if (input.method === "trailing_average") {
    calculation = calculateTrailingAverage({
      total,
      sampleSize: known.length,
      expectedSampleCount: input.expectedSampleCount ?? null,
    });
  } else {
    calculation = {
      value: total,
      withheldReason: null,
      methodDetail: `Scheduled estimate sums ${known.length} configured mission estimates.`,
    };
  }

  const missing = inWindow.length - known.length;
  const uncertainty = [
    calculation.methodDetail,
    `${known.length} known and ${missing} missing observations; ${(completeness * 100).toFixed(1)}% complete.`,
    includesEstimated
      ? "The forecast includes estimated source values."
      : "The forecast contains no estimated source values.",
  ].join(" ");

  return AnalyticsForecast.make({
    metricKey: input.metricKey,
    value: calculation.value,
    unit: input.unit,
    method: input.method,
    observationStart: input.observationStart,
    observationEnd: input.observationEnd,
    dataCompleteness: completeness,
    confidence: confidenceFor({
      withheld: calculation.value === null,
      completeness,
      includesEstimated,
      sampleSize: known.length,
      minimumSampleSize: input.minimumSampleSize,
    }),
    uncertainty,
    includesEstimatedCost: includesEstimated,
    withheldReason: calculation.withheldReason,
  });
};
