import type {
  AnalyticsConvertedCurrencyTotal,
  AnalyticsCurrencyTotal,
  AnalyticsDataQuality,
  AnalyticsSettings,
} from "@t3tools/contracts";

import {
  ANALYTICS_TABLE_CELL_CLASSNAME,
  ANALYTICS_TABLE_CLASSNAME,
  ANALYTICS_TABLE_HEADER_CLASSNAME,
  AnalyticsCard,
  AnalyticsNotice,
  AnalyticsStateBadge,
  AnalyticsTableFrame,
} from "./AnalyticsPrimitives";
import { analyticsDataQualityState, formatAnalyticsMoney } from "./analyticsPresentation";

const QUALITY_ROWS: ReadonlyArray<{
  key: keyof AnalyticsDataQuality;
  label: string;
  meaning: string;
}> = [
  { key: "runCount", label: "Runs observed", meaning: "Agent runs in the selected scope." },
  {
    key: "providerReportedUsageCount",
    label: "Provider-reported usage",
    meaning: "Usage supplied directly by a provider runtime.",
  },
  {
    key: "estimatedUsageCount",
    label: "Estimated usage",
    meaning: "Usage calculated by an adapter, tokenizer, or context estimate.",
  },
  {
    key: "unknownUsageCount",
    label: "Unknown usage",
    meaning: "Runs for which usable token or request usage was unavailable.",
  },
  {
    key: "pricedUsageCount",
    label: "Priced usage",
    meaning: "Usage matched to a usable pricing source.",
  },
  {
    key: "unpricedUsageCount",
    label: "Unpriced usage",
    meaning: "Usage present without enough pricing data to calculate cost.",
  },
  {
    key: "stalePricingCount",
    label: "Stale pricing",
    meaning: "Cost records using pricing outside its trusted effective period.",
  },
  {
    key: "incompleteOutcomeCount",
    label: "Incomplete outcomes",
    meaning: "Tasks or missions that do not yet have a final outcome.",
  },
  {
    key: "pendingHumanDispositionCount",
    label: "Pending human review",
    meaning: "Outcomes not yet explicitly accepted, edited, rejected, or abandoned.",
  },
  {
    key: "sourceDetailDeletedCount",
    label: "Source detail deleted",
    meaning: "Aggregates retained after their underlying detail aged out.",
  },
];

export function AnalyticsDataQualityPanel({
  settings,
  quality,
}: {
  settings: AnalyticsSettings;
  quality: AnalyticsDataQuality;
}) {
  const state = analyticsDataQualityState(settings.enabled, quality);

  return (
    <AnalyticsCard title="Data quality" action={<AnalyticsStateBadge state={state} />}>
      <div className="space-y-4">
        {state === "partial" ? (
          <AnalyticsNotice title="Use these results with care" tone="warning" role="status">
            Some usage, pricing, outcome, or retained source detail is estimated or incomplete.
            Every affected count stays visible below.
          </AnalyticsNotice>
        ) : null}
        {quality.stalePricingCount > 0 ? (
          <AnalyticsNotice title="Pricing data is stale" tone="warning" role="status">
            {quality.stalePricingCount.toLocaleString()} record
            {quality.stalePricingCount === 1 ? " uses" : "s use"} a price outside its trusted
            effective period. Historical snapshots remain attached and are not silently replaced.
          </AnalyticsNotice>
        ) : null}
        {state === "unknown" ? (
          <AnalyticsNotice title="Usage is unknown" tone="critical" role="alert">
            Runs exist, but no provider-reported or estimated usage is available for this scope.
          </AnalyticsNotice>
        ) : null}
        {state === "insufficient_sample" ? (
          <AnalyticsNotice title="No run sample yet" tone="warning" role="status">
            Analytics needs at least one observed run before it can describe data quality.
          </AnalyticsNotice>
        ) : null}
        {state === "disabled" ? (
          <AnalyticsNotice title="Collection is disabled" tone="critical" role="alert">
            Existing retained records may still be shown, but no new analytics detail is being
            collected.
          </AnalyticsNotice>
        ) : null}

        <AnalyticsTableFrame>
          <table className={ANALYTICS_TABLE_CLASSNAME}>
            <caption className="sr-only">
              Analytics coverage, missing-data, and retention counts
            </caption>
            <thead>
              <tr>
                <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                  Signal
                </th>
                <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                  Count
                </th>
                <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                  Meaning
                </th>
              </tr>
            </thead>
            <tbody>
              {QUALITY_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                    {row.label}
                  </th>
                  <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                    {quality[row.key].toLocaleString()}
                  </td>
                  <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} text-muted-foreground`}>
                    {row.meaning}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AnalyticsTableFrame>
      </div>
    </AnalyticsCard>
  );
}

function CostRow({ total }: { total: AnalyticsCurrencyTotal }) {
  return (
    <tr>
      <th scope="row" className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono`}>
        {total.currency}
      </th>
      <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
        {formatAnalyticsMoney(total.providerReportedAmount, total.currency)}
      </td>
      <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
        {formatAnalyticsMoney(total.calculatedEstimateAmount, total.currency)}
      </td>
      <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
        {formatAnalyticsMoney(total.subscriptionAllocationAmount, total.currency)}
      </td>
      <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
        {formatAnalyticsMoney(total.localComputeEstimateAmount, total.currency)}
      </td>
      <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
        {total.unknownCostRecordCount.toLocaleString()}
      </td>
    </tr>
  );
}

