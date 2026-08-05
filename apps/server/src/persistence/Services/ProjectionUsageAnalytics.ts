import type {
  AnalyticsAggregate,
  AnalyticsAlert,
  AnalyticsAnnotation,
  AnalyticsExport,
  AnalyticsRecommendation,
  AnalyticsRetentionOperation,
  AnalyticsSettings,
  BudgetEvent,
  BudgetOverride,
  BudgetPolicy,
  CostRecord,
  ExchangeRateSnapshot,
  HumanDispositionRecord,
  MissionOutcomeRecord,
  PricingSnapshot,
  RunPerformanceRecord,
  SubscriptionAttributionRule,
  SubscriptionUsageRecord,
  TaskOutcomeRecord,
  ToolExecutionMetric,
} from "@t3tools/contracts";
import {
  AgentRunId,
  AnalyticsAlertAcknowledgeInput,
  AnalyticsCurrency,
  AnalyticsFilter,
  AnalyticsOperationStatus,
  AnalyticsScopeType,
  BudgetEventAcknowledgeInput,
  CostRecord as CostRecordSchema,
  CostRecordId,
  HumanDispositionRecordId,
  HumanDispositionSourceChangedInput,
  MissionId,
  MissionTaskId,
  ModelProfileId,
  PricingSnapshotId,
  ProjectId as ProjectIdSchema,
  ProviderProfileId,
  SubscriptionAttributionRuleId,
  UsageRecord,
  UsageRecordId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

const BoundedLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }));
const BoundedOffset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));

export const GetUsageRecordInput = Schema.Struct({ usageRecordId: UsageRecordId });
export type GetUsageRecordInput = typeof GetUsageRecordInput.Type;
export const GetUsageRecordBySourceInput = Schema.Struct({
  sourceEventId: UsageRecord.fields.sourceEventId,
});
export type GetUsageRecordBySourceInput = typeof GetUsageRecordBySourceInput.Type;
export const ListUsageRecordsInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectIdSchema),
  recordedFrom: Schema.NullOr(Schema.String),
  recordedTo: Schema.NullOr(Schema.String),
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListUsageRecordsInput = typeof ListUsageRecordsInput.Type;
export const FinalizeUsageRecordInput = Schema.Struct({ record: UsageRecord }).check(
  Schema.makeFilter((input) =>
    input.record.state === "provisional" ? "finalized usage cannot remain provisional" : true,
  ),
);
export type FinalizeUsageRecordInput = typeof FinalizeUsageRecordInput.Type;

