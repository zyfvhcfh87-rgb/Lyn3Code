import {
  AnalyticsAlertId,
  AnalyticsRecommendationId,
  type AnalyticsAlert,
  type AnalyticsFilter,
  type AnalyticsRecommendation,
  type CostRecord,
  type OrchestrationEvent,
  type PricingSnapshot,
  type RunPerformanceRecord,
  type TaskOutcomeRecord,
  type UsageRecord,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionUsageAnalyticsRepository } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { forkParked } from "../serverActivation.ts";
import { compareDecimal, divideDecimal, sumDecimals } from "./DecimalMoney.ts";
import { pricingReferenceIsStale } from "./CostCalculator.ts";
import { UsageAnalyticsEventRecorder } from "./UsageAnalyticsEventRecorder.ts";

const QUERY_LIMIT = 500;
const GLOBAL_SCOPE_ID = "current-user";
const ALERT_CATEGORIES = new Set([
  "usage_data_incomplete",
  "pricing_data_stale",
  "fallback_spike",
  "verification_retry_spike",
  "unexpected_cost_increase",
  "provider_cost_discrepancy",
]);

export interface AnalyticsInsightInput {
  readonly usage: ReadonlyArray<UsageRecord>;
  readonly costs: ReadonlyArray<CostRecord>;
  readonly pricing: ReadonlyArray<PricingSnapshot>;
  readonly performance: ReadonlyArray<RunPerformanceRecord>;
  readonly outcomes: ReadonlyArray<TaskOutcomeRecord>;
  readonly minimumSampleSize: number;
  readonly observedAt: string;
}

const alert = (input: {
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly title: string;
  readonly detail: string;
  readonly observedAt: string;
}): AnalyticsAlert => ({
  id: AnalyticsAlertId.make(`analytics-insight:${input.category}`),
  deduplicationKey: `analytics-insight:${input.category}`,
  scopeType: "user",
  scopeId: GLOBAL_SCOPE_ID,
  category: input.category,
  severity: input.severity,
  title: input.title,
  detail: input.detail,
  status: "active",
  createdAt: input.observedAt,
  acknowledgedAt: null,
  resolvedAt: null,
});

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;

const average = (values: ReadonlyArray<string>): string | null => {
  const sum = sumDecimals(values);
  return sum === null ? null : divideDecimal(sum, String(values.length));
};