export function AnalyticsCostTable({
  totals,
  convertedTotals,
  reportingCurrency,
}: {
  totals: ReadonlyArray<AnalyticsCurrencyTotal>;
  convertedTotals: ReadonlyArray<AnalyticsConvertedCurrencyTotal>;
  reportingCurrency: string;
}) {
  const convertedCurrencies = new Set(
    convertedTotals.map(({ originalCurrency }) => originalCurrency),
  );
  const missingRateCurrencies = totals
    .filter(({ currency }) => currency !== reportingCurrency && !convertedCurrencies.has(currency))
    .map(({ currency }) => currency);
  return (
    <AnalyticsCard title="Cost sources">
      <div className="space-y-4">
        <AnalyticsNotice title="Categories stay separate" tone="neutral">
          Provider-reported, calculated, subscription, and local-compute amounts are different cost
          concepts. Lyn Code does not add them together, and it never combines currencies without an
          explicit exchange-rate snapshot.
        </AnalyticsNotice>

        {totals.length > 1 ? (
          <AnalyticsNotice title="Mixed currencies" tone="warning" role="status">
            This scope contains {totals.length.toLocaleString()} currencies. Each currency remains a
            separate row and no cross-currency total is shown.
          </AnalyticsNotice>
        ) : null}

        {missingRateCurrencies.length > 0 ? (
          <AnalyticsNotice title="Reporting conversion unavailable" tone="warning" role="status">
            No direct effective manual rate converts {missingRateCurrencies.join(", ")} to{" "}
            {reportingCurrency}. Original totals remain visible and separate.
          </AnalyticsNotice>
        ) : null}

        {totals.length === 0 ? (
          <AnalyticsNotice title="Cost is unknown" tone="critical" role="status">
            No priced cost records are available for this scope.
          </AnalyticsNotice>
        ) : (
          <AnalyticsTableFrame>
            <table className={`${ANALYTICS_TABLE_CLASSNAME} min-w-[1040px]`}>
              <caption className="sr-only">
                Cost amounts by currency and source category; categories and currencies are not
                summed
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Currency
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Provider reported
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Calculated estimate
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Subscription allocation
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Local compute estimate
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Unknown cost records
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map((total) => (
                  <CostRow key={total.currency} total={total} />
                ))}
              </tbody>
            </table>
          </AnalyticsTableFrame>
        )}

        {convertedTotals.length > 0 ? (
          <AnalyticsTableFrame>
            <table className={`${ANALYTICS_TABLE_CLASSNAME} min-w-[1160px]`}>
              <caption className="sr-only">
                Labelled reporting-currency conversions using immutable manual exchange-rate
                snapshots
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Original
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Manual rate
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Provider reported
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Calculated estimate
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Subscription allocation
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Local compute estimate
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Unknown records
                  </th>
                </tr>
              </thead>
              <tbody>
                {convertedTotals.map((total) => (
                  <tr key={`${total.originalCurrency}:${total.exchangeRateSnapshotId}`}>
                    <th scope="row" className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono`}>
                      {total.originalCurrency} → {total.reportingCurrency}
                    </th>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {total.exchangeRate}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {formatAnalyticsMoney(total.providerReportedAmount, total.reportingCurrency)}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {formatAnalyticsMoney(
                        total.calculatedEstimateAmount,
                        total.reportingCurrency,
                      )}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {formatAnalyticsMoney(
                        total.subscriptionAllocationAmount,
                        total.reportingCurrency,
                      )}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {formatAnalyticsMoney(
                        total.localComputeEstimateAmount,
                        total.reportingCurrency,
                      )}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {total.unknownCostRecordCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AnalyticsTableFrame>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Decimal amounts are rendered from their exact stored strings without binary-float
          conversion. Converted rows are labelled estimates tied to an immutable manual rate;
          original rows remain authoritative. Unknown records are counts, not zero-valued costs.
        </p>
      </div>
    </AnalyticsCard>
  );
}
