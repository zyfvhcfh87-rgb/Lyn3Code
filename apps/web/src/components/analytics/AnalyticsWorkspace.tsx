import type { AnalyticsFilter, AnalyticsWorkspaceSnapshot } from "@t3tools/contracts";

import { SettingsSection } from "../settings/settingsLayout";
import { AnalyticsComparisonTable, AnalyticsForecasts } from "./AnalyticsComparisonsAndForecasts";
import { AnalyticsCostTable, AnalyticsDataQualityPanel } from "./AnalyticsCostsAndQuality";
import {
  AnalyticsAlerts,
  AnalyticsBudgets,
  AnalyticsOperations,
  AnalyticsRecommendations,
} from "./AnalyticsGovernance";
import { AnalyticsCard, AnalyticsMetricCard, AnalyticsNotice } from "./AnalyticsPrimitives";
import {
  AnalyticsAccountingSnapshots,
  AnalyticsAnnotations,
  AnalyticsPricingSnapshots,
} from "./AnalyticsRecords";
import type { AnalyticsWorkspaceActions } from "./analyticsActions";
import { AnalyticsExplorationFilters } from "./AnalyticsExplorationFilters";
import type { AnalyticsFilterOptions } from "./analyticsFilterLogic";
import {
  type AnalyticsPricingProfiles,
  AnalyticsSettingsControls,
  ExchangeRateSnapshotDialog,
  PricingSnapshotDialog,
  SubscriptionAttributionRuleDialog,
} from "./AnalyticsControls";
import { formatDuration, formatRatio, humanizeAnalyticsKey } from "./analyticsPresentation";

export type AnalyticsWorkspaceProps =
  | { readonly state: "loading" }
  | { readonly state: "unavailable"; readonly reason: string }
  | {
      readonly state: "ready";
      readonly snapshot: AnalyticsWorkspaceSnapshot;
      readonly filter?: AnalyticsFilter | undefined;
      readonly filterOptions?: AnalyticsFilterOptions | undefined;
      readonly onFilterChange?: ((filter: AnalyticsFilter) => void) | undefined;
      readonly isFilterRefreshing?: boolean | undefined;
      readonly actions?: AnalyticsWorkspaceActions | undefined;
      readonly pricingProfiles?: AnalyticsPricingProfiles | undefined;
    };

