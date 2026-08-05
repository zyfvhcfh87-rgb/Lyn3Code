import {
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
  UsageRecord,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetCostRecordInput,
  GetHumanDispositionRecordInput,
  GetMissionOutcomeInput,
  GetPricingSnapshotInput,
  GetRunPerformanceInput,
  GetSubscriptionAttributionRuleInput,
  GetTaskOutcomeInput,
  GetUsageRecordBySourceInput,
  GetUsageRecordInput,
  ListAnalyticsOperationsInput,
  ListAnalyticsScopeRecordsInput,
  ListHumanDispositionRecordsInput,
  ListExchangeRateSnapshotsInput,
  ListPricingSnapshotsInput,
  ListRecoverableAnalyticsOperationsInput,
  ListUsageRecordsInput,
  ListSubscriptionAttributionRulesInput,
  ProjectionUsageAnalyticsRepository,
  QueryAnalyticsRecordsInput,
  type ProjectionUsageAnalyticsRepositoryShape,
} from "../Services/ProjectionUsageAnalytics.ts";

const UsageDbRow = UsageRecord;
const PricingDbRow = PricingSnapshot.mapFields(
  Struct.assign({
    toolRateMetadata: Schema.fromJsonString(PricingSnapshot.fields.toolRateMetadata),
    metadata: Schema.fromJsonString(PricingSnapshot.fields.metadata),
  }),
);
const CostDbRow = CostRecord.mapFields(
  Struct.assign({
    isEstimated: Schema.Number,
    isSubscriptionBacked: Schema.Number,
    calculationBreakdown: Schema.fromJsonString(CostRecord.fields.calculationBreakdown),
    missingPricingDimensions: Schema.fromJsonString(CostRecord.fields.missingPricingDimensions),
  }),
);
const SubscriptionAttributionRuleDbRow = SubscriptionAttributionRule;
const RunPerformanceDbRow = RunPerformanceRecord.mapFields(
  Struct.assign({ contextReductionApplied: Schema.Number }),
);
const TaskOutcomeDbRow = TaskOutcomeRecord.mapFields(
  Struct.assign({
    implementationCompleted: Schema.Number,
    reverted: Schema.Number,
    firstPassVerification: Schema.NullOr(Schema.Number),
  }),
);
const HumanDispositionDbRow = HumanDispositionRecord.mapFields(
  Struct.assign({ sourceChangedAfterDisposition: Schema.Number }),
);
const MissionOutcomeDbRow = MissionOutcomeRecord.mapFields(
  Struct.assign({ pullRequestCreated: Schema.Number, pullRequestMerged: Schema.Number }),
);
const BudgetPolicyDbRow = BudgetPolicy.mapFields(
  Struct.assign({ conservativeWhenIncomplete: Schema.Number, enabled: Schema.Number }),
);
const BudgetOverrideDbRow = BudgetOverride.mapFields(
  Struct.assign({ fallbackAllowed: Schema.Number }),
);
const RecommendationDbRow = AnalyticsRecommendation.mapFields(
  Struct.assign({
    metricKeys: Schema.fromJsonString(AnalyticsRecommendation.fields.metricKeys),
    estimatedCostPresent: Schema.Number,
    conflictsWithPolicy: Schema.Number,
  }),
);
const SettingsDbRow = AnalyticsSettings.mapFields(
  Struct.assign({
    enabled: Schema.Number,
    pricingSourcePriority: Schema.fromJsonString(AnalyticsSettings.fields.pricingSourcePriority),
    storePromptContent: Schema.Number,
  }),
);
const ExportDbRow = AnalyticsExport.mapFields(
  Struct.assign({ filter: Schema.fromJsonString(AnalyticsExport.fields.filter) }),
);

const toCostRecord = (row: typeof CostDbRow.Type): CostRecord => ({
  ...row,
  isEstimated: row.isEstimated === 1,
  isSubscriptionBacked: row.isSubscriptionBacked === 1,
});
const toRunPerformance = (row: typeof RunPerformanceDbRow.Type): RunPerformanceRecord => ({
  ...row,
  contextReductionApplied: row.contextReductionApplied === 1,
});
const toTaskOutcome = (row: typeof TaskOutcomeDbRow.Type): TaskOutcomeRecord => ({
  ...row,
  implementationCompleted: row.implementationCompleted === 1,
  reverted: row.reverted === 1,
  firstPassVerification:
    row.firstPassVerification === null ? null : row.firstPassVerification === 1,
});
const toHumanDisposition = (row: typeof HumanDispositionDbRow.Type): HumanDispositionRecord => ({
  ...row,
  sourceChangedAfterDisposition: row.sourceChangedAfterDisposition === 1,
});
const toMissionOutcome = (row: typeof MissionOutcomeDbRow.Type): MissionOutcomeRecord => ({
  ...row,
  pullRequestCreated: row.pullRequestCreated === 1,
  pullRequestMerged: row.pullRequestMerged === 1,
});
const toBudgetPolicy = (row: typeof BudgetPolicyDbRow.Type): BudgetPolicy => ({
  ...row,
  conservativeWhenIncomplete: row.conservativeWhenIncomplete === 1,
  enabled: row.enabled === 1,
});
const toBudgetOverride = (row: typeof BudgetOverrideDbRow.Type): BudgetOverride => ({
  ...row,
  fallbackAllowed: row.fallbackAllowed === 1,
});
const toRecommendation = (row: typeof RecommendationDbRow.Type): AnalyticsRecommendation => ({
  ...row,
  estimatedCostPresent: row.estimatedCostPresent === 1,
  conflictsWithPolicy: row.conflictsWithPolicy === 1,
});
const toSettings = (row: typeof SettingsDbRow.Type): AnalyticsSettings => ({
  ...row,
  enabled: row.enabled === 1,
  storePromptContent: false,
});

const usageColumns = `
  usage_record_id AS "id", source_event_id AS "sourceEventId",
  source_turn_id AS "sourceTurnId", project_id AS "projectId", mission_id AS "missionId",
  task_id AS "taskId", agent_run_id AS "agentRunId",
  parent_agent_run_id AS "parentAgentRunId", routing_decision_id AS "routingDecisionId",
  provider_profile_id AS "providerProfileId", model_profile_id AS "modelProfileId",
  capability_snapshot_id AS "capabilitySnapshotId", provider_request_id AS "providerRequestId",
  provider_response_id AS "providerResponseId", usage_source AS "usageSource",
  usage_confidence AS "usageConfidence", state, input_tokens AS "inputTokens",
  output_tokens AS "outputTokens", reasoning_tokens AS "reasoningTokens",
  cached_input_tokens AS "cachedInputTokens", cache_write_tokens AS "cacheWriteTokens",
  cache_read_tokens AS "cacheReadTokens", total_tokens AS "totalTokens",
  request_count AS "requestCount", tool_call_count AS "toolCallCount",
  provider_round_trip_count AS "providerRoundTripCount", started_at AS "startedAt",
  completed_at AS "completedAt", recorded_at AS "recordedAt", reconciled_at AS "reconciledAt"
`;
const toolMetricColumns = `
  tool_execution_metric_id AS "id", source_event_id AS "sourceEventId",
  provider_item_id AS "providerItemId", agent_run_id AS "agentRunId", task_id AS "taskId",
  tool_category AS "toolCategory", tool_name AS "toolName", status,
  started_at AS "startedAt", completed_at AS "completedAt",
  duration_milliseconds AS "durationMilliseconds", input_size AS "inputSize",
  output_size AS "outputSize", error_category AS "errorCategory", retry_count AS "retryCount",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;
const runPerformanceColumns = `
  run_performance_record_id AS "id", agent_run_id AS "agentRunId", task_id AS "taskId",
  mission_id AS "missionId", provider_profile_id AS "providerProfileId",
  model_profile_id AS "modelProfileId", reasoning_level AS "reasoningLevel",
  queued_duration_milliseconds AS "queuedDurationMilliseconds",
  startup_duration_milliseconds AS "startupDurationMilliseconds",
  first_output_latency_milliseconds AS "firstOutputLatencyMilliseconds",
  active_duration_milliseconds AS "activeDurationMilliseconds",
  wall_clock_duration_milliseconds AS "wallClockDurationMilliseconds", status,
  completion_category AS "completionCategory", fallback_count AS "fallbackCount",
  provider_retry_count AS "providerRetryCount", tool_failure_count AS "toolFailureCount",
  context_reduction_applied AS "contextReductionApplied", cancelled_by AS "cancelledBy",
  created_at AS "createdAt", updated_at AS "updatedAt", finalized_at AS "finalizedAt"
`;
const pricingColumns = `
  pricing_snapshot_id AS "id", provider_profile_id AS "providerProfileId",
  model_profile_id AS "modelProfileId", currency, pricing_source AS "pricingSource",
  pricing_version AS "pricingVersion", effective_from AS "effectiveFrom",
  effective_to AS "effectiveTo", input_token_rate AS "inputTokenRate",
  output_token_rate AS "outputTokenRate", reasoning_token_rate AS "reasoningTokenRate",
  cached_input_rate AS "cachedInputRate", cache_write_rate AS "cacheWriteRate",
  cache_read_rate AS "cacheReadRate", request_rate AS "requestRate",
  tool_rate_metadata_json AS "toolRateMetadata", billing_unit AS "billingUnit",
  confidence, metadata_json AS "metadata", created_at AS "createdAt"
`;
const costColumns = `
  cost_record_id AS "id", source_key AS "sourceKey", usage_record_id AS "usageRecordId",
  agent_run_id AS "agentRunId", project_id AS "projectId", mission_id AS "missionId",
  task_id AS "taskId", provider_profile_id AS "providerProfileId",
  model_profile_id AS "modelProfileId", pricing_snapshot_id AS "pricingSnapshotId",
  amount, currency, cost_type AS "costType", calculation_method AS "calculationMethod",
  confidence, is_estimated AS "isEstimated", is_subscription_backed AS "isSubscriptionBacked",
  calculation_breakdown_json AS "calculationBreakdown",
  missing_pricing_dimensions_json AS "missingPricingDimensions", created_at AS "createdAt"
