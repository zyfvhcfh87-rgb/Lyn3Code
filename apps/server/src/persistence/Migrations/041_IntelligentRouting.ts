import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_routing_provider_profiles (
      provider_profile_id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL CHECK (length(trim(provider_type)) BETWEEN 1 AND 128),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 256),
      account_reference TEXT CHECK (
        account_reference IS NULL OR length(trim(account_reference)) BETWEEN 1 AND 512
      ),
      endpoint_class TEXT NOT NULL CHECK (
        endpoint_class IN (
          'official_cloud', 'compatible_api', 'local_runtime', 'enterprise_gateway', 'custom'
        )
      ),
      status TEXT NOT NULL CHECK (
        status IN (
          'available', 'degraded', 'rate_limited', 'authentication_required',
          'credentials_expired', 'offline', 'disabled', 'unsupported', 'error'
        )
      ),
      is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
      is_local INTEGER NOT NULL CHECK (is_local IN (0, 1)),
      supports_model_discovery INTEGER NOT NULL CHECK (supports_model_discovery IN (0, 1)),
      configuration_metadata_json TEXT NOT NULL CHECK (
        json_valid(configuration_metadata_json) AND length(configuration_metadata_json) <= 16384
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_validated_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_provider_profiles_enabled_status
    ON projection_routing_provider_profiles(is_enabled, status, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_routing_model_profiles (
      model_profile_id TEXT PRIMARY KEY,
      provider_profile_id TEXT NOT NULL,
      provider_model_id TEXT NOT NULL CHECK (length(trim(provider_model_id)) BETWEEN 1 AND 512),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 512),
      family TEXT CHECK (family IS NULL OR length(trim(family)) BETWEEN 1 AND 256),
      version TEXT CHECK (version IS NULL OR length(trim(version)) BETWEEN 1 AND 256),
      release_channel TEXT CHECK (
        release_channel IS NULL OR length(trim(release_channel)) BETWEEN 1 AND 128
      ),
      status TEXT NOT NULL CHECK (
        status IN ('available', 'unavailable', 'deprecated', 'preview', 'unknown', 'disabled')
      ),
      is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
      is_deprecated INTEGER NOT NULL CHECK (is_deprecated IN (0, 1)),
      discovered_automatically INTEGER NOT NULL CHECK (discovered_automatically IN (0, 1)),
      maximum_concurrent_sessions INTEGER CHECK (
        maximum_concurrent_sessions IS NULL OR maximum_concurrent_sessions > 0
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_discovered_at TEXT,
      UNIQUE (provider_profile_id, provider_model_id),
      UNIQUE (provider_profile_id, model_profile_id),
      FOREIGN KEY (provider_profile_id)
        REFERENCES projection_routing_provider_profiles(provider_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_model_profiles_provider_enabled_status
    ON projection_routing_model_profiles(provider_profile_id, is_enabled, status, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_routing_model_capability_snapshots (
      capability_snapshot_id TEXT PRIMARY KEY,
      model_profile_id TEXT NOT NULL,
      snapshot_version INTEGER NOT NULL CHECK (snapshot_version > 0),
      source TEXT NOT NULL CHECK (
        source IN (
          'provider_reported', 'official_configuration', 'manual_override',
          'runtime_probe', 'inferred', 'unknown'
        )
      ),
      capabilities_json TEXT NOT NULL CHECK (
        json_valid(capabilities_json) AND length(capabilities_json) <= 32768
      ),
      context_limits_json TEXT NOT NULL CHECK (
        json_valid(context_limits_json) AND length(context_limits_json) <= 16384
      ),
      reasoning_options_json TEXT NOT NULL CHECK (
        json_valid(reasoning_options_json) AND length(reasoning_options_json) <= 16384
      ),
      tool_support_json TEXT NOT NULL CHECK (
        json_valid(tool_support_json) AND length(tool_support_json) <= 32768
      ),
      modality_support_json TEXT NOT NULL CHECK (
        json_valid(modality_support_json) AND length(modality_support_json) <= 16384
      ),
      output_support_json TEXT NOT NULL CHECK (
        json_valid(output_support_json) AND length(output_support_json) <= 16384
      ),
      privacy_metadata_json TEXT NOT NULL CHECK (
        json_valid(privacy_metadata_json) AND length(privacy_metadata_json) <= 16384
      ),
      captured_at TEXT NOT NULL,
      expires_at TEXT,
      UNIQUE (model_profile_id, snapshot_version),
      UNIQUE (model_profile_id, capability_snapshot_id),
      FOREIGN KEY (model_profile_id)
        REFERENCES projection_routing_model_profiles(model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_capability_snapshots_model_captured
    ON projection_routing_model_capability_snapshots(model_profile_id, captured_at DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_capability_snapshots_immutable_update
    BEFORE UPDATE ON projection_routing_model_capability_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'routing capability snapshots are immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_capability_snapshots_immutable_delete
    BEFORE DELETE ON projection_routing_model_capability_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'routing capability snapshots are immutable');
    END
  `;

  yield* sql`
    CREATE TABLE projection_routing_policies (
      routing_policy_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (
        scope_type IN ('global', 'user', 'project', 'mission', 'agent_role', 'task')
      ),
      scope_id TEXT,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 256),
      description TEXT NOT NULL CHECK (length(description) <= 4000),
      priority INTEGER NOT NULL CHECK (priority >= 0),
      is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
      default_provider_profile_id TEXT,
      default_model_profile_id TEXT,
      default_reasoning_level TEXT CHECK (
        default_reasoning_level IS NULL
        OR default_reasoning_level IN ('low', 'medium', 'high', 'extra_high')
      ),
      fallback_mode TEXT NOT NULL CHECK (
        fallback_mode IN ('none', 'same_model_retry', 'same_provider', 'configured_chain', 'any_compatible')
      ),
      privacy_mode TEXT NOT NULL CHECK (
        privacy_mode IN ('inherit', 'remote_allowed', 'approved_remote_only', 'local_preferred', 'local_only')
      ),
      budget_mode TEXT NOT NULL CHECK (
        budget_mode IN ('inherit', 'unrestricted', 'economy', 'balanced', 'quality_first', 'configured_limit')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (scope_type IN ('global', 'user') AND scope_id IS NULL)
        OR (scope_type NOT IN ('global', 'user') AND length(trim(scope_id)) > 0)
      ),
      CHECK (default_model_profile_id IS NULL OR default_provider_profile_id IS NOT NULL),
      FOREIGN KEY (default_provider_profile_id, default_model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_policies_scope_enabled_priority
    ON projection_routing_policies(scope_type, scope_id, is_enabled, priority DESC, updated_at DESC)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_routing_policies_environment_singleton_name
    ON projection_routing_policies(scope_type, name)
    WHERE scope_type IN ('global', 'user')
  `;
  yield* sql`
    INSERT INTO projection_routing_policies (
      routing_policy_id, scope_type, scope_id, name, description, priority, is_enabled,
      default_provider_profile_id, default_model_profile_id, default_reasoning_level,
      fallback_mode, privacy_mode, budget_mode, created_at, updated_at
    ) VALUES (
      'routing-policy:balanced-default', 'global', NULL, 'Balanced automatic routing',
      'Capability-driven routing with bounded compatible fallback and no provider or model lock-in.',
      0, 1, NULL, NULL, NULL, 'any_compatible', 'remote_allowed', 'balanced',
      '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
    )
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_policies_validate_scope_insert
    BEFORE INSERT ON projection_routing_policies
    BEGIN
      SELECT CASE
        WHEN NEW.scope_type = 'project' AND NOT EXISTS (
          SELECT 1 FROM projection_projects WHERE project_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing policy project scope does not exist')
        WHEN NEW.scope_type = 'mission' AND NOT EXISTS (
          SELECT 1 FROM projection_missions WHERE mission_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing policy mission scope does not exist')
        WHEN NEW.scope_type = 'task' AND NOT EXISTS (
          SELECT 1 FROM projection_mission_tasks WHERE task_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing policy task scope does not exist')
        WHEN NEW.scope_type = 'agent_role' AND NEW.scope_id NOT IN (
          'coordinator', 'implementer', 'researcher', 'reviewer', 'verifier',
          'memory_extractor', 'repair_agent', 'custom'
        ) THEN RAISE(ABORT, 'routing policy agent role scope is invalid')
      END;
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_policies_validate_scope_update
    BEFORE UPDATE OF scope_type, scope_id ON projection_routing_policies
    BEGIN
      SELECT CASE
        WHEN NEW.scope_type = 'project' AND NOT EXISTS (
          SELECT 1 FROM projection_projects WHERE project_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing policy project scope does not exist')
        WHEN NEW.scope_type = 'mission' AND NOT EXISTS (
          SELECT 1 FROM projection_missions WHERE mission_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing policy mission scope does not exist')
        WHEN NEW.scope_type = 'task' AND NOT EXISTS (
          SELECT 1 FROM projection_mission_tasks WHERE task_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing policy task scope does not exist')
        WHEN NEW.scope_type = 'agent_role' AND NEW.scope_id NOT IN (
          'coordinator', 'implementer', 'researcher', 'reviewer', 'verifier',
          'memory_extractor', 'repair_agent', 'custom'
        ) THEN RAISE(ABORT, 'routing policy agent role scope is invalid')
      END;
    END
  `;

  yield* sql`
    CREATE TABLE projection_routing_rules (
      routing_rule_id TEXT PRIMARY KEY,
      routing_policy_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 256),
      description TEXT NOT NULL CHECK (length(description) <= 4000),
      priority INTEGER NOT NULL CHECK (priority >= 0),
      is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
      conditions_json TEXT NOT NULL CHECK (
        json_valid(conditions_json) AND length(conditions_json) <= 131072
      ),
      requirements_json TEXT NOT NULL CHECK (
        json_valid(requirements_json) AND length(requirements_json) <= 131072
      ),
      preferences_json TEXT NOT NULL CHECK (
        json_valid(preferences_json) AND length(preferences_json) <= 65536
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(result_json) <= 65536
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (routing_policy_id) REFERENCES projection_routing_policies(routing_policy_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_rules_policy_enabled_priority
    ON projection_routing_rules(routing_policy_id, is_enabled, priority DESC, routing_rule_id)
  `;

  yield* sql`
    CREATE TABLE projection_agent_role_routing_profiles (
      agent_role_routing_profile_id TEXT PRIMARY KEY,
      project_id TEXT,
      role_kind TEXT NOT NULL CHECK (
        role_kind IN (
          'coordinator', 'implementer', 'researcher', 'reviewer', 'verifier',
          'memory_extractor', 'repair_agent', 'custom'
        )
      ),
      routing_policy_id TEXT NOT NULL,
      preferred_capabilities_json TEXT NOT NULL CHECK (
        json_valid(preferred_capabilities_json) AND length(preferred_capabilities_json) <= 16384
      ),
      required_capabilities_json TEXT NOT NULL CHECK (
        json_valid(required_capabilities_json) AND length(required_capabilities_json) <= 16384
      ),
      default_reasoning_level TEXT CHECK (
        default_reasoning_level IS NULL
        OR default_reasoning_level IN ('low', 'medium', 'high', 'extra_high')
      ),
      allow_fallback INTEGER NOT NULL CHECK (allow_fallback IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, role_kind),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (routing_policy_id) REFERENCES projection_routing_policies(routing_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_agent_role_routing_profiles_global_role
    ON projection_agent_role_routing_profiles(role_kind)
    WHERE project_id IS NULL
  `;

  yield* sql`
    CREATE TABLE projection_task_routing_assessments (
      task_routing_assessment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_role TEXT NOT NULL CHECK (
        agent_role IN (
          'coordinator', 'implementer', 'researcher', 'reviewer', 'verifier',
          'memory_extractor', 'repair_agent', 'custom'
        )
      ),
      task_type TEXT NOT NULL CHECK (
        task_type IN (
          'planning', 'architecture', 'implementation', 'refactor', 'bug_fix',
          'test_authoring', 'verification', 'review', 'security_review',
          'performance_review', 'research', 'documentation', 'memory_extraction',
          'github_workflow', 'conflict_resolution', 'repair', 'custom'
        )
      ),
      complexity TEXT NOT NULL CHECK (
        complexity IN ('trivial', 'low', 'medium', 'high', 'very_high', 'unknown')
      ),
      required_capabilities_json TEXT NOT NULL CHECK (
        json_valid(required_capabilities_json) AND length(required_capabilities_json) <= 16384
      ),
      preferred_capabilities_json TEXT NOT NULL CHECK (
        json_valid(preferred_capabilities_json) AND length(preferred_capabilities_json) <= 16384
      ),
      estimated_context_tokens INTEGER CHECK (estimated_context_tokens IS NULL OR estimated_context_tokens > 0),
      privacy_classification TEXT NOT NULL CHECK (
        privacy_classification IN ('public', 'normal', 'sensitive', 'restricted', 'local_only')
      ),
      write_access_required INTEGER NOT NULL CHECK (write_access_required IN (0, 1)),
      vision_required INTEGER NOT NULL CHECK (vision_required IN (0, 1)),
      structured_output_required INTEGER NOT NULL CHECK (structured_output_required IN (0, 1)),
      assessment_source TEXT NOT NULL CHECK (assessment_source IN ('manual', 'inferred', 'system')),
      assessment_explanation TEXT NOT NULL CHECK (length(assessment_explanation) <= 8000),
      version INTEGER NOT NULL CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      superseded_by_id TEXT,
      UNIQUE (task_id, version),
      CHECK (superseded_by_id IS NULL OR superseded_by_id <> task_routing_assessment_id),
      FOREIGN KEY (task_id) REFERENCES projection_mission_tasks(task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (superseded_by_id)
        REFERENCES projection_task_routing_assessments(task_routing_assessment_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_task_routing_assessments_task_version
    ON projection_task_routing_assessments(task_id, version DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_task_routing_assessments_immutable
    BEFORE UPDATE ON projection_task_routing_assessments
    WHEN
      OLD.task_id IS NOT NEW.task_id
      OR OLD.agent_role IS NOT NEW.agent_role
      OR OLD.task_type IS NOT NEW.task_type
      OR OLD.complexity IS NOT NEW.complexity
      OR OLD.required_capabilities_json IS NOT NEW.required_capabilities_json
      OR OLD.preferred_capabilities_json IS NOT NEW.preferred_capabilities_json
      OR OLD.estimated_context_tokens IS NOT NEW.estimated_context_tokens
      OR OLD.privacy_classification IS NOT NEW.privacy_classification
      OR OLD.write_access_required IS NOT NEW.write_access_required
      OR OLD.vision_required IS NOT NEW.vision_required
      OR OLD.structured_output_required IS NOT NEW.structured_output_required
      OR OLD.assessment_source IS NOT NEW.assessment_source
      OR OLD.assessment_explanation IS NOT NEW.assessment_explanation
      OR OLD.version IS NOT NEW.version
      OR OLD.created_at IS NOT NEW.created_at
      OR (OLD.superseded_by_id IS NOT NULL AND OLD.superseded_by_id IS NOT NEW.superseded_by_id)
    BEGIN
      SELECT RAISE(ABORT, 'routing assessments are immutable except for one-time supersession');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_task_routing_assessments_no_delete
    BEFORE DELETE ON projection_task_routing_assessments
    BEGIN
      SELECT RAISE(ABORT, 'routing assessment history cannot be deleted');
    END
  `;

  yield* sql`
    CREATE TABLE projection_routing_decisions (
      routing_decision_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      task_id TEXT,
      mission_agent_id TEXT,
      agent_run_id TEXT,
      assessment_id TEXT NOT NULL,
      decision_type TEXT NOT NULL CHECK (
        decision_type IN ('automatic', 'manual', 'policy_pinned', 'fallback', 'retry', 'recovery')
      ),
      selected_provider_profile_id TEXT NOT NULL,
      selected_model_profile_id TEXT NOT NULL,
      selected_capability_snapshot_id TEXT NOT NULL,
      selected_reasoning_level TEXT CHECK (
        selected_reasoning_level IS NULL
        OR selected_reasoning_level IN ('low', 'medium', 'high', 'extra_high')
      ),
      manual_provider_pin INTEGER NOT NULL CHECK (manual_provider_pin IN (0, 1)),
      manual_model_pin INTEGER NOT NULL CHECK (manual_model_pin IN (0, 1)),
      manual_reasoning_pin INTEGER NOT NULL CHECK (manual_reasoning_pin IN (0, 1)),
      fallback_plan_json TEXT NOT NULL CHECK (
        json_valid(fallback_plan_json) AND length(fallback_plan_json) <= 65536
      ),
      candidate_summary_json TEXT NOT NULL CHECK (
        json_valid(candidate_summary_json) AND length(candidate_summary_json) <= 32768
      ),
      selection_explanation TEXT NOT NULL CHECK (
        length(trim(selection_explanation)) BETWEEN 1 AND 8000
      ),
      constraints_snapshot_json TEXT NOT NULL CHECK (
        json_valid(constraints_snapshot_json) AND length(constraints_snapshot_json) <= 65536
      ),
      policy_snapshot_json TEXT NOT NULL CHECK (
        json_valid(policy_snapshot_json) AND length(policy_snapshot_json) <= 65536
      ),
      status TEXT NOT NULL CHECK (status IN ('planned', 'applied', 'superseded', 'failed', 'cancelled')),
      created_at TEXT NOT NULL,
      applied_at TEXT,
      terminal_at TEXT,
      failure_summary TEXT CHECK (failure_summary IS NULL OR length(failure_summary) <= 4000),
      superseded_by_id TEXT,
      CHECK (task_id IS NULL OR mission_id IS NOT NULL),
      CHECK (mission_agent_id IS NULL OR mission_id IS NOT NULL),
      CHECK (agent_run_id IS NULL OR mission_id IS NOT NULL),
      CHECK (superseded_by_id IS NULL OR superseded_by_id <> routing_decision_id),
      CHECK (
        (status = 'applied' AND applied_at IS NOT NULL AND agent_run_id IS NOT NULL)
        OR status <> 'applied'
      ),
      CHECK (
        (status = 'superseded' AND superseded_by_id IS NOT NULL AND terminal_at IS NOT NULL)
        OR (status <> 'superseded' AND superseded_by_id IS NULL)
      ),
      CHECK (
        status NOT IN ('failed', 'cancelled') OR terminal_at IS NOT NULL
      ),
      UNIQUE (agent_run_id),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, mission_agent_id)
        REFERENCES projection_mission_agents(mission_id, mission_agent_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (assessment_id)
        REFERENCES projection_task_routing_assessments(task_routing_assessment_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (selected_provider_profile_id, selected_model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (selected_model_profile_id, selected_capability_snapshot_id)
        REFERENCES projection_routing_model_capability_snapshots(model_profile_id, capability_snapshot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (superseded_by_id) REFERENCES projection_routing_decisions(routing_decision_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_decisions_project_created
    ON projection_routing_decisions(project_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_routing_decisions_task_created
    ON projection_routing_decisions(task_id, created_at DESC)
    WHERE task_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX idx_routing_decisions_recovery
    ON projection_routing_decisions(status, created_at)
    WHERE status IN ('planned', 'applied')
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_decisions_validate_scope_insert
    BEFORE INSERT ON projection_routing_decisions
    BEGIN
      SELECT CASE
        WHEN NEW.mission_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM projection_missions
          WHERE mission_id = NEW.mission_id AND project_id = NEW.project_id
        ) THEN RAISE(ABORT, 'routing decision mission must belong to project')
        WHEN NEW.task_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM projection_task_routing_assessments
          WHERE task_routing_assessment_id = NEW.assessment_id AND task_id = NEW.task_id
        ) THEN RAISE(ABORT, 'routing decision assessment must belong to task')
      END;
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_decisions_immutable_update
    BEFORE UPDATE ON projection_routing_decisions
    WHEN
      OLD.project_id IS NOT NEW.project_id
      OR OLD.mission_id IS NOT NEW.mission_id
      OR OLD.task_id IS NOT NEW.task_id
      OR OLD.mission_agent_id IS NOT NEW.mission_agent_id
      OR OLD.assessment_id IS NOT NEW.assessment_id
      OR OLD.decision_type IS NOT NEW.decision_type
      OR OLD.selected_provider_profile_id IS NOT NEW.selected_provider_profile_id
      OR OLD.selected_model_profile_id IS NOT NEW.selected_model_profile_id
      OR OLD.selected_capability_snapshot_id IS NOT NEW.selected_capability_snapshot_id
      OR OLD.selected_reasoning_level IS NOT NEW.selected_reasoning_level
      OR OLD.manual_provider_pin IS NOT NEW.manual_provider_pin
      OR OLD.manual_model_pin IS NOT NEW.manual_model_pin
      OR OLD.manual_reasoning_pin IS NOT NEW.manual_reasoning_pin
      OR OLD.fallback_plan_json IS NOT NEW.fallback_plan_json
      OR OLD.candidate_summary_json IS NOT NEW.candidate_summary_json
      OR OLD.selection_explanation IS NOT NEW.selection_explanation
      OR OLD.constraints_snapshot_json IS NOT NEW.constraints_snapshot_json
      OR OLD.policy_snapshot_json IS NOT NEW.policy_snapshot_json
      OR OLD.created_at IS NOT NEW.created_at
      OR (OLD.agent_run_id IS NOT NULL AND OLD.agent_run_id IS NOT NEW.agent_run_id)
    BEGIN
      SELECT RAISE(ABORT, 'routing decision evidence is immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_decisions_valid_transition
    BEFORE UPDATE OF status ON projection_routing_decisions
    WHEN OLD.status <> NEW.status AND NOT (
      (OLD.status = 'planned' AND NEW.status IN ('applied', 'superseded', 'failed', 'cancelled'))
      OR (OLD.status = 'applied' AND NEW.status = 'superseded')
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid routing decision status transition');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_decisions_no_delete
    BEFORE DELETE ON projection_routing_decisions
    BEGIN
      SELECT RAISE(ABORT, 'routing decision history cannot be deleted');
    END
  `;

  yield* sql`
    CREATE TABLE projection_routing_candidate_records (
      routing_candidate_record_id TEXT PRIMARY KEY,
      routing_decision_id TEXT NOT NULL,
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
      score REAL,
      rejection_reasons_json TEXT NOT NULL CHECK (
        json_valid(rejection_reasons_json) AND length(rejection_reasons_json) <= 32768
      ),
      preference_reasons_json TEXT NOT NULL CHECK (
        json_valid(preference_reasons_json) AND length(preference_reasons_json) <= 32768
      ),
      capability_snapshot_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (routing_decision_id, model_profile_id),
      CHECK (
        (eligible = 1 AND score IS NOT NULL AND json_array_length(rejection_reasons_json) = 0)
        OR eligible = 0
      ),
      FOREIGN KEY (routing_decision_id) REFERENCES projection_routing_decisions(routing_decision_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (provider_profile_id, model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (model_profile_id, capability_snapshot_id)
        REFERENCES projection_routing_model_capability_snapshots(model_profile_id, capability_snapshot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_candidates_decision_eligible_score
    ON projection_routing_candidate_records(routing_decision_id, eligible, score DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_candidate_records_immutable_update
    BEFORE UPDATE ON projection_routing_candidate_records
    BEGIN
      SELECT RAISE(ABORT, 'routing candidate records are immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_candidate_records_immutable_delete
    BEFORE DELETE ON projection_routing_candidate_records
    BEGIN
      SELECT RAISE(ABORT, 'routing candidate records are immutable');
    END
  `;

  yield* sql`
    CREATE TABLE projection_provider_health_records (
      provider_health_record_id TEXT PRIMARY KEY,
      provider_profile_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'available', 'degraded', 'rate_limited', 'authentication_required',
          'credentials_expired', 'offline', 'disabled', 'unsupported', 'error'
        )
      ),
      latency_milliseconds INTEGER CHECK (latency_milliseconds IS NULL OR latency_milliseconds >= 0),
      rate_limit_state TEXT NOT NULL CHECK (
        rate_limit_state IN ('clear', 'approaching', 'limited', 'unknown')
      ),
      error_category TEXT CHECK (
        error_category IS NULL OR length(trim(error_category)) BETWEEN 1 AND 256
      ),
      observed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL CHECK (expires_at > observed_at),
      FOREIGN KEY (provider_profile_id)
        REFERENCES projection_routing_provider_profiles(provider_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_provider_health_records_provider_observed
    ON projection_provider_health_records(provider_profile_id, observed_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_provider_health_records_expiry
    ON projection_provider_health_records(expires_at)
  `;
  yield* sql`
    CREATE TRIGGER projection_provider_health_records_immutable_update
    BEFORE UPDATE ON projection_provider_health_records
    BEGIN
      SELECT RAISE(ABORT, 'provider health observations are immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_provider_health_records_immutable_delete
    BEFORE DELETE ON projection_provider_health_records
    BEGIN
      SELECT RAISE(ABORT, 'provider health observations are immutable');
    END
  `;

  yield* sql`
    CREATE TABLE projection_routing_overrides (
      routing_override_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (
        scope_type IN ('global', 'user', 'project', 'mission', 'agent_role', 'task')
      ),
      scope_id TEXT,
      provider_profile_id TEXT,
      model_profile_id TEXT,
      reasoning_level TEXT CHECK (
        reasoning_level IS NULL OR reasoning_level IN ('low', 'medium', 'high', 'extra_high')
      ),
      fallback_mode TEXT CHECK (
        fallback_mode IS NULL
        OR fallback_mode IN ('none', 'same_model_retry', 'same_provider', 'configured_chain', 'any_compatible')
      ),
      expires_at TEXT,
      reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 4000),
      created_by TEXT NOT NULL CHECK (length(trim(created_by)) BETWEEN 1 AND 512),
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      CHECK (
        (scope_type IN ('global', 'user') AND scope_id IS NULL)
        OR (scope_type NOT IN ('global', 'user') AND length(trim(scope_id)) > 0)
      ),
      CHECK (
        provider_profile_id IS NOT NULL OR model_profile_id IS NOT NULL
        OR reasoning_level IS NOT NULL OR fallback_mode IS NOT NULL
      ),
      FOREIGN KEY (provider_profile_id) REFERENCES projection_routing_provider_profiles(provider_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (model_profile_id) REFERENCES projection_routing_model_profiles(model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routing_overrides_scope_active
    ON projection_routing_overrides(scope_type, scope_id, expires_at, created_at DESC)
    WHERE revoked_at IS NULL
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_overrides_validate_insert
    BEFORE INSERT ON projection_routing_overrides
    BEGIN
      SELECT CASE
        WHEN NEW.scope_type = 'project' AND NOT EXISTS (
          SELECT 1 FROM projection_projects WHERE project_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing override project scope does not exist')
        WHEN NEW.scope_type = 'mission' AND NOT EXISTS (
          SELECT 1 FROM projection_missions WHERE mission_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing override mission scope does not exist')
        WHEN NEW.scope_type = 'task' AND NOT EXISTS (
          SELECT 1 FROM projection_mission_tasks WHERE task_id = NEW.scope_id
        ) THEN RAISE(ABORT, 'routing override task scope does not exist')
        WHEN NEW.scope_type = 'agent_role' AND NEW.scope_id NOT IN (
          'coordinator', 'implementer', 'researcher', 'reviewer', 'verifier',
          'memory_extractor', 'repair_agent', 'custom'
        ) THEN RAISE(ABORT, 'routing override agent role scope is invalid')
        WHEN NEW.model_profile_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM projection_routing_model_profiles
          WHERE model_profile_id = NEW.model_profile_id
            AND (NEW.provider_profile_id IS NULL OR provider_profile_id = NEW.provider_profile_id)
        ) THEN RAISE(ABORT, 'routing override model does not belong to provider')
      END;
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_routing_overrides_immutable_update
    BEFORE UPDATE ON projection_routing_overrides
    WHEN
      OLD.scope_type IS NOT NEW.scope_type
      OR OLD.scope_id IS NOT NEW.scope_id
      OR OLD.provider_profile_id IS NOT NEW.provider_profile_id
      OR OLD.model_profile_id IS NOT NEW.model_profile_id
      OR OLD.reasoning_level IS NOT NEW.reasoning_level
      OR OLD.fallback_mode IS NOT NEW.fallback_mode
      OR OLD.expires_at IS NOT NEW.expires_at
      OR OLD.reason IS NOT NEW.reason
      OR OLD.created_by IS NOT NEW.created_by
      OR OLD.created_at IS NOT NEW.created_at
      OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS NOT NEW.revoked_at)
    BEGIN
      SELECT RAISE(ABORT, 'routing overrides are immutable except for one-time revocation');
    END
  `;

  yield* sql`
    CREATE TABLE projection_routed_run_outcomes (
      routed_run_outcome_id TEXT PRIMARY KEY,
      routing_decision_id TEXT NOT NULL UNIQUE,
      agent_run_id TEXT NOT NULL UNIQUE,
      task_type TEXT NOT NULL CHECK (
        task_type IN (
          'planning', 'architecture', 'implementation', 'refactor', 'bug_fix',
          'test_authoring', 'verification', 'review', 'security_review',
          'performance_review', 'research', 'documentation', 'memory_extraction',
          'github_workflow', 'conflict_resolution', 'repair', 'custom'
        )
      ),
      complexity TEXT NOT NULL CHECK (
        complexity IN ('trivial', 'low', 'medium', 'high', 'very_high', 'unknown')
      ),
      provider_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      reasoning_level TEXT CHECK (
        reasoning_level IS NULL OR reasoning_level IN ('low', 'medium', 'high', 'extra_high')
      ),
      completion_state TEXT NOT NULL CHECK (
        completion_state IN ('running', 'completed', 'cancelled', 'failed', 'interrupted')
      ),
      fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
      interrupted INTEGER NOT NULL CHECK (interrupted IN (0, 1)),
      verification_result TEXT NOT NULL CHECK (
        verification_result IN ('not_run', 'passed', 'failed', 'overridden', 'unknown')
      ),
      retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
      user_override INTEGER NOT NULL CHECK (user_override IN (0, 1)),
      human_disposition TEXT CHECK (human_disposition IS NULL OR human_disposition IN ('accepted', 'rejected')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (routing_decision_id) REFERENCES projection_routing_decisions(routing_decision_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (provider_profile_id, model_profile_id)
        REFERENCES projection_routing_model_profiles(provider_profile_id, model_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_routed_run_outcomes_model_completion
    ON projection_routed_run_outcomes(model_profile_id, completion_state, updated_at DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_routed_run_outcomes_immutable_identity
    BEFORE UPDATE ON projection_routed_run_outcomes
    WHEN
      OLD.routing_decision_id IS NOT NEW.routing_decision_id
      OR OLD.agent_run_id IS NOT NEW.agent_run_id
      OR OLD.task_type IS NOT NEW.task_type
      OR OLD.complexity IS NOT NEW.complexity
      OR OLD.provider_profile_id IS NOT NEW.provider_profile_id
      OR OLD.model_profile_id IS NOT NEW.model_profile_id
      OR OLD.reasoning_level IS NOT NEW.reasoning_level
      OR OLD.started_at IS NOT NEW.started_at
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN
      SELECT RAISE(ABORT, 'routed run outcome identity is immutable');
    END
  `;

  yield* sql`
    ALTER TABLE projection_agent_runs
    ADD COLUMN routing_decision_id TEXT
      REFERENCES projection_routing_decisions(routing_decision_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  `;
  yield* sql`
    ALTER TABLE projection_agent_runs
    ADD COLUMN model_selection_json TEXT
      CHECK (model_selection_json IS NULL OR (
        json_valid(model_selection_json) AND length(model_selection_json) <= 32768
      ))
  `;
  yield* sql`
    ALTER TABLE projection_agent_runs
    ADD COLUMN routing_reasoning_level TEXT
      CHECK (
        routing_reasoning_level IS NULL
        OR routing_reasoning_level IN ('low', 'medium', 'high', 'extra_high')
      )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_agent_runs_routing_decision
    ON projection_agent_runs(routing_decision_id)
    WHERE routing_decision_id IS NOT NULL
  `;
  yield* sql`
    CREATE TRIGGER projection_agent_runs_routing_selection_insert
    BEFORE INSERT ON projection_agent_runs
    WHEN NEW.routing_decision_id IS NOT NULL
    BEGIN
      SELECT CASE
        WHEN NEW.model_selection_json IS NULL
          THEN RAISE(ABORT, 'routed agent runs require a frozen model selection')
        WHEN NOT EXISTS (
          SELECT 1
          FROM projection_routing_decisions AS decision
          JOIN projection_routing_model_profiles AS model
            ON model.model_profile_id = decision.selected_model_profile_id
          WHERE decision.routing_decision_id = NEW.routing_decision_id
            AND decision.status = 'planned'
            AND decision.project_id = (
              SELECT project_id FROM projection_missions WHERE mission_id = NEW.mission_id
            )
            AND (decision.mission_id IS NULL OR decision.mission_id = NEW.mission_id)
            AND (decision.task_id IS NULL OR decision.task_id IS NEW.task_id)
            AND decision.selected_provider_profile_id = NEW.provider_instance_id
            AND json_extract(NEW.model_selection_json, '$.instanceId') = NEW.provider_instance_id
            AND json_extract(NEW.model_selection_json, '$.model') = model.provider_model_id
            AND decision.selected_reasoning_level IS NEW.routing_reasoning_level
        ) THEN RAISE(ABORT, 'agent run does not match its planned routing decision')
      END;
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_agent_runs_routing_selection_immutable
    BEFORE UPDATE ON projection_agent_runs
    WHEN
      (OLD.routing_decision_id IS NOT NULL AND OLD.routing_decision_id IS NOT NEW.routing_decision_id)
      OR (OLD.model_selection_json IS NOT NULL AND OLD.model_selection_json IS NOT NEW.model_selection_json)
      OR (OLD.routing_reasoning_level IS NOT NULL AND OLD.routing_reasoning_level IS NOT NEW.routing_reasoning_level)
    BEGIN
      SELECT RAISE(ABORT, 'routed agent run selection is immutable');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_agent_runs_routing_selection_link
    BEFORE UPDATE OF routing_decision_id, model_selection_json, routing_reasoning_level
    ON projection_agent_runs
    WHEN NEW.routing_decision_id IS NOT NULL AND OLD.routing_decision_id IS NULL
    BEGIN
      SELECT CASE
        WHEN NEW.model_selection_json IS NULL
          THEN RAISE(ABORT, 'routed agent runs require a frozen model selection')
        WHEN NOT EXISTS (
          SELECT 1
          FROM projection_routing_decisions AS decision
          JOIN projection_routing_model_profiles AS model
            ON model.model_profile_id = decision.selected_model_profile_id
          WHERE decision.routing_decision_id = NEW.routing_decision_id
            AND decision.status = 'planned'
            AND decision.project_id = (
              SELECT project_id FROM projection_missions WHERE mission_id = NEW.mission_id
            )
            AND (decision.mission_id IS NULL OR decision.mission_id = NEW.mission_id)
            AND (decision.task_id IS NULL OR decision.task_id IS NEW.task_id)
            AND decision.selected_provider_profile_id = NEW.provider_instance_id
            AND json_extract(NEW.model_selection_json, '$.instanceId') = NEW.provider_instance_id
            AND json_extract(NEW.model_selection_json, '$.model') = model.provider_model_id
            AND decision.selected_reasoning_level IS NEW.routing_reasoning_level
        ) THEN RAISE(ABORT, 'agent run does not match its planned routing decision')
      END;
    END
  `;

  yield* sql`
    ALTER TABLE projection_thread_sessions
    ADD COLUMN runtime_error_class TEXT CHECK (
      runtime_error_class IS NULL
      OR runtime_error_class IN (
        'provider_error', 'transport_error', 'permission_error', 'validation_error', 'unknown'
      )
    )
  `;
});
