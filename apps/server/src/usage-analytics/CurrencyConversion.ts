import type {
  AnalyticsConvertedCurrencyTotal,
  AnalyticsCurrency,
  AnalyticsCurrencyTotal,
  ExchangeRateSnapshot,
} from "@t3tools/contracts";

import { multiplyDecimal } from "./DecimalMoney.ts";

export interface CurrencyConversionResult {
  readonly converted: ReadonlyArray<AnalyticsConvertedCurrencyTotal>;
  readonly missingRateCurrencies: ReadonlyArray<AnalyticsCurrency>;
}

const latestEffectiveRate = (input: {
  readonly originalCurrency: AnalyticsCurrency;
  readonly reportingCurrency: AnalyticsCurrency;
  readonly asOf: string;
  readonly snapshots: ReadonlyArray<ExchangeRateSnapshot>;
}): ExchangeRateSnapshot | null =>
  input.snapshots
    .filter(
      (snapshot) =>
        snapshot.baseCurrency === input.originalCurrency &&
        snapshot.quoteCurrency === input.reportingCurrency &&
        snapshot.effectiveAt <= input.asOf,
    )
    .toSorted(
      (left, right) =>
        right.effectiveAt.localeCompare(left.effectiveAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    )[0] ?? null;

/**
 * Converts each original currency row independently with an immutable manual snapshot.
 * Original totals remain authoritative and no cross-currency grand total is produced here.
 */
export const convertCurrencyTotals = (input: {
  readonly totals: ReadonlyArray<AnalyticsCurrencyTotal>;
  readonly reportingCurrency: AnalyticsCurrency;
  readonly snapshots: ReadonlyArray<ExchangeRateSnapshot>;
  readonly asOf: string;
}): CurrencyConversionResult => {
  const converted: Array<AnalyticsConvertedCurrencyTotal> = [];
  const missingRateCurrencies: Array<AnalyticsCurrency> = [];

  for (const total of input.totals) {
    if (total.currency === input.reportingCurrency) continue;
    const snapshot = latestEffectiveRate({
      originalCurrency: total.currency,
      reportingCurrency: input.reportingCurrency,
      snapshots: input.snapshots,
      asOf: input.asOf,
    });
    if (snapshot === null) {
      missingRateCurrencies.push(total.currency);
      continue;
    }
    converted.push({
      originalCurrency: total.currency,
      reportingCurrency: input.reportingCurrency,
      exchangeRateSnapshotId: snapshot.id,
      exchangeRate: snapshot.rate,
      exchangeRateEffectiveAt: snapshot.effectiveAt,
      providerReportedAmount: multiplyDecimal(total.providerReportedAmount, snapshot.rate),
      calculatedEstimateAmount: multiplyDecimal(total.calculatedEstimateAmount, snapshot.rate),
      subscriptionAllocationAmount: multiplyDecimal(
        total.subscriptionAllocationAmount,
        snapshot.rate,
      ),
      localComputeEstimateAmount: multiplyDecimal(total.localComputeEstimateAmount, snapshot.rate),
      unknownCostRecordCount: total.unknownCostRecordCount,
    });
  }

  return {
    converted: converted.toSorted((left, right) =>
      left.originalCurrency.localeCompare(right.originalCurrency),
    ),
    missingRateCurrencies: [...new Set(missingRateCurrencies)].toSorted(),
  };
};