`;
const subscriptionAttributionRuleColumns = `
  subscription_attribution_rule_id AS "id", provider_profile_id AS "providerProfileId",
  model_profile_id AS "modelProfileId", label, mode, period_start AS "periodStart",
  period_end AS "periodEnd", currency, monthly_amount AS "monthlyAmount",
  fixed_internal_rate AS "fixedInternalRate", fixed_rate_unit AS "fixedRateUnit",
  created_at AS "createdAt"
`;
const exchangeRateColumns = `
  exchange_rate_snapshot_id AS "id", base_currency AS "baseCurrency",
  quote_currency AS "quoteCurrency", rate, source, effective_at AS "effectiveAt",
  created_at AS "createdAt"
`;
const taskOutcomeColumns = `
  task_outcome_record_id AS "id", task_id AS "taskId", mission_id AS "missionId", status,
  implementation_completed AS "implementationCompleted", verification_result AS "verificationResult",
  integration_result AS "integrationResult", human_disposition AS "humanDisposition", reverted,
  first_pass_verification AS "firstPassVerification", repair_attempt_count AS "repairAttemptCount",
  agent_run_count AS "agentRunCount",
  total_wall_clock_duration_milliseconds AS "totalWallClockDurationMilliseconds",
  total_active_agent_duration_milliseconds AS "totalActiveAgentDurationMilliseconds",
  created_at AS "createdAt", updated_at AS "updatedAt", finalized_at AS "finalizedAt"
`;
const humanDispositionColumns = `
  human_disposition_record_id AS "id", task_outcome_record_id AS "taskOutcomeRecordId",
  task_id AS "taskId", mission_id AS "missionId", disposition, actor,
  marked_at AS "markedAt", reason, source_fingerprint AS "sourceFingerprint",
  source_changed_after_disposition AS "sourceChangedAfterDisposition",
  source_changed_at AS "sourceChangedAt"
`;
const missionOutcomeColumns = `
  mission_outcome_record_id AS "id", mission_id AS "missionId", status,
  task_count AS "taskCount", completed_task_count AS "completedTaskCount",
  failed_task_count AS "failedTaskCount", verified_task_count AS "verifiedTaskCount",
  integrated_task_count AS "integratedTaskCount", pull_request_created AS "pullRequestCreated",
  pull_request_merged AS "pullRequestMerged", human_disposition AS "humanDisposition",
  started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const budgetPolicyColumns = `
  budget_policy_id AS "id", scope_type AS "scopeType", scope_id AS "scopeId", name, currency,
  period_type AS "periodType", period_start AS "periodStart", period_end AS "periodEnd",
  soft_limit AS "softLimit", hard_limit AS "hardLimit", token_limit AS "tokenLimit",
  request_limit AS "requestLimit", action_on_soft_limit AS "actionOnSoftLimit",
  action_on_hard_limit AS "actionOnHardLimit",
  conservative_when_incomplete AS "conservativeWhenIncomplete", enabled,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;
const budgetEventColumns = `
  budget_event_id AS "id", deduplication_key AS "deduplicationKey",
  budget_policy_id AS "budgetPolicyId", scope_type AS "scopeType", scope_id AS "scopeId",
  event_type AS "eventType", current_value AS "currentValue",
  threshold_value AS "thresholdValue", currency, created_at AS "createdAt",
  acknowledged_at AS "acknowledgedAt"
`;
const budgetOverrideColumns = `
  budget_override_id AS "id", budget_policy_id AS "budgetPolicyId",
  scope_type AS "scopeType", scope_id AS "scopeId", current_value AS "currentValue",
  threshold_value AS "thresholdValue", reason, actor, expires_at AS "expiresAt",
  fallback_allowed AS "fallbackAllowed", created_at AS "createdAt", expired_at AS "expiredAt"
