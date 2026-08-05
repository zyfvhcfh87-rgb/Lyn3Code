import {
  ANALYTICS_METRIC_VERSION,
  AnalyticsAggregateId,
  AnalyticsExportId,
  HumanDispositionRecordId,
  AnalyticsNotFoundError,
  AnalyticsRetentionOperationId,
  AnalyticsUnavailableError,
  type AnalyticsAggregateRebuildInput,
  type AnalyticsAlert,
  type AnalyticsAlertAcknowledgeInput,
  type AnalyticsAnnotation,
  type AnalyticsComparisonRow,
  type AnalyticsCurrency,
  type AnalyticsCurrencyTotal,
  type ExchangeRateSnapshot,
  type AnalyticsExport,
  type AnalyticsExportCreateInput,
  type AnalyticsFilter,
  type AnalyticsRetentionOperation,
  type AnalyticsRetentionStartInput,
  type AnalyticsRunDetail,
  type AnalyticsSettings,
  type AnalyticsWorkspaceSnapshot,
  type BudgetEvent,
  type BudgetEventAcknowledgeInput,
  type BudgetOverride,
  type BudgetPolicy,
  type CostRecord,
  type HumanDispositionRecord,
  type HumanDispositionRecordInput,
  type MissionOutcomeRecord,
  type PricingSnapshot,
  type RunPerformanceRecord,
  type SubscriptionAttributionRule,
  type TaskOutcomeRecord,
  type UsageRecord,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { ProjectionAgentRunRepository } from "../persistence/Services/ProjectionAgentRuns.ts";
import { ProjectionMissionTeamRepository } from "../persistence/Services/ProjectionMissionTeams.ts";
import { ProjectionUsageAnalyticsRepository } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { UsageAnalyticsEventRecorder } from "./UsageAnalyticsEventRecorder.ts";
import { pricingReferenceIsStale } from "./CostCalculator.ts";
import { convertCurrencyTotals } from "./CurrencyConversion.ts";
import { addDecimal, divideDecimal } from "./DecimalMoney.ts";
import { forecastMetric } from "./Forecasting.ts";
import {
  calculateFallbackRate,
  calculateFirstPassVerificationRate,
  calculateHumanAcceptanceRate,
  calculateRepairRate,
  countVerifiedTasks,
  METRIC_CATALOGUE_V1,
} from "./MetricCatalogue.ts";
import { allocateSubscriptionCosts } from "./SubscriptionAttribution.ts";

const queryLimit = 500;
const maximumRecordOffset = 100_000;
const operationLimit = 100;
const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);

export const DEFAULT_ANALYTICS_SETTINGS = (updatedAt: string): AnalyticsSettings => ({
  enabled: true,
  detailRetentionDays: 90,
  aggregateRetentionDays: null,
  exportRetentionDays: 30,
  pricingSourcePriority: [
    "provider_reported",
    "official_catalog",
    "user_configured",
    "subscription_plan",
    "unknown",
  ],
  defaultReportingCurrency: "USD",
  subscriptionAttributionMode: "none",
  localComputeHourlyRate: null,
  outcomeObservationWindowDays: 30,
  minimumComparisonSampleSize: 5,
  forecastMethod: "current_period_run_rate",
  detailLevel: "standard",
  storePromptContent: false,
  updatedAt,
});

