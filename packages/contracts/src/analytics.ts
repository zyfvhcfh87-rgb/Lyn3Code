import * as Schema from "effect/Schema";

import {
  AgentRoleId,
  AgentRunId,
  IsoDateTime,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RoutingDecisionId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ModelCapabilitySnapshotId,
  ModelProfileId,
  ProviderProfileId,
  RoutingReasoningLevel,
} from "./routing.ts";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const BoundedString = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));
const BoundedNonEmptyString = (maximumLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maximumLength));
const AnalyticsMetadataValue = Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Number,
  BoundedString(2_048),
]);
const AnalyticsMetadata = Schema.Record(BoundedNonEmptyString(128), AnalyticsMetadataValue);

/** Exact decimal wire/storage representation. Currency math must not use binary floats. */
export const AnalyticsDecimal = BoundedNonEmptyString(96).check(
  Schema.isPattern(/^-?\d+(?:\.\d{1,18})?$/),
);
export type AnalyticsDecimal = typeof AnalyticsDecimal.Type;
export const AnalyticsNonNegativeDecimal = BoundedNonEmptyString(96).check(
  Schema.isPattern(/^\d+(?:\.\d{1,18})?$/),
);
export type AnalyticsNonNegativeDecimal = typeof AnalyticsNonNegativeDecimal.Type;
export const AnalyticsPositiveDecimal = AnalyticsNonNegativeDecimal.check(
  Schema.isPattern(/^(?=.*[1-9])\d+(?:\.\d{1,18})?$/),
);
export type AnalyticsPositiveDecimal = typeof AnalyticsPositiveDecimal.Type;
export const AnalyticsCurrency = BoundedNonEmptyString(3).check(Schema.isPattern(/^[A-Z]{3}$/));
export type AnalyticsCurrency = typeof AnalyticsCurrency.Type;
export const AnalyticsConfidenceRatio = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

export const UsageRecordId = entityId("UsageRecordId");
export type UsageRecordId = typeof UsageRecordId.Type;
export const ToolExecutionMetricId = entityId("ToolExecutionMetricId");
export type ToolExecutionMetricId = typeof ToolExecutionMetricId.Type;
export const RunPerformanceRecordId = entityId("RunPerformanceRecordId");
export type RunPerformanceRecordId = typeof RunPerformanceRecordId.Type;
export const PricingSnapshotId = entityId("PricingSnapshotId");
export type PricingSnapshotId = typeof PricingSnapshotId.Type;
export const CostRecordId = entityId("CostRecordId");
export type CostRecordId = typeof CostRecordId.Type;
export const SubscriptionUsageRecordId = entityId("SubscriptionUsageRecordId");
export type SubscriptionUsageRecordId = typeof SubscriptionUsageRecordId.Type;
export const SubscriptionAttributionRuleId = entityId("SubscriptionAttributionRuleId");
export type SubscriptionAttributionRuleId = typeof SubscriptionAttributionRuleId.Type;
export const TaskOutcomeRecordId = entityId("TaskOutcomeRecordId");
export type TaskOutcomeRecordId = typeof TaskOutcomeRecordId.Type;
export const MissionOutcomeRecordId = entityId("MissionOutcomeRecordId");
export type MissionOutcomeRecordId = typeof MissionOutcomeRecordId.Type;
export const HumanDispositionRecordId = entityId("HumanDispositionRecordId");
export type HumanDispositionRecordId = typeof HumanDispositionRecordId.Type;
export const AnalyticsAggregateId = entityId("AnalyticsAggregateId");
export type AnalyticsAggregateId = typeof AnalyticsAggregateId.Type;
export const BudgetPolicyId = entityId("BudgetPolicyId");
export type BudgetPolicyId = typeof BudgetPolicyId.Type;
export const BudgetEventId = entityId("BudgetEventId");
export type BudgetEventId = typeof BudgetEventId.Type;
export const BudgetOverrideId = entityId("BudgetOverrideId");
export type BudgetOverrideId = typeof BudgetOverrideId.Type;
export const AnalyticsAnnotationId = entityId("AnalyticsAnnotationId");
export type AnalyticsAnnotationId = typeof AnalyticsAnnotationId.Type;
export const AnalyticsAlertId = entityId("AnalyticsAlertId");
export type AnalyticsAlertId = typeof AnalyticsAlertId.Type;
export const AnalyticsRecommendationId = entityId("AnalyticsRecommendationId");
export type AnalyticsRecommendationId = typeof AnalyticsRecommendationId.Type;
export const AnalyticsExportId = entityId("AnalyticsExportId");
export type AnalyticsExportId = typeof AnalyticsExportId.Type;
export const AnalyticsRetentionOperationId = entityId("AnalyticsRetentionOperationId");
export type AnalyticsRetentionOperationId = typeof AnalyticsRetentionOperationId.Type;
export const ExchangeRateSnapshotId = entityId("ExchangeRateSnapshotId");
export type ExchangeRateSnapshotId = typeof ExchangeRateSnapshotId.Type;

export const AnalyticsConfidence = Schema.Literals([
  "confirmed",
  "high",
  "medium",
  "low",
  "unknown",
]);
export type AnalyticsConfidence = typeof AnalyticsConfidence.Type;
export const UsageSource = Schema.Literals([
  "provider_reported",
  "adapter_calculated",
  "tokenizer_estimated",
  "context_estimated",
  "unknown",
]);
export type UsageSource = typeof UsageSource.Type;
export const UsageRecordState = Schema.Literals(["provisional", "final", "reconciled", "unknown"]);
export type UsageRecordState = typeof UsageRecordState.Type;