function AnalyticsSettingsSummary({
  snapshot,
  actions,
  pricingProfiles,
}: {
  snapshot: AnalyticsWorkspaceSnapshot;
  actions?: AnalyticsWorkspaceActions | undefined;
  pricingProfiles?: AnalyticsPricingProfiles | undefined;
}) {
  const { settings } = snapshot;

  return (
    <AnalyticsCard
      title="Collection and interpretation"
      action={
        actions ? (
          <div className="flex flex-wrap justify-end gap-2">
            <AnalyticsSettingsControls settings={settings} actions={actions} />
            {pricingProfiles &&
            pricingProfiles.providers.length > 0 &&
            pricingProfiles.models.length > 0 ? (
              <>
                <PricingSnapshotDialog
                  key={`${pricingProfiles.providers[0]?.id}:${pricingProfiles.models[0]?.id}`}
                  profiles={pricingProfiles}
                  actions={actions}
                />
                <SubscriptionAttributionRuleDialog
                  profiles={pricingProfiles}
                  settings={settings}
                  actions={actions}
                />
              </>
            ) : null}
            <ExchangeRateSnapshotDialog
              reportingCurrency={settings.defaultReportingCurrency}
              actions={actions}
            />
          </div>
        ) : undefined
      }
    >
      <dl className="grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Collection</dt>
          <dd className="mt-1 font-medium">{settings.enabled ? "Enabled" : "Disabled"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Metric catalogue</dt>
          <dd className="mt-1 font-medium">Version {snapshot.overview.metricVersion}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Detail level</dt>
          <dd className="mt-1 font-medium">{humanizeAnalyticsKey(settings.detailLevel)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Detail retention</dt>
          <dd className="mt-1 font-medium">{settings.detailRetentionDays} days</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Aggregate retention</dt>
          <dd className="mt-1 font-medium">
            {settings.aggregateRetentionDays === null
              ? "No automatic expiry"
              : `${settings.aggregateRetentionDays} days`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Export retention</dt>
          <dd className="mt-1 font-medium">{settings.exportRetentionDays} days</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reporting currency</dt>
          <dd className="mt-1 font-mono font-medium">{settings.defaultReportingCurrency}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Forecast method</dt>
          <dd className="mt-1 font-medium">{humanizeAnalyticsKey(settings.forecastMethod)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Minimum comparison sample</dt>
          <dd className="mt-1 font-medium">
            {settings.minimumComparisonSampleSize.toLocaleString()}
          </dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <dt className="text-muted-foreground">Pricing source priority</dt>
          <dd className="mt-1 font-medium">
            {settings.pricingSourcePriority.length === 0
              ? "No pricing source configured"
              : settings.pricingSourcePriority.map(humanizeAnalyticsKey).join(" → ")}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <AnalyticsNotice title="Prompt content is not stored" tone="success">
          Analytics records counts, timing, identifiers, outcomes, and bounded operational metadata.
          The v1 settings contract permanently fixes prompt-content storage to false.
        </AnalyticsNotice>
      </div>
    </AnalyticsCard>
  );
}

function AnalyticsOverview({
  snapshot,
  actions,
  pricingProfiles,
}: {
  snapshot: AnalyticsWorkspaceSnapshot;
  actions?: AnalyticsWorkspaceActions | undefined;
  pricingProfiles?: AnalyticsPricingProfiles | undefined;
}) {
  const { overview } = snapshot;
  const noRuns = overview.totalAgentRunCount === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AnalyticsMetricCard
          label="Completed missions"
          value={overview.completedMissionCount.toLocaleString()}
        />
        <AnalyticsMetricCard
          label="Verified tasks"
          value={overview.verifiedTaskCount.toLocaleString()}
        />
        <AnalyticsMetricCard
          label="Agent runs"
          value={overview.totalAgentRunCount.toLocaleString()}
          state={noRuns ? "insufficient_sample" : undefined}
        />
        <AnalyticsMetricCard
          label="First-pass verification"
          value={formatRatio(overview.firstPassVerificationRate)}
          state={overview.firstPassVerificationRate === null ? "unknown" : undefined}
          detail="Passed required verification after the first implementation attempt."
        />
        <AnalyticsMetricCard
          label="Repair rate"
          value={formatRatio(overview.repairRate)}
          state={overview.repairRate === null ? "unknown" : undefined}
          detail="Verification-reaching tasks with at least one repair-agent run."
        />
        <AnalyticsMetricCard
          label="Fallback per started run"
          value={formatRatio(overview.fallbackRate)}
          state={overview.fallbackRate === null ? "unknown" : undefined}
        />
        <AnalyticsMetricCard
          label="Human acceptance"
          value={formatRatio(overview.humanAcceptanceRate)}
          state={overview.humanAcceptanceRate === null ? "unknown" : undefined}
          detail="Accepted or accepted with edits among explicit human dispositions."
        />
        <AnalyticsMetricCard
          label="Active agent time"
          value={formatDuration(overview.activeAgentMilliseconds)}
        />
        <AnalyticsMetricCard
          label="Wall-clock delivery"
          value={formatDuration(overview.wallClockDeliveryMilliseconds)}
          state={overview.wallClockDeliveryMilliseconds === null ? "unknown" : undefined}
        />
      </div>
      <AnalyticsSettingsSummary
        snapshot={snapshot}
        actions={actions}
        pricingProfiles={pricingProfiles}
      />
    </div>
  );
}

function ReadyAnalyticsWorkspace({
  snapshot,
  actions,
  filter,
  filterOptions,
  onFilterChange,
  isFilterRefreshing,
  pricingProfiles,
}: {
  snapshot: AnalyticsWorkspaceSnapshot;
  actions?: AnalyticsWorkspaceActions | undefined;
  filter?: AnalyticsFilter | undefined;
  filterOptions?: AnalyticsFilterOptions | undefined;
  onFilterChange?: ((filter: AnalyticsFilter) => void) | undefined;
  isFilterRefreshing?: boolean | undefined;
  pricingProfiles?: AnalyticsPricingProfiles | undefined;
}) {
  return (
    <>
      {!snapshot.settings.enabled ? (
        <AnalyticsNotice title="Analytics collection is disabled" tone="critical" role="alert">
          Existing retained records remain visible for review, but new detail is not being
          collected. Disabled is not equivalent to zero usage or zero cost.
        </AnalyticsNotice>
      ) : null}

      {filter && filterOptions && onFilterChange ? (
        <SettingsSection id="analytics-explore" title="Explore analytics">
          <AnalyticsExplorationFilters
            filter={filter}
            options={filterOptions}
            onChange={onFilterChange}
            isRefreshing={isFilterRefreshing ?? false}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection id="analytics-overview" title="Analytics overview">
        <div className="space-y-4">
          <AnalyticsOverview
            snapshot={snapshot}
            actions={actions}
            pricingProfiles={pricingProfiles}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="analytics-costs" title="Cost and data quality">
        <div className="space-y-4">
          <AnalyticsCostTable
            totals={snapshot.overview.currencyTotals}
            convertedTotals={snapshot.overview.convertedCurrencyTotals}
            reportingCurrency={snapshot.settings.defaultReportingCurrency}
          />
          <AnalyticsDataQualityPanel
            settings={snapshot.settings}
            quality={snapshot.overview.dataQuality}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="analytics-pricing" title="Pricing snapshots">
        <div className="space-y-4">
          <AnalyticsPricingSnapshots snapshots={snapshot.pricingSnapshots} />
          <AnalyticsAccountingSnapshots
            rules={snapshot.subscriptionAttributionRules}
            exchangeRates={snapshot.exchangeRateSnapshots}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="analytics-comparisons" title="Comparisons">
        <AnalyticsComparisonTable
          rows={snapshot.comparisons}
          minimumSampleSize={snapshot.settings.minimumComparisonSampleSize}
        />
      </SettingsSection>

      <SettingsSection id="analytics-forecasts" title="Forecasts">
        <AnalyticsForecasts forecasts={snapshot.forecasts} />
      </SettingsSection>

      <SettingsSection id="analytics-budgets" title="Budgets">
        <AnalyticsBudgets
          policies={snapshot.budgets}
          events={snapshot.budgetEvents}
          actions={actions}
        />
      </SettingsSection>

      <SettingsSection id="analytics-alerts" title="Alerts">
        <AnalyticsAlerts alerts={snapshot.activeAlerts} actions={actions} />
      </SettingsSection>

      <SettingsSection id="analytics-recommendations" title="Recommendations">
        <AnalyticsRecommendations
          recommendations={snapshot.recommendations}
          minimumSampleSize={snapshot.settings.minimumComparisonSampleSize}
        />
      </SettingsSection>

      <SettingsSection id="analytics-annotations" title="Annotations">
        <AnalyticsAnnotations annotations={snapshot.annotations} actions={actions} />
      </SettingsSection>

      <SettingsSection id="analytics-operations" title="Exports and retention">
        <AnalyticsOperations
          exports={snapshot.exports}
          retentionOperations={snapshot.retentionOperations}
          actions={actions}
          filter={filter}
        />
      </SettingsSection>
    </>
  );
}

export function AnalyticsWorkspace(props: AnalyticsWorkspaceProps) {
  if (props.state === "loading") {
    return (
      <AnalyticsNotice title="Loading analytics" tone="neutral" role="status">
        Waiting for an evidence-backed workspace snapshot. No placeholder values are shown.
      </AnalyticsNotice>
    );
  }

  if (props.state === "unavailable") {
    return (
      <AnalyticsNotice title="Analytics unavailable" tone="critical" role="alert">
        {props.reason} Unknown values remain unknown; Lyn Code does not fill gaps with zeroes.
      </AnalyticsNotice>
    );
  }

  return (
    <ReadyAnalyticsWorkspace
      snapshot={props.snapshot}
      actions={props.actions}
      filter={props.filter}
      filterOptions={props.filterOptions}
      onFilterChange={props.onFilterChange}
      isFilterRefreshing={props.isFilterRefreshing}
      pricingProfiles={props.pricingProfiles}
    />
  );
}
