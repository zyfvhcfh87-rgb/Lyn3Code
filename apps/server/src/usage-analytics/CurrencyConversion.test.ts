import {
  AnalyticsCurrency,
  ExchangeRateSnapshotId,
  type AnalyticsCurrencyTotal,
  type ExchangeRateSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { convertCurrencyTotals } from "./CurrencyConversion.ts";

const total = (currency: "EUR" | "GBP" | "USD"): AnalyticsCurrencyTotal => ({
  currency: AnalyticsCurrency.make(currency),
  providerReportedAmount: "10",
  calculatedEstimateAmount: "2.5",
  subscriptionAllocationAmount: "1.25",
  localComputeEstimateAmount: "0.5",
  unknownCostRecordCount: 1,
});

const rate = (id: string, effectiveAt: string, value: string): ExchangeRateSnapshot => ({
  id: ExchangeRateSnapshotId.make(id),
  baseCurrency: AnalyticsCurrency.make("EUR"),
  quoteCurrency: AnalyticsCurrency.make("USD"),
  rate: value,
  source: "user_configured",
  effectiveAt,
  createdAt: effectiveAt,
});

describe("CurrencyConversion", () => {
  it("uses the latest effective manual snapshot and preserves original totals", () => {
    const original = total("EUR");
    const result = convertCurrencyTotals({
      totals: [original, total("USD")],
      reportingCurrency: AnalyticsCurrency.make("USD"),
      snapshots: [
        rate("rate-old", "2026-01-01T00:00:00.000Z", "1.1"),
        rate("rate-current", "2026-02-01T00:00:00.000Z", "1.2"),
        rate("rate-future", "2026-04-01T00:00:00.000Z", "9"),
      ],
      asOf: "2026-03-01T00:00:00.000Z",
    });

    expect(original).toEqual(total("EUR"));
    expect(result.missingRateCurrencies).toEqual([]);
    expect(result.converted).toEqual([
      {
        originalCurrency: "EUR",
        reportingCurrency: "USD",
        exchangeRateSnapshotId: "rate-current",
        exchangeRate: "1.2",
        exchangeRateEffectiveAt: "2026-02-01T00:00:00.000Z",
        providerReportedAmount: "12",
        calculatedEstimateAmount: "3",
        subscriptionAllocationAmount: "1.5",
        localComputeEstimateAmount: "0.6",
        unknownCostRecordCount: 1,
      },
    ]);
  });

  it("withholds conversion when no direct rate exists", () => {
    const result = convertCurrencyTotals({
      totals: [total("GBP"), total("EUR")],
      reportingCurrency: AnalyticsCurrency.make("USD"),
      snapshots: [],
      asOf: "2026-03-01T00:00:00.000Z",
    });

    expect(result.converted).toEqual([]);
    expect(result.missingRateCurrencies).toEqual(["EUR", "GBP"]);
  });
});
