import type { AnalyticsComparisonRow, AnalyticsForecast } from "@t3tools/contracts";

import {
  ANALYTICS_TABLE_CELL_CLASSNAME,
  ANALYTICS_TABLE_CLASSNAME,
  ANALYTICS_TABLE_HEADER_CLASSNAME,
  AnalyticsCard,
  AnalyticsConfidenceBadge,
  AnalyticsNotice,
  AnalyticsStateBadge,
  AnalyticsTableFrame,
  StaticRatioBar,
} from "./AnalyticsPrimitives";
import {
  formatAnalyticsDecimal,
  formatDateTime,
  formatDuration,
  formatRatio,
  humanizeAnalyticsKey,
} from "./analyticsPresentation";

function nullableDecimal(value: string | null): string {
  return value === null ? "Unknown" : formatAnalyticsDecimal(value);
}

function comparisonState(row: AnalyticsComparisonRow) {
  if (row.insufficientSample) return "insufficient_sample" as const;
  if (row.missingDataRatio >= 1) return "unknown" as const;
  if (row.missingDataRatio > 0 || row.estimatedCostRatio > 0) return "partial" as const;
  return "complete" as const;
}

export function AnalyticsComparisonTable({
  rows,
  minimumSampleSize,
}: {
  rows: ReadonlyArray<AnalyticsComparisonRow>;
  minimumSampleSize: number;
}) {
  const insufficientCount = rows.filter(({ insufficientSample }) => insufficientSample).length;
  const incompleteCount = rows.filter(
    ({ missingDataRatio, estimatedCostRatio }) => missingDataRatio > 0 || estimatedCostRatio > 0,
  ).length;

  return (
    <AnalyticsCard title="Provider, model, reasoning, and role comparisons">
      <div className="space-y-4">
        <AnalyticsNotice title="Comparisons are descriptive" tone="neutral">
          Missing-data and estimated-cost ratios travel with every row. Rows below the configured
          sample threshold are not promoted as winners or recommendations.
        </AnalyticsNotice>

        {insufficientCount > 0 ? (
          <AnalyticsNotice title="Some comparisons need more evidence" tone="warning" role="status">
            {insufficientCount.toLocaleString()} comparison
            {insufficientCount === 1 ? " is" : "s are"} below the configured sample of{" "}
            {minimumSampleSize.toLocaleString()} tasks. The row remains visible, but no winner is
            implied.
          </AnalyticsNotice>
        ) : null}

        {incompleteCount > 0 ? (
          <AnalyticsNotice title="Some comparison evidence is incomplete" tone="warning">
            {incompleteCount.toLocaleString()} comparison
            {incompleteCount === 1 ? " contains" : "s contain"} missing data or estimated cost.
            Review each row's ratios before drawing conclusions.
          </AnalyticsNotice>
        ) : null}

        {rows.length === 0 ? (
          <AnalyticsNotice title="Insufficient comparison sample" tone="warning" role="status">
            No provider, model, or agent-role comparison rows are available yet.
          </AnalyticsNotice>
        ) : (
          <AnalyticsTableFrame>
            <table className={`${ANALYTICS_TABLE_CLASSNAME} min-w-[1560px]`}>
              <caption className="sr-only">
                Provider, model, reasoning-level, and agent-role performance comparisons with sample
                and data-quality context
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Scope
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Sample (tasks)
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Runs
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Completion
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    First-pass verification
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Repair
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Fallback per started run
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    First output
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Tokens / verified task
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Human acceptance
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Missing data
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Estimated cost
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Quality
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.scopeType}:${row.scopeId}`}>
                    <th scope="row" className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <span className="block font-medium">{row.label}</span>
                      <span className="mt-0.5 block font-normal text-muted-foreground">
                        {humanizeAnalyticsKey(row.scopeType)}
                      </span>
                    </th>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      <span className="block font-medium">{row.taskCount.toLocaleString()}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {row.insufficientSample
                          ? `Below ${minimumSampleSize.toLocaleString()}-task minimum`
                          : `Meets ${minimumSampleSize.toLocaleString()}-task minimum`}
                      </span>
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      {row.runCount.toLocaleString()}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.completionRate)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.firstPassVerificationRate)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.repairRate)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.fallbackRate)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatDuration(row.averageFirstOutputLatencyMilliseconds)}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono tabular-nums`}>
                      {nullableDecimal(row.tokensPerVerifiedTask)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.humanAcceptanceRate)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.missingDataRatio)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {formatRatio(row.estimatedCostRatio)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <AnalyticsStateBadge state={comparisonState(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AnalyticsTableFrame>
        )}
      </div>
    </AnalyticsCard>
  );
}

function ForecastCard({ forecast }: { forecast: AnalyticsForecast }) {
  const withheld = forecast.value === null;

  return (
    <AnalyticsCard
      title={humanizeAnalyticsKey(forecast.metricKey)}
      action={<AnalyticsConfidenceBadge confidence={forecast.confidence} />}
    >
      <div className="space-y-4">
        {withheld ? (
          <AnalyticsNotice title="Forecast withheld" tone="critical" role="status">
            {forecast.withheldReason ?? "The forecast has no usable value for this sample."}
          </AnalyticsNotice>
        ) : (
          <p className="font-mono text-2xl font-semibold tracking-tight">
            {formatAnalyticsDecimal(forecast.value)} {forecast.unit}
          </p>
        )}

        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Method</dt>
            <dd className="mt-1 font-medium">{humanizeAnalyticsKey(forecast.method)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Observation window</dt>
            <dd className="mt-1 font-medium">
              <time dateTime={forecast.observationStart}>
                {formatDateTime(forecast.observationStart)}
              </time>{" "}
              –{" "}
              <time dateTime={forecast.observationEnd}>
                {formatDateTime(forecast.observationEnd)}
              </time>
            </dd>
          </div>
        </dl>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Data completeness</span>
            <span className="font-mono tabular-nums">{formatRatio(forecast.dataCompleteness)}</span>
          </div>
          <StaticRatioBar value={forecast.dataCompleteness} label="Forecast data completeness" />
        </div>

        <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed">
          <p className="font-medium">Uncertainty</p>
          <p className="mt-1 text-muted-foreground">{forecast.uncertainty}</p>
        </div>

        {forecast.includesEstimatedCost ? (
          <AnalyticsNotice title="Includes estimated cost" tone="warning">
            This forecast is not made entirely from provider-reported monetary amounts.
          </AnalyticsNotice>
        ) : null}
      </div>
    </AnalyticsCard>
  );
}

export function AnalyticsForecasts({ forecasts }: { forecasts: ReadonlyArray<AnalyticsForecast> }) {
  if (forecasts.length === 0) {
    return (
      <AnalyticsNotice title="Forecasts unavailable" tone="warning" role="status">
        No forecast has enough observations for the selected scope and method.
      </AnalyticsNotice>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {forecasts.map((forecast) => (
        <ForecastCard
          key={`${forecast.metricKey}:${forecast.observationStart}:${forecast.observationEnd}`}
          forecast={forecast}
        />
      ))}
    </div>
  );
}