`;
const annotationColumns = `
  analytics_annotation_id AS "id", scope_type AS "scopeType", scope_id AS "scopeId",
  timestamp, title, content, created_by AS "createdBy", created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const alertColumns = `
  analytics_alert_id AS "id", deduplication_key AS "deduplicationKey",
  scope_type AS "scopeType", scope_id AS "scopeId", category, severity, title, detail,
  status, created_at AS "createdAt", acknowledged_at AS "acknowledgedAt",
  resolved_at AS "resolvedAt"
`;
const recommendationColumns = `
  analytics_recommendation_id AS "id", scope_type AS "scopeType", scope_id AS "scopeId",
  title, evidence, sample_size AS "sampleSize", period_start AS "periodStart",
  period_end AS "periodEnd", task_segment AS "taskSegment", metric_keys_json AS "metricKeys",
  uncertainty, estimated_cost_present AS "estimatedCostPresent",
  conflicts_with_policy AS "conflictsWithPolicy", created_at AS "createdAt"
`;
const settingsColumns = `
  enabled, detail_retention_days AS "detailRetentionDays",
  aggregate_retention_days AS "aggregateRetentionDays",
  export_retention_days AS "exportRetentionDays",
  pricing_source_priority_json AS "pricingSourcePriority",
  default_reporting_currency AS "defaultReportingCurrency",
  subscription_attribution_mode AS "subscriptionAttributionMode",
  local_compute_hourly_rate AS "localComputeHourlyRate",
  outcome_observation_window_days AS "outcomeObservationWindowDays",
  minimum_comparison_sample_size AS "minimumComparisonSampleSize",
  forecast_method AS "forecastMethod", detail_level AS "detailLevel",
  store_prompt_content AS "storePromptContent", updated_at AS "updatedAt"
`;
const exportColumns = `
  analytics_export_id AS "id", format, status, filter_json AS "filter",
  metric_version AS "metricVersion", relative_file_path AS "relativeFilePath",
  row_count AS "rowCount", byte_count AS "byteCount", error_category AS "errorCategory",
  requested_at AS "requestedAt", started_at AS "startedAt", completed_at AS "completedAt"
`;
const retentionColumns = `
  analytics_retention_operation_id AS "id", status, project_id AS "projectId",
  detail_before AS "detailBefore", deleted_usage_count AS "deletedUsageCount",
  deleted_tool_metric_count AS "deletedToolMetricCount",
  deleted_export_count AS "deletedExportCount", error_category AS "errorCategory",
  requested_at AS "requestedAt", started_at AS "startedAt", completed_at AS "completedAt"
`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));

  const upsertUsageRow = SqlSchema.void({
    Request: UsageRecord,
    execute: (row) => sql`
      INSERT INTO projection_analytics_usage_records (
        usage_record_id, source_event_id, source_turn_id, project_id, mission_id, task_id,
        agent_run_id, parent_agent_run_id, routing_decision_id, provider_profile_id,
        model_profile_id, capability_snapshot_id, provider_request_id, provider_response_id,
        usage_source, usage_confidence, state, input_tokens, output_tokens, reasoning_tokens,
        cached_input_tokens, cache_write_tokens, cache_read_tokens, total_tokens, request_count,
        tool_call_count, provider_round_trip_count, started_at, completed_at, recorded_at, reconciled_at
      ) VALUES (
        ${row.id}, ${row.sourceEventId}, ${row.sourceTurnId}, ${row.projectId}, ${row.missionId},
        ${row.taskId}, ${row.agentRunId}, ${row.parentAgentRunId}, ${row.routingDecisionId},
        ${row.providerProfileId}, ${row.modelProfileId}, ${row.capabilitySnapshotId},
        ${row.providerRequestId}, ${row.providerResponseId}, ${row.usageSource},
        ${row.usageConfidence}, ${row.state}, ${row.inputTokens}, ${row.outputTokens},
        ${row.reasoningTokens}, ${row.cachedInputTokens}, ${row.cacheWriteTokens},
        ${row.cacheReadTokens}, ${row.totalTokens}, ${row.requestCount}, ${row.toolCallCount},
        ${row.providerRoundTripCount}, ${row.startedAt}, ${row.completedAt}, ${row.recordedAt},
        ${row.reconciledAt}
      ) ON CONFLICT (source_event_id) DO UPDATE SET
        source_turn_id = excluded.source_turn_id, mission_id = excluded.mission_id,
        task_id = excluded.task_id, parent_agent_run_id = excluded.parent_agent_run_id,
        routing_decision_id = excluded.routing_decision_id,
        capability_snapshot_id = excluded.capability_snapshot_id,
        provider_request_id = excluded.provider_request_id,
        provider_response_id = excluded.provider_response_id,
        usage_source = excluded.usage_source, usage_confidence = excluded.usage_confidence,
        state = excluded.state, input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens, reasoning_tokens = excluded.reasoning_tokens,
        cached_input_tokens = excluded.cached_input_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        cache_read_tokens = excluded.cache_read_tokens, total_tokens = excluded.total_tokens,
        request_count = excluded.request_count, tool_call_count = excluded.tool_call_count,
        provider_round_trip_count = excluded.provider_round_trip_count,
        started_at = excluded.started_at, completed_at = excluded.completed_at,
        reconciled_at = excluded.reconciled_at
      WHERE projection_analytics_usage_records.state = 'provisional'
    `,
  });
  const getUsageRow = SqlSchema.findOneOption({
    Request: GetUsageRecordInput,
    Result: UsageDbRow,
    execute: ({ usageRecordId }) => sql`
      SELECT ${sql.unsafe(usageColumns)} FROM projection_analytics_usage_records
      WHERE usage_record_id = ${usageRecordId}
    `,
  });
  const getUsageBySourceRow = SqlSchema.findOneOption({
    Request: GetUsageRecordBySourceInput,
    Result: UsageDbRow,
    execute: ({ sourceEventId }) => sql`
      SELECT ${sql.unsafe(usageColumns)} FROM projection_analytics_usage_records
      WHERE source_event_id = ${sourceEventId}
    `,
  });
  const listUsageRows = SqlSchema.findAll({
    Request: ListUsageRecordsInput,
    Result: UsageDbRow,
    execute: ({ projectId, recordedFrom, recordedTo, limit, offset }) => sql`
      SELECT ${sql.unsafe(usageColumns)} FROM projection_analytics_usage_records
      WHERE (${projectId} IS NULL OR project_id = ${projectId})
        AND (${recordedFrom} IS NULL OR recorded_at >= ${recordedFrom})
        AND (${recordedTo} IS NULL OR recorded_at < ${recordedTo})
      ORDER BY recorded_at DESC, usage_record_id
      LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const queryUsageRows = SqlSchema.findAll({
    Request: QueryAnalyticsRecordsInput,
    Result: UsageDbRow,
    execute: ({ filter, limit, offset }) => sql`
      SELECT ${sql.unsafe(usageColumns)} FROM projection_analytics_usage_records
      WHERE (${filter.dateRange.from} IS NULL OR recorded_at >= ${filter.dateRange.from})
        AND (${filter.dateRange.to} IS NULL OR recorded_at < ${filter.dateRange.to})
        AND (${filter.projectId} IS NULL OR project_id = ${filter.projectId})
        AND (${filter.missionId} IS NULL OR mission_id = ${filter.missionId})
        AND (${filter.taskId} IS NULL OR task_id = ${filter.taskId})
        AND (${filter.agentRunId} IS NULL OR agent_run_id = ${filter.agentRunId})
        AND (${filter.providerProfileId} IS NULL OR provider_profile_id = ${filter.providerProfileId})
        AND (${filter.modelProfileId} IS NULL OR model_profile_id = ${filter.modelProfileId})
        AND (
          ${filter.agentRoleId} IS NULL OR agent_run_id IN (
            SELECT runs.agent_run_id FROM projection_agent_runs runs
            JOIN projection_mission_agents agents
              ON agents.mission_agent_id = runs.mission_agent_id
            WHERE agents.role_id = ${filter.agentRoleId}
          )
        )
      ORDER BY recorded_at DESC, usage_record_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const upsertToolMetricRow = SqlSchema.void({
    Request: ToolExecutionMetric,
    execute: (row) => sql`
      INSERT INTO projection_analytics_tool_metrics (
        tool_execution_metric_id, source_event_id, provider_item_id, agent_run_id, task_id,
        tool_category, tool_name, status, started_at, completed_at, duration_milliseconds,
        input_size, output_size, error_category, retry_count, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.sourceEventId}, ${row.providerItemId}, ${row.agentRunId}, ${row.taskId},
        ${row.toolCategory}, ${row.toolName}, ${row.status}, ${row.startedAt}, ${row.completedAt},
        ${row.durationMilliseconds}, ${row.inputSize}, ${row.outputSize}, ${row.errorCategory},
        ${row.retryCount}, ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (source_event_id) DO UPDATE SET
        provider_item_id = excluded.provider_item_id, status = excluded.status,
        completed_at = excluded.completed_at, duration_milliseconds = excluded.duration_milliseconds,
        input_size = excluded.input_size, output_size = excluded.output_size,
        error_category = excluded.error_category, retry_count = excluded.retry_count,
        updated_at = excluded.updated_at
      WHERE projection_analytics_tool_metrics.status = 'running'
    `,
  });
  const queryToolMetricRows = SqlSchema.findAll({
    Request: QueryAnalyticsRecordsInput,
    Result: ToolExecutionMetric,
    execute: ({ filter, limit, offset }) => sql`
      SELECT ${sql.unsafe(toolMetricColumns)} FROM projection_analytics_tool_metrics
      WHERE (${filter.dateRange.from} IS NULL OR started_at >= ${filter.dateRange.from})
        AND (${filter.dateRange.to} IS NULL OR started_at < ${filter.dateRange.to})
        AND (${filter.taskId} IS NULL OR task_id = ${filter.taskId})
        AND (${filter.agentRunId} IS NULL OR agent_run_id = ${filter.agentRunId})
        AND (
          ${filter.projectId} IS NULL OR agent_run_id IN (
            SELECT runs.agent_run_id FROM projection_agent_runs runs
            JOIN projection_missions missions ON missions.mission_id = runs.mission_id
            WHERE missions.project_id = ${filter.projectId}
          )
        )
        AND (
          ${filter.missionId} IS NULL OR agent_run_id IN (
            SELECT agent_run_id FROM projection_agent_runs WHERE mission_id = ${filter.missionId}
          )
        )
        AND (
          ${filter.providerProfileId} IS NULL OR agent_run_id IN (
            SELECT agent_run_id FROM projection_analytics_run_performance
            WHERE provider_profile_id = ${filter.providerProfileId}
          )
        )
        AND (
          ${filter.modelProfileId} IS NULL OR agent_run_id IN (
            SELECT agent_run_id FROM projection_analytics_run_performance
            WHERE model_profile_id = ${filter.modelProfileId}
          )
        )
      ORDER BY started_at DESC, tool_execution_metric_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const upsertRunPerformanceRow = SqlSchema.void({
    Request: RunPerformanceRecord,
    execute: (row) => sql`
      INSERT INTO projection_analytics_run_performance (
        run_performance_record_id, agent_run_id, task_id, mission_id, provider_profile_id,
        model_profile_id, reasoning_level, queued_duration_milliseconds,
        startup_duration_milliseconds, first_output_latency_milliseconds,
        active_duration_milliseconds, wall_clock_duration_milliseconds, status,
        completion_category, fallback_count, provider_retry_count, tool_failure_count,
        context_reduction_applied, cancelled_by, created_at, updated_at, finalized_at
      ) VALUES (
        ${row.id}, ${row.agentRunId}, ${row.taskId}, ${row.missionId}, ${row.providerProfileId},
        ${row.modelProfileId}, ${row.reasoningLevel}, ${row.queuedDurationMilliseconds},
        ${row.startupDurationMilliseconds}, ${row.firstOutputLatencyMilliseconds},
        ${row.activeDurationMilliseconds}, ${row.wallClockDurationMilliseconds}, ${row.status},
        ${row.completionCategory}, ${row.fallbackCount}, ${row.providerRetryCount},
        ${row.toolFailureCount}, ${row.contextReductionApplied ? 1 : 0}, ${row.cancelledBy},
        ${row.createdAt}, ${row.updatedAt}, ${row.finalizedAt}
      ) ON CONFLICT (agent_run_id) DO UPDATE SET
        queued_duration_milliseconds = excluded.queued_duration_milliseconds,
        startup_duration_milliseconds = excluded.startup_duration_milliseconds,
        first_output_latency_milliseconds = excluded.first_output_latency_milliseconds,
        active_duration_milliseconds = excluded.active_duration_milliseconds,
        wall_clock_duration_milliseconds = excluded.wall_clock_duration_milliseconds,
        status = excluded.status, completion_category = excluded.completion_category,
        fallback_count = excluded.fallback_count, provider_retry_count = excluded.provider_retry_count,
        tool_failure_count = excluded.tool_failure_count,
        context_reduction_applied = excluded.context_reduction_applied,
        cancelled_by = excluded.cancelled_by, updated_at = excluded.updated_at,
        finalized_at = excluded.finalized_at
      WHERE projection_analytics_run_performance.status <> 'finalized'
    `,
  });
  const getRunPerformanceRow = SqlSchema.findOneOption({
    Request: GetRunPerformanceInput,
    Result: RunPerformanceDbRow,
    execute: ({ agentRunId }) => sql`
      SELECT ${sql.unsafe(runPerformanceColumns)} FROM projection_analytics_run_performance
      WHERE agent_run_id = ${agentRunId}
    `,
  });
  const queryRunPerformanceRows = SqlSchema.findAll({
    Request: QueryAnalyticsRecordsInput,
    Result: RunPerformanceDbRow,
    execute: ({ filter, limit, offset }) => sql`
      SELECT ${sql.unsafe(runPerformanceColumns)} FROM projection_analytics_run_performance
      WHERE (${filter.dateRange.from} IS NULL OR created_at >= ${filter.dateRange.from})
        AND (${filter.dateRange.to} IS NULL OR created_at < ${filter.dateRange.to})
        AND (${filter.missionId} IS NULL OR mission_id = ${filter.missionId})
        AND (${filter.taskId} IS NULL OR task_id = ${filter.taskId})
        AND (${filter.agentRunId} IS NULL OR agent_run_id = ${filter.agentRunId})
        AND (${filter.providerProfileId} IS NULL OR provider_profile_id = ${filter.providerProfileId})
        AND (${filter.modelProfileId} IS NULL OR model_profile_id = ${filter.modelProfileId})
        AND (${filter.reasoningLevel} IS NULL OR reasoning_level = ${filter.reasoningLevel})
        AND (
          ${filter.agentRoleId} IS NULL OR agent_run_id IN (
            SELECT runs.agent_run_id FROM projection_agent_runs runs
            JOIN projection_mission_agents agents
              ON agents.mission_agent_id = runs.mission_agent_id
            WHERE agents.role_id = ${filter.agentRoleId}
          )
        )
        AND (
          ${filter.projectId} IS NULL OR mission_id IN (
            SELECT mission_id FROM projection_missions WHERE project_id = ${filter.projectId}
          )
        )
      ORDER BY created_at DESC, run_performance_record_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const insertPricingRow = SqlSchema.void({
    Request: PricingSnapshot,
    execute: (row) => sql`
      INSERT OR IGNORE INTO projection_analytics_pricing_snapshots (
        pricing_snapshot_id, provider_profile_id, model_profile_id, currency, pricing_source,
        pricing_version, effective_from, effective_to, input_token_rate, output_token_rate,
        reasoning_token_rate, cached_input_rate, cache_write_rate, cache_read_rate, request_rate,
        tool_rate_metadata_json, billing_unit, confidence, metadata_json, created_at
      ) VALUES (
        ${row.id}, ${row.providerProfileId}, ${row.modelProfileId}, ${row.currency},
        ${row.pricingSource}, ${row.pricingVersion}, ${row.effectiveFrom}, ${row.effectiveTo},
        ${row.inputTokenRate}, ${row.outputTokenRate}, ${row.reasoningTokenRate},
        ${row.cachedInputRate}, ${row.cacheWriteRate}, ${row.cacheReadRate}, ${row.requestRate},
        ${JSON.stringify(row.toolRateMetadata)}, ${row.billingUnit}, ${row.confidence},
        ${JSON.stringify(row.metadata)}, ${row.createdAt}
      )
    `,
  });
  const getPricingRow = SqlSchema.findOneOption({
    Request: GetPricingSnapshotInput,
    Result: PricingDbRow,
    execute: ({ pricingSnapshotId }) => sql`
      SELECT ${sql.unsafe(pricingColumns)} FROM projection_analytics_pricing_snapshots
      WHERE pricing_snapshot_id = ${pricingSnapshotId}
    `,
  });
  const listPricingRows = SqlSchema.findAll({
    Request: ListPricingSnapshotsInput,
    Result: PricingDbRow,
    execute: ({ providerProfileId, modelProfileId, currency, effectiveAt, limit, offset }) => sql`
      SELECT ${sql.unsafe(pricingColumns)} FROM projection_analytics_pricing_snapshots
      WHERE (${providerProfileId} IS NULL OR provider_profile_id = ${providerProfileId})
        AND (${modelProfileId} IS NULL OR model_profile_id = ${modelProfileId})
        AND (${currency} IS NULL OR currency = ${currency})
        AND (${effectiveAt} IS NULL OR effective_from <= ${effectiveAt})
        AND (${effectiveAt} IS NULL OR effective_to IS NULL OR effective_to > ${effectiveAt})
      ORDER BY effective_from DESC, pricing_snapshot_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const insertCostRow = SqlSchema.void({
    Request: CostRecord,
    execute: (row) => sql`
      INSERT OR IGNORE INTO projection_analytics_cost_records (
        cost_record_id, source_key, usage_record_id, agent_run_id, project_id, mission_id,
        task_id, provider_profile_id, model_profile_id, pricing_snapshot_id, amount, currency,
        cost_type, calculation_method, confidence, is_estimated, is_subscription_backed,
        calculation_breakdown_json, missing_pricing_dimensions_json, created_at
      ) VALUES (
        ${row.id}, ${row.sourceKey}, ${row.usageRecordId}, ${row.agentRunId}, ${row.projectId},
        ${row.missionId}, ${row.taskId}, ${row.providerProfileId}, ${row.modelProfileId},
        ${row.pricingSnapshotId}, ${row.amount}, ${row.currency}, ${row.costType},
        ${row.calculationMethod}, ${row.confidence}, ${row.isEstimated ? 1 : 0},
        ${row.isSubscriptionBacked ? 1 : 0}, ${JSON.stringify(row.calculationBreakdown)},
        ${JSON.stringify(row.missingPricingDimensions)}, ${row.createdAt}
      )
    `,
  });
  const getCostRow = SqlSchema.findOneOption({
    Request: GetCostRecordInput,
    Result: CostDbRow,
    execute: ({ costRecordId }) => sql`
      SELECT ${sql.unsafe(costColumns)} FROM projection_analytics_cost_records
      WHERE cost_record_id = ${costRecordId}
    `,
  });
  const queryCostRows = SqlSchema.findAll({
    Request: QueryAnalyticsRecordsInput,
    Result: CostDbRow,
    execute: ({ filter, limit, offset }) => sql`
      SELECT ${sql.unsafe(costColumns)} FROM projection_analytics_cost_records
      WHERE (${filter.dateRange.from} IS NULL OR created_at >= ${filter.dateRange.from})
        AND (${filter.dateRange.to} IS NULL OR created_at < ${filter.dateRange.to})
        AND (${filter.projectId} IS NULL OR project_id = ${filter.projectId})
        AND (${filter.missionId} IS NULL OR mission_id = ${filter.missionId})
        AND (${filter.taskId} IS NULL OR task_id = ${filter.taskId})
        AND (${filter.agentRunId} IS NULL OR agent_run_id = ${filter.agentRunId})
        AND (${filter.providerProfileId} IS NULL OR provider_profile_id = ${filter.providerProfileId})
        AND (${filter.modelProfileId} IS NULL OR model_profile_id = ${filter.modelProfileId})
        AND (${filter.subscriptionBacked === null ? null : filter.subscriptionBacked ? 1 : 0} IS NULL
          OR is_subscription_backed = ${filter.subscriptionBacked === null ? null : filter.subscriptionBacked ? 1 : 0})
        AND (
          NOT EXISTS (
            SELECT 1 FROM projection_analytics_subscription_allocation_entries allocation_entry
            WHERE allocation_entry.cost_record_id = projection_analytics_cost_records.cost_record_id
          )
          OR EXISTS (
            SELECT 1 FROM projection_analytics_subscription_allocation_current current_allocation
            WHERE current_allocation.cost_record_id = projection_analytics_cost_records.cost_record_id
          )
        )
        AND (
          ${filter.agentRoleId} IS NULL OR agent_run_id IN (
            SELECT runs.agent_run_id FROM projection_agent_runs runs
            JOIN projection_mission_agents agents
              ON agents.mission_agent_id = runs.mission_agent_id
            WHERE agents.role_id = ${filter.agentRoleId}
          )
        )
      ORDER BY created_at DESC, cost_record_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const insertSubscriptionAttributionRuleRow = SqlSchema.void({
    Request: SubscriptionAttributionRule,
    execute: (row) => sql`
      INSERT OR IGNORE INTO projection_analytics_subscription_attribution_rules (
        subscription_attribution_rule_id, provider_profile_id, model_profile_id, label, mode,
        period_start, period_end, currency, monthly_amount, fixed_internal_rate,
        fixed_rate_unit, created_at
      ) VALUES (
        ${row.id}, ${row.providerProfileId}, ${row.modelProfileId}, ${row.label}, ${row.mode},
        ${row.periodStart}, ${row.periodEnd}, ${row.currency}, ${row.monthlyAmount},
        ${row.fixedInternalRate}, ${row.fixedRateUnit}, ${row.createdAt}
      )
    `,
  });
  const getSubscriptionAttributionRuleRow = SqlSchema.findOneOption({
    Request: GetSubscriptionAttributionRuleInput,
    Result: SubscriptionAttributionRuleDbRow,
    execute: ({ ruleId }) => sql`
      SELECT ${sql.unsafe(subscriptionAttributionRuleColumns)}
      FROM projection_analytics_subscription_attribution_rules
      WHERE subscription_attribution_rule_id = ${ruleId}
    `,
  });
  const listSubscriptionAttributionRuleRows = SqlSchema.findAll({
    Request: ListSubscriptionAttributionRulesInput,
    Result: SubscriptionAttributionRuleDbRow,
    execute: ({ providerProfileId, modelProfileId, periodStart, periodEnd, limit, offset }) => sql`
      SELECT ${sql.unsafe(subscriptionAttributionRuleColumns)}
      FROM projection_analytics_subscription_attribution_rules
      WHERE (${providerProfileId} IS NULL OR provider_profile_id = ${providerProfileId})
        AND (${modelProfileId} IS NULL OR model_profile_id = ${modelProfileId})
        AND (${periodStart} IS NULL OR period_end > ${periodStart})
        AND (${periodEnd} IS NULL OR period_start < ${periodEnd})
      ORDER BY period_start DESC, subscription_attribution_rule_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const insertExchangeRateRow = SqlSchema.void({
    Request: ExchangeRateSnapshot,
    execute: (row) => sql`
      INSERT OR IGNORE INTO projection_analytics_exchange_rate_snapshots (
        exchange_rate_snapshot_id, base_currency, quote_currency, rate, source,
        effective_at, created_at
      ) VALUES (
        ${row.id}, ${row.baseCurrency}, ${row.quoteCurrency}, ${row.rate}, ${row.source},
        ${row.effectiveAt}, ${row.createdAt}
      )
    `,
  });
  const listExchangeRateRows = SqlSchema.findAll({
    Request: ListExchangeRateSnapshotsInput,
    Result: ExchangeRateSnapshot,
    execute: ({ baseCurrency, quoteCurrency, effectiveAt, limit, offset }) => sql`
      SELECT ${sql.unsafe(exchangeRateColumns)}
      FROM projection_analytics_exchange_rate_snapshots
      WHERE (${baseCurrency} IS NULL OR base_currency = ${baseCurrency})
        AND (${quoteCurrency} IS NULL OR quote_currency = ${quoteCurrency})
        AND (${effectiveAt} IS NULL OR effective_at <= ${effectiveAt})
      ORDER BY effective_at DESC, exchange_rate_snapshot_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const upsertSubscriptionUsageRow = SqlSchema.void({
    Request: SubscriptionUsageRecord,
    execute: (row) => sql`
      INSERT INTO projection_analytics_subscription_usage (
        subscription_usage_record_id, provider_profile_id, account_reference, plan_name,
        period_start, period_end, usage_unit, used_amount, remaining_amount, reset_at,
        source, confidence, recorded_at
      ) VALUES (
        ${row.id}, ${row.providerProfileId}, ${row.accountReference}, ${row.planName},
        ${row.periodStart}, ${row.periodEnd}, ${row.usageUnit}, ${row.usedAmount},
        ${row.remainingAmount}, ${row.resetAt}, ${row.source}, ${row.confidence}, ${row.recordedAt}
      ) ON CONFLICT (subscription_usage_record_id) DO UPDATE SET
        account_reference = excluded.account_reference, plan_name = excluded.plan_name,
        period_start = excluded.period_start, period_end = excluded.period_end,
        used_amount = excluded.used_amount, remaining_amount = excluded.remaining_amount,
        reset_at = excluded.reset_at, source = excluded.source, confidence = excluded.confidence,
        recorded_at = excluded.recorded_at
    `,
  });

  const updateTaskOutcomeRow = SqlSchema.void({
    Request: TaskOutcomeRecord,
    execute: (row) => sql`
      UPDATE projection_analytics_task_outcomes SET
        status = ${row.status},
        implementation_completed = ${row.implementationCompleted ? 1 : 0},
        verification_result = ${row.verificationResult},
        integration_result = ${row.integrationResult},
        human_disposition = ${row.humanDisposition},
        reverted = ${row.reverted ? 1 : 0},
        first_pass_verification = ${
          row.firstPassVerification === null ? null : row.firstPassVerification ? 1 : 0
        },
        repair_attempt_count = ${row.repairAttemptCount},
        agent_run_count = ${row.agentRunCount},
        total_wall_clock_duration_milliseconds = ${row.totalWallClockDurationMilliseconds},
        total_active_agent_duration_milliseconds = ${row.totalActiveAgentDurationMilliseconds},
        updated_at = ${row.updatedAt},
        finalized_at = ${row.finalizedAt}
      WHERE task_id = ${row.taskId}
    `,
  });
  const insertTaskOutcomeRow = SqlSchema.void({
    Request: TaskOutcomeRecord,
    execute: (row) => sql`
      INSERT INTO projection_analytics_task_outcomes (
        task_outcome_record_id, task_id, mission_id, status, implementation_completed,
        verification_result, integration_result, human_disposition, reverted,
        first_pass_verification, repair_attempt_count, agent_run_count,
        total_wall_clock_duration_milliseconds, total_active_agent_duration_milliseconds,
        created_at, updated_at, finalized_at
      ) SELECT
        ${row.id},
        ${row.taskId}, ${row.missionId}, ${row.status},
        ${row.implementationCompleted ? 1 : 0}, ${row.verificationResult}, ${row.integrationResult},
        ${row.humanDisposition}, ${row.reverted ? 1 : 0},
        ${row.firstPassVerification === null ? null : row.firstPassVerification ? 1 : 0},
        ${row.repairAttemptCount}, ${row.agentRunCount}, ${row.totalWallClockDurationMilliseconds},
        ${row.totalActiveAgentDurationMilliseconds}, ${row.createdAt}, ${row.updatedAt},
        ${row.finalizedAt}
      WHERE NOT EXISTS (
        SELECT 1 FROM projection_analytics_task_outcomes WHERE task_id = ${row.taskId}
      )
    `,
  });
  const getTaskOutcomeRow = SqlSchema.findOneOption({
    Request: GetTaskOutcomeInput,
    Result: TaskOutcomeDbRow,
    execute: ({ taskId }) => sql`
      SELECT ${sql.unsafe(taskOutcomeColumns)} FROM projection_analytics_task_outcomes
      WHERE task_id = ${taskId}
    `,
  });
  const queryTaskOutcomeRows = SqlSchema.findAll({
    Request: QueryAnalyticsRecordsInput,
    Result: TaskOutcomeDbRow,
    execute: ({ filter, limit, offset }) => sql`
      SELECT ${sql.unsafe(taskOutcomeColumns)} FROM projection_analytics_task_outcomes
      WHERE (${filter.dateRange.from} IS NULL OR updated_at >= ${filter.dateRange.from})
        AND (${filter.dateRange.to} IS NULL OR updated_at < ${filter.dateRange.to})
        AND (${filter.missionId} IS NULL OR mission_id = ${filter.missionId})
        AND (${filter.taskId} IS NULL OR task_id = ${filter.taskId})
        AND (${filter.humanDisposition} IS NULL OR human_disposition = ${filter.humanDisposition})
        AND (
          ${filter.projectId} IS NULL OR mission_id IN (
            SELECT mission_id FROM projection_missions WHERE project_id = ${filter.projectId}
          )
        )
      ORDER BY updated_at DESC, task_outcome_record_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const insertHumanDispositionRow = SqlSchema.void({
    Request: HumanDispositionRecord,
    execute: (row) => sql`
      INSERT OR IGNORE INTO projection_analytics_human_dispositions (
        human_disposition_record_id, task_outcome_record_id, task_id, mission_id,
        disposition, actor, marked_at, reason, source_fingerprint,
        source_changed_after_disposition, source_changed_at
      ) VALUES (
        ${row.id}, ${row.taskOutcomeRecordId}, ${row.taskId}, ${row.missionId},
        ${row.disposition}, ${row.actor}, ${row.markedAt}, ${row.reason},
        ${row.sourceFingerprint}, ${row.sourceChangedAfterDisposition ? 1 : 0},
        ${row.sourceChangedAt}
      )
    `,
  });
  const getHumanDispositionRow = SqlSchema.findOneOption({
    Request: GetHumanDispositionRecordInput,
    Result: HumanDispositionDbRow,
    execute: ({ humanDispositionRecordId }) => sql`
      SELECT ${sql.unsafe(humanDispositionColumns)}
      FROM projection_analytics_human_dispositions
      WHERE human_disposition_record_id = ${humanDispositionRecordId}
    `,
  });
  const getLatestHumanDispositionRow = SqlSchema.findOneOption({
    Request: GetTaskOutcomeInput,
    Result: HumanDispositionDbRow,
    execute: ({ taskId }) => sql`
      SELECT ${sql.unsafe(humanDispositionColumns)}
      FROM projection_analytics_human_dispositions
      WHERE task_id = ${taskId}
      ORDER BY marked_at DESC, human_disposition_record_id DESC LIMIT 1
    `,
  });
  const listHumanDispositionRows = SqlSchema.findAll({
    Request: ListHumanDispositionRecordsInput,
    Result: HumanDispositionDbRow,
    execute: ({ taskId, limit, offset }) => sql`
      SELECT ${sql.unsafe(humanDispositionColumns)}
      FROM projection_analytics_human_dispositions
      WHERE task_id = ${taskId}
      ORDER BY marked_at DESC, human_disposition_record_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const upsertMissionOutcomeRow = SqlSchema.void({
    Request: MissionOutcomeRecord,
    execute: (row) => sql`
      INSERT INTO projection_analytics_mission_outcomes (
        mission_outcome_record_id, mission_id, status, task_count, completed_task_count,
        failed_task_count, verified_task_count, integrated_task_count, pull_request_created,
        pull_request_merged, human_disposition, started_at, completed_at, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.missionId}, ${row.status}, ${row.taskCount}, ${row.completedTaskCount},
        ${row.failedTaskCount}, ${row.verifiedTaskCount}, ${row.integratedTaskCount},
        ${row.pullRequestCreated ? 1 : 0}, ${row.pullRequestMerged ? 1 : 0},
        ${row.humanDisposition}, ${row.startedAt}, ${row.completedAt}, ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (mission_id) DO UPDATE SET
        status = excluded.status, task_count = excluded.task_count,
        completed_task_count = excluded.completed_task_count,
        failed_task_count = excluded.failed_task_count,
        verified_task_count = excluded.verified_task_count,
        integrated_task_count = excluded.integrated_task_count,
        pull_request_created = excluded.pull_request_created,
        pull_request_merged = excluded.pull_request_merged,
        human_disposition = excluded.human_disposition, started_at = excluded.started_at,
        completed_at = excluded.completed_at, updated_at = excluded.updated_at
    `,
  });
  const getMissionOutcomeRow = SqlSchema.findOneOption({
    Request: GetMissionOutcomeInput,
    Result: MissionOutcomeDbRow,
    execute: ({ missionId }) => sql`
      SELECT ${sql.unsafe(missionOutcomeColumns)} FROM projection_analytics_mission_outcomes
      WHERE mission_id = ${missionId}
    `,
  });
  const queryMissionOutcomeRows = SqlSchema.findAll({
    Request: QueryAnalyticsRecordsInput,
    Result: MissionOutcomeDbRow,
    execute: ({ filter, limit, offset }) => sql`
      SELECT ${sql.unsafe(missionOutcomeColumns)} FROM projection_analytics_mission_outcomes
      WHERE (${filter.dateRange.from} IS NULL OR updated_at >= ${filter.dateRange.from})
        AND (${filter.dateRange.to} IS NULL OR updated_at < ${filter.dateRange.to})
        AND (${filter.missionId} IS NULL OR mission_id = ${filter.missionId})
        AND (${filter.humanDisposition} IS NULL OR human_disposition = ${filter.humanDisposition})
        AND (
          ${filter.projectId} IS NULL OR mission_id IN (
            SELECT mission_id FROM projection_missions WHERE project_id = ${filter.projectId}
          )
        )
      ORDER BY updated_at DESC, mission_outcome_record_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const upsertAggregateRow = SqlSchema.void({
    Request: AnalyticsAggregate,
    execute: (row) => sql`
      INSERT INTO projection_analytics_aggregates (
        analytics_aggregate_id, scope_type, scope_id, period_type, period_start, period_end,
        metric_version, metrics_json, calculated_at, source_watermark, source_detail_deleted
      ) VALUES (
        ${row.id}, ${row.scopeType}, ${row.scopeId}, ${row.periodType}, ${row.periodStart},
        ${row.periodEnd}, ${row.metricVersion}, ${JSON.stringify(row.metrics)}, ${row.calculatedAt},
        ${row.sourceWatermark}, ${row.sourceDetailDeleted ? 1 : 0}
      ) ON CONFLICT (scope_type, scope_id, period_type, period_start, period_end, metric_version)
      DO UPDATE SET metrics_json = excluded.metrics_json, calculated_at = excluded.calculated_at,
        source_watermark = excluded.source_watermark,
        source_detail_deleted = max(source_detail_deleted, excluded.source_detail_deleted)
    `,
  });

  const upsertBudgetPolicyRow = SqlSchema.void({
    Request: BudgetPolicy,
    execute: (row) => sql`
      INSERT INTO projection_analytics_budget_policies (
        budget_policy_id, scope_type, scope_id, name, currency, period_type, period_start,
        period_end, soft_limit, hard_limit, token_limit, request_limit, action_on_soft_limit,
        action_on_hard_limit, conservative_when_incomplete, enabled, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.scopeType}, ${row.scopeId}, ${row.name}, ${row.currency},
        ${row.periodType}, ${row.periodStart}, ${row.periodEnd}, ${row.softLimit}, ${row.hardLimit},
        ${row.tokenLimit}, ${row.requestLimit}, ${row.actionOnSoftLimit}, ${row.actionOnHardLimit},
        ${row.conservativeWhenIncomplete ? 1 : 0}, ${row.enabled ? 1 : 0},
        ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (budget_policy_id) DO UPDATE SET
        scope_type = excluded.scope_type, scope_id = excluded.scope_id, name = excluded.name,
        currency = excluded.currency, period_type = excluded.period_type,
        period_start = excluded.period_start, period_end = excluded.period_end,
        soft_limit = excluded.soft_limit, hard_limit = excluded.hard_limit,
        token_limit = excluded.token_limit, request_limit = excluded.request_limit,
        action_on_soft_limit = excluded.action_on_soft_limit,
        action_on_hard_limit = excluded.action_on_hard_limit,
        conservative_when_incomplete = excluded.conservative_when_incomplete,
        enabled = excluded.enabled, updated_at = excluded.updated_at
    `,
  });
  const listBudgetPolicyRows = SqlSchema.findAll({
    Request: ListAnalyticsScopeRecordsInput,
    Result: BudgetPolicyDbRow,
    execute: ({ scopeType, scopeId, limit, offset }) => sql`
      SELECT ${sql.unsafe(budgetPolicyColumns)} FROM projection_analytics_budget_policies
      WHERE (${scopeType} IS NULL OR scope_type = ${scopeType})
        AND (${scopeId} IS NULL OR scope_id = ${scopeId})
      ORDER BY updated_at DESC, budget_policy_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const upsertBudgetEventRow = SqlSchema.void({
    Request: BudgetEvent,
    execute: (row) => sql`
      INSERT INTO projection_analytics_budget_events (
        budget_event_id, deduplication_key, budget_policy_id, scope_type, scope_id,
        event_type, current_value, threshold_value, currency, created_at, acknowledged_at
      ) VALUES (
        ${row.id}, ${row.deduplicationKey}, ${row.budgetPolicyId}, ${row.scopeType}, ${row.scopeId},
        ${row.eventType}, ${row.currentValue}, ${row.thresholdValue}, ${row.currency},
        ${row.createdAt}, ${row.acknowledgedAt}
      ) ON CONFLICT (deduplication_key) DO UPDATE SET
        current_value = excluded.current_value, threshold_value = excluded.threshold_value,
        acknowledged_at = coalesce(excluded.acknowledged_at, acknowledged_at)
    `,
  });
  const listBudgetEventRows = SqlSchema.findAll({
    Request: ListAnalyticsScopeRecordsInput,
    Result: BudgetEvent,
    execute: ({ scopeType, scopeId, limit, offset }) => sql`
      SELECT ${sql.unsafe(budgetEventColumns)} FROM projection_analytics_budget_events
      WHERE (${scopeType} IS NULL OR scope_type = ${scopeType})
        AND (${scopeId} IS NULL OR scope_id = ${scopeId})
      ORDER BY created_at DESC, budget_event_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const upsertBudgetOverrideRow = SqlSchema.void({
    Request: BudgetOverride,
    execute: (row) => sql`
      INSERT INTO projection_analytics_budget_overrides (
        budget_override_id, budget_policy_id, scope_type, scope_id, current_value,
        threshold_value, reason, actor, expires_at, fallback_allowed, created_at, expired_at
      ) VALUES (
        ${row.id}, ${row.budgetPolicyId}, ${row.scopeType}, ${row.scopeId}, ${row.currentValue},
        ${row.thresholdValue}, ${row.reason}, ${row.actor}, ${row.expiresAt},
        ${row.fallbackAllowed ? 1 : 0}, ${row.createdAt}, ${row.expiredAt}
      ) ON CONFLICT (budget_override_id) DO UPDATE SET expired_at = excluded.expired_at
    `,
  });
  const listBudgetOverrideRows = SqlSchema.findAll({
    Request: ListAnalyticsScopeRecordsInput,
    Result: BudgetOverrideDbRow,
    execute: ({ scopeType, scopeId, limit, offset }) => sql`
      SELECT ${sql.unsafe(budgetOverrideColumns)} FROM projection_analytics_budget_overrides
      WHERE (${scopeType} IS NULL OR scope_type = ${scopeType})
        AND (${scopeId} IS NULL OR scope_id = ${scopeId})
      ORDER BY created_at DESC, budget_override_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const upsertAnnotationRow = SqlSchema.void({
    Request: AnalyticsAnnotation,
    execute: (row) => sql`
      INSERT INTO projection_analytics_annotations (
        analytics_annotation_id, scope_type, scope_id, timestamp, title, content,
        created_by, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.scopeType}, ${row.scopeId}, ${row.timestamp}, ${row.title},
        ${row.content}, ${row.createdBy}, ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (analytics_annotation_id) DO UPDATE SET
        timestamp = excluded.timestamp, title = excluded.title, content = excluded.content,
        updated_at = excluded.updated_at
    `,
  });
  const listAnnotationRows = SqlSchema.findAll({
    Request: ListAnalyticsScopeRecordsInput,
    Result: AnalyticsAnnotation,
    execute: ({ scopeType, scopeId, limit, offset }) => sql`
      SELECT ${sql.unsafe(annotationColumns)} FROM projection_analytics_annotations
      WHERE (${scopeType} IS NULL OR scope_type = ${scopeType})
        AND (${scopeId} IS NULL OR scope_id = ${scopeId})
      ORDER BY coalesce(timestamp, created_at) DESC, analytics_annotation_id
      LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const upsertAlertRow = SqlSchema.void({
    Request: AnalyticsAlert,
    execute: (row) => sql`
      INSERT INTO projection_analytics_alerts (
        analytics_alert_id, deduplication_key, scope_type, scope_id, category, severity,
        title, detail, status, created_at, acknowledged_at, resolved_at
      ) VALUES (
        ${row.id}, ${row.deduplicationKey}, ${row.scopeType}, ${row.scopeId}, ${row.category},
        ${row.severity}, ${row.title}, ${row.detail}, ${row.status}, ${row.createdAt},
        ${row.acknowledgedAt}, ${row.resolvedAt}
      ) ON CONFLICT (deduplication_key) DO UPDATE SET
        severity = excluded.severity, title = excluded.title, detail = excluded.detail,
        status = excluded.status, acknowledged_at = excluded.acknowledged_at,
        resolved_at = excluded.resolved_at
    `,
  });
  const listAlertRows = SqlSchema.findAll({
    Request: ListAnalyticsScopeRecordsInput,
    Result: AnalyticsAlert,
    execute: ({ scopeType, scopeId, limit, offset }) => sql`
      SELECT ${sql.unsafe(alertColumns)} FROM projection_analytics_alerts
      WHERE (${scopeType} IS NULL OR scope_type = ${scopeType})
        AND (${scopeId} IS NULL OR scope_id = ${scopeId})
      ORDER BY created_at DESC, analytics_alert_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const insertRecommendationRow = SqlSchema.void({
    Request: AnalyticsRecommendation,
    execute: (row) => sql`
      INSERT OR IGNORE INTO projection_analytics_recommendations (
        analytics_recommendation_id, scope_type, scope_id, title, evidence, sample_size,
        period_start, period_end, task_segment, metric_keys_json, uncertainty,
        estimated_cost_present, conflicts_with_policy, created_at
      ) VALUES (
        ${row.id}, ${row.scopeType}, ${row.scopeId}, ${row.title}, ${row.evidence},
        ${row.sampleSize}, ${row.periodStart}, ${row.periodEnd}, ${row.taskSegment},
        ${JSON.stringify(row.metricKeys)}, ${row.uncertainty},
        ${row.estimatedCostPresent ? 1 : 0}, ${row.conflictsWithPolicy ? 1 : 0}, ${row.createdAt}
      )
    `,
  });
  const listRecommendationRows = SqlSchema.findAll({
    Request: ListAnalyticsScopeRecordsInput,
    Result: RecommendationDbRow,
    execute: ({ scopeType, scopeId, limit, offset }) => sql`
      SELECT ${sql.unsafe(recommendationColumns)} FROM projection_analytics_recommendations
      WHERE (${scopeType} IS NULL OR scope_type = ${scopeType})
        AND (${scopeId} IS NULL OR scope_id = ${scopeId})
      ORDER BY created_at DESC, analytics_recommendation_id LIMIT ${limit} OFFSET ${offset}
    `,
  });

  const saveSettingsRow = SqlSchema.void({
    Request: AnalyticsSettings,
    execute: (row) => sql`
      INSERT INTO projection_analytics_settings (
        settings_key, enabled, detail_retention_days, aggregate_retention_days,
        export_retention_days, pricing_source_priority_json, default_reporting_currency,
        subscription_attribution_mode, local_compute_hourly_rate,
        outcome_observation_window_days, minimum_comparison_sample_size, forecast_method,
        detail_level, store_prompt_content, updated_at
      ) VALUES (
        'environment', ${row.enabled ? 1 : 0}, ${row.detailRetentionDays},
        ${row.aggregateRetentionDays}, ${row.exportRetentionDays},
        ${JSON.stringify(row.pricingSourcePriority)}, ${row.defaultReportingCurrency},
        ${row.subscriptionAttributionMode}, ${row.localComputeHourlyRate},
        ${row.outcomeObservationWindowDays}, ${row.minimumComparisonSampleSize},
        ${row.forecastMethod}, ${row.detailLevel}, 0, ${row.updatedAt}
      ) ON CONFLICT (settings_key) DO UPDATE SET
        enabled = excluded.enabled, detail_retention_days = excluded.detail_retention_days,
        aggregate_retention_days = excluded.aggregate_retention_days,
        export_retention_days = excluded.export_retention_days,
        pricing_source_priority_json = excluded.pricing_source_priority_json,
        default_reporting_currency = excluded.default_reporting_currency,
        subscription_attribution_mode = excluded.subscription_attribution_mode,
        local_compute_hourly_rate = excluded.local_compute_hourly_rate,
        outcome_observation_window_days = excluded.outcome_observation_window_days,
        minimum_comparison_sample_size = excluded.minimum_comparison_sample_size,
        forecast_method = excluded.forecast_method, detail_level = excluded.detail_level,
        updated_at = excluded.updated_at
    `,
  });
  const getSettingsRow = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: SettingsDbRow,
    execute: () => sql`
      SELECT ${sql.unsafe(settingsColumns)} FROM projection_analytics_settings
      WHERE settings_key = 'environment'
    `,
  });

  const saveExportRow = SqlSchema.void({
    Request: AnalyticsExport,
    execute: (row) => sql`
      INSERT INTO projection_analytics_exports (
        analytics_export_id, format, status, filter_json, metric_version, relative_file_path,
        row_count, byte_count, error_category, requested_at, started_at, completed_at
      ) VALUES (
        ${row.id}, ${row.format}, ${row.status}, ${JSON.stringify(row.filter)},
        ${row.metricVersion}, ${row.relativeFilePath}, ${row.rowCount}, ${row.byteCount},
        ${row.errorCategory}, ${row.requestedAt}, ${row.startedAt}, ${row.completedAt}
      ) ON CONFLICT (analytics_export_id) DO UPDATE SET
        status = excluded.status, relative_file_path = excluded.relative_file_path,
        row_count = excluded.row_count, byte_count = excluded.byte_count,
        error_category = excluded.error_category, started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `,
  });
  const saveRetentionRow = SqlSchema.void({
    Request: AnalyticsRetentionOperation,
    execute: (row) => sql`
      INSERT INTO projection_analytics_retention_operations (
        analytics_retention_operation_id, status, project_id, detail_before,
        deleted_usage_count, deleted_tool_metric_count, deleted_export_count, error_category,
        requested_at, started_at, completed_at
      ) VALUES (
        ${row.id}, ${row.status}, ${row.projectId}, ${row.detailBefore}, ${row.deletedUsageCount},
        ${row.deletedToolMetricCount}, ${row.deletedExportCount}, ${row.errorCategory},
        ${row.requestedAt}, ${row.startedAt}, ${row.completedAt}
      ) ON CONFLICT (analytics_retention_operation_id) DO UPDATE SET
        status = excluded.status, deleted_usage_count = excluded.deleted_usage_count,
        deleted_tool_metric_count = excluded.deleted_tool_metric_count,
        deleted_export_count = excluded.deleted_export_count,
        error_category = excluded.error_category, started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `,
  });
  const listExportRows = SqlSchema.findAll({
    Request: ListAnalyticsOperationsInput,
    Result: ExportDbRow,
    execute: ({ status, limit, offset }) => sql`
      SELECT ${sql.unsafe(exportColumns)} FROM projection_analytics_exports
      WHERE (${status} IS NULL OR status = ${status})
      ORDER BY requested_at DESC, analytics_export_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const listRetentionRows = SqlSchema.findAll({
    Request: ListAnalyticsOperationsInput,
    Result: AnalyticsRetentionOperation,
    execute: ({ status, limit, offset }) => sql`
      SELECT ${sql.unsafe(retentionColumns)} FROM projection_analytics_retention_operations
      WHERE (${status} IS NULL OR status = ${status})
      ORDER BY requested_at DESC, analytics_retention_operation_id LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const listRecoverableExportRows = SqlSchema.findAll({
    Request: ListRecoverableAnalyticsOperationsInput,
    Result: ExportDbRow,
    execute: ({ requestedBefore, limit }) => sql`
      SELECT ${sql.unsafe(exportColumns)} FROM projection_analytics_exports
      WHERE status IN ('queued', 'running') AND requested_at <= ${requestedBefore}
      ORDER BY requested_at, analytics_export_id LIMIT ${limit}
    `,
  });
  const listRecoverableRetentionRows = SqlSchema.findAll({
    Request: ListRecoverableAnalyticsOperationsInput,
    Result: AnalyticsRetentionOperation,
    execute: ({ requestedBefore, limit }) => sql`
      SELECT ${sql.unsafe(retentionColumns)} FROM projection_analytics_retention_operations
      WHERE status IN ('queued', 'running') AND requested_at <= ${requestedBefore}
      ORDER BY requested_at, analytics_retention_operation_id LIMIT ${limit}
    `,
  });

  const upsertUsageRecord: ProjectionUsageAnalyticsRepositoryShape["upsertUsageRecord"] = (row) =>
    upsertUsageRow(row).pipe(sqlError("upsert usage record"));
  const finalizeUsageRecord: ProjectionUsageAnalyticsRepositoryShape["finalizeUsageRecord"] = (
    input,
  ) => upsertUsageRow(input.record).pipe(sqlError("finalize usage record"));
  const getUsageRecord: ProjectionUsageAnalyticsRepositoryShape["getUsageRecord"] = (input) =>
    getUsageRow(input).pipe(sqlError("get usage record"));
  const getUsageRecordBySource: ProjectionUsageAnalyticsRepositoryShape["getUsageRecordBySource"] =
    (input) => getUsageBySourceRow(input).pipe(sqlError("get usage record by source"));
  const listUsageRecords: ProjectionUsageAnalyticsRepositoryShape["listUsageRecords"] = (input) =>
    listUsageRows(input).pipe(sqlError("list usage records"));
  const upsertToolMetric: ProjectionUsageAnalyticsRepositoryShape["upsertToolMetric"] = (row) =>
    upsertToolMetricRow(row).pipe(sqlError("upsert tool metric"));
  const upsertRunPerformance: ProjectionUsageAnalyticsRepositoryShape["upsertRunPerformance"] = (
    row,
  ) => upsertRunPerformanceRow(row).pipe(sqlError("upsert run performance"));
  const finalizeRunPerformance: ProjectionUsageAnalyticsRepositoryShape["finalizeRunPerformance"] =
    (row) => upsertRunPerformanceRow(row).pipe(sqlError("finalize run performance"));
  const insertPricingSnapshot: ProjectionUsageAnalyticsRepositoryShape["insertPricingSnapshot"] = (
    row,
  ) => insertPricingRow(row).pipe(sqlError("insert pricing snapshot"));
  const getPricingSnapshot: ProjectionUsageAnalyticsRepositoryShape["getPricingSnapshot"] = (
    input,
  ) => getPricingRow(input).pipe(sqlError("get pricing snapshot"));
  const insertCostRecord: ProjectionUsageAnalyticsRepositoryShape["insertCostRecord"] = (row) =>
    insertCostRow(row).pipe(sqlError("insert cost record"));
  const getCostRecord: ProjectionUsageAnalyticsRepositoryShape["getCostRecord"] = (input) =>
    getCostRow(input).pipe(Effect.map(Option.map(toCostRecord)), sqlError("get cost record"));

  const replaceSubscriptionAllocations: ProjectionUsageAnalyticsRepositoryShape["replaceSubscriptionAllocations"] =
    Effect.fn("ProjectionUsageAnalytics.replaceSubscriptionAllocations")(function* (input) {
      const effect = Effect.gen(function* () {
        const replaced = yield* sql<{ readonly id: string }>`
          DELETE FROM projection_analytics_subscription_allocation_current
          WHERE subscription_attribution_rule_id = ${input.ruleId}
            AND period_start = ${input.periodStart}
            AND period_end = ${input.periodEnd}
          RETURNING cost_record_id AS id
        `;
        for (const record of input.records) {
          yield* insertCostRow(record);
          yield* sql`
            INSERT OR IGNORE INTO projection_analytics_subscription_allocation_entries (
              cost_record_id, subscription_attribution_rule_id, period_start, period_end,
              agent_run_id, revision, allocated_at
            ) VALUES (
              ${record.id}, ${input.ruleId}, ${input.periodStart}, ${input.periodEnd},
              ${record.agentRunId}, ${input.revision}, ${input.allocatedAt}
            )
          `;
          yield* sql`
            INSERT INTO projection_analytics_subscription_allocation_current (
              subscription_attribution_rule_id, period_start, period_end, agent_run_id,
              cost_record_id, revision, updated_at
            ) VALUES (
              ${input.ruleId}, ${input.periodStart}, ${input.periodEnd}, ${record.agentRunId},
              ${record.id}, ${input.revision}, ${input.allocatedAt}
            )
          `;
        }
        return { replacedCount: replaced.length, activeCount: input.records.length };
      });
      return yield* sql.withTransaction(effect);
    }, sqlError("replace subscription allocations"));

  const listRecoverableOperations: ProjectionUsageAnalyticsRepositoryShape["listRecoverableOperations"] =
    Effect.fn("ProjectionUsageAnalytics.listRecoverableOperations")(function* (input) {
      const exports = yield* listRecoverableExportRows(input);
      const retentionOperations = yield* listRecoverableRetentionRows(input);
      return { exports, retentionOperations };
    }, sqlError("list recoverable analytics operations"));

  const recordHumanDisposition: ProjectionUsageAnalyticsRepositoryShape["recordHumanDisposition"] =
    Effect.fn("ProjectionUsageAnalytics.recordHumanDisposition")(function* (row) {
      const effect = Effect.gen(function* () {
        yield* insertHumanDispositionRow(row);
        yield* sql`
          UPDATE projection_analytics_task_outcomes
          SET human_disposition = ${row.disposition}, updated_at = ${row.markedAt}
          WHERE task_outcome_record_id = ${row.taskOutcomeRecordId}
            AND task_id = ${row.taskId}
            AND mission_id = ${row.missionId}
            AND EXISTS (
              SELECT 1 FROM projection_analytics_human_dispositions disposition
              WHERE disposition.task_outcome_record_id = ${row.taskOutcomeRecordId}
                AND disposition.task_id = ${row.taskId}
                AND disposition.disposition = ${row.disposition}
                AND disposition.actor = ${row.actor}
                AND disposition.marked_at = ${row.markedAt}
                AND disposition.source_fingerprint = ${row.sourceFingerprint}
            )
        `;
      });
      yield* sql.withTransaction(effect);
    }, sqlError("record human disposition"));

  const interruptRunningOperations: ProjectionUsageAnalyticsRepositoryShape["interruptRunningOperations"] =
    Effect.fn("ProjectionUsageAnalytics.interruptRunningOperations")(function* (input) {
      const effect = Effect.gen(function* () {
        const interruptedExports = yield* sql<{ readonly id: string }>`
          UPDATE projection_analytics_exports
          SET status = 'interrupted', error_category = ${input.errorCategory},
            completed_at = ${input.interruptedAt}
          WHERE status IN ('queued', 'running')
          RETURNING analytics_export_id AS id
        `;
        const interruptedRetention = yield* sql<{ readonly id: string }>`
          UPDATE projection_analytics_retention_operations
          SET status = 'interrupted', error_category = ${input.errorCategory},
            completed_at = ${input.interruptedAt}
          WHERE status IN ('queued', 'running')
          RETURNING analytics_retention_operation_id AS id
        `;
        return {
          exportCount: interruptedExports.length,
          retentionOperationCount: interruptedRetention.length,
        };
      });
      return yield* sql.withTransaction(effect);
    }, sqlError("interrupt running analytics operations"));

  const deleteDetailBefore: ProjectionUsageAnalyticsRepositoryShape["deleteDetailBefore"] =
    Effect.fn("ProjectionUsageAnalytics.deleteDetailBefore")(function* (input) {
      const effect = Effect.gen(function* () {
        const deletedUsage = yield* sql<{ readonly id: string }>`
          DELETE FROM projection_analytics_usage_records
          WHERE recorded_at < ${input.detailBefore}
            AND (${input.projectId} IS NULL OR project_id = ${input.projectId})
          RETURNING usage_record_id AS id
        `;
        const deletedTools = yield* sql<{ readonly id: string }>`
          DELETE FROM projection_analytics_tool_metrics
          WHERE started_at < ${input.detailBefore}
            AND (
              ${input.projectId} IS NULL OR agent_run_id IN (
                SELECT runs.agent_run_id
                FROM projection_agent_runs runs
                JOIN projection_missions missions ON missions.mission_id = runs.mission_id
                WHERE missions.project_id = ${input.projectId}
              )
            )
          RETURNING tool_execution_metric_id AS id
        `;
        const deletedExports = yield* sql<{ readonly id: string }>`
          DELETE FROM projection_analytics_exports
          WHERE coalesce(completed_at, requested_at) < ${input.detailBefore}
            AND status IN ('completed', 'failed', 'interrupted')
            AND (
              ${input.projectId} IS NULL
              OR json_extract(filter_json, '$.projectId') = ${input.projectId}
            )
          RETURNING analytics_export_id AS id
        `;
        yield* sql`
          UPDATE projection_analytics_aggregates
          SET source_detail_deleted = 1
          WHERE period_end <= ${input.detailBefore}
            AND (
              ${input.projectId} IS NULL
              OR (scope_type = 'project' AND scope_id = ${input.projectId})
            )
        `;
        return {
          usageCount: deletedUsage.length,
          toolMetricCount: deletedTools.length,
          exportCount: deletedExports.length,
        };
      });
      return yield* sql.withTransaction(effect);
    }, sqlError("delete retained analytics detail"));

  return ProjectionUsageAnalyticsRepository.of({
    upsertUsageRecord,
    finalizeUsageRecord,
    getUsageRecord,
    getUsageRecordBySource,
    listUsageRecords,
    queryUsageRecords: (input) => queryUsageRows(input).pipe(sqlError("query usage records")),
    upsertToolMetric,
    queryToolMetrics: (input) => queryToolMetricRows(input).pipe(sqlError("query tool metrics")),
    upsertRunPerformance,
    finalizeRunPerformance,
    getRunPerformance: (input) =>
      getRunPerformanceRow(input).pipe(
        Effect.map(Option.map(toRunPerformance)),
        sqlError("get run performance"),
      ),
    queryRunPerformance: (input) =>
      queryRunPerformanceRows(input).pipe(
        Effect.map((rows) => rows.map(toRunPerformance)),
        sqlError("query run performance"),
      ),
    insertPricingSnapshot,
    getPricingSnapshot,
    listPricingSnapshots: (input) =>
      listPricingRows(input).pipe(sqlError("list pricing snapshots")),
    insertCostRecord,
    getCostRecord,
    queryCostRecords: (input) =>
      queryCostRows(input).pipe(
        Effect.map((rows) => rows.map(toCostRecord)),
        sqlError("query cost records"),
      ),
    insertSubscriptionAttributionRule: (row) =>
      insertSubscriptionAttributionRuleRow(row).pipe(
        sqlError("insert subscription attribution rule"),
      ),
    getSubscriptionAttributionRule: (input) =>
      getSubscriptionAttributionRuleRow(input).pipe(sqlError("get subscription attribution rule")),
    listSubscriptionAttributionRules: (input) =>
      listSubscriptionAttributionRuleRows(input).pipe(
        sqlError("list subscription attribution rules"),
      ),
    replaceSubscriptionAllocations,
    insertExchangeRateSnapshot: (row) =>
      insertExchangeRateRow(row).pipe(sqlError("insert exchange rate snapshot")),
    listExchangeRateSnapshots: (input) =>
      listExchangeRateRows(input).pipe(sqlError("list exchange rate snapshots")),
    upsertSubscriptionUsage: (row) =>
      upsertSubscriptionUsageRow(row).pipe(sqlError("upsert subscription usage")),
    upsertTaskOutcome: (row) =>
      updateTaskOutcomeRow(row).pipe(
        Effect.andThen(insertTaskOutcomeRow(row)),
        sqlError("upsert task outcome"),
      ),
    getTaskOutcome: (input) =>
      getTaskOutcomeRow(input).pipe(
        Effect.map(Option.map(toTaskOutcome)),
        sqlError("get task outcome"),
      ),
    queryTaskOutcomes: (input) =>
      queryTaskOutcomeRows(input).pipe(
        Effect.map((rows) => rows.map(toTaskOutcome)),
        sqlError("query task outcomes"),
      ),
    recordHumanDisposition,
    getHumanDispositionRecord: (input) =>
      getHumanDispositionRow(input).pipe(
        Effect.map(Option.map(toHumanDisposition)),
        sqlError("get human disposition record"),
      ),
    getLatestHumanDisposition: (input) =>
      getLatestHumanDispositionRow(input).pipe(
        Effect.map(Option.map(toHumanDisposition)),
        sqlError("get latest human disposition"),
      ),
    listHumanDispositions: (input) =>
      listHumanDispositionRows(input).pipe(
        Effect.map((rows) => rows.map(toHumanDisposition)),
        sqlError("list human dispositions"),
      ),
    markHumanDispositionSourceChanged: ({ humanDispositionRecordId, sourceChangedAt }) =>
      sql`
        UPDATE projection_analytics_human_dispositions
        SET source_changed_after_disposition = 1, source_changed_at = ${sourceChangedAt}
        WHERE human_disposition_record_id = ${humanDispositionRecordId}
          AND source_changed_after_disposition = 0
      `.pipe(Effect.asVoid, sqlError("mark human disposition source changed")),
    upsertMissionOutcome: (row) =>
      upsertMissionOutcomeRow(row).pipe(sqlError("upsert mission outcome")),
    getMissionOutcome: (input) =>
      getMissionOutcomeRow(input).pipe(
        Effect.map(Option.map(toMissionOutcome)),
        sqlError("get mission outcome"),
      ),
    queryMissionOutcomes: (input) =>
      queryMissionOutcomeRows(input).pipe(
        Effect.map((rows) => rows.map(toMissionOutcome)),
        sqlError("query mission outcomes"),
      ),
    upsertAggregate: (row) => upsertAggregateRow(row).pipe(sqlError("upsert aggregate")),
    upsertBudgetPolicy: (row) => upsertBudgetPolicyRow(row).pipe(sqlError("upsert budget policy")),
    listBudgetPolicies: (input) =>
      listBudgetPolicyRows(input).pipe(
        Effect.map((rows) => rows.map(toBudgetPolicy)),
        sqlError("list budget policies"),
      ),
    upsertBudgetEvent: (row) => upsertBudgetEventRow(row).pipe(sqlError("upsert budget event")),
    listBudgetEvents: (input) => listBudgetEventRows(input).pipe(sqlError("list budget events")),
    acknowledgeBudgetEvent: ({ budgetEventId, acknowledgedAt }) =>
      sql`
        UPDATE projection_analytics_budget_events
        SET acknowledged_at = coalesce(acknowledged_at, ${acknowledgedAt})
        WHERE budget_event_id = ${budgetEventId}
      `.pipe(Effect.asVoid, sqlError("acknowledge budget event")),
    upsertBudgetOverride: (row) =>
      upsertBudgetOverrideRow(row).pipe(sqlError("upsert budget override")),
    listBudgetOverrides: (input) =>
      listBudgetOverrideRows(input).pipe(
        Effect.map((rows) => rows.map(toBudgetOverride)),
        sqlError("list budget overrides"),
      ),
    upsertAnnotation: (row) => upsertAnnotationRow(row).pipe(sqlError("upsert annotation")),
    listAnnotations: (input) => listAnnotationRows(input).pipe(sqlError("list annotations")),
    upsertAlert: (row) => upsertAlertRow(row).pipe(sqlError("upsert alert")),
    listAlerts: (input) => listAlertRows(input).pipe(sqlError("list alerts")),
    acknowledgeAlert: ({ alertId, acknowledgedAt }) =>
      sql`
        UPDATE projection_analytics_alerts
        SET status = CASE WHEN status = 'active' THEN 'acknowledged' ELSE status END,
          acknowledged_at = coalesce(acknowledged_at, ${acknowledgedAt})
        WHERE analytics_alert_id = ${alertId}
      `.pipe(Effect.asVoid, sqlError("acknowledge alert")),
    insertRecommendation: (row) =>
      insertRecommendationRow(row).pipe(sqlError("insert recommendation")),
    listRecommendations: (input) =>
      listRecommendationRows(input).pipe(
        Effect.map((rows) => rows.map(toRecommendation)),
        sqlError("list recommendations"),
      ),
    saveSettings: (row) => saveSettingsRow(row).pipe(sqlError("save analytics settings")),
    getSettings: () =>
      getSettingsRow(undefined).pipe(
        Effect.map(Option.map(toSettings)),
        sqlError("get analytics settings"),
      ),
    saveExport: (row) => saveExportRow(row).pipe(sqlError("save analytics export")),
    listExports: (input) => listExportRows(input).pipe(sqlError("list analytics exports")),
    saveRetentionOperation: (row) =>
      saveRetentionRow(row).pipe(sqlError("save analytics retention operation")),
    listRetentionOperations: (input) =>
      listRetentionRows(input).pipe(sqlError("list analytics retention operations")),
    listRecoverableOperations,
    interruptRunningOperations,
    deleteDetailBefore,
  });
});

export const ProjectionUsageAnalyticsRepositoryLive = Layer.effect(
  ProjectionUsageAnalyticsRepository,
  make,
);