const unavailable = (operation: string, cause: unknown) =>
  new AnalyticsUnavailableError({
    message: `${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const sumKnownMilliseconds = (values: ReadonlyArray<number | null>): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
};

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

interface CurrencyAccumulator {
  providerReportedAmount: string;
  calculatedEstimateAmount: string;
  subscriptionAllocationAmount: string;
  localComputeEstimateAmount: string;
  unknownCostRecordCount: number;
}

const currencyTotals = (
  costs: ReadonlyArray<CostRecord>,
): ReadonlyArray<AnalyticsCurrencyTotal> => {
  const totals = new Map<AnalyticsCurrency, CurrencyAccumulator>();
  for (const cost of costs) {
    const current = totals.get(cost.currency) ?? {
      providerReportedAmount: "0",
      calculatedEstimateAmount: "0",
      subscriptionAllocationAmount: "0",
      localComputeEstimateAmount: "0",
      unknownCostRecordCount: 0,
    };
    if (cost.amount === null) {
      current.unknownCostRecordCount += 1;
    } else if (cost.costType === "provider_reported") {
      current.providerReportedAmount = addDecimal(current.providerReportedAmount, cost.amount);
    } else if (cost.costType === "subscription_attribution") {
      current.subscriptionAllocationAmount = addDecimal(
        current.subscriptionAllocationAmount,
        cost.amount,
      );
    } else if (cost.costType === "local_compute_estimate") {
      current.localComputeEstimateAmount = addDecimal(
        current.localComputeEstimateAmount,
        cost.amount,
      );
    } else {
      current.calculatedEstimateAmount = addDecimal(current.calculatedEstimateAmount, cost.amount);
    }
    totals.set(cost.currency, current);
  }
  return [...totals.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([currency, total]) => ({ currency, ...total }));
};

export const comparisonRows = (input: {
  readonly performance: ReadonlyArray<RunPerformanceRecord>;
  readonly usage: ReadonlyArray<UsageRecord>;
  readonly costs: ReadonlyArray<CostRecord>;
  readonly outcomes: ReadonlyArray<TaskOutcomeRecord>;
  readonly agentRolesByRun?: ReadonlyMap<
    string,
    { readonly scopeId: string; readonly label: string }
  >;
  readonly minimumSampleSize: number;
}): ReadonlyArray<AnalyticsComparisonRow> => {
  const scopes = new Map<
    string,
    {
      type: "provider" | "model" | "agent_role" | "reasoning";
      id: string;
      label: string;
    }
  >();
  for (const run of input.performance) {
    scopes.set(`provider:${run.providerProfileId}`, {
      type: "provider",
      id: run.providerProfileId,
      label: run.providerProfileId,
    });
    scopes.set(`model:${run.modelProfileId}`, {
      type: "model",
      id: run.modelProfileId,
      label: run.modelProfileId,
    });
    const reasoningLevel = run.reasoningLevel ?? "provider_default";
    scopes.set(`reasoning:${reasoningLevel}`, {
      type: "reasoning",
      id: reasoningLevel,
      label: reasoningLevel,
    });
    const role = input.agentRolesByRun?.get(run.agentRunId);
    if (role !== undefined) {
      scopes.set(`agent_role:${role.scopeId}`, {
        type: "agent_role",
        id: role.scopeId,
        label: role.label,
      });
    }
  }

  return [...scopes.values()]
    .map(({ type, id, label }): AnalyticsComparisonRow => {
      const runs = input.performance.filter((run) => {
        if (type === "provider") return run.providerProfileId === id;
        if (type === "model") return run.modelProfileId === id;
        if (type === "agent_role") {
          return input.agentRolesByRun?.get(run.agentRunId)?.scopeId === id;
        }
        return (run.reasoningLevel ?? "provider_default") === id;
      });
      const runIds = new Set(runs.map(({ agentRunId }) => agentRunId));
      const taskIds = new Set(runs.flatMap(({ taskId }) => (taskId === null ? [] : [taskId])));
      const outcomes = input.outcomes.filter(({ taskId }) => taskIds.has(taskId));
      const usage = input.usage.filter(({ agentRunId }) => runIds.has(agentRunId));
      const costs = input.costs.filter(({ agentRunId }) => runIds.has(agentRunId));
      const firstPass = calculateFirstPassVerificationRate(outcomes);
      const repair = calculateRepairRate(outcomes);
      const acceptance = calculateHumanAcceptanceRate(outcomes);
      const fallback = calculateFallbackRate(runs);
      const finalized = runs.filter(({ status }) => status === "finalized");
      const completed = finalized.filter(
        ({ completionCategory }) => completionCategory === "completed",
      );
      const knownLatencies = runs
        .map(({ firstOutputLatencyMilliseconds }) => firstOutputLatencyMilliseconds)
        .filter((value): value is number => value !== null);
      const verifiedTaskCount = countVerifiedTasks(outcomes);
      const knownTokens = usage
        .map(({ totalTokens }) => totalTokens)
        .filter((value): value is number => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const missingUsage = runs.filter(
        ({ agentRunId }) =>
          !usage.some((record) => record.agentRunId === agentRunId && record.totalTokens !== null),
      ).length;
      const missingCost = runs.filter(
        ({ agentRunId }) =>
          !costs.some((record) => record.agentRunId === agentRunId && record.amount !== null),
      ).length;
      const estimatedCostCount = costs.filter(({ isEstimated }) => isEstimated).length;
      return {
        scopeType: type,
        scopeId: id,
        label,
        taskCount: taskIds.size,
        runCount: runs.length,
        completionRate: ratio(completed.length, finalized.length),
        firstPassVerificationRate: firstPass.value === null ? null : Number(firstPass.value),
        repairRate: repair.value === null ? null : Number(repair.value),
        fallbackRate: fallback.value === null ? null : Number(fallback.value),
        averageFirstOutputLatencyMilliseconds:
          knownLatencies.length === 0
            ? null
            : Math.round(
                knownLatencies.reduce((sum, value) => sum + value, 0) / knownLatencies.length,
              ),
        tokensPerVerifiedTask:
          verifiedTaskCount === 0 || knownTokens === 0
            ? null
            : divideDecimal(knownTokens.toString(), verifiedTaskCount.toString()),
        humanAcceptanceRate: acceptance.value === null ? null : Number(acceptance.value),
        missingDataRatio: ratio(missingUsage + missingCost, Math.max(1, runs.length * 2)) ?? 0,
        estimatedCostRatio: ratio(estimatedCostCount, costs.length) ?? 0,
        insufficientSample: taskIds.size < input.minimumSampleSize,
      };
    })
    .toSorted(
      (left, right) =>
        left.scopeType.localeCompare(right.scopeType) || left.scopeId.localeCompare(right.scopeId),
    );
};

const safeFilterMetadata = (filter: AnalyticsFilter) => ({
  from: filter.dateRange.from,
  to: filter.dateRange.to,
  projectId: filter.projectId,
  missionId: filter.missionId,
  taskId: filter.taskId,
  agentRunId: filter.agentRunId,
  providerProfileId: filter.providerProfileId,
  modelProfileId: filter.modelProfileId,
  agentRoleId: filter.agentRoleId,
  reasoningLevel: filter.reasoningLevel,
  humanDisposition: filter.humanDisposition,
  subscriptionBacked: filter.subscriptionBacked,
});

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const buildAnalyticsExportRows = (input: {
  readonly usage: ReadonlyArray<UsageRecord>;
  readonly costs: ReadonlyArray<CostRecord>;
  readonly performance: ReadonlyArray<RunPerformanceRecord>;
  readonly outcomes: ReadonlyArray<TaskOutcomeRecord>;
  readonly missionOutcomes: ReadonlyArray<MissionOutcomeRecord>;
}) => [
  ...METRIC_CATALOGUE_V1.map((definition) => ({
    schemaVersion: 1,
    metricVersion: definition.version,
    recordType: "metric_definition",
    id: definition.key,
    projectId: null,
    missionId: null,
    taskId: null,
    agentRunId: null,
    timestamp: null,
    status: definition.numerator,
    value: definition.denominator,
    unit: definition.unit,
    currency: null,
    provenance: "canonical_metric_catalogue",
    confidence: "confirmed",
    attribution: "not_applicable",
    reference: null,
  })),
  ...input.usage.map((record) => ({
    schemaVersion: 1,
    metricVersion: ANALYTICS_METRIC_VERSION,
    recordType: "usage",
    id: record.id,
    projectId: record.projectId,
    missionId: record.missionId,
    taskId: record.taskId,
    agentRunId: record.agentRunId,
    timestamp: record.recordedAt,
    status: record.state,
    value: record.totalTokens,
    unit: "tokens",
    currency: null,
    provenance: record.usageSource,
    confidence: record.usageConfidence,
    attribution: record.parentAgentRunId === null ? "exclusive_root_run" : "exclusive_subagent_run",
    reference: record.routingDecisionId,
  })),
  ...input.costs.map((record) => ({
    schemaVersion: 1,
    metricVersion: ANALYTICS_METRIC_VERSION,
    recordType: "cost",
    id: record.id,
    projectId: record.projectId,
    missionId: record.missionId,
    taskId: record.taskId,
    agentRunId: record.agentRunId,
    timestamp: record.createdAt,
    status: record.costType,
    value: record.amount,
    unit: "currency",
    currency: record.currency,
    provenance: record.calculationMethod,
    confidence: record.confidence,
    attribution: "exclusive_agent_run",
    reference: record.pricingSnapshotId,
  })),
  ...input.performance.map((record) => ({
    schemaVersion: 1,
    metricVersion: ANALYTICS_METRIC_VERSION,
    recordType: "run_performance",
    id: record.id,
    projectId: null,
    missionId: record.missionId,
    taskId: record.taskId,
    agentRunId: record.agentRunId,
    timestamp: record.updatedAt,
    status: record.completionCategory,
    value: record.wallClockDurationMilliseconds,
    unit: "milliseconds",
    currency: null,
    provenance: "orchestration_lifecycle",
    confidence: record.status === "finalized" ? "confirmed" : "unknown",
    attribution: "exclusive_agent_run",
    reference: null,
  })),
  ...input.outcomes.map((record) => ({
    schemaVersion: 1,
    metricVersion: ANALYTICS_METRIC_VERSION,
    recordType: "task_outcome",
    id: record.id,
    projectId: null,
    missionId: record.missionId,
    taskId: record.taskId,
    agentRunId: null,
    timestamp: record.updatedAt,
    status: record.status,
    value: record.verificationResult,
    unit: "outcome",
    currency: null,
    provenance: "verification_projection",
    confidence: record.verificationResult === null ? "unknown" : "confirmed",
    attribution: "inclusive_task",
    reference: null,
  })),
  ...input.missionOutcomes.map((record) => ({
    schemaVersion: 1,
    metricVersion: ANALYTICS_METRIC_VERSION,
    recordType: "mission_outcome",
    id: record.id,
    projectId: null,
    missionId: record.missionId,
    taskId: null,
    agentRunId: null,
    timestamp: record.updatedAt,
    status: record.status,
    value: record.pullRequestMerged
      ? "pull_request_merged"
      : record.pullRequestCreated
        ? "pull_request_created"
        : null,
    unit: "outcome",
    currency: null,
    provenance: "mission_and_github_projections",
    confidence: record.status === "pending" ? "unknown" : "confirmed",
    attribution: "inclusive_mission",
    reference: null,
  })),
];

export interface UsageAnalyticsWorkspaceServiceShape {
  readonly getWorkspace: (
    filter: AnalyticsFilter,
  ) => Effect.Effect<AnalyticsWorkspaceSnapshot, AnalyticsUnavailableError>;
  readonly getRunDetail: (
    agentRunId: import("@t3tools/contracts").AgentRunId,
  ) => Effect.Effect<AnalyticsRunDetail, AnalyticsUnavailableError>;
  readonly updateSettings: (
    settings: AnalyticsSettings,
  ) => Effect.Effect<AnalyticsSettings, AnalyticsUnavailableError>;
  readonly saveBudget: (
    policy: BudgetPolicy,
  ) => Effect.Effect<BudgetPolicy, AnalyticsUnavailableError>;
  readonly savePricingSnapshot: (
    snapshot: PricingSnapshot,
  ) => Effect.Effect<PricingSnapshot, AnalyticsUnavailableError>;
  readonly saveSubscriptionAttributionRule: (
    rule: SubscriptionAttributionRule,
  ) => Effect.Effect<SubscriptionAttributionRule, AnalyticsUnavailableError>;
  readonly saveExchangeRateSnapshot: (
    snapshot: ExchangeRateSnapshot,
  ) => Effect.Effect<ExchangeRateSnapshot, AnalyticsUnavailableError>;
  readonly acknowledgeBudgetEvent: (
    input: BudgetEventAcknowledgeInput,
  ) => Effect.Effect<BudgetEvent, AnalyticsNotFoundError | AnalyticsUnavailableError>;
  readonly createBudgetOverride: (
    override: BudgetOverride,
  ) => Effect.Effect<BudgetOverride, AnalyticsUnavailableError>;
  readonly acknowledgeAlert: (
    input: AnalyticsAlertAcknowledgeInput,
  ) => Effect.Effect<AnalyticsAlert, AnalyticsNotFoundError | AnalyticsUnavailableError>;
  readonly saveAnnotation: (
    annotation: AnalyticsAnnotation,
  ) => Effect.Effect<AnalyticsAnnotation, AnalyticsUnavailableError>;
  readonly recordHumanDisposition: (
    input: HumanDispositionRecordInput,
  ) => Effect.Effect<HumanDispositionRecord, AnalyticsNotFoundError | AnalyticsUnavailableError>;
  readonly createExport: (
    input: AnalyticsExportCreateInput,
  ) => Effect.Effect<AnalyticsExport, AnalyticsUnavailableError>;
  readonly startRetention: (
    input: AnalyticsRetentionStartInput,
  ) => Effect.Effect<AnalyticsRetentionOperation, AnalyticsUnavailableError>;
  readonly rebuildAggregates: (
    input: AnalyticsAggregateRebuildInput,
  ) => Effect.Effect<{ readonly accepted: boolean }, AnalyticsUnavailableError>;
  readonly subscribeWorkspace: (
    filter: AnalyticsFilter,
  ) => Stream.Stream<AnalyticsWorkspaceSnapshot, AnalyticsUnavailableError>;
}

export class UsageAnalyticsWorkspaceService extends Context.Service<
  UsageAnalyticsWorkspaceService,
  UsageAnalyticsWorkspaceServiceShape
>()("t3/usage-analytics/UsageAnalyticsWorkspaceService") {}

export const make = Effect.gen(function* () {
  const repository = yield* ProjectionUsageAnalyticsRepository;
  const agentRuns = yield* ProjectionAgentRunRepository;
  const missionTeams = yield* ProjectionMissionTeamRepository;
  const audit = yield* UsageAnalyticsEventRecorder;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const changes = yield* PubSub.unbounded<void>();

  const persist = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.mapError((cause) => unavailable(operation, cause)));
  const publish = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const recordAudit = (
    eventType: Parameters<typeof audit.record>[0]["eventType"],
    aggregateId: string,
    payload: Parameters<typeof audit.record>[0]["payload"],
  ) =>
    audit.record({ eventType, aggregateId, payload }).pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning("analytics workspace audit failed without losing the durable record", {
          eventType,
          recordId: payload.recordId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const removeExportFile = (item: AnalyticsExport) =>
    Effect.gen(function* () {
      if (item.relativeFilePath === null) return;
      const lexicalRoot = path.resolve(config.stateDir, "analytics", "exports");
      const lexicalFile = path.resolve(config.stateDir, item.relativeFilePath);
      const lexicalPrefix = lexicalRoot.endsWith(path.sep)
        ? lexicalRoot
        : `${lexicalRoot}${path.sep}`;
      if (!lexicalFile.startsWith(lexicalPrefix)) {
        return yield* new AnalyticsUnavailableError({
          message: "refused to remove an analytics export outside the managed export directory",
        });
      }
      if (!(yield* fileSystem.exists(lexicalFile).pipe(Effect.orElseSucceed(() => false)))) return;
      const [canonicalRoot, canonicalFile] = yield* Effect.all([
        fileSystem.realPath(lexicalRoot),
        fileSystem.realPath(lexicalFile),
      ] as const).pipe(
        Effect.mapError((cause) => unavailable("resolve retained analytics export", cause)),
      );
      const canonicalPrefix = canonicalRoot.endsWith(path.sep)
        ? canonicalRoot
        : `${canonicalRoot}${path.sep}`;
      if (!canonicalFile.startsWith(canonicalPrefix)) {
        return yield* new AnalyticsUnavailableError({
          message: "refused to follow an analytics export link outside the managed directory",
        });
      }
      yield* fileSystem
        .remove(canonicalFile)
        .pipe(Effect.mapError((cause) => unavailable("remove retained analytics export", cause)));
    });

  const settings = Effect.gen(function* () {
    const stored = yield* persist("read analytics settings", repository.getSettings());
    return Option.getOrElse(stored, () => DEFAULT_ANALYTICS_SETTINGS("1970-01-01T00:00:00.000Z"));
  });

  const readAllPages = <Row, Error>(
    load: (offset: number) => Effect.Effect<ReadonlyArray<Row>, Error>,
  ) =>
    Effect.gen(function* () {
      const rows: Array<Row> = [];
      for (let offset = 0; offset <= maximumRecordOffset; offset += queryLimit) {
        const page = yield* load(offset);
        rows.push(...page);
        if (page.length < queryLimit) break;
      }
      return rows;
    });

  const readRecords = (filter: AnalyticsFilter) =>
    Effect.all(
      {
        usage: readAllPages((offset) =>
          repository.queryUsageRecords({ filter, limit: queryLimit, offset }),
        ),
        costs: readAllPages((offset) =>
          repository.queryCostRecords({ filter, limit: queryLimit, offset }),
        ),
        performance: readAllPages((offset) =>
          repository.queryRunPerformance({ filter, limit: queryLimit, offset }),
        ),
        taskOutcomes: readAllPages((offset) =>
          repository.queryTaskOutcomes({ filter, limit: queryLimit, offset }),
        ),
        missionOutcomes: readAllPages((offset) =>
          repository.queryMissionOutcomes({ filter, limit: queryLimit, offset }),
        ),
      },
      { concurrency: "unbounded" },
    ).pipe(Effect.mapError((cause) => unavailable("read analytics records", cause)));

  const subscriptionRuleFilter = (rule: SubscriptionAttributionRule): AnalyticsFilter => ({
    dateRange: { from: rule.periodStart, to: rule.periodEnd },
    projectId: null,
    missionId: null,
    taskId: null,
    agentRunId: null,
    providerProfileId: rule.providerProfileId,
    modelProfileId: rule.modelProfileId,
    agentRoleId: null,
    reasoningLevel: null,
    humanDisposition: null,
    subscriptionBacked: null,
  });

  const rebuildSubscriptionAttribution = Effect.fn(
    "UsageAnalyticsWorkspaceService.rebuildSubscriptionAttribution",
  )(function* (rule: SubscriptionAttributionRule, calculatedAt: string) {
    const filter = subscriptionRuleFilter(rule);
    const [configuration, usage, performance] = yield* Effect.all(
      [
        settings,
        persist(
          "read subscription-period usage",
          readAllPages((offset) =>
            repository.queryUsageRecords({ filter, limit: queryLimit, offset }),
          ),
        ),
        persist(
          "read subscription-period performance",
          readAllPages((offset) =>
            repository.queryRunPerformance({ filter, limit: queryLimit, offset }),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const result = allocateSubscriptionCosts({
      rule,
      configuredMode: configuration.subscriptionAttributionMode,
      usage,
      performance,
      calculatedAt,
    });
    yield* persist(
      "replace current subscription accounting allocations",
      repository.replaceSubscriptionAllocations({
        ruleId: rule.id,
        periodStart: rule.periodStart,
        periodEnd: rule.periodEnd,
        revision: result.revision,
        allocatedAt: calculatedAt,
        records: result.records,
      }),
    );
    yield* recordAudit(
      "analytics.subscription_allocation_rebuilt",
      `analytics:subscription:${rule.id}`,
      {
        recordType: "subscription_allocation",
        recordId: rule.id,
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
        detail: `${result.status}:${result.revision}:${result.withheldReason ?? "complete"}`,
      },
    );
    return result;
  });

  const rebuildAllSubscriptionAttributions = Effect.fn(
    "UsageAnalyticsWorkspaceService.rebuildAllSubscriptionAttributions",
  )(function* (calculatedAt: string) {
    const rules = yield* readAllPages((offset) =>
      repository.listSubscriptionAttributionRules({
        providerProfileId: null,
        modelProfileId: null,
        periodStart: null,
        periodEnd: calculatedAt,
        limit: queryLimit,
        offset,
      }),
    ).pipe(Effect.mapError((cause) => unavailable("read subscription attribution rules", cause)));
    yield* Effect.forEach(rules, (rule) => rebuildSubscriptionAttribution(rule, calculatedAt), {
      concurrency: 1,
      discard: true,
    });
  });

  const readAgentRoleAttributions = (performance: ReadonlyArray<RunPerformanceRecord>) =>
    Effect.gen(function* () {
      const roleDefinitions = yield* missionTeams.listAgentRoles().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("analytics agent role definitions were unavailable", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as([])),
        ),
      );
      const roleLabels = new Map(roleDefinitions.map((role) => [role.id, role.name]));
      const performanceRunIds = new Set(performance.map(({ agentRunId }) => agentRunId));
      const missionIds = [...new Set(performance.map(({ missionId }) => missionId))].toSorted(
        (left, right) => left.localeCompare(right),
      );
      const missionRows = yield* Effect.forEach(
        missionIds,
        (missionId) =>
          Effect.all(
            {
              runs: agentRuns.listByMissionId({ missionId }),
              missionAgents: missionTeams.listMissionAgentsByMissionId({ missionId }),
            },
            { concurrency: "unbounded" },
          ).pipe(
            Effect.map((rows) => ({ missionId, ...rows })),
            Effect.catchCause((cause) =>
              Effect.logWarning("analytics skipped unavailable mission agent roles", {
                missionId,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(null)),
            ),
          ),
        { concurrency: 4 },
      );
      const result = new Map<string, { readonly scopeId: string; readonly label: string }>();
      for (const mission of missionRows) {
        if (mission === null) continue;
        const agentsById = new Map(mission.missionAgents.map((agent) => [agent.id, agent]));
        for (const run of mission.runs) {
          if (!performanceRunIds.has(run.id) || run.missionAgentId === null) continue;
          const agent = agentsById.get(run.missionAgentId);
          if (agent === undefined) continue;
          const scopeId = agent.roleId ?? `kind:${agent.roleKind}`;
          result.set(run.id, {
            scopeId,
            label:
              agent.roleId === null
                ? agent.roleKind
                : (roleLabels.get(agent.roleId) ?? agent.roleKind),
          });
        }
      }
      return result;
    });

  const getWorkspace: UsageAnalyticsWorkspaceServiceShape["getWorkspace"] = (filter) =>
    Effect.gen(function* () {
      const [
        configuration,
        records,
        pricingSnapshots,
        subscriptionAttributionRules,
        exchangeRateSnapshots,
        budgets,
        budgetEvents,
        alerts,
        recommendations,
        annotations,
        exports,
        retentionOperations,
      ] = yield* Effect.all(
        [
          settings,
          readRecords(filter),
          persist(
            "read analytics pricing snapshots",
            repository.listPricingSnapshots({
              providerProfileId: filter.providerProfileId,
              modelProfileId: filter.modelProfileId,
              currency: null,
              effectiveAt: null,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read subscription attribution rules",
            repository.listSubscriptionAttributionRules({
              providerProfileId: filter.providerProfileId,
              modelProfileId: filter.modelProfileId,
              periodStart: filter.dateRange.from,
              periodEnd: filter.dateRange.to,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read analytics exchange-rate snapshots",
            repository.listExchangeRateSnapshots({
              baseCurrency: null,
              quoteCurrency: null,
              effectiveAt: filter.dateRange.to,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read analytics budgets",
            repository.listBudgetPolicies({
              scopeType: null,
              scopeId: null,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read analytics budget events",
            repository.listBudgetEvents({
              scopeType: null,
              scopeId: null,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read analytics alerts",
            repository.listAlerts({ scopeType: null, scopeId: null, limit: queryLimit, offset: 0 }),
          ),
          persist(
            "read analytics recommendations",
            repository.listRecommendations({
              scopeType: null,
              scopeId: null,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read analytics annotations",
            repository.listAnnotations({
              scopeType: null,
              scopeId: null,
              limit: queryLimit,
              offset: 0,
            }),
          ),
          persist(
            "read analytics exports",
            repository.listExports({ status: null, limit: operationLimit, offset: 0 }),
          ),
          persist(
            "read analytics retention operations",
            repository.listRetentionOperations({ status: null, limit: operationLimit, offset: 0 }),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const firstPass = calculateFirstPassVerificationRate(records.taskOutcomes);
      const repair = calculateRepairRate(records.taskOutcomes);
      const acceptance = calculateHumanAcceptanceRate(records.taskOutcomes);
      const fallback = calculateFallbackRate(records.performance);
      const agentRolesByRun = yield* readAgentRoleAttributions(records.performance);
      const knownCostUsageIds = new Set(
        records.costs.flatMap(({ usageRecordId, amount }) =>
          usageRecordId !== null && amount !== null ? [usageRecordId] : [],
        ),
      );
      const pricingById = new Map(pricingSnapshots.map((snapshot) => [snapshot.id, snapshot]));
      const usageById = new Map(records.usage.map((usage) => [usage.id, usage]));
      const stalePricingCount = records.costs.filter((cost) =>
        pricingReferenceIsStale(
          cost,
          cost.usageRecordId === null ? null : (usageById.get(cost.usageRecordId) ?? null),
          cost.pricingSnapshotId === null
            ? null
            : (pricingById.get(cost.pricingSnapshotId) ?? null),
        ),
      ).length;
      const completedMissionCount = records.missionOutcomes.filter(
        ({ status }) => status === "completed",
      ).length;
      const reportCurrencyTotals = currencyTotals(records.costs);
      const forecastStart = filter.dateRange.from ?? "1970-01-01T00:00:00.000Z";
      const forecastEnd = filter.dateRange.to ?? (yield* now);
      const convertedCurrencyTotals = convertCurrencyTotals({
        totals: reportCurrencyTotals,
        reportingCurrency: configuration.defaultReportingCurrency,
        snapshots: exchangeRateSnapshots,
        asOf: forecastEnd,
      }).converted;
      const forecasts = reportCurrencyTotals.map(({ currency }) =>
        forecastMetric({
          metricKey: `cost_${currency.toLowerCase()}`,
          unit: currency,
          method: configuration.forecastMethod,
          observationStart: forecastStart,
          observationEnd: forecastEnd,
          asOf: forecastEnd,
          observations: records.costs
            .filter((cost) => cost.currency === currency)
            .map((cost) => ({
              value: cost.amount,
              observedAt: cost.createdAt,
              estimated: cost.isEstimated,
              currency: cost.currency,
            })),
          minimumSampleSize: configuration.minimumComparisonSampleSize,
          expectedSampleCount: null,
        }),
      );

      return {
        settings: configuration,
        overview: {
          metricVersion: ANALYTICS_METRIC_VERSION,
          completedMissionCount,
          verifiedTaskCount: countVerifiedTasks(records.taskOutcomes),
          firstPassVerificationRate: firstPass.value === null ? null : Number(firstPass.value),
          totalAgentRunCount: records.performance.length,
          fallbackRate: fallback.value === null ? null : Number(fallback.value),
          repairRate: repair.value === null ? null : Number(repair.value),
          humanAcceptanceRate: acceptance.value === null ? null : Number(acceptance.value),
          activeAgentMilliseconds:
            sumKnownMilliseconds(
              records.performance.map(
                ({ activeDurationMilliseconds }) => activeDurationMilliseconds,
              ),
            ) ?? 0,
          wallClockDeliveryMilliseconds: sumKnownMilliseconds(
            records.performance.map(
              ({ wallClockDurationMilliseconds }) => wallClockDurationMilliseconds,
            ),
          ),
          currencyTotals: reportCurrencyTotals,
          convertedCurrencyTotals,
          dataQuality: {
            runCount: records.performance.length,
            providerReportedUsageCount: records.usage.filter(
              ({ usageSource }) => usageSource === "provider_reported",
            ).length,
            estimatedUsageCount: records.usage.filter(
              ({ usageSource }) =>
                usageSource === "tokenizer_estimated" || usageSource === "context_estimated",
            ).length,
            unknownUsageCount: records.usage.filter(({ usageSource }) => usageSource === "unknown")
              .length,
            pricedUsageCount: knownCostUsageIds.size,
            unpricedUsageCount: records.usage.filter(({ id }) => !knownCostUsageIds.has(id)).length,
            stalePricingCount,
            incompleteOutcomeCount: records.taskOutcomes.filter(
              ({ status, verificationResult }) =>
                status === "pending" || verificationResult === null,
            ).length,
            pendingHumanDispositionCount: records.taskOutcomes.filter(
              ({ humanDisposition }) =>
                humanDisposition === "unknown" || humanDisposition === "not_reviewed",
            ).length,
            sourceDetailDeletedCount: 0,
          },
        },
        comparisons: comparisonRows({
          performance: records.performance,
          usage: records.usage,
          costs: records.costs,
          outcomes: records.taskOutcomes,
          agentRolesByRun,
          minimumSampleSize: configuration.minimumComparisonSampleSize,
        }),
        forecasts,
        pricingSnapshots,
        subscriptionAttributionRules,
        exchangeRateSnapshots,
        budgets,
        budgetEvents,
        activeAlerts: alerts.filter(({ status }) => status === "active"),
        recommendations,
        annotations,
        exports,
        retentionOperations,
      };
    });

  const getRunDetail: UsageAnalyticsWorkspaceServiceShape["getRunDetail"] = (agentRunId) =>
    Effect.gen(function* () {
      const filter: AnalyticsFilter = {
        dateRange: { from: null, to: null },
        projectId: null,
        missionId: null,
        taskId: null,
        agentRunId,
        providerProfileId: null,
        modelProfileId: null,
        agentRoleId: null,
        reasoningLevel: null,
        humanDisposition: null,
        subscriptionBacked: null,
      };
      const [performance, usage, costs, tools] = yield* Effect.all(
        [
          persist("read run performance", repository.getRunPerformance({ agentRunId })),
          persist(
            "read run usage",
            repository.queryUsageRecords({ filter, limit: queryLimit, offset: 0 }),
          ),
          persist(
            "read run costs",
            repository.queryCostRecords({ filter, limit: queryLimit, offset: 0 }),
          ),
          persist(
            "read run tools",
            repository.queryToolMetrics({ filter, limit: queryLimit, offset: 0 }),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const performanceValue = Option.getOrNull(performance);
      const taskOutcome =
        performanceValue?.taskId === null || performanceValue?.taskId === undefined
          ? null
          : Option.getOrNull(
              yield* persist(
                "read task outcome",
                repository.getTaskOutcome({ taskId: performanceValue.taskId }),
              ),
            );
      const humanDispositions =
        performanceValue?.taskId === null || performanceValue?.taskId === undefined
          ? []
          : yield* persist(
              "read human dispositions",
              repository.listHumanDispositions({
                taskId: performanceValue.taskId,
                limit: queryLimit,
                offset: 0,
              }),
            );
      return { performance: performanceValue, usage, costs, tools, taskOutcome, humanDispositions };
    });

  const updateSettings: UsageAnalyticsWorkspaceServiceShape["updateSettings"] = (value) =>
    Effect.gen(function* () {
      yield* persist("save analytics settings", repository.saveSettings(value));
      yield* rebuildAllSubscriptionAttributions(value.updatedAt);
      yield* publish;
      return value;
    });
  const saveBudget: UsageAnalyticsWorkspaceServiceShape["saveBudget"] = (policy) =>
    Effect.gen(function* () {
      yield* persist("save analytics budget", repository.upsertBudgetPolicy(policy));
      yield* recordAudit(
        policy.createdAt === policy.updatedAt
          ? "analytics.budget_created"
          : "analytics.budget_updated",
        `analytics:budget:${policy.scopeType}:${policy.scopeId}`,
        {
          recordType: "budget_policy",
          recordId: policy.id,
          projectId: null,
          missionId: null,
          taskId: null,
          agentRunId: null,
          usageRecordId: null,
          costRecordId: null,
          humanDispositionRecordId: null,
          budgetPolicyId: policy.id,
          exportId: null,
          retentionOperationId: null,
          detail: policy.name,
        },
      );
      yield* publish;
      return policy;
    });
  const savePricingSnapshot: UsageAnalyticsWorkspaceServiceShape["savePricingSnapshot"] = (
    snapshot,
  ) =>
    Effect.gen(function* () {
      yield* persist(
        "save immutable analytics pricing snapshot",
        repository.insertPricingSnapshot(snapshot),
      );
      yield* recordAudit(
        "analytics.pricing_snapshot_created",
        `analytics:pricing:${snapshot.providerProfileId}:${snapshot.modelProfileId}`,
        {
          recordType: "pricing_snapshot",
          recordId: snapshot.id,
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
          detail: `${snapshot.pricingSource}:${snapshot.currency}:${snapshot.billingUnit}`,
        },
      );
      yield* publish;
      return snapshot;
    });
  const saveSubscriptionAttributionRule: UsageAnalyticsWorkspaceServiceShape["saveSubscriptionAttributionRule"] =
    (rule) =>
      Effect.gen(function* () {
        yield* persist(
          "save immutable subscription attribution rule",
          repository.insertSubscriptionAttributionRule(rule),
        );
        const stored = Option.getOrElse(
          yield* persist(
            "read immutable subscription attribution rule",
            repository.getSubscriptionAttributionRule({ ruleId: rule.id }),
          ),
          () => rule,
        );
        yield* recordAudit(
          "analytics.subscription_attribution_rule_created",
          `analytics:subscription:${stored.id}`,
          {
            recordType: "subscription_attribution_rule",
            recordId: stored.id,
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
            detail: `${stored.mode}:${stored.periodStart}:${stored.periodEnd}`,
          },
        );
        const calculatedAt = yield* now;
        yield* rebuildSubscriptionAttribution(stored, calculatedAt);
        yield* publish;
        return stored;
      });
  const saveExchangeRateSnapshot: UsageAnalyticsWorkspaceServiceShape["saveExchangeRateSnapshot"] =
    (snapshot) =>
      Effect.gen(function* () {
        yield* persist(
          "save immutable exchange-rate snapshot",
          repository.insertExchangeRateSnapshot(snapshot),
        );
        yield* recordAudit(
          "analytics.exchange_rate_snapshot_created",
          `analytics:exchange:${snapshot.baseCurrency}:${snapshot.quoteCurrency}`,
          {
            recordType: "exchange_rate_snapshot",
            recordId: snapshot.id,
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
            detail: `${snapshot.baseCurrency}:${snapshot.quoteCurrency}:${snapshot.effectiveAt}`,
          },
        );
        yield* publish;
        return snapshot;
      });
  const createBudgetOverride: UsageAnalyticsWorkspaceServiceShape["createBudgetOverride"] = (
    override,
  ) =>
    Effect.gen(function* () {
      yield* persist("save analytics budget override", repository.upsertBudgetOverride(override));
      yield* recordAudit(
        "analytics.budget_override_created",
        `analytics:budget:${override.scopeType}:${override.scopeId}`,
        {
          recordType: "budget_override",
          recordId: override.id,
          projectId: null,
          missionId: null,
          taskId: null,
          agentRunId: null,
          usageRecordId: null,
          costRecordId: null,
          humanDispositionRecordId: null,
          budgetPolicyId: override.budgetPolicyId,
          exportId: null,
          retentionOperationId: null,
          detail: override.reason,
        },
      );
      yield* publish;
      return override;
    });
  const saveAnnotation: UsageAnalyticsWorkspaceServiceShape["saveAnnotation"] = (annotation) =>
    persist("save analytics annotation", repository.upsertAnnotation(annotation)).pipe(
      Effect.andThen(publish),
      Effect.as(annotation),
    );
  const recordHumanDisposition: UsageAnalyticsWorkspaceServiceShape["recordHumanDisposition"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const taskOutcome = Option.getOrNull(
        yield* persist(
          "read task outcome for human disposition",
          repository.getTaskOutcome({ taskId: input.taskId }),
        ),
      );
      if (taskOutcome === null) {
        return yield* new AnalyticsNotFoundError({
          entity: "task_outcome",
          id: input.taskId,
        });
      }
      const previous = Option.getOrNull(
        yield* persist(
          "read previous human disposition",
          repository.getLatestHumanDisposition({ taskId: input.taskId }),
        ),
      );
      if (previous !== null && previous.sourceFingerprint !== input.sourceFingerprint) {
        yield* persist(
          "mark previous human disposition source changed",
          repository.markHumanDispositionSourceChanged({
            humanDispositionRecordId: previous.id,
            sourceChangedAt: input.markedAt,
          }),
        );
        yield* audit
          .record({
            eventType: "analytics.human_disposition_source_changed",
            aggregateId: `analytics:${taskOutcome.missionId}`,
            payload: {
              recordType: "human_disposition",
              recordId: previous.id,
              projectId: null,
              missionId: taskOutcome.missionId,
              taskId: taskOutcome.taskId,
              agentRunId: null,
              usageRecordId: null,
              costRecordId: null,
              humanDispositionRecordId: previous.id,
              budgetPolicyId: null,
              exportId: null,
              retentionOperationId: null,
              detail: "The source fingerprint changed after this human disposition.",
            },
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("human disposition source-change audit failed", {
                cause: Cause.pretty(cause),
              }),
            ),
          );
      }
      const record: HumanDispositionRecord = {
        id: HumanDispositionRecordId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
        taskOutcomeRecordId: taskOutcome.id,
        taskId: taskOutcome.taskId,
        missionId: taskOutcome.missionId,
        disposition: input.disposition,
        actor: input.actor,
        markedAt: input.markedAt,
        reason: input.reason,
        sourceFingerprint: input.sourceFingerprint,
        sourceChangedAfterDisposition: false,
        sourceChangedAt: null,
      };
      yield* persist("record human disposition", repository.recordHumanDisposition(record));
      yield* audit
        .record({
          eventType: "analytics.human_disposition_recorded",
          aggregateId: `analytics:${taskOutcome.missionId}`,
          payload: {
            recordType: "human_disposition",
            recordId: record.id,
            projectId: null,
            missionId: record.missionId,
            taskId: record.taskId,
            agentRunId: null,
            usageRecordId: null,
            costRecordId: null,
            humanDispositionRecordId: record.id,
            budgetPolicyId: null,
            exportId: null,
            retentionOperationId: null,
            detail: input.reason,
          },
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("human disposition audit failed", {
              cause: Cause.pretty(cause),
            }),
          ),
        );
      yield* publish;
      return record;
    });

  const acknowledgeBudgetEvent: UsageAnalyticsWorkspaceServiceShape["acknowledgeBudgetEvent"] = (
    input,
  ) =>
    Effect.gen(function* () {
      yield* persist("acknowledge budget event", repository.acknowledgeBudgetEvent(input));
      const events = yield* persist(
        "read acknowledged budget event",
        repository.listBudgetEvents({
          scopeType: null,
          scopeId: null,
          limit: queryLimit,
          offset: 0,
        }),
      );
      const event = events.find(({ id }) => id === input.budgetEventId);
      if (event === undefined) {
        return yield* new AnalyticsNotFoundError({
          entity: "budget_event",
          id: input.budgetEventId,
        });
      }
      yield* publish;
      return event;
    });

  const acknowledgeAlert: UsageAnalyticsWorkspaceServiceShape["acknowledgeAlert"] = (input) =>
    Effect.gen(function* () {
      yield* persist("acknowledge analytics alert", repository.acknowledgeAlert(input));
      const alerts = yield* persist(
        "read acknowledged analytics alert",
        repository.listAlerts({ scopeType: null, scopeId: null, limit: queryLimit, offset: 0 }),
      );
      const alert = alerts.find(({ id }) => id === input.alertId);
      if (alert === undefined) {
        return yield* new AnalyticsNotFoundError({ entity: "analytics_alert", id: input.alertId });
      }
      yield* recordAudit(
        "analytics.alert_acknowledged",
        `analytics:alert:${alert.scopeType}:${alert.scopeId}`,
        {
          recordType: "analytics_alert",
          recordId: alert.id,
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
          detail: alert.title,
        },
      );
      yield* publish;
      return alert;
    });

  const createExport: UsageAnalyticsWorkspaceServiceShape["createExport"] = (input) =>
    Effect.gen(function* () {
      const id = AnalyticsExportId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
      const startedAt = yield* now;
      const running: AnalyticsExport = {
        id,
        format: input.format,
        status: "running",
        filter: safeFilterMetadata(input.filter),
        metricVersion: ANALYTICS_METRIC_VERSION,
        relativeFilePath: null,
        rowCount: null,
        byteCount: null,
        errorCategory: null,
        requestedAt: input.requestedAt,
        startedAt,
        completedAt: null,
      };
      yield* persist("start analytics export", repository.saveExport(running));
      yield* recordAudit("analytics.export_started", `analytics:export:${id}`, {
        recordType: "analytics_export",
        recordId: id,
        projectId: input.filter.projectId,
        missionId: input.filter.missionId,
        taskId: input.filter.taskId,
        agentRunId: input.filter.agentRunId,
        usageRecordId: null,
        costRecordId: null,
        humanDispositionRecordId: null,
        budgetPolicyId: null,
        exportId: id,
        retentionOperationId: null,
        detail: input.format,
      });
      return yield* Effect.gen(function* () {
        const records = yield* readRecords(input.filter);
        const rows = buildAnalyticsExportRows({
          usage: records.usage,
          costs: records.costs,
          performance: records.performance,
          outcomes: records.taskOutcomes,
          missionOutcomes: records.missionOutcomes,
        });
        const relativeFilePath = path.join("analytics", "exports", `${id}.${input.format}`);
        const absoluteFilePath = path.join(config.stateDir, relativeFilePath);
        const content =
          input.format === "json"
            ? `${encodeUnknownJson({ schemaVersion: 1, metricVersion: ANALYTICS_METRIC_VERSION, filter: safeFilterMetadata(input.filter), rows })}\n`
            : [
                [
                  "schemaVersion",
                  "metricVersion",
                  "recordType",
                  "id",
                  "projectId",
                  "missionId",
                  "taskId",
                  "agentRunId",
                  "timestamp",
                  "status",
                  "value",
                  "unit",
                  "currency",
                  "provenance",
                  "confidence",
                  "attribution",
                  "reference",
                ].join(","),
                ...rows.map((row) => Object.values(row).map(csvCell).join(",")),
              ].join("\n") + "\n";
        yield* fileSystem.makeDirectory(path.dirname(absoluteFilePath), { recursive: true }).pipe(
          Effect.andThen(fileSystem.writeFileString(absoluteFilePath, content)),
          Effect.mapError((cause) => unavailable("write analytics export", cause)),
        );
        const completedAt = yield* now;
        const completed: AnalyticsExport = {
          ...running,
          status: "completed",
          relativeFilePath,
          rowCount: rows.length,
          byteCount: new TextEncoder().encode(content).byteLength,
          completedAt,
        };
        yield* persist("finish analytics export", repository.saveExport(completed));
        yield* recordAudit("analytics.export_completed", `analytics:export:${id}`, {
          recordType: "analytics_export",
          recordId: id,
          projectId: input.filter.projectId,
          missionId: input.filter.missionId,
          taskId: input.filter.taskId,
          agentRunId: input.filter.agentRunId,
          usageRecordId: null,
          costRecordId: null,
          humanDispositionRecordId: null,
          budgetPolicyId: null,
          exportId: id,
          retentionOperationId: null,
          detail: `${rows.length} rows`,
        });
        yield* publish;
        return completed;
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const completedAt = yield* now;
            yield* repository
              .saveExport({
                ...running,
                status: "failed",
                errorCategory: "analytics_export_failed",
                completedAt,
              })
              .pipe(Effect.catchCause(() => Effect.void));
            yield* recordAudit("analytics.export_failed", `analytics:export:${id}`, {
              recordType: "analytics_export",
              recordId: id,
              projectId: input.filter.projectId,
              missionId: input.filter.missionId,
              taskId: input.filter.taskId,
              agentRunId: input.filter.agentRunId,
              usageRecordId: null,
              costRecordId: null,
              humanDispositionRecordId: null,
              budgetPolicyId: null,
              exportId: id,
              retentionOperationId: null,
              detail: "analytics_export_failed",
            });
            yield* publish;
            return yield* error;
          }),
        ),
      );
    });

  const startRetention: UsageAnalyticsWorkspaceServiceShape["startRetention"] = (input) =>
    Effect.gen(function* () {
      const id = AnalyticsRetentionOperationId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
      const startedAt = yield* now;
      const running: AnalyticsRetentionOperation = {
        id,
        status: "running",
        projectId: input.projectId,
        detailBefore: input.detailBefore,
        deletedUsageCount: 0,
        deletedToolMetricCount: 0,
        deletedExportCount: 0,
        errorCategory: null,
        requestedAt: input.requestedAt,
        startedAt,
        completedAt: null,
      };
      yield* persist("start analytics retention", repository.saveRetentionOperation(running));
      yield* recordAudit("analytics.retention_started", `analytics:retention:${id}`, {
        recordType: "analytics_retention",
        recordId: id,
        projectId: input.projectId,
        missionId: null,
        taskId: null,
        agentRunId: null,
        usageRecordId: null,
        costRecordId: null,
        humanDispositionRecordId: null,
        budgetPolicyId: null,
        exportId: null,
        retentionOperationId: id,
        detail: `delete detail before ${input.detailBefore}`,
      });
      return yield* Effect.gen(function* () {
        const exportsToDelete = (yield* persist(
          "list retained analytics exports",
          repository.listExports({ status: null, limit: operationLimit, offset: 0 }),
        )).filter(
          (item) =>
            item.requestedAt < input.detailBefore &&
            (input.projectId === null || item.filter["projectId"] === input.projectId),
        );
        yield* Effect.forEach(exportsToDelete, removeExportFile, {
          concurrency: 4,
          discard: true,
        });
        const deleted = yield* persist(
          "delete retained analytics detail",
          repository.deleteDetailBefore({
            projectId: input.projectId,
            detailBefore: input.detailBefore,
          }),
        );
        const completedAt = yield* now;
        const completed: AnalyticsRetentionOperation = {
          ...running,
          status: "completed",
          deletedUsageCount: deleted.usageCount,
          deletedToolMetricCount: deleted.toolMetricCount,
          deletedExportCount: deleted.exportCount,
          completedAt,
        };
        yield* persist("finish analytics retention", repository.saveRetentionOperation(completed));
        yield* recordAudit("analytics.retention_completed", `analytics:retention:${id}`, {
          recordType: "analytics_retention",
          recordId: id,
          projectId: input.projectId,
          missionId: null,
          taskId: null,
          agentRunId: null,
          usageRecordId: null,
          costRecordId: null,
          humanDispositionRecordId: null,
          budgetPolicyId: null,
          exportId: null,
          retentionOperationId: id,
          detail: `${deleted.usageCount} usage, ${deleted.toolMetricCount} tool, ${deleted.exportCount} export records removed`,
        });
        yield* publish;
        return completed;
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const completedAt = yield* now;
            yield* repository
              .saveRetentionOperation({
                ...running,
                status: "failed",
                errorCategory: "analytics_retention_failed",
                completedAt,
              })
              .pipe(Effect.catchCause(() => Effect.void));
            yield* recordAudit("analytics.retention_failed", `analytics:retention:${id}`, {
              recordType: "analytics_retention",
              recordId: id,
              projectId: input.projectId,
              missionId: null,
              taskId: null,
              agentRunId: null,
              usageRecordId: null,
              costRecordId: null,
              humanDispositionRecordId: null,
              budgetPolicyId: null,
              exportId: null,
              retentionOperationId: id,
              detail: "analytics_retention_failed",
            });
            yield* publish;
            return yield* error;
          }),
        ),
      );
    });

  const rebuildAggregates: UsageAnalyticsWorkspaceServiceShape["rebuildAggregates"] = (input) =>
    Effect.gen(function* () {
      yield* rebuildAllSubscriptionAttributions(input.requestedAt);
      const scopeType = input.scopeType ?? "user";
      const scopeId = input.scopeId ?? "current-user";
      const aggregateId = AnalyticsAggregateId.make(
        `${scopeType}:${scopeId}:v${ANALYTICS_METRIC_VERSION}:all-time`,
      );
      yield* recordAudit("analytics.aggregate_requested", `analytics:aggregate:${aggregateId}`, {
        recordType: "analytics_aggregate",
        recordId: aggregateId,
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
        detail: `rebuild ${scopeType}:${scopeId}`,
      });
      const snapshot = yield* getWorkspace({
        dateRange: { from: null, to: input.requestedAt },
        projectId:
          input.scopeType === "project" ? (input.scopeId as AnalyticsFilter["projectId"]) : null,
        missionId:
          input.scopeType === "mission" ? (input.scopeId as AnalyticsFilter["missionId"]) : null,
        taskId: input.scopeType === "task" ? (input.scopeId as AnalyticsFilter["taskId"]) : null,
        agentRunId:
          input.scopeType === "agent_run" ? (input.scopeId as AnalyticsFilter["agentRunId"]) : null,
        providerProfileId:
          input.scopeType === "provider"
            ? (input.scopeId as AnalyticsFilter["providerProfileId"])
            : null,
        modelProfileId:
          input.scopeType === "model" ? (input.scopeId as AnalyticsFilter["modelProfileId"]) : null,
        agentRoleId:
          input.scopeType === "agent_role"
            ? (input.scopeId as AnalyticsFilter["agentRoleId"])
            : null,
        reasoningLevel: null,
        humanDisposition: null,
        subscriptionBacked: null,
      });
      yield* persist(
        "rebuild analytics aggregate",
        repository.upsertAggregate({
          id: aggregateId,
          scopeType,
          scopeId,
          periodType: "custom",
          periodStart: "1970-01-01T00:00:00.000Z",
          periodEnd: input.requestedAt,
          metricVersion: ANALYTICS_METRIC_VERSION,
          metrics: {
            first_pass_verification_rate: {
              value:
                snapshot.overview.firstPassVerificationRate === null
                  ? null
                  : String(snapshot.overview.firstPassVerificationRate),
              unit: "ratio",
              confidence:
                snapshot.overview.firstPassVerificationRate === null ? "unknown" : "confirmed",
              sampleSize: snapshot.overview.verifiedTaskCount,
              missingCount: snapshot.overview.dataQuality.incompleteOutcomeCount,
              estimatedCount: 0,
            },
            repair_rate: {
              value:
                snapshot.overview.repairRate === null ? null : String(snapshot.overview.repairRate),
              unit: "ratio",
              confidence: snapshot.overview.repairRate === null ? "unknown" : "confirmed",
              sampleSize: snapshot.overview.verifiedTaskCount,
              missingCount: snapshot.overview.dataQuality.incompleteOutcomeCount,
              estimatedCount: 0,
            },
          },
          calculatedAt: input.requestedAt,
          sourceWatermark: 0,
          sourceDetailDeleted: false,
        }),
      );
      yield* recordAudit("analytics.aggregate_completed", `analytics:aggregate:${aggregateId}`, {
        recordType: "analytics_aggregate",
        recordId: aggregateId,
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
        detail: `metric version ${ANALYTICS_METRIC_VERSION}`,
      });
      yield* publish;
      return { accepted: true };
    });

  const subscribeWorkspace: UsageAnalyticsWorkspaceServiceShape["subscribeWorkspace"] = (filter) =>
    Stream.concat(
      Stream.fromEffect(getWorkspace(filter)),
      Stream.fromPubSub(changes).pipe(Stream.mapEffect(() => getWorkspace(filter))),
    );

  return UsageAnalyticsWorkspaceService.of({
    getWorkspace,
    getRunDetail,
    updateSettings,
    saveBudget,
    savePricingSnapshot,
    saveSubscriptionAttributionRule,
    saveExchangeRateSnapshot,
    acknowledgeBudgetEvent,
    createBudgetOverride,
    acknowledgeAlert,
    saveAnnotation,
    recordHumanDisposition,
    createExport,
    startRetention,
    rebuildAggregates,
    subscribeWorkspace,
  });
});

export const UsageAnalyticsWorkspaceServiceLive = Layer.effect(
  UsageAnalyticsWorkspaceService,
  make,
);

export const layer = UsageAnalyticsWorkspaceServiceLive;
