import type { AnalyticsWorkspaceSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AnalyticsWorkspace } from "./AnalyticsWorkspace";
import type { AnalyticsWorkspaceActions } from "./analyticsActions";

const ACTIONS: AnalyticsWorkspaceActions = {
  updateSettings: async () => true,
  savePricingSnapshot: async () => true,
  saveSubscriptionAttributionRule: async () => true,
  saveExchangeRateSnapshot: async () => true,
  saveBudget: async () => true,
  acknowledgeBudgetEvent: async () => true,
  createBudgetOverride: async () => true,
  acknowledgeAlert: async () => true,
  saveAnnotation: async () => true,
  recordHumanDisposition: async () => true,
  createExport: async () => true,
  startRetention: async () => true,
  rebuildAggregates: async () => true,
};

const FILTER = {
  dateRange: { from: null, to: null },
  projectId: null,
  missionId: null,
  taskId: null,
  agentRunId: null,
  providerProfileId: null,
  modelProfileId: null,
  agentRoleId: null,
  reasoningLevel: null,
  humanDisposition: null,
  subscriptionBacked: null,
} as const;

const PRICING_PROFILES = {
  providers: [{ id: "provider:codex", label: "Codex" }],
  models: [{ id: "model:gpt", providerProfileId: "provider:codex", label: "GPT" }],
} as const;

const SNAPSHOT = {
  settings: {
    enabled: true,
    detailRetentionDays: 30,
    aggregateRetentionDays: 365,
    exportRetentionDays: 7,
    pricingSourcePriority: ["provider_reported", "official_catalog"],
    defaultReportingCurrency: "USD",
    subscriptionAttributionMode: "none",
    localComputeHourlyRate: null,
    outcomeObservationWindowDays: 14,
    minimumComparisonSampleSize: 5,
    forecastMethod: "trailing_average",
    detailLevel: "standard",
    storePromptContent: false,
    updatedAt: "2026-08-04T10:00:00.000Z",
  },
  overview: {
    metricVersion: 1,
    completedMissionCount: 2,
    verifiedTaskCount: 3,
    firstPassVerificationRate: 0.5,
    totalAgentRunCount: 6,
    fallbackRate: 0.25,
    repairRate: 0.5,
    humanAcceptanceRate: null,
    activeAgentMilliseconds: 120_000,
    wallClockDeliveryMilliseconds: null,
    currencyTotals: [
      {
        currency: "USD",
        providerReportedAmount: "12.100000",
        calculatedEstimateAmount: "3.200000",
        subscriptionAllocationAmount: "5.000000",
        localComputeEstimateAmount: "1.250000",
        unknownCostRecordCount: 1,
      },
      {
        currency: "EUR",
        providerReportedAmount: "7.000000",
        calculatedEstimateAmount: "0.500000",
        subscriptionAllocationAmount: "0",
        localComputeEstimateAmount: "0",
        unknownCostRecordCount: 0,
      },
    ],
    convertedCurrencyTotals: [],
    dataQuality: {
      runCount: 6,
      providerReportedUsageCount: 4,
      estimatedUsageCount: 1,
      unknownUsageCount: 1,
      pricedUsageCount: 4,
      unpricedUsageCount: 2,
      stalePricingCount: 0,
      incompleteOutcomeCount: 1,
      pendingHumanDispositionCount: 2,
      sourceDetailDeletedCount: 0,
    },
  },
  comparisons: [
    {
      scopeType: "provider",
      scopeId: "provider:codex",
      label: "Codex",
      taskCount: 2,
      runCount: 3,
      completionRate: 1,
      firstPassVerificationRate: 0.5,
      repairRate: 0.5,
      fallbackRate: 0,
      averageFirstOutputLatencyMilliseconds: 1_500,
      tokensPerVerifiedTask: "1200.5",
      humanAcceptanceRate: null,
      missingDataRatio: 0.25,
      estimatedCostRatio: 0.5,
      insufficientSample: true,
    },
  ],
  forecasts: [
    {
      metricKey: "api_usage_cost",
      value: null,
      unit: "USD",
      method: "trailing_average",
      observationStart: "2026-07-28T10:00:00.000Z",
      observationEnd: "2026-08-04T10:00:00.000Z",
      dataCompleteness: 0.4,
      confidence: "low",
      uncertainty: "Most provider cost records are missing.",
      includesEstimatedCost: true,
      withheldReason: "Fewer than five complete observations.",
    },
  ],
  pricingSnapshots: [
    {
      id: "pricing:1",
      providerProfileId: "provider:codex",
      modelProfileId: "model:gpt",
      currency: "USD",
      pricingSource: "user_configured",
      pricingVersion: "2026-08",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
      inputTokenRate: "0.100000000000000001",
      outputTokenRate: "0.2",
      reasoningTokenRate: null,
      cachedInputRate: null,
      cacheWriteRate: null,
      cacheReadRate: null,
      requestRate: null,
      toolRateMetadata: {},
      billingUnit: "per_million_tokens",
      confidence: "medium",
      metadata: {},
      createdAt: "2026-08-04T10:00:00.000Z",
    },
  ],
  subscriptionAttributionRules: [],
  exchangeRateSnapshots: [],
  budgets: [],
  budgetEvents: [],
  activeAlerts: [],
  recommendations: [
    {
      id: "recommendation:1",
      scopeType: "project",
      scopeId: "project:1",
      title: "Compare one more run",
      evidence: "Two similar tasks completed.",
      sampleSize: 2,
      periodStart: "2026-07-28T10:00:00.000Z",
      periodEnd: "2026-08-04T10:00:00.000Z",
      taskSegment: "frontend",
      metricKeys: ["first_pass_verification_rate"],
      uncertainty: "The sample is small.",
      estimatedCostPresent: true,
      conflictsWithPolicy: false,
      createdAt: "2026-08-04T10:00:00.000Z",
    },
  ],
  annotations: [
    {
      id: "annotation:1",
      scopeType: "project",
      scopeId: "project:1",
      timestamp: "2026-08-03T10:00:00.000Z",
      title: "Release migration",
      content: "The team moved its release workflow during this period.",
      createdBy: "user",
      createdAt: "2026-08-04T10:00:00.000Z",
      updatedAt: "2026-08-04T10:00:00.000Z",
    },
  ],
  exports: [],
  retentionOperations: [],
} as unknown as AnalyticsWorkspaceSnapshot;

