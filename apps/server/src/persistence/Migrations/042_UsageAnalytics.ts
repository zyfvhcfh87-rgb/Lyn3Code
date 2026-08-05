import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_analytics_usage_records (
      usage_record_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE CHECK (length(trim(source_event_id)) BETWEEN 1 AND 512),
      source_turn_id TEXT,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      task_id TEXT,
      agent_run_id TEXT NOT NULL,
      parent_agent_run_id TEXT,
      routing_decision_id TEXT,
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      capability_snapshot_id TEXT,
      provider_request_id TEXT,
      provider_response_id TEXT,
      usage_source TEXT NOT NULL CHECK (
        usage_source IN ('provider_reported', 'adapter_calculated', 'tokenizer_estimated',
          'context_estimated', 'unknown')
      ),
      usage_confidence TEXT NOT NULL CHECK (
        usage_confidence IN ('confirmed', 'high', 'medium', 'low', 'unknown')
      ),
      state TEXT NOT NULL CHECK (state IN ('provisional', 'final', 'reconciled', 'unknown')),
      input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
      output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
      reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
      cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
      cache_write_tokens INTEGER CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
      cache_read_tokens INTEGER CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
      total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
      request_count INTEGER CHECK (request_count IS NULL OR request_count >= 0),
      tool_call_count INTEGER CHECK (tool_call_count IS NULL OR tool_call_count >= 0),
      provider_round_trip_count INTEGER CHECK (
        provider_round_trip_count IS NULL OR provider_round_trip_count >= 0
      ),
      started_at TEXT,
      completed_at TEXT,
      recorded_at TEXT NOT NULL,
      reconciled_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (parent_agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (routing_decision_id) REFERENCES projection_routing_decisions(routing_decision_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (model_profile_id, capability_snapshot_id)
        REFERENCES projection_routing_model_capability_snapshots(model_profile_id, capability_snapshot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_usage_project_recorded
    ON projection_analytics_usage_records(project_id, recorded_at DESC, usage_record_id)
  `;
  yield* sql`
    CREATE INDEX idx_analytics_usage_run_recorded
    ON projection_analytics_usage_records(agent_run_id, recorded_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_analytics_usage_provisional_recovery
    ON projection_analytics_usage_records(recorded_at, usage_record_id)
    WHERE state = 'provisional'
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_usage_final_immutable
    BEFORE UPDATE ON projection_analytics_usage_records
    WHEN OLD.state <> 'provisional'
    BEGIN
      SELECT RAISE(ABORT, 'final analytics usage records are immutable');
    END
  `;

  yield* sql`
    CREATE TABLE projection_analytics_tool_metrics (
      tool_execution_metric_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE CHECK (length(trim(source_event_id)) BETWEEN 1 AND 512),
      provider_item_id TEXT,
      agent_run_id TEXT NOT NULL,
      task_id TEXT,
      tool_category TEXT NOT NULL,
      tool_name TEXT NOT NULL CHECK (length(trim(tool_name)) BETWEEN 1 AND 256),
      status TEXT NOT NULL CHECK (
        status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted', 'denied', 'unknown')
      ),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_milliseconds INTEGER CHECK (duration_milliseconds IS NULL OR duration_milliseconds >= 0),
      input_size INTEGER CHECK (input_size IS NULL OR input_size >= 0),
      output_size INTEGER CHECK (output_size IS NULL OR output_size >= 0),
      error_category TEXT,
      retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (task_id) REFERENCES projection_mission_tasks(task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_tool_metrics_run_started
    ON projection_analytics_tool_metrics(agent_run_id, started_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_analytics_tool_metrics_running_recovery
    ON projection_analytics_tool_metrics(started_at, tool_execution_metric_id)
    WHERE status = 'running'
  `;

  yield* sql`
    CREATE TABLE projection_analytics_run_performance (
      run_performance_record_id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL UNIQUE,
      task_id TEXT,
      mission_id TEXT NOT NULL,
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      reasoning_level TEXT,
      queued_duration_milliseconds INTEGER CHECK (queued_duration_milliseconds IS NULL OR queued_duration_milliseconds >= 0),
      startup_duration_milliseconds INTEGER CHECK (startup_duration_milliseconds IS NULL OR startup_duration_milliseconds >= 0),
      first_output_latency_milliseconds INTEGER CHECK (first_output_latency_milliseconds IS NULL OR first_output_latency_milliseconds >= 0),
      active_duration_milliseconds INTEGER CHECK (active_duration_milliseconds IS NULL OR active_duration_milliseconds >= 0),
      wall_clock_duration_milliseconds INTEGER CHECK (wall_clock_duration_milliseconds IS NULL OR wall_clock_duration_milliseconds >= 0),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'finalized', 'finalization_failed')),
      completion_category TEXT NOT NULL,
      fallback_count INTEGER NOT NULL CHECK (fallback_count >= 0),
      provider_retry_count INTEGER NOT NULL CHECK (provider_retry_count >= 0),
      tool_failure_count INTEGER NOT NULL CHECK (tool_failure_count >= 0),
      context_reduction_applied INTEGER NOT NULL CHECK (context_reduction_applied IN (0, 1)),
      cancelled_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalized_at TEXT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (provider_profile_id, model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_run_performance_recovery
    ON projection_analytics_run_performance(status, updated_at, run_performance_record_id)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_pricing_snapshots (
      pricing_snapshot_id TEXT PRIMARY KEY,
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      pricing_source TEXT NOT NULL,
      pricing_version TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      input_token_rate TEXT,
      output_token_rate TEXT,
      reasoning_token_rate TEXT,
      cached_input_rate TEXT,
      cache_write_rate TEXT,
      cache_read_rate TEXT,
      request_rate TEXT,
      tool_rate_metadata_json TEXT NOT NULL CHECK (
        json_valid(tool_rate_metadata_json) AND length(tool_rate_metadata_json) <= 65536
      ),
      billing_unit TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'high', 'medium', 'low', 'unknown')),
      metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
      created_at TEXT NOT NULL,
      UNIQUE (provider_profile_id, model_profile_id, currency, pricing_source, effective_from, pricing_version),
      FOREIGN KEY (provider_profile_id, model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_pricing_model_effective
    ON projection_analytics_pricing_snapshots(model_profile_id, currency, effective_from DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_pricing_immutable_update
    BEFORE UPDATE ON projection_analytics_pricing_snapshots
    BEGIN SELECT RAISE(ABORT, 'analytics pricing snapshots are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_pricing_immutable_delete
    BEFORE DELETE ON projection_analytics_pricing_snapshots
    BEGIN SELECT RAISE(ABORT, 'analytics pricing snapshots are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_analytics_subscription_attribution_rules (
      subscription_attribution_rule_id TEXT PRIMARY KEY,
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT,
      label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 256),
      mode TEXT NOT NULL CHECK (mode IN (
        'flat_monthly_by_runs', 'flat_monthly_by_tokens',
        'flat_monthly_by_active_time', 'manual_fixed_internal_rate'
      )),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL CHECK (period_end > period_start),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      monthly_amount TEXT,
      fixed_internal_rate TEXT,
      fixed_rate_unit TEXT CHECK (
        fixed_rate_unit IS NULL OR fixed_rate_unit IN ('per_run', 'per_million_tokens', 'per_active_hour')
      ),
      created_at TEXT NOT NULL,
      CHECK (
        (mode = 'manual_fixed_internal_rate' AND monthly_amount IS NULL
          AND fixed_internal_rate IS NOT NULL AND fixed_rate_unit IS NOT NULL)
        OR
        (mode <> 'manual_fixed_internal_rate' AND monthly_amount IS NOT NULL
          AND fixed_internal_rate IS NULL AND fixed_rate_unit IS NULL)
      ),
      FOREIGN KEY (provider_profile_id) REFERENCES projection_routing_provider_profiles(provider_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (provider_profile_id, model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_subscription_rules_provider_period
    ON projection_analytics_subscription_attribution_rules(provider_profile_id, period_start, period_end)
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_subscription_rules_immutable_update
    BEFORE UPDATE ON projection_analytics_subscription_attribution_rules
    BEGIN SELECT RAISE(ABORT, 'subscription attribution rules are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_subscription_rules_immutable_delete
    BEFORE DELETE ON projection_analytics_subscription_attribution_rules
    BEGIN SELECT RAISE(ABORT, 'subscription attribution rules are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_analytics_cost_records (
      cost_record_id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE CHECK (length(trim(source_key)) BETWEEN 1 AND 512),
      usage_record_id TEXT,
      agent_run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      task_id TEXT,
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      pricing_snapshot_id TEXT,
      amount TEXT,
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      cost_type TEXT NOT NULL,
      calculation_method TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'high', 'medium', 'low', 'unknown')),
      is_estimated INTEGER NOT NULL CHECK (is_estimated IN (0, 1)),
      is_subscription_backed INTEGER NOT NULL CHECK (is_subscription_backed IN (0, 1)),
      calculation_breakdown_json TEXT NOT NULL CHECK (
        json_valid(calculation_breakdown_json) AND length(calculation_breakdown_json) <= 65536
      ),
      missing_pricing_dimensions_json TEXT NOT NULL CHECK (
        json_valid(missing_pricing_dimensions_json) AND length(missing_pricing_dimensions_json) <= 8192
      ),
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (provider_profile_id, model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (pricing_snapshot_id) REFERENCES projection_analytics_pricing_snapshots(pricing_snapshot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_cost_project_created
    ON projection_analytics_cost_records(project_id, created_at DESC, cost_record_id)
  `;
  yield* sql`
    CREATE INDEX idx_analytics_cost_usage
    ON projection_analytics_cost_records(usage_record_id, created_at)
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_cost_immutable_update
    BEFORE UPDATE ON projection_analytics_cost_records
    BEGIN SELECT RAISE(ABORT, 'analytics cost records are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_cost_immutable_delete
    BEFORE DELETE ON projection_analytics_cost_records
    BEGIN SELECT RAISE(ABORT, 'analytics cost records are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_analytics_subscription_allocation_entries (
      cost_record_id TEXT PRIMARY KEY,
      subscription_attribution_rule_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      revision TEXT NOT NULL CHECK (length(trim(revision)) BETWEEN 1 AND 128),
      allocated_at TEXT NOT NULL,
      FOREIGN KEY (cost_record_id) REFERENCES projection_analytics_cost_records(cost_record_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (subscription_attribution_rule_id)
        REFERENCES projection_analytics_subscription_attribution_rules(subscription_attribution_rule_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_subscription_allocation_entries_validate
    BEFORE INSERT ON projection_analytics_subscription_allocation_entries
    WHEN NOT EXISTS (
      SELECT 1
      FROM projection_analytics_subscription_attribution_rules rule
      JOIN projection_analytics_cost_records cost
        ON cost.cost_record_id = NEW.cost_record_id
      WHERE rule.subscription_attribution_rule_id = NEW.subscription_attribution_rule_id
        AND rule.period_start = NEW.period_start
        AND rule.period_end = NEW.period_end
        AND cost.agent_run_id = NEW.agent_run_id
        AND cost.provider_profile_id = rule.provider_profile_id
        AND (rule.model_profile_id IS NULL OR cost.model_profile_id = rule.model_profile_id)
        AND cost.cost_type = 'subscription_attribution'
        AND cost.is_subscription_backed = 1
        AND cost.calculation_method IN ('subscription_backed', 'user_configured_rate')
    )
    BEGIN SELECT RAISE(ABORT, 'invalid subscription accounting allocation'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_subscription_allocation_entries_immutable_update
    BEFORE UPDATE ON projection_analytics_subscription_allocation_entries
    BEGIN SELECT RAISE(ABORT, 'subscription accounting allocation history is immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_subscription_allocation_entries_immutable_delete
    BEFORE DELETE ON projection_analytics_subscription_allocation_entries
    BEGIN SELECT RAISE(ABORT, 'subscription accounting allocation history is immutable'); END
  `;
  yield* sql`
    CREATE TABLE projection_analytics_subscription_allocation_current (
      subscription_attribution_rule_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      cost_record_id TEXT NOT NULL UNIQUE,
      revision TEXT NOT NULL CHECK (length(trim(revision)) BETWEEN 1 AND 128),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (subscription_attribution_rule_id, period_start, period_end, agent_run_id),
      FOREIGN KEY (cost_record_id)
        REFERENCES projection_analytics_subscription_allocation_entries(cost_record_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (subscription_attribution_rule_id)
        REFERENCES projection_analytics_subscription_attribution_rules(subscription_attribution_rule_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_subscription_allocation_current_period
    ON projection_analytics_subscription_allocation_current(subscription_attribution_rule_id, period_start, period_end)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_subscription_usage (
      subscription_usage_record_id TEXT PRIMARY KEY,
      provider_profile_id TEXT NOT NULL,
      account_reference TEXT,
      plan_name TEXT,
      period_start TEXT,
      period_end TEXT,
      usage_unit TEXT NOT NULL,
      used_amount TEXT,
      remaining_amount TEXT,
      reset_at TEXT,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'high', 'medium', 'low', 'unknown')),
      recorded_at TEXT NOT NULL,
      UNIQUE (provider_profile_id, account_reference, usage_unit, period_start, recorded_at),
      FOREIGN KEY (provider_profile_id) REFERENCES projection_routing_provider_profiles(provider_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_subscription_provider_recorded
    ON projection_analytics_subscription_usage(provider_profile_id, recorded_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_task_outcomes (
      task_outcome_record_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      mission_id TEXT NOT NULL,
      status TEXT NOT NULL,
      implementation_completed INTEGER NOT NULL CHECK (implementation_completed IN (0, 1)),
      verification_result TEXT,
      integration_result TEXT,
      human_disposition TEXT NOT NULL,
      reverted INTEGER NOT NULL CHECK (reverted IN (0, 1)),
      first_pass_verification INTEGER CHECK (first_pass_verification IS NULL OR first_pass_verification IN (0, 1)),
      repair_attempt_count INTEGER NOT NULL CHECK (repair_attempt_count >= 0),
      agent_run_count INTEGER NOT NULL CHECK (agent_run_count >= 0),
      total_wall_clock_duration_milliseconds INTEGER CHECK (total_wall_clock_duration_milliseconds IS NULL OR total_wall_clock_duration_milliseconds >= 0),
      total_active_agent_duration_milliseconds INTEGER CHECK (total_active_agent_duration_milliseconds IS NULL OR total_active_agent_duration_milliseconds >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalized_at TEXT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_task_outcomes_mission_status
    ON projection_analytics_task_outcomes(mission_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE TABLE projection_analytics_human_dispositions (
      human_disposition_record_id TEXT PRIMARY KEY,
      task_outcome_record_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (
        disposition IN ('accepted', 'accepted_with_edits', 'rejected', 'abandoned')
      ),
      actor TEXT NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 256),
      marked_at TEXT NOT NULL,
      reason TEXT CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 2000),
      source_fingerprint TEXT NOT NULL CHECK (
        length(trim(source_fingerprint)) BETWEEN 1 AND 512
      ),
      source_changed_after_disposition INTEGER NOT NULL CHECK (
        source_changed_after_disposition IN (0, 1)
      ),
      source_changed_at TEXT,
      CHECK (
        source_changed_after_disposition = (source_changed_at IS NOT NULL)
      ),
      UNIQUE (task_id, disposition, actor, marked_at, source_fingerprint),
      FOREIGN KEY (task_outcome_record_id)
        REFERENCES projection_analytics_task_outcomes(task_outcome_record_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_human_dispositions_task_marked
    ON projection_analytics_human_dispositions(task_id, marked_at DESC, human_disposition_record_id)
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_human_dispositions_audit_update
    BEFORE UPDATE ON projection_analytics_human_dispositions
    WHEN OLD.human_disposition_record_id IS NOT NEW.human_disposition_record_id
      OR OLD.task_outcome_record_id IS NOT NEW.task_outcome_record_id
      OR OLD.task_id IS NOT NEW.task_id
      OR OLD.mission_id IS NOT NEW.mission_id
      OR OLD.disposition IS NOT NEW.disposition
      OR OLD.actor IS NOT NEW.actor
      OR OLD.marked_at IS NOT NEW.marked_at
      OR OLD.reason IS NOT NEW.reason
      OR OLD.source_fingerprint IS NOT NEW.source_fingerprint
      OR (OLD.source_changed_after_disposition = 1 AND (
        NEW.source_changed_after_disposition <> 1
        OR OLD.source_changed_at IS NOT NEW.source_changed_at
      ))
    BEGIN
      SELECT RAISE(ABORT, 'human disposition audit records are immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_human_dispositions_audit_delete
    BEFORE DELETE ON projection_analytics_human_dispositions
    BEGIN
      SELECT RAISE(ABORT, 'human disposition audit records are immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_task_outcomes_explicit_disposition_insert
    BEFORE INSERT ON projection_analytics_task_outcomes
    WHEN NEW.human_disposition IN ('accepted', 'accepted_with_edits', 'rejected', 'abandoned')
      AND NOT EXISTS (
        SELECT 1 FROM projection_analytics_human_dispositions disposition
        WHERE disposition.task_outcome_record_id = NEW.task_outcome_record_id
          AND disposition.task_id = NEW.task_id
          AND disposition.disposition = NEW.human_disposition
      )
    BEGIN
      SELECT RAISE(ABORT, 'task outcomes require an explicit human disposition record');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_task_outcomes_explicit_disposition_update
    BEFORE UPDATE OF human_disposition ON projection_analytics_task_outcomes
    WHEN NEW.human_disposition IN ('accepted', 'accepted_with_edits', 'rejected', 'abandoned')
      AND NOT EXISTS (
        SELECT 1 FROM projection_analytics_human_dispositions disposition
        WHERE disposition.task_outcome_record_id = NEW.task_outcome_record_id
          AND disposition.task_id = NEW.task_id
          AND disposition.disposition = NEW.human_disposition
      )
    BEGIN
      SELECT RAISE(ABORT, 'task outcomes require an explicit human disposition record');
    END
  `;

  yield* sql`
    CREATE TABLE projection_analytics_mission_outcomes (
      mission_outcome_record_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      task_count INTEGER NOT NULL CHECK (task_count >= 0),
      completed_task_count INTEGER NOT NULL CHECK (completed_task_count >= 0),
      failed_task_count INTEGER NOT NULL CHECK (failed_task_count >= 0),
      verified_task_count INTEGER NOT NULL CHECK (verified_task_count >= 0),
      integrated_task_count INTEGER NOT NULL CHECK (integrated_task_count >= 0),
      pull_request_created INTEGER NOT NULL CHECK (pull_request_created IN (0, 1)),
      pull_request_merged INTEGER NOT NULL CHECK (pull_request_merged IN (0, 1)),
      human_disposition TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE TABLE projection_analytics_aggregates (
      analytics_aggregate_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      period_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      metric_version INTEGER NOT NULL CHECK (metric_version > 0),
      metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json) AND length(metrics_json) <= 262144),
      calculated_at TEXT NOT NULL,
      source_watermark INTEGER NOT NULL CHECK (source_watermark >= 0),
      source_detail_deleted INTEGER NOT NULL CHECK (source_detail_deleted IN (0, 1)),
      UNIQUE (scope_type, scope_id, period_type, period_start, period_end, metric_version)
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_aggregates_scope_period
    ON projection_analytics_aggregates(scope_type, scope_id, period_start DESC, metric_version)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_budget_policies (
      budget_policy_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      name TEXT NOT NULL,
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      period_type TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      soft_limit TEXT,
      hard_limit TEXT,
      token_limit INTEGER CHECK (token_limit IS NULL OR token_limit >= 0),
      request_limit INTEGER CHECK (request_limit IS NULL OR request_limit >= 0),
      action_on_soft_limit TEXT NOT NULL,
      action_on_hard_limit TEXT NOT NULL,
      conservative_when_incomplete INTEGER NOT NULL CHECK (conservative_when_incomplete IN (0, 1)),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_budget_policies_scope_enabled
    ON projection_analytics_budget_policies(scope_type, scope_id, enabled, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_budget_events (
      budget_event_id TEXT PRIMARY KEY,
      deduplication_key TEXT NOT NULL UNIQUE,
      budget_policy_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      current_value TEXT NOT NULL,
      threshold_value TEXT NOT NULL,
      currency TEXT,
      created_at TEXT NOT NULL,
      acknowledged_at TEXT,
      FOREIGN KEY (budget_policy_id) REFERENCES projection_analytics_budget_policies(budget_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_budget_events_policy_active
    ON projection_analytics_budget_events(budget_policy_id, acknowledged_at, created_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_budget_overrides (
      budget_override_id TEXT PRIMARY KEY,
      budget_policy_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      current_value TEXT NOT NULL,
      threshold_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      fallback_allowed INTEGER NOT NULL CHECK (fallback_allowed IN (0, 1)),
      created_at TEXT NOT NULL,
      expired_at TEXT,
      FOREIGN KEY (budget_policy_id) REFERENCES projection_analytics_budget_policies(budget_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_budget_overrides_policy_expiry
    ON projection_analytics_budget_overrides(budget_policy_id, expires_at, expired_at)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_annotations (
      analytics_annotation_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      timestamp TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_annotations_scope_timestamp
    ON projection_analytics_annotations(scope_type, scope_id, timestamp DESC, created_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_alerts (
      analytics_alert_id TEXT PRIMARY KEY,
      deduplication_key TEXT NOT NULL UNIQUE,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'acknowledged', 'resolved')),
      created_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_alerts_scope_status
    ON projection_analytics_alerts(scope_type, scope_id, status, created_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_recommendations (
      analytics_recommendation_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      title TEXT NOT NULL,
      evidence TEXT NOT NULL,
      sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      task_segment TEXT NOT NULL,
      metric_keys_json TEXT NOT NULL CHECK (json_valid(metric_keys_json) AND length(metric_keys_json) <= 8192),
      uncertainty TEXT NOT NULL,
      estimated_cost_present INTEGER NOT NULL CHECK (estimated_cost_present IN (0, 1)),
      conflicts_with_policy INTEGER NOT NULL CHECK (conflicts_with_policy IN (0, 1)),
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_recommendations_scope_period
    ON projection_analytics_recommendations(scope_type, scope_id, period_end DESC)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_exports (
      analytics_export_id TEXT PRIMARY KEY,
      format TEXT NOT NULL CHECK (format IN ('csv', 'json')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
      filter_json TEXT NOT NULL CHECK (json_valid(filter_json) AND length(filter_json) <= 65536),
      metric_version INTEGER NOT NULL CHECK (metric_version > 0),
      relative_file_path TEXT,
      row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
      byte_count INTEGER CHECK (byte_count IS NULL OR byte_count >= 0),
      error_category TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_exports_recovery
    ON projection_analytics_exports(status, requested_at, analytics_export_id)
  `;
  yield* sql`
    CREATE INDEX idx_analytics_exports_retention
    ON projection_analytics_exports(completed_at, analytics_export_id)
    WHERE status IN ('completed', 'failed', 'interrupted')
  `;

  yield* sql`
    CREATE TABLE projection_analytics_retention_operations (
      analytics_retention_operation_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
      project_id TEXT,
      detail_before TEXT NOT NULL,
      deleted_usage_count INTEGER NOT NULL CHECK (deleted_usage_count >= 0),
      deleted_tool_metric_count INTEGER NOT NULL CHECK (deleted_tool_metric_count >= 0),
      deleted_export_count INTEGER NOT NULL CHECK (deleted_export_count >= 0),
      error_category TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_retention_recovery
    ON projection_analytics_retention_operations(status, requested_at, analytics_retention_operation_id)
  `;

  yield* sql`
    CREATE TABLE projection_analytics_exchange_rate_snapshots (
      exchange_rate_snapshot_id TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL CHECK (length(base_currency) = 3),
      quote_currency TEXT NOT NULL CHECK (length(quote_currency) = 3),
      rate TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source = 'user_configured'),
      effective_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (base_currency, quote_currency, effective_at)
    )
  `;
  yield* sql`
    CREATE INDEX idx_analytics_exchange_rates_pair_effective
    ON projection_analytics_exchange_rate_snapshots(base_currency, quote_currency, effective_at DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_exchange_rates_immutable_update
    BEFORE UPDATE ON projection_analytics_exchange_rate_snapshots
    BEGIN SELECT RAISE(ABORT, 'analytics exchange rate snapshots are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_analytics_exchange_rates_immutable_delete
    BEFORE DELETE ON projection_analytics_exchange_rate_snapshots
    BEGIN SELECT RAISE(ABORT, 'analytics exchange rate snapshots are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_analytics_settings (
      settings_key TEXT PRIMARY KEY CHECK (settings_key = 'environment'),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      detail_retention_days INTEGER NOT NULL CHECK (detail_retention_days > 0),
      aggregate_retention_days INTEGER CHECK (aggregate_retention_days IS NULL OR aggregate_retention_days > 0),
      export_retention_days INTEGER NOT NULL CHECK (export_retention_days > 0),
      pricing_source_priority_json TEXT NOT NULL CHECK (
        json_valid(pricing_source_priority_json) AND length(pricing_source_priority_json) <= 1024
      ),
      default_reporting_currency TEXT NOT NULL CHECK (length(default_reporting_currency) = 3),
      subscription_attribution_mode TEXT NOT NULL,
      local_compute_hourly_rate TEXT,
      outcome_observation_window_days INTEGER NOT NULL CHECK (outcome_observation_window_days > 0),
      minimum_comparison_sample_size INTEGER NOT NULL CHECK (minimum_comparison_sample_size > 0),
      forecast_method TEXT NOT NULL,
      detail_level TEXT NOT NULL CHECK (detail_level IN ('minimal', 'standard', 'detailed')),
      store_prompt_content INTEGER NOT NULL CHECK (store_prompt_content = 0),
      updated_at TEXT NOT NULL
    )
  `;
});