export const UsageRecord = Schema.Struct({
  id: UsageRecordId,
  sourceEventId: BoundedNonEmptyString(512),
  sourceTurnId: Schema.NullOr(BoundedNonEmptyString(512)),
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: AgentRunId,
  parentAgentRunId: Schema.NullOr(AgentRunId),
  routingDecisionId: Schema.NullOr(RoutingDecisionId),
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  capabilitySnapshotId: Schema.NullOr(ModelCapabilitySnapshotId),
  providerRequestId: Schema.NullOr(BoundedNonEmptyString(512)),
  providerResponseId: Schema.NullOr(BoundedNonEmptyString(512)),
  usageSource: UsageSource,
  usageConfidence: AnalyticsConfidence,
  state: UsageRecordState,
  inputTokens: Schema.NullOr(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  reasoningTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.NullOr(NonNegativeInt),
  cacheWriteTokens: Schema.NullOr(NonNegativeInt),
  cacheReadTokens: Schema.NullOr(NonNegativeInt),
  totalTokens: Schema.NullOr(NonNegativeInt),
  requestCount: Schema.NullOr(NonNegativeInt),
  toolCallCount: Schema.NullOr(NonNegativeInt),
  providerRoundTripCount: Schema.NullOr(NonNegativeInt),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  recordedAt: IsoDateTime,
  reconciledAt: Schema.NullOr(IsoDateTime),
});
export type UsageRecord = typeof UsageRecord.Type;

export const ToolMetricCategory = Schema.Literals([
  "file_read",
  "file_write",
  "repository_search",
  "command",
  "test",
  "verification",
  "git",
  "github",
  "memory",
  "browser",
  "provider",
  "custom",
]);
export type ToolMetricCategory = typeof ToolMetricCategory.Type;
export const ToolMetricStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "denied",
  "unknown",
]);
export type ToolMetricStatus = typeof ToolMetricStatus.Type;
export const ToolExecutionMetric = Schema.Struct({
  id: ToolExecutionMetricId,
  sourceEventId: BoundedNonEmptyString(512),
  providerItemId: Schema.NullOr(BoundedNonEmptyString(512)),
  agentRunId: AgentRunId,
  taskId: Schema.NullOr(MissionTaskId),
  toolCategory: ToolMetricCategory,
  toolName: BoundedNonEmptyString(256),
  status: ToolMetricStatus,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  durationMilliseconds: Schema.NullOr(NonNegativeInt),
  inputSize: Schema.NullOr(NonNegativeInt),
  outputSize: Schema.NullOr(NonNegativeInt),
  errorCategory: Schema.NullOr(BoundedNonEmptyString(128)),
  retryCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ToolExecutionMetric = typeof ToolExecutionMetric.Type;

export const RunCompletionCategory = Schema.Literals([
  "completed",
  "failed_provider",
  "failed_transport",
  "failed_source",
  "failed_verification",
  "cancelled",
  "interrupted",
  "fallback_superseded",
  "permission_blocked",
  "unknown",
]);
export type RunCompletionCategory = typeof RunCompletionCategory.Type;
export const RunPerformanceStatus = Schema.Literals([
  "queued",
  "running",
  "finalized",
  "finalization_failed",
]);
export type RunPerformanceStatus = typeof RunPerformanceStatus.Type;
export const RunPerformanceRecord = Schema.Struct({
  id: RunPerformanceRecordId,
  agentRunId: AgentRunId,
  taskId: Schema.NullOr(MissionTaskId),
  missionId: MissionId,
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  queuedDurationMilliseconds: Schema.NullOr(NonNegativeInt),
  startupDurationMilliseconds: Schema.NullOr(NonNegativeInt),
  firstOutputLatencyMilliseconds: Schema.NullOr(NonNegativeInt),
  activeDurationMilliseconds: Schema.NullOr(NonNegativeInt),
  wallClockDurationMilliseconds: Schema.NullOr(NonNegativeInt),
  status: RunPerformanceStatus,
  completionCategory: RunCompletionCategory,
  fallbackCount: NonNegativeInt,
  providerRetryCount: NonNegativeInt,
  toolFailureCount: NonNegativeInt,
  contextReductionApplied: Schema.Boolean,
  cancelledBy: Schema.NullOr(BoundedNonEmptyString(256)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  finalizedAt: Schema.NullOr(IsoDateTime),
});
export type RunPerformanceRecord = typeof RunPerformanceRecord.Type;

export const PricingSource = Schema.Literals([
  "provider_reported",
  "official_catalog",
  "user_configured",
  "subscription_plan",
  "unknown",
]);
export type PricingSource = typeof PricingSource.Type;
export const PricingBillingUnit = Schema.Literals([
  "per_million_tokens",
  "per_thousand_tokens",
  "per_token",
  "per_request",
  "per_hour",
  "flat_period",
  "custom",
  "unknown",
]);
export type PricingBillingUnit = typeof PricingBillingUnit.Type;
export const PricingSnapshot = Schema.Struct({
  id: PricingSnapshotId,
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  currency: AnalyticsCurrency,
  pricingSource: PricingSource,
  pricingVersion: Schema.NullOr(BoundedNonEmptyString(256)),
  effectiveFrom: IsoDateTime,
  effectiveTo: Schema.NullOr(IsoDateTime),
  inputTokenRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  outputTokenRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  reasoningTokenRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  cachedInputRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  cacheWriteRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  cacheReadRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  requestRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  toolRateMetadata: AnalyticsMetadata,
  billingUnit: PricingBillingUnit,
  confidence: AnalyticsConfidence,
  metadata: AnalyticsMetadata,
  createdAt: IsoDateTime,
});
export type PricingSnapshot = typeof PricingSnapshot.Type;

export const SubscriptionAllocationMode = Schema.Literals([
  "flat_monthly_by_runs",
  "flat_monthly_by_tokens",
  "flat_monthly_by_active_time",
  "manual_fixed_internal_rate",
]);
export type SubscriptionAllocationMode = typeof SubscriptionAllocationMode.Type;
export const SubscriptionFixedRateUnit = Schema.Literals([
  "per_run",
  "per_million_tokens",
  "per_active_hour",
]);
export type SubscriptionFixedRateUnit = typeof SubscriptionFixedRateUnit.Type;
export const SubscriptionAttributionRule = Schema.Struct({
  id: SubscriptionAttributionRuleId,
  providerProfileId: ProviderProfileId,
  modelProfileId: Schema.NullOr(ModelProfileId),
  label: BoundedNonEmptyString(256),
  mode: SubscriptionAllocationMode,
  periodStart: IsoDateTime,
  periodEnd: IsoDateTime,
  currency: AnalyticsCurrency,
  monthlyAmount: Schema.NullOr(AnalyticsNonNegativeDecimal),
  fixedInternalRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  fixedRateUnit: Schema.NullOr(SubscriptionFixedRateUnit),
  createdAt: IsoDateTime,
}).check(
  Schema.makeFilter((rule) => {
    if (Date.parse(rule.periodStart) >= Date.parse(rule.periodEnd)) {
      return "subscription attribution period must be a non-empty half-open interval";
    }
    if (rule.mode === "manual_fixed_internal_rate") {
      return rule.monthlyAmount === null &&
        rule.fixedInternalRate !== null &&
        rule.fixedRateUnit !== null
        ? true
        : "manual fixed attribution requires only a fixed rate and explicit unit";
    }
    return rule.monthlyAmount !== null &&
      rule.fixedInternalRate === null &&
      rule.fixedRateUnit === null
      ? true
      : "flat monthly attribution requires only a monthly amount";
  }),
);
export type SubscriptionAttributionRule = typeof SubscriptionAttributionRule.Type;

export const CostType = Schema.Literals([
  "api_usage",
  "subscription_attribution",
  "local_compute_estimate",
  "provider_reported",
  "unknown",
]);
export type CostType = typeof CostType.Type;
export const CostCalculationMethod = Schema.Literals([
  "provider_reported",
  "pricing_catalog_calculated",
  "user_configured_rate",
  "subscription_backed",
  "unknown",
]);
export type CostCalculationMethod = typeof CostCalculationMethod.Type;
export const CostCalculationComponent = Schema.Struct({
  dimension: BoundedNonEmptyString(128),
  quantity: Schema.NullOr(AnalyticsNonNegativeDecimal),
  rate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  billingUnit: PricingBillingUnit,
  subtotal: Schema.NullOr(AnalyticsNonNegativeDecimal),
  missing: Schema.Boolean,
});
export type CostCalculationComponent = typeof CostCalculationComponent.Type;
export const CostRecord = Schema.Struct({
  id: CostRecordId,
  sourceKey: BoundedNonEmptyString(512),
  usageRecordId: Schema.NullOr(UsageRecordId),
  agentRunId: AgentRunId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  providerProfileId: ProviderProfileId,
  modelProfileId: ModelProfileId,
  pricingSnapshotId: Schema.NullOr(PricingSnapshotId),
  amount: Schema.NullOr(AnalyticsNonNegativeDecimal),
  currency: AnalyticsCurrency,
  costType: CostType,
  calculationMethod: CostCalculationMethod,
  confidence: AnalyticsConfidence,
  isEstimated: Schema.Boolean,
  isSubscriptionBacked: Schema.Boolean,
  calculationBreakdown: Schema.Array(CostCalculationComponent).check(Schema.isMaxLength(32)),
  missingPricingDimensions: Schema.Array(BoundedNonEmptyString(128)).check(Schema.isMaxLength(32)),
  createdAt: IsoDateTime,
});
export type CostRecord = typeof CostRecord.Type;

export const SubscriptionUsageSource = Schema.Literals([
  "provider_reported",
  "adapter_calculated",
  "user_configured",
  "unknown",
]);
export type SubscriptionUsageSource = typeof SubscriptionUsageSource.Type;
export const SubscriptionUsageRecord = Schema.Struct({
  id: SubscriptionUsageRecordId,
  providerProfileId: ProviderProfileId,
  accountReference: Schema.NullOr(BoundedNonEmptyString(512)),
  planName: Schema.NullOr(BoundedNonEmptyString(256)),
  periodStart: Schema.NullOr(IsoDateTime),
  periodEnd: Schema.NullOr(IsoDateTime),
  usageUnit: BoundedNonEmptyString(128),
  usedAmount: Schema.NullOr(AnalyticsNonNegativeDecimal),
  remainingAmount: Schema.NullOr(AnalyticsNonNegativeDecimal),
  resetAt: Schema.NullOr(IsoDateTime),
  source: SubscriptionUsageSource,
  confidence: AnalyticsConfidence,
  recordedAt: IsoDateTime,
});
export type SubscriptionUsageRecord = typeof SubscriptionUsageRecord.Type;

export const HumanDisposition = Schema.Literals([
  "accepted",
  "accepted_with_edits",
  "rejected",
  "abandoned",
  "not_reviewed",
  "unknown",
]);
export type HumanDisposition = typeof HumanDisposition.Type;
export const ExplicitHumanDisposition = Schema.Literals([
  "accepted",
  "accepted_with_edits",
  "rejected",
  "abandoned",
]);
export type ExplicitHumanDisposition = typeof ExplicitHumanDisposition.Type;
export const OutcomeStatus = Schema.Literals([
  "pending",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "abandoned",
  "unknown",
]);
export type OutcomeStatus = typeof OutcomeStatus.Type;
export const OutcomeVerificationResult = Schema.Literals([
  "passed",
  "passed_with_warnings",
  "failed",
  "invalidated",
  "overridden",
  "not_required",
  "not_run",
  "unknown",
]);
export type OutcomeVerificationResult = typeof OutcomeVerificationResult.Type;
export const OutcomeIntegrationResult = Schema.Literals([
  "integrated",
  "conflicted",
  "failed",
  "not_requested",
  "not_applicable",
  "unknown",
]);
export type OutcomeIntegrationResult = typeof OutcomeIntegrationResult.Type;
export const TaskOutcomeRecord = Schema.Struct({
  id: TaskOutcomeRecordId,
  taskId: MissionTaskId,
  missionId: MissionId,
  status: OutcomeStatus,
  implementationCompleted: Schema.Boolean,
  verificationResult: Schema.NullOr(OutcomeVerificationResult),
  integrationResult: Schema.NullOr(OutcomeIntegrationResult),
  humanDisposition: HumanDisposition,
  reverted: Schema.Boolean,
  firstPassVerification: Schema.NullOr(Schema.Boolean),
  repairAttemptCount: NonNegativeInt,
  agentRunCount: NonNegativeInt,
  totalWallClockDurationMilliseconds: Schema.NullOr(NonNegativeInt),
  totalActiveAgentDurationMilliseconds: Schema.NullOr(NonNegativeInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  finalizedAt: Schema.NullOr(IsoDateTime),
});
export type TaskOutcomeRecord = typeof TaskOutcomeRecord.Type;
export const HumanDispositionRecord = Schema.Struct({
  id: HumanDispositionRecordId,
  taskOutcomeRecordId: TaskOutcomeRecordId,
  taskId: MissionTaskId,
  missionId: MissionId,
  disposition: ExplicitHumanDisposition,
  actor: BoundedNonEmptyString(256),
  markedAt: IsoDateTime,
  reason: Schema.NullOr(BoundedNonEmptyString(2_000)),
  sourceFingerprint: BoundedNonEmptyString(512),
  sourceChangedAfterDisposition: Schema.Boolean,
  sourceChangedAt: Schema.NullOr(IsoDateTime),
}).check(
  Schema.makeFilter((record) =>
    record.sourceChangedAfterDisposition === (record.sourceChangedAt !== null)
      ? true
      : "sourceChangedAt must be present exactly when the disposition source has changed",
  ),
);
export type HumanDispositionRecord = typeof HumanDispositionRecord.Type;
export const HumanDispositionRecordInput = Schema.Struct({
  taskId: MissionTaskId,
  disposition: ExplicitHumanDisposition,
  actor: BoundedNonEmptyString(256),
  markedAt: IsoDateTime,
  reason: Schema.NullOr(BoundedNonEmptyString(2_000)),
  sourceFingerprint: BoundedNonEmptyString(512),
});
export type HumanDispositionRecordInput = typeof HumanDispositionRecordInput.Type;
export const HumanDispositionSourceChangedInput = Schema.Struct({
  humanDispositionRecordId: HumanDispositionRecordId,
  sourceChangedAt: IsoDateTime,
});
export type HumanDispositionSourceChangedInput = typeof HumanDispositionSourceChangedInput.Type;
export const MissionOutcomeRecord = Schema.Struct({
  id: MissionOutcomeRecordId,
  missionId: MissionId,
  status: OutcomeStatus,
  taskCount: NonNegativeInt,
  completedTaskCount: NonNegativeInt,
  failedTaskCount: NonNegativeInt,
  verifiedTaskCount: NonNegativeInt,
  integratedTaskCount: NonNegativeInt,
  pullRequestCreated: Schema.Boolean,
  pullRequestMerged: Schema.Boolean,
  humanDisposition: HumanDisposition,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MissionOutcomeRecord = typeof MissionOutcomeRecord.Type;

export const AnalyticsScopeType = Schema.Literals([
  "user",
  "project",
  "mission",
  "task",
  "provider",
  "model",
  "agent_role",
  "agent_run",
]);
export type AnalyticsScopeType = typeof AnalyticsScopeType.Type;
export const AnalyticsPeriodType = Schema.Literals([
  "per_task",
  "per_mission",
  "daily",
  "weekly",
  "monthly",
  "billing_cycle",
  "custom",
]);
export type AnalyticsPeriodType = typeof AnalyticsPeriodType.Type;
export const AnalyticsMetricValue = Schema.Struct({
  value: Schema.NullOr(AnalyticsDecimal),
  unit: BoundedNonEmptyString(64),
  confidence: AnalyticsConfidence,
  sampleSize: NonNegativeInt,
  missingCount: NonNegativeInt,
  estimatedCount: NonNegativeInt,
});
export type AnalyticsMetricValue = typeof AnalyticsMetricValue.Type;
export const AnalyticsAggregate = Schema.Struct({
  id: AnalyticsAggregateId,
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  periodType: AnalyticsPeriodType,
  periodStart: IsoDateTime,
  periodEnd: IsoDateTime,
  metricVersion: PositiveInt,
  metrics: Schema.Record(BoundedNonEmptyString(128), AnalyticsMetricValue),
  calculatedAt: IsoDateTime,
  sourceWatermark: NonNegativeInt,
  sourceDetailDeleted: Schema.Boolean,
});
export type AnalyticsAggregate = typeof AnalyticsAggregate.Type;

export const BudgetAction = Schema.Literals([
  "notify",
  "require_approval",
  "pause_new_runs",
  "block_new_runs",
  "informational",
]);
export type BudgetAction = typeof BudgetAction.Type;
export const BudgetPolicy = Schema.Struct({
  id: BudgetPolicyId,
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  name: BoundedNonEmptyString(256),
  currency: AnalyticsCurrency,
  periodType: AnalyticsPeriodType,
  periodStart: Schema.NullOr(IsoDateTime),
  periodEnd: Schema.NullOr(IsoDateTime),
  softLimit: Schema.NullOr(AnalyticsNonNegativeDecimal),
  hardLimit: Schema.NullOr(AnalyticsNonNegativeDecimal),
  tokenLimit: Schema.NullOr(NonNegativeInt),
  requestLimit: Schema.NullOr(NonNegativeInt),
  actionOnSoftLimit: BudgetAction,
  actionOnHardLimit: BudgetAction,
  conservativeWhenIncomplete: Schema.Boolean,
  enabled: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BudgetPolicy = typeof BudgetPolicy.Type;
export const BudgetEventType = Schema.Literals([
  "soft_limit_approaching",
  "soft_limit_reached",
  "hard_limit_approaching",
  "hard_limit_reached",
  "forecast_exceeds_limit",
  "usage_data_incomplete",
]);
export type BudgetEventType = typeof BudgetEventType.Type;
export const BudgetEvent = Schema.Struct({
  id: BudgetEventId,
  deduplicationKey: BoundedNonEmptyString(512),
  budgetPolicyId: BudgetPolicyId,
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  eventType: BudgetEventType,
  currentValue: AnalyticsNonNegativeDecimal,
  thresholdValue: AnalyticsNonNegativeDecimal,
  currency: Schema.NullOr(AnalyticsCurrency),
  createdAt: IsoDateTime,
  acknowledgedAt: Schema.NullOr(IsoDateTime),
});
export type BudgetEvent = typeof BudgetEvent.Type;
export const BudgetOverride = Schema.Struct({
  id: BudgetOverrideId,
  budgetPolicyId: BudgetPolicyId,
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  currentValue: AnalyticsNonNegativeDecimal,
  thresholdValue: AnalyticsNonNegativeDecimal,
  reason: BoundedNonEmptyString(2_000),
  actor: BoundedNonEmptyString(256),
  expiresAt: IsoDateTime,
  fallbackAllowed: Schema.Boolean,
  createdAt: IsoDateTime,
  expiredAt: Schema.NullOr(IsoDateTime),
});
export type BudgetOverride = typeof BudgetOverride.Type;

export const AnalyticsAnnotation = Schema.Struct({
  id: AnalyticsAnnotationId,
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  timestamp: Schema.NullOr(IsoDateTime),
  title: BoundedNonEmptyString(256),
  content: BoundedNonEmptyString(8_000),
  createdBy: BoundedNonEmptyString(256),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AnalyticsAnnotation = typeof AnalyticsAnnotation.Type;
export const AnalyticsAlertStatus = Schema.Literals(["active", "acknowledged", "resolved"]);
export type AnalyticsAlertStatus = typeof AnalyticsAlertStatus.Type;
export const AnalyticsAlert = Schema.Struct({
  id: AnalyticsAlertId,
  deduplicationKey: BoundedNonEmptyString(512),
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  category: BoundedNonEmptyString(128),
  severity: Schema.Literals(["info", "warning", "critical"]),
  title: BoundedNonEmptyString(256),
  detail: BoundedNonEmptyString(2_000),
  status: AnalyticsAlertStatus,
  createdAt: IsoDateTime,
  acknowledgedAt: Schema.NullOr(IsoDateTime),
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type AnalyticsAlert = typeof AnalyticsAlert.Type;
export const AnalyticsRecommendation = Schema.Struct({
  id: AnalyticsRecommendationId,
  scopeType: AnalyticsScopeType,
  scopeId: BoundedNonEmptyString(512),
  title: BoundedNonEmptyString(256),
  evidence: BoundedNonEmptyString(4_000),
  sampleSize: NonNegativeInt,
  periodStart: IsoDateTime,
  periodEnd: IsoDateTime,
  taskSegment: BoundedNonEmptyString(512),
  metricKeys: Schema.Array(BoundedNonEmptyString(128)).check(Schema.isMaxLength(32)),
  uncertainty: BoundedNonEmptyString(1_000),
  estimatedCostPresent: Schema.Boolean,
  conflictsWithPolicy: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type AnalyticsRecommendation = typeof AnalyticsRecommendation.Type;

export const AnalyticsExportFormat = Schema.Literals(["csv", "json"]);
export type AnalyticsExportFormat = typeof AnalyticsExportFormat.Type;
export const AnalyticsOperationStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
]);
export type AnalyticsOperationStatus = typeof AnalyticsOperationStatus.Type;
export const AnalyticsExport = Schema.Struct({
  id: AnalyticsExportId,
  format: AnalyticsExportFormat,
  status: AnalyticsOperationStatus,
  filter: AnalyticsMetadata,
  metricVersion: PositiveInt,
  relativeFilePath: Schema.NullOr(BoundedNonEmptyString(1_024)),
  rowCount: Schema.NullOr(NonNegativeInt),
  byteCount: Schema.NullOr(NonNegativeInt),
  errorCategory: Schema.NullOr(BoundedNonEmptyString(128)),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type AnalyticsExport = typeof AnalyticsExport.Type;
export const AnalyticsRetentionOperation = Schema.Struct({
  id: AnalyticsRetentionOperationId,
  status: AnalyticsOperationStatus,
  projectId: Schema.NullOr(ProjectId),
  detailBefore: IsoDateTime,
  deletedUsageCount: NonNegativeInt,
  deletedToolMetricCount: NonNegativeInt,
  deletedExportCount: NonNegativeInt,
  errorCategory: Schema.NullOr(BoundedNonEmptyString(128)),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type AnalyticsRetentionOperation = typeof AnalyticsRetentionOperation.Type;

export const ExchangeRateSnapshot = Schema.Struct({
  id: ExchangeRateSnapshotId,
  baseCurrency: AnalyticsCurrency,
  quoteCurrency: AnalyticsCurrency,
  rate: AnalyticsPositiveDecimal,
  source: Schema.Literal("user_configured"),
  effectiveAt: IsoDateTime,
  createdAt: IsoDateTime,
}).check(
  Schema.makeFilter((snapshot) =>
    snapshot.baseCurrency === snapshot.quoteCurrency
      ? "exchange-rate currencies must differ"
      : true,
  ),
);
export type ExchangeRateSnapshot = typeof ExchangeRateSnapshot.Type;

export const SubscriptionAttributionMode = Schema.Literals([
  "none",
  "flat_monthly_by_runs",
  "flat_monthly_by_tokens",
  "flat_monthly_by_active_time",
  "manual_fixed_internal_rate",
]);
export type SubscriptionAttributionMode = typeof SubscriptionAttributionMode.Type;
export const AnalyticsForecastMethod = Schema.Literals([
  "current_period_run_rate",
  "trailing_average",
  "scheduled_mission_estimate",
]);
export type AnalyticsForecastMethod = typeof AnalyticsForecastMethod.Type;
export const AnalyticsDetailLevel = Schema.Literals(["minimal", "standard", "detailed"]);
export type AnalyticsDetailLevel = typeof AnalyticsDetailLevel.Type;
export const AnalyticsSettings = Schema.Struct({
  enabled: Schema.Boolean,
  detailRetentionDays: PositiveInt,
  aggregateRetentionDays: Schema.NullOr(PositiveInt),
  exportRetentionDays: PositiveInt,
  pricingSourcePriority: Schema.Array(PricingSource).check(Schema.isMaxLength(5)),
  defaultReportingCurrency: AnalyticsCurrency,
  subscriptionAttributionMode: SubscriptionAttributionMode,
  localComputeHourlyRate: Schema.NullOr(AnalyticsNonNegativeDecimal),
  outcomeObservationWindowDays: PositiveInt,
  minimumComparisonSampleSize: PositiveInt,
  forecastMethod: AnalyticsForecastMethod,
  detailLevel: AnalyticsDetailLevel,
  storePromptContent: Schema.Literal(false),
  updatedAt: IsoDateTime,
});
export type AnalyticsSettings = typeof AnalyticsSettings.Type;

export const AnalyticsDateRange = Schema.Struct({
  from: Schema.NullOr(IsoDateTime),
  to: Schema.NullOr(IsoDateTime),
});
export type AnalyticsDateRange = typeof AnalyticsDateRange.Type;
export const AnalyticsFilter = Schema.Struct({
  dateRange: AnalyticsDateRange,
  projectId: Schema.NullOr(ProjectId),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: Schema.NullOr(AgentRunId),
  providerProfileId: Schema.NullOr(ProviderProfileId),
  modelProfileId: Schema.NullOr(ModelProfileId),
  agentRoleId: Schema.NullOr(AgentRoleId),
  reasoningLevel: Schema.NullOr(RoutingReasoningLevel),
  humanDisposition: Schema.NullOr(HumanDisposition),
  subscriptionBacked: Schema.NullOr(Schema.Boolean),
});
export type AnalyticsFilter = typeof AnalyticsFilter.Type;

export const AnalyticsDataQuality = Schema.Struct({
  runCount: NonNegativeInt,
  providerReportedUsageCount: NonNegativeInt,
  estimatedUsageCount: NonNegativeInt,
  unknownUsageCount: NonNegativeInt,
  pricedUsageCount: NonNegativeInt,
  unpricedUsageCount: NonNegativeInt,
  stalePricingCount: NonNegativeInt,
  incompleteOutcomeCount: NonNegativeInt,
  pendingHumanDispositionCount: NonNegativeInt,
  sourceDetailDeletedCount: NonNegativeInt,
});
export type AnalyticsDataQuality = typeof AnalyticsDataQuality.Type;
export const AnalyticsCurrencyTotal = Schema.Struct({
  currency: AnalyticsCurrency,
  providerReportedAmount: AnalyticsNonNegativeDecimal,
  calculatedEstimateAmount: AnalyticsNonNegativeDecimal,
  subscriptionAllocationAmount: AnalyticsNonNegativeDecimal,
  localComputeEstimateAmount: AnalyticsNonNegativeDecimal,
  unknownCostRecordCount: NonNegativeInt,
});
export type AnalyticsCurrencyTotal = typeof AnalyticsCurrencyTotal.Type;
export const AnalyticsConvertedCurrencyTotal = Schema.Struct({
  originalCurrency: AnalyticsCurrency,
  reportingCurrency: AnalyticsCurrency,
  exchangeRateSnapshotId: ExchangeRateSnapshotId,
  exchangeRate: AnalyticsNonNegativeDecimal,
  exchangeRateEffectiveAt: IsoDateTime,
  providerReportedAmount: AnalyticsNonNegativeDecimal,
  calculatedEstimateAmount: AnalyticsNonNegativeDecimal,
  subscriptionAllocationAmount: AnalyticsNonNegativeDecimal,
  localComputeEstimateAmount: AnalyticsNonNegativeDecimal,
  unknownCostRecordCount: NonNegativeInt,
});
export type AnalyticsConvertedCurrencyTotal = typeof AnalyticsConvertedCurrencyTotal.Type;
export const AnalyticsOverview = Schema.Struct({
  metricVersion: PositiveInt,
  completedMissionCount: NonNegativeInt,
  verifiedTaskCount: NonNegativeInt,
  firstPassVerificationRate: Schema.NullOr(AnalyticsConfidenceRatio),
  totalAgentRunCount: NonNegativeInt,
  fallbackRate: Schema.NullOr(AnalyticsConfidenceRatio),
  repairRate: Schema.NullOr(AnalyticsConfidenceRatio),
  humanAcceptanceRate: Schema.NullOr(AnalyticsConfidenceRatio),
  activeAgentMilliseconds: NonNegativeInt,
  wallClockDeliveryMilliseconds: Schema.NullOr(NonNegativeInt),
  currencyTotals: Schema.Array(AnalyticsCurrencyTotal),
  convertedCurrencyTotals: Schema.Array(AnalyticsConvertedCurrencyTotal),
  dataQuality: AnalyticsDataQuality,
});
export type AnalyticsOverview = typeof AnalyticsOverview.Type;
export const AnalyticsComparisonRow = Schema.Struct({
  scopeType: Schema.Literals(["provider", "model", "agent_role", "reasoning"]),
  scopeId: BoundedNonEmptyString(512),
  label: BoundedNonEmptyString(512),
  taskCount: NonNegativeInt,
  runCount: NonNegativeInt,
  completionRate: Schema.NullOr(AnalyticsConfidenceRatio),
  firstPassVerificationRate: Schema.NullOr(AnalyticsConfidenceRatio),
  repairRate: Schema.NullOr(AnalyticsConfidenceRatio),
  fallbackRate: Schema.NullOr(AnalyticsConfidenceRatio),
  averageFirstOutputLatencyMilliseconds: Schema.NullOr(NonNegativeInt),
  tokensPerVerifiedTask: Schema.NullOr(AnalyticsNonNegativeDecimal),
  humanAcceptanceRate: Schema.NullOr(AnalyticsConfidenceRatio),
  missingDataRatio: AnalyticsConfidenceRatio,
  estimatedCostRatio: AnalyticsConfidenceRatio,
  insufficientSample: Schema.Boolean,
});
export type AnalyticsComparisonRow = typeof AnalyticsComparisonRow.Type;
export const AnalyticsForecast = Schema.Struct({
  metricKey: BoundedNonEmptyString(128),
  value: Schema.NullOr(AnalyticsNonNegativeDecimal),
  unit: BoundedNonEmptyString(64),
  method: AnalyticsForecastMethod,
  observationStart: IsoDateTime,
  observationEnd: IsoDateTime,
  dataCompleteness: AnalyticsConfidenceRatio,
  confidence: AnalyticsConfidence,
  uncertainty: BoundedNonEmptyString(1_000),
  includesEstimatedCost: Schema.Boolean,
  withheldReason: Schema.NullOr(BoundedNonEmptyString(1_000)),
});
export type AnalyticsForecast = typeof AnalyticsForecast.Type;
export const BudgetDecision = Schema.Struct({
  allowed: Schema.Boolean,
  action: BudgetAction,
  reason: BoundedNonEmptyString(2_000),
  applicablePolicyIds: Schema.Array(BudgetPolicyId),
  blockingPolicyId: Schema.NullOr(BudgetPolicyId),
  overrideId: Schema.NullOr(BudgetOverrideId),
  usageIncomplete: Schema.Boolean,
  estimatedProposedAmount: Schema.NullOr(AnalyticsNonNegativeDecimal),
  currency: Schema.NullOr(AnalyticsCurrency),
});
export type BudgetDecision = typeof BudgetDecision.Type;

export const AnalyticsWorkspaceSnapshot = Schema.Struct({
  settings: AnalyticsSettings,
  overview: AnalyticsOverview,
  comparisons: Schema.Array(AnalyticsComparisonRow),
  forecasts: Schema.Array(AnalyticsForecast),
  pricingSnapshots: Schema.Array(PricingSnapshot),
  subscriptionAttributionRules: Schema.Array(SubscriptionAttributionRule),
  exchangeRateSnapshots: Schema.Array(ExchangeRateSnapshot),
  budgets: Schema.Array(BudgetPolicy),
  budgetEvents: Schema.Array(BudgetEvent),
  activeAlerts: Schema.Array(AnalyticsAlert),
  recommendations: Schema.Array(AnalyticsRecommendation),
  annotations: Schema.Array(AnalyticsAnnotation),
  exports: Schema.Array(AnalyticsExport),
  retentionOperations: Schema.Array(AnalyticsRetentionOperation),
});
export type AnalyticsWorkspaceSnapshot = typeof AnalyticsWorkspaceSnapshot.Type;

export const AnalyticsOrchestrationEventType = Schema.Literals([
  "analytics.usage_recorded",
  "analytics.usage_reconciled",
  "analytics.usage_unknown",
  "analytics.pricing_snapshot_created",
  "analytics.subscription_attribution_rule_created",
  "analytics.subscription_allocation_rebuilt",
  "analytics.exchange_rate_snapshot_created",
  "analytics.pricing_snapshot_updated",
  "analytics.cost_calculated",
  "analytics.cost_recalculation_failed",
  "analytics.provider_cost_received",
  "analytics.run_performance_finalized",
  "analytics.task_outcome_updated",
  "analytics.human_disposition_recorded",
  "analytics.human_disposition_source_changed",
  "analytics.mission_outcome_updated",
  "analytics.aggregate_requested",
  "analytics.aggregate_completed",
  "analytics.aggregate_invalidated",
  "analytics.aggregate_failed",
  "analytics.budget_created",
  "analytics.budget_updated",
  "analytics.budget_soft_limit_reached",
  "analytics.budget_hard_limit_reached",
  "analytics.budget_override_created",
  "analytics.budget_override_expired",
  "analytics.alert_created",
  "analytics.alert_acknowledged",
  "analytics.recommendation_created",
  "analytics.export_started",
  "analytics.export_completed",
  "analytics.export_failed",
  "analytics.retention_started",
  "analytics.retention_completed",
  "analytics.retention_failed",
]);
export type AnalyticsOrchestrationEventType = typeof AnalyticsOrchestrationEventType.Type;
export const AnalyticsEventReferencePayload = Schema.Struct({
  recordType: BoundedNonEmptyString(128),
  recordId: BoundedNonEmptyString(512),
  projectId: Schema.NullOr(ProjectId),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: Schema.NullOr(AgentRunId),
  usageRecordId: Schema.NullOr(UsageRecordId),
  costRecordId: Schema.NullOr(CostRecordId),
  humanDispositionRecordId: Schema.NullOr(HumanDispositionRecordId),
  budgetPolicyId: Schema.NullOr(BudgetPolicyId),
  exportId: Schema.NullOr(AnalyticsExportId),
  retentionOperationId: Schema.NullOr(AnalyticsRetentionOperationId),
  detail: Schema.NullOr(BoundedString(1_000)),
});
export type AnalyticsEventReferencePayload = typeof AnalyticsEventReferencePayload.Type;

export class AnalyticsValidationError extends Schema.TaggedErrorClass<AnalyticsValidationError>()(
  "AnalyticsValidationError",
  { message: BoundedNonEmptyString(2_000) },
) {}
export class AnalyticsNotFoundError extends Schema.TaggedErrorClass<AnalyticsNotFoundError>()(
  "AnalyticsNotFoundError",
  { entity: BoundedNonEmptyString(128), id: BoundedNonEmptyString(512) },
) {}
export class AnalyticsUnavailableError extends Schema.TaggedErrorClass<AnalyticsUnavailableError>()(
  "AnalyticsUnavailableError",
  { message: BoundedNonEmptyString(2_000) },
) {}

export const AnalyticsFilterInput = Schema.Struct({ filter: AnalyticsFilter });
export type AnalyticsFilterInput = typeof AnalyticsFilterInput.Type;
export const AnalyticsRunDetailInput = Schema.Struct({ agentRunId: AgentRunId });
export type AnalyticsRunDetailInput = typeof AnalyticsRunDetailInput.Type;
export const AnalyticsRunDetail = Schema.Struct({
  performance: Schema.NullOr(RunPerformanceRecord),
  usage: Schema.Array(UsageRecord),
  costs: Schema.Array(CostRecord),
  tools: Schema.Array(ToolExecutionMetric),
  taskOutcome: Schema.NullOr(TaskOutcomeRecord),
  humanDispositions: Schema.Array(HumanDispositionRecord),
});
export type AnalyticsRunDetail = typeof AnalyticsRunDetail.Type;
export const AnalyticsSettingsUpdateInput = Schema.Struct({ settings: AnalyticsSettings });
export type AnalyticsSettingsUpdateInput = typeof AnalyticsSettingsUpdateInput.Type;
export const PricingSnapshotSaveInput = Schema.Struct({ snapshot: PricingSnapshot });
export type PricingSnapshotSaveInput = typeof PricingSnapshotSaveInput.Type;
export const SubscriptionAttributionRuleSaveInput = Schema.Struct({
  rule: SubscriptionAttributionRule,
});
export type SubscriptionAttributionRuleSaveInput = typeof SubscriptionAttributionRuleSaveInput.Type;
export const ExchangeRateSnapshotSaveInput = Schema.Struct({ snapshot: ExchangeRateSnapshot });
export type ExchangeRateSnapshotSaveInput = typeof ExchangeRateSnapshotSaveInput.Type;
export const BudgetPolicySaveInput = Schema.Struct({ policy: BudgetPolicy });
export type BudgetPolicySaveInput = typeof BudgetPolicySaveInput.Type;
export const BudgetEventAcknowledgeInput = Schema.Struct({
  budgetEventId: BudgetEventId,
  acknowledgedAt: IsoDateTime,
});
export type BudgetEventAcknowledgeInput = typeof BudgetEventAcknowledgeInput.Type;
export const BudgetOverrideCreateInput = Schema.Struct({ override: BudgetOverride });
export type BudgetOverrideCreateInput = typeof BudgetOverrideCreateInput.Type;
export const AnalyticsAlertAcknowledgeInput = Schema.Struct({
  alertId: AnalyticsAlertId,
  acknowledgedAt: IsoDateTime,
});
export type AnalyticsAlertAcknowledgeInput = typeof AnalyticsAlertAcknowledgeInput.Type;
export const AnalyticsAnnotationSaveInput = Schema.Struct({ annotation: AnalyticsAnnotation });
export type AnalyticsAnnotationSaveInput = typeof AnalyticsAnnotationSaveInput.Type;
export const AnalyticsExportCreateInput = Schema.Struct({
  format: AnalyticsExportFormat,
  filter: AnalyticsFilter,
  requestedAt: IsoDateTime,
});
export type AnalyticsExportCreateInput = typeof AnalyticsExportCreateInput.Type;
export const AnalyticsRetentionStartInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  detailBefore: IsoDateTime,
  requestedAt: IsoDateTime,
});
export type AnalyticsRetentionStartInput = typeof AnalyticsRetentionStartInput.Type;
export const AnalyticsAggregateRebuildInput = Schema.Struct({
  scopeType: Schema.NullOr(AnalyticsScopeType),
  scopeId: Schema.NullOr(BoundedNonEmptyString(512)),
  requestedAt: IsoDateTime,
});
export type AnalyticsAggregateRebuildInput = typeof AnalyticsAggregateRebuildInput.Type;

/** The first canonical Phase 7 metric catalogue. Never change meanings in-place. */
export const ANALYTICS_METRIC_VERSION = 1 as const;
export const ANALYTICS_METRIC_KEYS = [
  "cost_per_verified_task_implementation",
  "cost_per_verified_task_inclusive",
  "cost_per_merged_mission",
  "first_pass_verification_rate",
  "repair_rate",
  "human_acceptance_rate",
  "provider_failure_rate",
  "fallback_rate_per_started_run",
] as const;