describe("AnalyticsWorkspace", () => {
  it("keeps cost concepts and currencies separate while exposing uncertainty", () => {
    const markup = renderToStaticMarkup(<AnalyticsWorkspace state="ready" snapshot={SNAPSHOT} />);

    expect(markup).toContain("Provider reported");
    expect(markup).toContain("Calculated estimate");
    expect(markup).toContain("Subscription allocation");
    expect(markup).toContain("Local compute estimate");
    expect(markup).toContain("12.1 USD");
    expect(markup).toContain("7 EUR");
    expect(markup).toContain("Partial data");
    expect(markup).toContain("Insufficient sample");
    expect(markup).toContain("Sample (tasks)");
    expect(markup).toContain("Below 5-task minimum");
    expect(markup).toContain("Some comparison evidence is incomplete");
    expect(markup).toContain("Mixed currencies");
    expect(markup).toContain("Forecast withheld");
    expect(markup).toContain("Fewer than five complete observations.");
    expect(markup).toContain("Recommendations are non-binding");
    expect(markup).toContain("Release migration");
    expect(markup).toContain("0.100000000000000001");
    expect(markup).toContain("<caption");
    expect(markup).not.toContain("<animate");
  });

  it("does not present disabled collection as zero usage", () => {
    const disabledSnapshot = {
      ...SNAPSHOT,
      settings: { ...SNAPSHOT.settings, enabled: false },
    } as unknown as AnalyticsWorkspaceSnapshot;
    const markup = renderToStaticMarkup(
      <AnalyticsWorkspace state="ready" snapshot={disabledSnapshot} />,
    );

    expect(markup).toContain("Analytics collection is disabled");
    expect(markup).toContain("Disabled is not equivalent to zero usage or zero cost.");
  });

  it("calls out stale historical pricing without replacing the retained snapshot", () => {
    const staleSnapshot = {
      ...SNAPSHOT,
      overview: {
        ...SNAPSHOT.overview,
        dataQuality: { ...SNAPSHOT.overview.dataQuality, stalePricingCount: 2 },
      },
    } as AnalyticsWorkspaceSnapshot;
    const markup = renderToStaticMarkup(
      <AnalyticsWorkspace state="ready" snapshot={staleSnapshot} />,
    );

    expect(markup).toContain("Pricing data is stale");
    expect(markup).toContain("2 records use a price outside its trusted effective period");
    expect(markup).toContain("not silently replaced");
  });

  it("exposes the available mutation controls only when actions are connected", () => {
    const readOnlyMarkup = renderToStaticMarkup(
      <AnalyticsWorkspace state="ready" snapshot={SNAPSHOT} />,
    );
    const connectedMarkup = renderToStaticMarkup(
      <AnalyticsWorkspace
        state="ready"
        snapshot={SNAPSHOT}
        actions={ACTIONS}
        filter={FILTER}
        filterOptions={{
          projects: [{ id: "project:1", label: "Lyn Code" }],
          missions: [],
          roles: [],
          providers: PRICING_PROFILES.providers,
          models: PRICING_PROFILES.models,
        }}
        onFilterChange={() => undefined}
        pricingProfiles={PRICING_PROFILES}
      />,
    );

    expect(readOnlyMarkup).not.toContain("Edit settings");
    expect(connectedMarkup).toContain("Edit settings");
    expect(connectedMarkup).toContain("Disable collection");
    expect(connectedMarkup).toContain("Add price snapshot");
    expect(connectedMarkup).toContain("Add subscription rule");
    expect(connectedMarkup).toContain("Add exchange rate");
    expect(connectedMarkup).toContain("Add annotation");
    expect(connectedMarkup).toContain("New budget");
    expect(connectedMarkup).toContain("Export CSV");
    expect(connectedMarkup).toContain("Export JSON");
    expect(connectedMarkup).toContain("Run retention");
    expect(connectedMarkup).toContain("Rebuild aggregates");
    expect(connectedMarkup).toContain("Explore analytics");
  });

  it("labels manual reporting-currency conversions without replacing original rows", () => {
    const convertedSnapshot = {
      ...SNAPSHOT,
      overview: {
        ...SNAPSHOT.overview,
        convertedCurrencyTotals: [
          {
            originalCurrency: "EUR",
            reportingCurrency: "USD",
            exchangeRateSnapshotId: "exchange:eur-usd",
            exchangeRate: "1.2",
            exchangeRateEffectiveAt: "2026-08-01T00:00:00.000Z",
            providerReportedAmount: "8.4",
            calculatedEstimateAmount: "0.6",
            subscriptionAllocationAmount: "0",
            localComputeEstimateAmount: "0",
            unknownCostRecordCount: 0,
          },
        ],
      },
      exchangeRateSnapshots: [
        {
          id: "exchange:eur-usd",
          baseCurrency: "EUR",
          quoteCurrency: "USD",
          rate: "1.2",
          source: "user_configured",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    } as unknown as AnalyticsWorkspaceSnapshot;
    const markup = renderToStaticMarkup(
      <AnalyticsWorkspace state="ready" snapshot={convertedSnapshot} />,
    );

    expect(markup).toContain("EUR → USD");
    expect(markup).toContain("8.4 USD");
    expect(markup).toContain("1 EUR = 1.2 USD");
    expect(markup).toContain("Converted rows are labelled estimates");
    expect(markup).toContain("7 EUR");
  });

  it("renders unavailable state without placeholder metrics", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsWorkspace state="unavailable" reason="The environment did not respond." />,
    );

    expect(markup).toContain("Analytics unavailable");
    expect(markup).toContain("Unknown values remain unknown");
    expect(markup).not.toContain("Completed missions");
  });
});