export const deriveAnalyticsAlerts = (
  input: AnalyticsInsightInput,
): ReadonlyArray<AnalyticsAlert> => {
  const alerts: Array<AnalyticsAlert> = [];
  const unknownUsage = input.usage.filter(
    ({ state, totalTokens }) => state === "unknown" || totalTokens === null,
  ).length;
  if (unknownUsage > 0) {
    alerts.push(
      alert({
        category: "usage_data_incomplete",
        severity: "warning",
        title: "Some run usage is unknown",
        detail: `${unknownUsage} usage record${unknownUsage === 1 ? " is" : "s are"} missing a confirmed token total. Budgets and comparisons preserve that uncertainty rather than treating it as zero.`,
        observedAt: input.observedAt,
      }),
    );
  }

  const pricingById = new Map(input.pricing.map((snapshot) => [snapshot.id, snapshot]));
  const usageById = new Map(input.usage.map((usage) => [usage.id, usage]));
  const stalePricing = input.costs.filter((cost) =>
    pricingReferenceIsStale(
      cost,
      cost.usageRecordId === null ? null : (usageById.get(cost.usageRecordId) ?? null),
      cost.pricingSnapshotId === null ? null : (pricingById.get(cost.pricingSnapshotId) ?? null),
    ),
  ).length;
  if (stalePricing > 0) {
    alerts.push(
      alert({
        category: "pricing_data_stale",
        severity: "warning",
        title: "Historical pricing needs review",
        detail: `${stalePricing} calculated cost record${stalePricing === 1 ? " has" : "s have"} a missing or out-of-range pricing snapshot. Historical records were left unchanged.`,
        observedAt: input.observedAt,
      }),
    );
  }

  const finalized = input.performance.filter(({ status }) => status === "finalized");
  if (finalized.length >= input.minimumSampleSize) {
    const fallbackCount = finalized.filter(({ fallbackCount }) => fallbackCount > 0).length;
    const fallbackRate = ratio(fallbackCount, finalized.length)!;
    if (fallbackRate >= 0.2) {
      alerts.push(
        alert({
          category: "fallback_spike",
          severity: fallbackRate >= 0.5 ? "critical" : "warning",
          title: "Fallback usage is elevated",
          detail: `${fallbackCount} of ${finalized.length} finalized runs used fallback (${Math.round(fallbackRate * 100)}%). This is descriptive; routing policy remains unchanged.`,
          observedAt: input.observedAt,
        }),
      );
    }
  }

  const verifiedOutcomes = input.outcomes.filter(
    ({ verificationResult }) => verificationResult === "passed" || verificationResult === "failed",
  );
  if (verifiedOutcomes.length >= input.minimumSampleSize) {
    const repaired = verifiedOutcomes.filter(
      ({ repairAttemptCount }) => repairAttemptCount > 0,
    ).length;
    const repairRate = ratio(repaired, verifiedOutcomes.length)!;
    if (repairRate >= 0.25) {
      alerts.push(
        alert({
          category: "verification_retry_spike",
          severity: repairRate >= 0.5 ? "critical" : "warning",
          title: "Verification repairs are elevated",
          detail: `${repaired} of ${verifiedOutcomes.length} verified tasks required at least one repair (${Math.round(repairRate * 100)}%).`,
          observedAt: input.observedAt,
        }),
      );
    }
  }

  const knownByCurrency = Map.groupBy(
    input.costs.filter((cost): cost is CostRecord & { amount: string } => cost.amount !== null),
    ({ currency }) => currency,
  );
  for (const [currency, records] of knownByCurrency) {
    const ordered = records.toSorted((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
    if (ordered.length < input.minimumSampleSize * 2) continue;
    const midpoint = Math.floor(ordered.length / 2);
    const before = average(ordered.slice(0, midpoint).map(({ amount }) => amount));
    const after = average(ordered.slice(midpoint).map(({ amount }) => amount));
    if (before === null || after === null || compareDecimal(before, "0") === 0) continue;
    const increaseRatio = divideDecimal(after, before);
    if (compareDecimal(increaseRatio, "1.5") >= 0) {
      alerts.push(
        alert({
          category: `unexpected_cost_increase:${currency}`,
          severity: compareDecimal(increaseRatio, "2") >= 0 ? "critical" : "warning",
          title: `Average ${currency} cost increased`,
          detail: `The later ${ordered.length - midpoint}-record window averaged ${after} ${currency}, versus ${before} ${currency} for the earlier ${midpoint}. Workload mix may explain the correlation.`,
          observedAt: input.observedAt,
        }),
      );
    }
  }

  const comparableCosts = input.costs.filter(
    (cost): cost is CostRecord & { amount: string } =>
      cost.amount !== null &&
      (cost.costType === "provider_reported" || cost.costType === "api_usage"),
  );
  const comparableByRunAndCurrency = Map.groupBy(
    comparableCosts,
    ({ agentRunId, currency }) => `${agentRunId}:${currency}`,
  );
  const discrepanciesByCurrency = new Map<string, number>();
  for (const records of comparableByRunAndCurrency.values()) {
    const providerAmount = sumDecimals(
      records
        .filter(({ costType }) => costType === "provider_reported")
        .map(({ amount }) => amount),
    );
    const calculatedAmount = sumDecimals(
      records.filter(({ costType }) => costType === "api_usage").map(({ amount }) => amount),
    );
    if (providerAmount === null || calculatedAmount === null) continue;
    const smaller =
      compareDecimal(providerAmount, calculatedAmount) <= 0 ? providerAmount : calculatedAmount;
    const larger = smaller === providerAmount ? calculatedAmount : providerAmount;
    const differs =
      compareDecimal(smaller, "0") === 0
        ? compareDecimal(larger, "0") > 0
        : compareDecimal(divideDecimal(larger, smaller), "1.05") >= 0;
    if (!differs) continue;
    const currency = records[0]!.currency;
    discrepanciesByCurrency.set(currency, (discrepanciesByCurrency.get(currency) ?? 0) + 1);
  }
  for (const [currency, count] of discrepanciesByCurrency) {
    alerts.push(
      alert({
        category: `provider_cost_discrepancy:${currency}`,
        severity: "warning",
        title: `Provider and calculated ${currency} cost differ`,
        detail: `${count} run${count === 1 ? " has" : "s have"} a provider-reported amount that differs from the catalogue calculation by at least 5%. Both records were preserved; neither amount replaced the other.`,
        observedAt: input.observedAt,
      }),
    );
  }
  return alerts;
};

const observationWindow = (input: AnalyticsInsightInput) => {
  const timestamps = [
    ...input.performance.map(({ createdAt }) => createdAt),
    ...input.outcomes.map(({ createdAt }) => createdAt),
  ].toSorted();
  return {
    start: timestamps[0] ?? input.observedAt,
    end: input.observedAt,
  };
};

export const deriveAnalyticsRecommendations = (
  input: AnalyticsInsightInput,
): ReadonlyArray<AnalyticsRecommendation> => {
  const window = observationWindow(input);
  const day = input.observedAt.slice(0, 10);
  const recommendations: Array<AnalyticsRecommendation> = [];
  const providers = Map.groupBy(input.performance, ({ providerProfileId }) => providerProfileId);
  for (const [providerProfileId, runs] of providers) {
    const finalized = runs.filter(({ status }) => status === "finalized");
    if (finalized.length < input.minimumSampleSize) continue;
    const transientFailures = finalized.filter(
      ({ completionCategory }) =>
        completionCategory === "failed_provider" || completionCategory === "failed_transport",
    ).length;
    const failureRate = ratio(transientFailures, finalized.length)!;
    if (failureRate < 0.2) continue;
    recommendations.push({
      id: AnalyticsRecommendationId.make(
        `recommendation:${day}:provider-failure:${providerProfileId}`,
      ),
      scopeType: "provider",
      scopeId: providerProfileId,
      title: `Review transient failures for ${providerProfileId}`,
      evidence: `${transientFailures} of ${finalized.length} finalized runs ended with provider or transport failure (${Math.round(failureRate * 100)}%). No routing setting was changed.`,
      sampleSize: finalized.length,
      periodStart: window.start,
      periodEnd: window.end,
      taskSegment: "all routed tasks in the selected observation window",
      metricKeys: ["provider_failure_rate"],
      uncertainty:
        "This is correlation across mixed workloads and network conditions. Capability, privacy, and budget policy still control routing.",
      estimatedCostPresent: false,
      conflictsWithPolicy: false,
      createdAt: input.observedAt,
    });
  }
  return recommendations;
};

const allFilter: AnalyticsFilter = {
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
};

export const UsageAnalyticsInsightsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const repository = yield* ProjectionUsageAnalyticsRepository;
    const orchestration = yield* OrchestrationEngineService;
    const audit = yield* UsageAnalyticsEventRecorder;

    const refresh = (observedAt: string) =>
      Effect.gen(function* () {
        const settings = Option.getOrNull(yield* repository.getSettings());
        if (settings?.enabled === false) return;
        const [
          usage,
          costs,
          pricing,
          performance,
          outcomes,
          existingAlerts,
          existingRecommendations,
        ] = yield* Effect.all(
          [
            repository.queryUsageRecords({ filter: allFilter, limit: QUERY_LIMIT, offset: 0 }),
            repository.queryCostRecords({ filter: allFilter, limit: QUERY_LIMIT, offset: 0 }),
            repository.listPricingSnapshots({
              providerProfileId: null,
              modelProfileId: null,
              currency: null,
              effectiveAt: null,
              limit: QUERY_LIMIT,
              offset: 0,
            }),
            repository.queryRunPerformance({ filter: allFilter, limit: QUERY_LIMIT, offset: 0 }),
            repository.queryTaskOutcomes({ filter: allFilter, limit: QUERY_LIMIT, offset: 0 }),
            repository.listAlerts({
              scopeType: null,
              scopeId: null,
              limit: QUERY_LIMIT,
              offset: 0,
            }),
            repository.listRecommendations({
              scopeType: null,
              scopeId: null,
              limit: QUERY_LIMIT,
              offset: 0,
            }),
          ] as const,
          { concurrency: "unbounded" },
        );
        const input: AnalyticsInsightInput = {
          usage,
          costs,
          pricing,
          performance,
          outcomes,
          minimumSampleSize: settings?.minimumComparisonSampleSize ?? 5,
          observedAt,
        };
        const derivedAlerts = deriveAnalyticsAlerts(input);
        const activeKeys = new Set(derivedAlerts.map(({ deduplicationKey }) => deduplicationKey));
        yield* Effect.forEach(
          derivedAlerts,
          (derived) => {
            const existing = existingAlerts.find(
              ({ deduplicationKey }) => deduplicationKey === derived.deduplicationKey,
            );
            return existing === undefined
              ? repository.upsertAlert(derived).pipe(
                  Effect.andThen(
                    audit
                      .record({
                        eventType: "analytics.alert_created",
                        aggregateId: "analytics:current-user",
                        payload: {
                          recordType: "analytics_alert",
                          recordId: derived.id,
                          projectId: null,
                          missionId: null,
                          taskId: null,
                          agentRunId: null,
                          usageRecordId: null,
                          costRecordId: null,
                          humanDispositionRecordId: null,
                          budgetPolicyId: null,
                          exportId: null,
                          retentionOperationId: null,
                          detail: derived.detail,
                        },
                      })
                      .pipe(
                        Effect.catchCause((cause) =>
                          Effect.logWarning("analytics alert audit failed", {
                            alertId: derived.id,
                            cause: Cause.pretty(cause),
                          }),
                        ),
                      ),
                  ),
                )
              : Effect.void;
          },
          { concurrency: 4, discard: true },
        );
        yield* Effect.forEach(
          existingAlerts.filter(
            ({ category, status, deduplicationKey }) =>
              ALERT_CATEGORIES.has(category.split(":")[0]!) &&
              status === "active" &&
              !activeKeys.has(deduplicationKey),
          ),
          (existing) =>
            repository.upsertAlert({
              ...existing,
              status: "resolved",
              resolvedAt: observedAt,
            }),
          { concurrency: 4, discard: true },
        );
        const knownRecommendationIds = new Set(existingRecommendations.map(({ id }) => id));
        yield* Effect.forEach(
          deriveAnalyticsRecommendations(input).filter(({ id }) => !knownRecommendationIds.has(id)),
          (recommendation) =>
            repository.insertRecommendation(recommendation).pipe(
              Effect.andThen(
                audit.record({
                  eventType: "analytics.recommendation_created",
                  aggregateId: "analytics:current-user",
                  payload: {
                    recordType: "recommendation",
                    recordId: recommendation.id,
                    projectId: null,
                    missionId: null,
                    taskId: null,
                    agentRunId: null,
                    usageRecordId: null,
                    costRecordId: null,
                    budgetPolicyId: null,
                    exportId: null,
                    retentionOperationId: null,
                    humanDispositionRecordId: null,
                    detail: recommendation.evidence,
                  },
                }),
              ),
            ),
          { concurrency: 4, discard: true },
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("analytics insight refresh failed without affecting orchestration", {
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const startedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    yield* refresh(startedAt);
    const terminalEvents = orchestration.streamDomainEvents.pipe(
      Stream.filter(
        (event: OrchestrationEvent) =>
          event.type === "analytics.run_performance_finalized" ||
          event.type === "analytics.task_outcome_updated" ||
          event.type === "analytics.pricing_snapshot_created" ||
          event.type === "analytics.pricing_snapshot_updated",
      ),
      Stream.mapEffect((event) => refresh(event.occurredAt), { concurrency: 1 }),
    );
    yield* forkParked(Stream.runDrain(terminalEvents));
  }),
);
