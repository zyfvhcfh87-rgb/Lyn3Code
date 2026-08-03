import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_verification_profiles (
      verification_profile_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      trigger_modes_json TEXT NOT NULL CHECK (json_valid(trigger_modes_json)),
      configuration_revision TEXT NOT NULL,
      configuration_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, verification_profile_id),
      UNIQUE (project_id, name),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_project_verification_settings (
      project_id TEXT PRIMARY KEY,
      configuration_path TEXT,
      configuration_source TEXT NOT NULL CHECK (
        configuration_source IN ('explicit_project_setting', 'repository', 'inferred', 'none')
      ),
      accepted_configuration_digest TEXT,
      accepted_at TEXT,
      accepted_by TEXT,
      default_profile_id TEXT,
      pre_integration_profile_id TEXT,
      automatic_task_verification_enabled INTEGER NOT NULL DEFAULT 0 CHECK (
        automatic_task_verification_enabled IN (0, 1)
      ),
      maximum_repair_attempts INTEGER NOT NULL DEFAULT 2 CHECK (maximum_repair_attempts >= 0),
      automatic_repair_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_repair_enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_gates (
      verification_gate_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK (
        category IN (
          'install', 'format', 'lint', 'typecheck', 'unit_test', 'integration_test',
          'build', 'ui_smoke', 'security', 'custom'
        )
      ),
      position INTEGER NOT NULL CHECK (position >= 0),
      required INTEGER NOT NULL CHECK (required IN (0, 1)),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      execution_mode TEXT NOT NULL CHECK (execution_mode IN ('sequential', 'parallel_safe')),
      failure_policy TEXT NOT NULL CHECK (failure_policy IN ('block', 'warn', 'informational')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_id, verification_gate_id),
      UNIQUE (profile_id, position),
      FOREIGN KEY (profile_id) REFERENCES projection_verification_profiles(verification_profile_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_check_definitions (
      verification_check_definition_id TEXT PRIMARY KEY,
      gate_id TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      arguments_json TEXT NOT NULL CHECK (json_valid(arguments_json)),
      requires_shell INTEGER NOT NULL CHECK (requires_shell IN (0, 1)),
      working_directory TEXT NOT NULL,
      environment_overrides_json TEXT NOT NULL CHECK (json_valid(environment_overrides_json)),
      timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds > 0),
      allowed_exit_codes_json TEXT NOT NULL CHECK (json_valid(allowed_exit_codes_json)),
      continue_on_failure INTEGER NOT NULL CHECK (continue_on_failure IN (0, 1)),
      applicable_file_patterns_json TEXT NOT NULL CHECK (json_valid(applicable_file_patterns_json)),
      excluded_file_patterns_json TEXT NOT NULL CHECK (json_valid(excluded_file_patterns_json)),
      platforms_json TEXT NOT NULL CHECK (json_valid(platforms_json)),
      artifact_patterns_json TEXT NOT NULL CHECK (json_valid(artifact_patterns_json)),
      diagnostic_parser TEXT NOT NULL CHECK (
        diagnostic_parser IN ('none', 'typescript', 'eslint', 'test', 'build', 'generic')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (gate_id, verification_check_definition_id),
      FOREIGN KEY (gate_id) REFERENCES projection_verification_gates(verification_gate_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_runs (
      verification_run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      task_id TEXT,
      worktree_id TEXT,
      agent_run_id TEXT,
      profile_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (
        trigger IN (
          'manual', 'task_completion', 'before_integration', 'after_integration',
          'retry_failed_gate', 'retry_profile', 'repair_retry', 'recovery'
        )
      ),
      authorization_scope TEXT NOT NULL DEFAULT 'full_profile' CHECK (
        authorization_scope IN ('full_profile', 'diagnostic_subset')
      ),
      source_verification_run_id TEXT,
      status TEXT NOT NULL CHECK (
        status IN (
          'queued', 'preparing', 'running', 'cancelling', 'passed',
          'passed_with_warnings', 'failed', 'cancelled', 'interrupted', 'invalidated'
        )
      ),
      configuration_revision TEXT NOT NULL,
      configuration_digest TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      commit_hash TEXT,
      dirty_state_fingerprint TEXT,
      source_fingerprint TEXT NOT NULL,
      changed_files_snapshot_json TEXT NOT NULL CHECK (json_valid(changed_files_snapshot_json)),
      environment_snapshot_json TEXT NOT NULL CHECK (json_valid(environment_snapshot_json)),
      execution_plan_json TEXT NOT NULL CHECK (json_valid(execution_plan_json)),
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      result TEXT CHECK (
        result IS NULL OR result IN (
          'passed', 'passed_with_warnings', 'failed', 'cancelled', 'interrupted'
        )
      ),
      failure_summary TEXT,
      invalidated_at TEXT,
      invalidation_reason TEXT,
      created_at TEXT NOT NULL,
      CHECK (
        (
          authorization_scope = 'full_profile' AND source_verification_run_id IS NULL AND
          trigger <> 'retry_failed_gate'
        ) OR
        (
          authorization_scope = 'diagnostic_subset' AND source_verification_run_id IS NOT NULL AND
          trigger = 'retry_failed_gate'
        )
      ),
      UNIQUE (verification_run_id, project_id),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (worktree_id) REFERENCES projection_managed_worktrees(managed_worktree_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
      FOREIGN KEY (profile_id) REFERENCES projection_verification_profiles(verification_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (source_verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_check_runs (
      verification_check_run_id TEXT PRIMARY KEY,
      verification_run_id TEXT NOT NULL,
      gate_id TEXT NOT NULL,
      check_definition_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL,
      command_snapshot TEXT NOT NULL,
      arguments_snapshot_json TEXT NOT NULL CHECK (json_valid(arguments_snapshot_json)),
      working_directory_snapshot TEXT NOT NULL,
      selection_reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'passed', 'warned', 'failed', 'skipped', 'cancelled', 'interrupted')
      ),
      position INTEGER NOT NULL CHECK (position >= 0),
      started_at TEXT,
      completed_at TEXT,
      exit_code INTEGER,
      signal TEXT,
      duration_milliseconds INTEGER CHECK (duration_milliseconds IS NULL OR duration_milliseconds >= 0),
      timed_out INTEGER NOT NULL DEFAULT 0 CHECK (timed_out IN (0, 1)),
      result TEXT CHECK (
        result IS NULL OR result IN ('passed', 'warned', 'failed', 'skipped', 'cancelled', 'interrupted')
      ),
      failure_category TEXT CHECK (
        failure_category IS NULL OR failure_category IN (
          'source_error', 'test_failure', 'type_error', 'lint_error', 'build_error',
          'dependency_error', 'environment_error', 'timeout', 'process_crash',
          'configuration_error', 'permission_error', 'cancelled', 'unknown'
        )
      ),
      summary TEXT,
      log_reference TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (verification_run_id, check_definition_id),
      UNIQUE (verification_run_id, position),
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (gate_id) REFERENCES projection_verification_gates(verification_gate_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (check_definition_id)
        REFERENCES projection_verification_check_definitions(verification_check_definition_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_diagnostics (
      verification_diagnostic_id TEXT PRIMARY KEY,
      check_run_id TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'fatal')),
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      file_path TEXT,
      line INTEGER CHECK (line IS NULL OR line > 0),
      column_number INTEGER CHECK (column_number IS NULL OR column_number > 0),
      code TEXT,
      raw_reference TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (check_run_id)
        REFERENCES projection_verification_check_runs(verification_check_run_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_artifacts (
      verification_artifact_id TEXT PRIMARY KEY,
      verification_run_id TEXT NOT NULL,
      check_run_id TEXT,
      type TEXT NOT NULL CHECK (
        type IN (
          'log', 'report', 'coverage', 'screenshot', 'video', 'trace',
          'test_result', 'bundle_stats', 'custom'
        )
      ),
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
      checksum TEXT,
      metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (check_run_id)
        REFERENCES projection_verification_check_runs(verification_check_run_id)
        ON UPDATE CASCADE ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_repair_attempts (
      verification_repair_attempt_id TEXT PRIMARY KEY,
      verification_run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_run_id TEXT,
      attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
      failure_snapshot_json TEXT NOT NULL CHECK (json_valid(failure_snapshot_json)),
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')
      ),
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (verification_run_id, attempt_number),
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES projection_mission_tasks(task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE TABLE projection_verification_overrides (
      verification_override_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      task_id TEXT NOT NULL,
      verification_run_id TEXT,
      source_fingerprint TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE SET NULL
    )
  `;

  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'implementation' CHECK (purpose IN ('implementation', 'verification_repair'))`;
  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN repair_attempt_id TEXT REFERENCES projection_verification_repair_attempts(verification_repair_attempt_id) ON UPDATE CASCADE ON DELETE SET NULL`;

  yield* sql`
    CREATE UNIQUE INDEX idx_projection_verification_profiles_one_default
    ON projection_verification_profiles(project_id)
    WHERE is_default = 1
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_profiles_project_updated
    ON projection_verification_profiles(project_id, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_gates_profile_position
    ON projection_verification_gates(profile_id, position, verification_gate_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_checks_gate_created
    ON projection_verification_check_definitions(gate_id, created_at, verification_check_definition_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_project_created
    ON projection_verification_runs(project_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_mission_created
    ON projection_verification_runs(mission_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_task_created
    ON projection_verification_runs(task_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_worktree_status
    ON projection_verification_runs(worktree_id, status, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_status_created
    ON projection_verification_runs(status, created_at ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_source_fingerprint
    ON projection_verification_runs(task_id, source_fingerprint, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_runs_source_run
    ON projection_verification_runs(source_verification_run_id, created_at DESC)
    WHERE source_verification_run_id IS NOT NULL
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_verification_runs_one_active_per_task
    ON projection_verification_runs(task_id)
    WHERE task_id IS NOT NULL AND status IN ('queued', 'preparing', 'running', 'cancelling')
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_check_runs_run_position
    ON projection_verification_check_runs(verification_run_id, position, verification_check_run_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_check_runs_status
    ON projection_verification_check_runs(status, created_at ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_diagnostics_check_severity
    ON projection_verification_diagnostics(check_run_id, severity, created_at ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_diagnostics_file
    ON projection_verification_diagnostics(file_path, line, column_number)
    WHERE file_path IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_artifacts_run_check
    ON projection_verification_artifacts(verification_run_id, check_run_id, created_at ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_repairs_task_created
    ON projection_verification_repair_attempts(task_id, created_at ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_verification_overrides_task_created
    ON projection_verification_overrides(task_id, created_at DESC)
  `;

  yield* sql`
    CREATE TRIGGER projection_verification_runs_diagnostic_source
    BEFORE INSERT ON projection_verification_runs
    WHEN NEW.authorization_scope = 'diagnostic_subset' AND NOT EXISTS (
      SELECT 1 FROM projection_verification_runs source
      WHERE source.verification_run_id = NEW.source_verification_run_id
        AND source.authorization_scope = 'full_profile'
        AND source.status = 'failed'
        AND source.result = 'failed'
        AND source.project_id = NEW.project_id
        AND source.mission_id IS NEW.mission_id
        AND source.task_id IS NEW.task_id
        AND source.worktree_id IS NEW.worktree_id
        AND source.profile_id = NEW.profile_id
        AND source.configuration_digest = NEW.configuration_digest
        AND source.source_fingerprint = NEW.source_fingerprint
    )
    BEGIN
      SELECT RAISE(ABORT, 'diagnostic verification source is not an exact failed full-profile run');
    END
  `;

  yield* sql`
    CREATE TRIGGER projection_verification_runs_immutable_evidence
    BEFORE UPDATE ON projection_verification_runs
    WHEN
      NEW.project_id <> OLD.project_id OR
      NEW.profile_id <> OLD.profile_id OR
      NEW.authorization_scope <> OLD.authorization_scope OR
      (OLD.source_verification_run_id IS NOT NEW.source_verification_run_id) OR
      NEW.configuration_revision <> OLD.configuration_revision OR
      NEW.configuration_digest <> OLD.configuration_digest OR
      NEW.branch_name <> OLD.branch_name OR
      NEW.source_fingerprint <> OLD.source_fingerprint OR
      NEW.changed_files_snapshot_json <> OLD.changed_files_snapshot_json OR
      NEW.environment_snapshot_json <> OLD.environment_snapshot_json OR
      NEW.execution_plan_json <> OLD.execution_plan_json OR
      (OLD.commit_hash IS NOT NEW.commit_hash) OR
      (OLD.dirty_state_fingerprint IS NOT NEW.dirty_state_fingerprint) OR
      (OLD.result IS NOT NULL AND OLD.result IS NOT NEW.result)
    BEGIN
      SELECT RAISE(ABORT, 'verification run evidence is immutable');
    END
  `;

  yield* sql`
    CREATE TRIGGER projection_verification_check_runs_immutable_snapshot
    BEFORE UPDATE ON projection_verification_check_runs
    WHEN
      NEW.verification_run_id <> OLD.verification_run_id OR
      NEW.gate_id <> OLD.gate_id OR
      NEW.check_definition_id <> OLD.check_definition_id OR
      NEW.name_snapshot <> OLD.name_snapshot OR
      NEW.command_snapshot <> OLD.command_snapshot OR
      NEW.arguments_snapshot_json <> OLD.arguments_snapshot_json OR
      NEW.working_directory_snapshot <> OLD.working_directory_snapshot OR
      NEW.selection_reason <> OLD.selection_reason OR
      NEW.position <> OLD.position OR
      (OLD.result IS NOT NULL AND OLD.result IS NOT NEW.result)
    BEGIN
      SELECT RAISE(ABORT, 'verification check evidence is immutable');
    END
  `;
});