export const GetPricingSnapshotInput = Schema.Struct({ pricingSnapshotId: PricingSnapshotId });
export type GetPricingSnapshotInput = typeof GetPricingSnapshotInput.Type;
export const GetCostRecordInput = Schema.Struct({ costRecordId: CostRecordId });
export type GetCostRecordInput = typeof GetCostRecordInput.Type;
export const GetSubscriptionAttributionRuleInput = Schema.Struct({
  ruleId: SubscriptionAttributionRuleId,
});
export type GetSubscriptionAttributionRuleInput = typeof GetSubscriptionAttributionRuleInput.Type;
export const QueryAnalyticsRecordsInput = Schema.Struct({
  filter: AnalyticsFilter,
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type QueryAnalyticsRecordsInput = typeof QueryAnalyticsRecordsInput.Type;
export const GetRunPerformanceInput = Schema.Struct({ agentRunId: AgentRunId });
export type GetRunPerformanceInput = typeof GetRunPerformanceInput.Type;
export const GetTaskOutcomeInput = Schema.Struct({ taskId: MissionTaskId });
export type GetTaskOutcomeInput = typeof GetTaskOutcomeInput.Type;
export const GetMissionOutcomeInput = Schema.Struct({ missionId: MissionId });
export type GetMissionOutcomeInput = typeof GetMissionOutcomeInput.Type;
export const GetHumanDispositionRecordInput = Schema.Struct({
  humanDispositionRecordId: HumanDispositionRecordId,
});
export type GetHumanDispositionRecordInput = typeof GetHumanDispositionRecordInput.Type;
export const ListHumanDispositionRecordsInput = Schema.Struct({
  taskId: MissionTaskId,
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListHumanDispositionRecordsInput = typeof ListHumanDispositionRecordsInput.Type;
export const ListPricingSnapshotsInput = Schema.Struct({
  providerProfileId: Schema.NullOr(ProviderProfileId),
  modelProfileId: Schema.NullOr(ModelProfileId),
  currency: Schema.NullOr(Schema.String),
  effectiveAt: Schema.NullOr(Schema.String),
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListPricingSnapshotsInput = typeof ListPricingSnapshotsInput.Type;
export const ListSubscriptionAttributionRulesInput = Schema.Struct({
  providerProfileId: Schema.NullOr(ProviderProfileId),
  modelProfileId: Schema.NullOr(ModelProfileId),
  periodStart: Schema.NullOr(Schema.String),
  periodEnd: Schema.NullOr(Schema.String),
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListSubscriptionAttributionRulesInput =
  typeof ListSubscriptionAttributionRulesInput.Type;
export const ListExchangeRateSnapshotsInput = Schema.Struct({
  baseCurrency: Schema.NullOr(AnalyticsCurrency),
  quoteCurrency: Schema.NullOr(AnalyticsCurrency),
  effectiveAt: Schema.NullOr(Schema.String),
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListExchangeRateSnapshotsInput = typeof ListExchangeRateSnapshotsInput.Type;
export const ReplaceSubscriptionAllocationsInput = Schema.Struct({
  ruleId: SubscriptionAttributionRuleId,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  allocatedAt: Schema.String,
  records: Schema.Array(CostRecordSchema).check(Schema.isMaxLength(10_000)),
}).check(
  Schema.makeFilter((input) => {
    const runIds = new Set(input.records.map(({ agentRunId }) => agentRunId));
    return input.records.every(
      (record) =>
        record.costType === "subscription_attribution" &&
        record.isSubscriptionBacked &&
        (record.calculationMethod === "subscription_backed" ||
          record.calculationMethod === "user_configured_rate"),
    ) && runIds.size === input.records.length
      ? true
      : "replacement requires one explicitly labelled subscription accounting record per run";
  }),
);
export type ReplaceSubscriptionAllocationsInput = typeof ReplaceSubscriptionAllocationsInput.Type;
export const ListAnalyticsScopeRecordsInput = Schema.Struct({
  scopeType: Schema.NullOr(AnalyticsScopeType),
  scopeId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListAnalyticsScopeRecordsInput = typeof ListAnalyticsScopeRecordsInput.Type;
export const ListAnalyticsOperationsInput = Schema.Struct({
  status: Schema.NullOr(AnalyticsOperationStatus),
  limit: BoundedLimit,
  offset: BoundedOffset,
});
export type ListAnalyticsOperationsInput = typeof ListAnalyticsOperationsInput.Type;

export const ListRecoverableAnalyticsOperationsInput = Schema.Struct({
  requestedBefore: Schema.String,
  limit: BoundedLimit,
});
export type ListRecoverableAnalyticsOperationsInput =
  typeof ListRecoverableAnalyticsOperationsInput.Type;
export const InterruptRunningAnalyticsOperationsInput = Schema.Struct({
  interruptedAt: Schema.String,
  errorCategory: Schema.String.check(Schema.isMaxLength(128)),
});
export type InterruptRunningAnalyticsOperationsInput =
  typeof InterruptRunningAnalyticsOperationsInput.Type;
export const DeleteAnalyticsDetailBeforeInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectIdSchema),
  detailBefore: Schema.String,
});
export type DeleteAnalyticsDetailBeforeInput = typeof DeleteAnalyticsDetailBeforeInput.Type;

export interface RecoverableAnalyticsOperations {
  readonly exports: ReadonlyArray<AnalyticsExport>;
  readonly retentionOperations: ReadonlyArray<AnalyticsRetentionOperation>;
}

export interface InterruptedAnalyticsOperationCounts {
  readonly exportCount: number;
  readonly retentionOperationCount: number;
}

export interface DeletedAnalyticsDetailCounts {
  readonly usageCount: number;
  readonly toolMetricCount: number;
  readonly exportCount: number;
}

export interface ReplacedSubscriptionAllocationCounts {
  readonly replacedCount: number;
  readonly activeCount: number;
}

export interface ProjectionUsageAnalyticsRepositoryShape {
  readonly upsertUsageRecord: (row: UsageRecord) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly finalizeUsageRecord: (
    input: FinalizeUsageRecordInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getUsageRecord: (
    input: GetUsageRecordInput,
  ) => Effect.Effect<Option.Option<UsageRecord>, ProjectionRepositoryError>;
  readonly getUsageRecordBySource: (
    input: GetUsageRecordBySourceInput,
  ) => Effect.Effect<Option.Option<UsageRecord>, ProjectionRepositoryError>;
  readonly listUsageRecords: (
    input: ListUsageRecordsInput,
  ) => Effect.Effect<ReadonlyArray<UsageRecord>, ProjectionRepositoryError>;
  readonly queryUsageRecords: (
    input: QueryAnalyticsRecordsInput,
  ) => Effect.Effect<ReadonlyArray<UsageRecord>, ProjectionRepositoryError>;

  readonly upsertToolMetric: (
    row: ToolExecutionMetric,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly queryToolMetrics: (
    input: QueryAnalyticsRecordsInput,
  ) => Effect.Effect<ReadonlyArray<ToolExecutionMetric>, ProjectionRepositoryError>;
  readonly upsertRunPerformance: (
    row: RunPerformanceRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly finalizeRunPerformance: (
    row: RunPerformanceRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getRunPerformance: (
    input: GetRunPerformanceInput,
  ) => Effect.Effect<Option.Option<RunPerformanceRecord>, ProjectionRepositoryError>;
  readonly queryRunPerformance: (
    input: QueryAnalyticsRecordsInput,
  ) => Effect.Effect<ReadonlyArray<RunPerformanceRecord>, ProjectionRepositoryError>;

  readonly insertPricingSnapshot: (
    row: PricingSnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getPricingSnapshot: (
    input: GetPricingSnapshotInput,
  ) => Effect.Effect<Option.Option<PricingSnapshot>, ProjectionRepositoryError>;
  readonly listPricingSnapshots: (
    input: ListPricingSnapshotsInput,
  ) => Effect.Effect<ReadonlyArray<PricingSnapshot>, ProjectionRepositoryError>;
  readonly insertCostRecord: (row: CostRecord) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getCostRecord: (
    input: GetCostRecordInput,
  ) => Effect.Effect<Option.Option<CostRecord>, ProjectionRepositoryError>;
  readonly queryCostRecords: (
    input: QueryAnalyticsRecordsInput,
  ) => Effect.Effect<ReadonlyArray<CostRecord>, ProjectionRepositoryError>;
  readonly insertSubscriptionAttributionRule: (
    row: SubscriptionAttributionRule,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getSubscriptionAttributionRule: (
    input: GetSubscriptionAttributionRuleInput,
  ) => Effect.Effect<Option.Option<SubscriptionAttributionRule>, ProjectionRepositoryError>;
  readonly listSubscriptionAttributionRules: (
    input: ListSubscriptionAttributionRulesInput,
  ) => Effect.Effect<ReadonlyArray<SubscriptionAttributionRule>, ProjectionRepositoryError>;
  readonly replaceSubscriptionAllocations: (
    input: ReplaceSubscriptionAllocationsInput,
  ) => Effect.Effect<ReplacedSubscriptionAllocationCounts, ProjectionRepositoryError>;
  readonly insertExchangeRateSnapshot: (
    row: ExchangeRateSnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listExchangeRateSnapshots: (
    input: ListExchangeRateSnapshotsInput,
  ) => Effect.Effect<ReadonlyArray<ExchangeRateSnapshot>, ProjectionRepositoryError>;
  readonly upsertSubscriptionUsage: (
    row: SubscriptionUsageRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly upsertTaskOutcome: (
    row: TaskOutcomeRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getTaskOutcome: (
    input: GetTaskOutcomeInput,
  ) => Effect.Effect<Option.Option<TaskOutcomeRecord>, ProjectionRepositoryError>;
  readonly queryTaskOutcomes: (
    input: QueryAnalyticsRecordsInput,
  ) => Effect.Effect<ReadonlyArray<TaskOutcomeRecord>, ProjectionRepositoryError>;
  readonly recordHumanDisposition: (
    row: HumanDispositionRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getHumanDispositionRecord: (
    input: GetHumanDispositionRecordInput,
  ) => Effect.Effect<Option.Option<HumanDispositionRecord>, ProjectionRepositoryError>;
  readonly getLatestHumanDisposition: (
    input: GetTaskOutcomeInput,
  ) => Effect.Effect<Option.Option<HumanDispositionRecord>, ProjectionRepositoryError>;
  readonly listHumanDispositions: (
    input: ListHumanDispositionRecordsInput,
  ) => Effect.Effect<ReadonlyArray<HumanDispositionRecord>, ProjectionRepositoryError>;
  readonly markHumanDispositionSourceChanged: (
    input: HumanDispositionSourceChangedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertMissionOutcome: (
    row: MissionOutcomeRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getMissionOutcome: (
    input: GetMissionOutcomeInput,
  ) => Effect.Effect<Option.Option<MissionOutcomeRecord>, ProjectionRepositoryError>;
  readonly queryMissionOutcomes: (
    input: QueryAnalyticsRecordsInput,
  ) => Effect.Effect<ReadonlyArray<MissionOutcomeRecord>, ProjectionRepositoryError>;
  readonly upsertAggregate: (
    row: AnalyticsAggregate,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertBudgetPolicy: (
    row: BudgetPolicy,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBudgetPolicies: (
    input: ListAnalyticsScopeRecordsInput,
  ) => Effect.Effect<ReadonlyArray<BudgetPolicy>, ProjectionRepositoryError>;
  readonly upsertBudgetEvent: (row: BudgetEvent) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBudgetEvents: (
    input: ListAnalyticsScopeRecordsInput,
  ) => Effect.Effect<ReadonlyArray<BudgetEvent>, ProjectionRepositoryError>;
  readonly acknowledgeBudgetEvent: (
    input: BudgetEventAcknowledgeInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertBudgetOverride: (
    row: BudgetOverride,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBudgetOverrides: (
    input: ListAnalyticsScopeRecordsInput,
  ) => Effect.Effect<ReadonlyArray<BudgetOverride>, ProjectionRepositoryError>;
  readonly upsertAnnotation: (
    row: AnalyticsAnnotation,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAnnotations: (
    input: ListAnalyticsScopeRecordsInput,
  ) => Effect.Effect<ReadonlyArray<AnalyticsAnnotation>, ProjectionRepositoryError>;
  readonly upsertAlert: (row: AnalyticsAlert) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAlerts: (
    input: ListAnalyticsScopeRecordsInput,
  ) => Effect.Effect<ReadonlyArray<AnalyticsAlert>, ProjectionRepositoryError>;
  readonly acknowledgeAlert: (
    input: AnalyticsAlertAcknowledgeInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly insertRecommendation: (
    row: AnalyticsRecommendation,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listRecommendations: (
    input: ListAnalyticsScopeRecordsInput,
  ) => Effect.Effect<ReadonlyArray<AnalyticsRecommendation>, ProjectionRepositoryError>;

  readonly saveSettings: (row: AnalyticsSettings) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getSettings: () => Effect.Effect<
    Option.Option<AnalyticsSettings>,
    ProjectionRepositoryError
  >;
  readonly saveExport: (row: AnalyticsExport) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listExports: (
    input: ListAnalyticsOperationsInput,
  ) => Effect.Effect<ReadonlyArray<AnalyticsExport>, ProjectionRepositoryError>;
  readonly saveRetentionOperation: (
    row: AnalyticsRetentionOperation,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listRetentionOperations: (
    input: ListAnalyticsOperationsInput,
  ) => Effect.Effect<ReadonlyArray<AnalyticsRetentionOperation>, ProjectionRepositoryError>;
  readonly listRecoverableOperations: (
    input: ListRecoverableAnalyticsOperationsInput,
  ) => Effect.Effect<RecoverableAnalyticsOperations, ProjectionRepositoryError>;
  readonly interruptRunningOperations: (
    input: InterruptRunningAnalyticsOperationsInput,
  ) => Effect.Effect<InterruptedAnalyticsOperationCounts, ProjectionRepositoryError>;
  readonly deleteDetailBefore: (
    input: DeleteAnalyticsDetailBeforeInput,
  ) => Effect.Effect<DeletedAnalyticsDetailCounts, ProjectionRepositoryError>;
}

export class ProjectionUsageAnalyticsRepository extends Context.Service<
  ProjectionUsageAnalyticsRepository,
  ProjectionUsageAnalyticsRepositoryShape
>()("t3/persistence/Services/ProjectionUsageAnalytics/ProjectionUsageAnalyticsRepository") {}
