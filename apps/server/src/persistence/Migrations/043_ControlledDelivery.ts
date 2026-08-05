import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_delivery_policies (
      delivery_policy_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      version INTEGER NOT NULL CHECK (version > 0),
      policy_digest TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      merge_policy_json TEXT NOT NULL CHECK (json_valid(merge_policy_json)),
      release_policy_json TEXT NOT NULL CHECK (json_valid(release_policy_json)),
      deployment_policy_json TEXT NOT NULL CHECK (json_valid(deployment_policy_json)),
      rollback_policy_json TEXT NOT NULL CHECK (json_valid(rollback_policy_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, name, version),
      UNIQUE (project_id, delivery_policy_id),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_policies_project_enabled
    ON projection_delivery_policies(project_id, enabled, updated_at DESC)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_delivery_policies_one_default
    ON projection_delivery_policies(project_id)
    WHERE is_default = 1
  `;

  yield* sql`
    CREATE TABLE projection_delivery_merge_assessments (
      merge_readiness_assessment_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      mission_id TEXT,
      repository_connection_id TEXT NOT NULL,
      pull_request_record_id TEXT NOT NULL,
      delivery_policy_id TEXT NOT NULL,
      policy_digest TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      source_commit TEXT NOT NULL CHECK (source_commit = head_sha),
      source_fingerprint TEXT NOT NULL,
      verification_run_id TEXT,
      result TEXT NOT NULL CHECK (result IN ('ready', 'ready_with_warnings', 'blocked', 'unknown', 'stale')),
      states_json TEXT NOT NULL CHECK (json_valid(states_json)),
      blocking_reasons_json TEXT NOT NULL CHECK (json_valid(blocking_reasons_json)),
      warning_reasons_json TEXT NOT NULL CHECK (json_valid(warning_reasons_json)),
      evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json)),
      observed_at TEXT NOT NULL,
      expires_at TEXT,
      invalidated_at TEXT,
      UNIQUE (pull_request_record_id, policy_digest, source_fingerprint),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (repository_connection_id)
        REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (pull_request_record_id)
        REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (delivery_policy_id) REFERENCES projection_delivery_policies(delivery_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_merge_assessments_pr_observed
    ON projection_delivery_merge_assessments(pull_request_record_id, observed_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_merge_assessments_recovery
    ON projection_delivery_merge_assessments(result, invalidated_at, expires_at, observed_at)
    WHERE invalidated_at IS NULL AND result IN ('ready', 'ready_with_warnings', 'blocked', 'unknown')
  `;

  yield* sql`
    CREATE TABLE projection_delivery_approval_requests (
      approval_request_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      mission_id TEXT,
      delivery_policy_id TEXT NOT NULL,
      approval_type TEXT NOT NULL CHECK (approval_type IN ('merge', 'release', 'deployment', 'production_deployment', 'rollback', 'destructive_cleanup')),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      plan_digest TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'cancelled', 'expired')),
      required_decision_count INTEGER NOT NULL CHECK (required_decision_count > 0),
      policy_snapshot_json TEXT NOT NULL CHECK (json_valid(policy_snapshot_json)),
      context_snapshot_json TEXT NOT NULL CHECK (json_valid(context_snapshot_json)),
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      expires_at TEXT,
      UNIQUE (approval_type, target_type, target_id, plan_digest, source_commit),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (delivery_policy_id) REFERENCES projection_delivery_policies(delivery_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_approval_requests_project_status
    ON projection_delivery_approval_requests(project_id, status, requested_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_approval_requests_recovery
    ON projection_delivery_approval_requests(requested_at, approval_request_id)
    WHERE status = 'pending'
  `;
  yield* sql`
    CREATE TABLE projection_delivery_approval_decisions (
      approval_decision_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      approval_request_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'team', 'system')),
      decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes')),
      reason TEXT,
      plan_digest TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      UNIQUE (approval_request_id, actor_id),
      FOREIGN KEY (approval_request_id)
        REFERENCES projection_delivery_approval_requests(approval_request_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_approval_decisions_request_decided
    ON projection_delivery_approval_decisions(approval_request_id, decided_at, approval_decision_id)
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_approval_decisions_source_insert
    BEFORE INSERT ON projection_delivery_approval_decisions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_approval_requests request
      WHERE request.approval_request_id = NEW.approval_request_id
        AND request.plan_digest = NEW.plan_digest
        AND request.source_commit = NEW.source_commit
        AND request.status = 'pending'
    )
    BEGIN SELECT RAISE(ABORT, 'approval decision does not match a pending source-bound request'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_approval_decisions_immutable_update
    BEFORE UPDATE ON projection_delivery_approval_decisions
    BEGIN SELECT RAISE(ABORT, 'approval decisions are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_approval_decisions_immutable_delete
    BEFORE DELETE ON projection_delivery_approval_decisions
    BEGIN SELECT RAISE(ABORT, 'approval decisions are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_approval_requests_evidence_immutable
    BEFORE UPDATE ON projection_delivery_approval_requests
    WHEN EXISTS (
      SELECT 1 FROM projection_delivery_approval_decisions decision
      WHERE decision.approval_request_id = OLD.approval_request_id
    ) AND (
      NEW.project_id IS NOT OLD.project_id OR NEW.mission_id IS NOT OLD.mission_id OR
      NEW.delivery_policy_id IS NOT OLD.delivery_policy_id OR NEW.approval_type IS NOT OLD.approval_type OR
      NEW.target_type IS NOT OLD.target_type OR NEW.target_id IS NOT OLD.target_id OR
      NEW.plan_digest IS NOT OLD.plan_digest OR NEW.source_commit IS NOT OLD.source_commit OR
      NEW.required_decision_count IS NOT OLD.required_decision_count OR
      NEW.policy_snapshot_json IS NOT OLD.policy_snapshot_json OR
      NEW.context_snapshot_json IS NOT OLD.context_snapshot_json OR
      NEW.requested_by IS NOT OLD.requested_by OR NEW.requested_at IS NOT OLD.requested_at
    )
    BEGIN SELECT RAISE(ABORT, 'decided approval request evidence is immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_merge_executions (
      merge_execution_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      idempotency_key TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      repository_connection_id TEXT NOT NULL,
      pull_request_record_id TEXT NOT NULL,
      readiness_assessment_id TEXT NOT NULL,
      approval_request_id TEXT,
      delivery_policy_id TEXT NOT NULL,
      merge_strategy TEXT NOT NULL CHECK (merge_strategy IN ('merge_commit', 'squash', 'rebase')),
      expected_head_sha TEXT NOT NULL,
      expected_base_sha TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'validating', 'succeeded', 'succeeded_with_warnings', 'failed', 'cancelled', 'interrupted', 'indeterminate', 'rolled_back')),
      remote_merge_sha TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (repository_connection_id) REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (pull_request_record_id) REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (readiness_assessment_id) REFERENCES projection_delivery_merge_assessments(merge_readiness_assessment_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (approval_request_id) REFERENCES projection_delivery_approval_requests(approval_request_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (delivery_policy_id) REFERENCES projection_delivery_policies(delivery_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_merge_executions_project_created
    ON projection_delivery_merge_executions(project_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_merge_executions_recovery
    ON projection_delivery_merge_executions(status, created_at, merge_execution_id)
    WHERE status IN ('queued', 'preparing', 'running', 'interrupted', 'indeterminate')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_merge_executions_source_insert
    BEFORE INSERT ON projection_delivery_merge_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_merge_assessments assessment
      WHERE assessment.merge_readiness_assessment_id = NEW.readiness_assessment_id
        AND assessment.project_id = NEW.project_id
        AND assessment.repository_connection_id = NEW.repository_connection_id
        AND assessment.pull_request_record_id = NEW.pull_request_record_id
        AND assessment.delivery_policy_id = NEW.delivery_policy_id
        AND assessment.head_sha = NEW.expected_head_sha
        AND assessment.base_sha = NEW.expected_base_sha
        AND assessment.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'merge execution does not match readiness source'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_merge_executions_source_update
    BEFORE UPDATE ON projection_delivery_merge_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_merge_assessments assessment
      WHERE assessment.merge_readiness_assessment_id = NEW.readiness_assessment_id
        AND assessment.project_id = NEW.project_id
        AND assessment.repository_connection_id = NEW.repository_connection_id
        AND assessment.pull_request_record_id = NEW.pull_request_record_id
        AND assessment.delivery_policy_id = NEW.delivery_policy_id
        AND assessment.head_sha = NEW.expected_head_sha
        AND assessment.base_sha = NEW.expected_base_sha
        AND assessment.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'merge execution does not match readiness source'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_release_configurations (
      release_configuration_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      repository TEXT NOT NULL,
      release_channel TEXT NOT NULL,
      tag_pattern TEXT NOT NULL,
      artifact_globs_json TEXT NOT NULL CHECK (json_valid(artifact_globs_json)),
      version_strategy TEXT NOT NULL CHECK (version_strategy IN ('manual', 'semantic_explicit', 'semantic_from_changes', 'calendar', 'repository_script')),
      version_source TEXT NOT NULL CHECK (version_source IN ('package', 'git_tag', 'manifest', 'manual', 'custom')),
      changelog_mode TEXT NOT NULL CHECK (changelog_mode IN ('generated', 'provided', 'none')),
      artifact_configuration_json TEXT NOT NULL CHECK (json_valid(artifact_configuration_json)),
      github_release_enabled INTEGER NOT NULL CHECK (github_release_enabled IN (0, 1)),
      package_publishing_enabled INTEGER NOT NULL CHECK (package_publishing_enabled IN (0, 1)),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      version INTEGER NOT NULL CHECK (version > 0),
      configuration_digest TEXT NOT NULL,
      public_metadata_json TEXT NOT NULL CHECK (json_valid(public_metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, name, version),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_release_configurations_project_enabled
    ON projection_delivery_release_configurations(project_id, enabled, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_delivery_release_plans (
      release_plan_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      mission_id TEXT,
      release_configuration_id TEXT NOT NULL,
      delivery_policy_id TEXT NOT NULL,
      plan_digest TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      version TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      release_name TEXT NOT NULL,
      source_branch TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      changelog_draft TEXT NOT NULL,
      release_notes_draft TEXT NOT NULL,
      included_missions_json TEXT NOT NULL CHECK (json_valid(included_missions_json)),
      included_pull_requests_json TEXT NOT NULL CHECK (json_valid(included_pull_requests_json)),
      artifact_plan_json TEXT NOT NULL CHECK (json_valid(artifact_plan_json)),
      publication_plan_json TEXT NOT NULL CHECK (json_valid(publication_plan_json)),
      status TEXT NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'executing', 'completed', 'superseded', 'cancelled', 'failed', 'interrupted')),
      approval_request_id TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (release_configuration_id, plan_digest, source_commit),
      UNIQUE (release_configuration_id, tag_name),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (release_configuration_id) REFERENCES projection_delivery_release_configurations(release_configuration_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (delivery_policy_id) REFERENCES projection_delivery_policies(delivery_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (approval_request_id) REFERENCES projection_delivery_approval_requests(approval_request_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_release_plans_project_created
    ON projection_delivery_release_plans(project_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_release_plans_recovery
    ON projection_delivery_release_plans(status, updated_at, release_plan_id)
    WHERE status IN ('pending_approval', 'approved', 'executing', 'interrupted')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_release_plans_approved_immutable
    BEFORE UPDATE ON projection_delivery_release_plans
    WHEN OLD.status IN ('approved', 'executing', 'completed') AND (
      NEW.project_id IS NOT OLD.project_id OR NEW.mission_id IS NOT OLD.mission_id OR
      NEW.release_configuration_id IS NOT OLD.release_configuration_id OR
      NEW.delivery_policy_id IS NOT OLD.delivery_policy_id OR
      NEW.plan_digest IS NOT OLD.plan_digest OR NEW.source_commit IS NOT OLD.source_commit OR
      NEW.version IS NOT OLD.version OR NEW.tag_name IS NOT OLD.tag_name OR
      NEW.release_name IS NOT OLD.release_name OR NEW.source_branch IS NOT OLD.source_branch OR
      NEW.change_summary IS NOT OLD.change_summary OR NEW.changelog_draft IS NOT OLD.changelog_draft OR
      NEW.release_notes_draft IS NOT OLD.release_notes_draft OR
      NEW.included_missions_json IS NOT OLD.included_missions_json OR
      NEW.included_pull_requests_json IS NOT OLD.included_pull_requests_json OR
      NEW.artifact_plan_json IS NOT OLD.artifact_plan_json OR
      NEW.publication_plan_json IS NOT OLD.publication_plan_json OR
      NEW.approval_request_id IS NOT OLD.approval_request_id
    )
    BEGIN SELECT RAISE(ABORT, 'approved release plans are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_release_artifacts (
      release_artifact_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      release_plan_id TEXT NOT NULL,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      checksum TEXT,
      size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
      content_type TEXT,
      source_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned', 'collected', 'published', 'failed')),
      remote_url TEXT,
      created_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE (release_plan_id, relative_path),
      FOREIGN KEY (release_plan_id) REFERENCES projection_delivery_release_plans(release_plan_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_release_artifacts_plan_status
    ON projection_delivery_release_artifacts(release_plan_id, status, created_at)
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_release_artifacts_source_insert
    BEFORE INSERT ON projection_delivery_release_artifacts
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_release_plans plan
      WHERE plan.release_plan_id = NEW.release_plan_id AND plan.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'release artifact source does not match plan'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_release_artifacts_source_update
    BEFORE UPDATE ON projection_delivery_release_artifacts
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_release_plans plan
      WHERE plan.release_plan_id = NEW.release_plan_id AND plan.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'release artifact source does not match plan'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_environments (
      deployment_environment_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('local', 'development', 'staging', 'production')),
      kind TEXT NOT NULL CHECK (kind IN ('preview', 'development', 'staging', 'production', 'custom')),
      provider TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      provider_connection_reference TEXT,
      external_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'unavailable')),
      protected INTEGER NOT NULL CHECK (protected IN (0, 1)),
      requires_approval INTEGER NOT NULL CHECK (requires_approval IN (0, 1)),
      required_approval_count INTEGER NOT NULL CHECK (required_approval_count >= 0),
      configuration_digest TEXT NOT NULL,
      public_metadata_json TEXT NOT NULL CHECK (json_valid(public_metadata_json)),
      window_policy_json TEXT NOT NULL CHECK (json_valid(window_policy_json)),
      configuration_metadata_json TEXT NOT NULL CHECK (json_valid(configuration_metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, name),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_environments_project_tier
    ON projection_delivery_environments(project_id, tier, name)
  `;

  yield* sql`
    CREATE TABLE projection_delivery_deployment_plans (
      deployment_plan_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      mission_id TEXT,
      release_plan_id TEXT,
      deployment_environment_id TEXT NOT NULL,
      delivery_policy_id TEXT NOT NULL,
      plan_digest TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('release', 'commit', 'branch', 'artifact', 'provider')),
      source_reference TEXT NOT NULL,
      strategy TEXT NOT NULL CHECK (strategy IN ('standard', 'rolling', 'canary', 'blue_green', 'provider_default', 'custom')),
      configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
      configuration_snapshot_json TEXT NOT NULL CHECK (json_valid(configuration_snapshot_json)),
      validation_profile_id TEXT,
      rollback_plan_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'executing', 'completed', 'superseded', 'cancelled', 'failed', 'interrupted')),
      approval_request_id TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (deployment_environment_id, plan_digest, source_commit),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (release_plan_id) REFERENCES projection_delivery_release_plans(release_plan_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (deployment_environment_id) REFERENCES projection_delivery_environments(deployment_environment_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (delivery_policy_id) REFERENCES projection_delivery_policies(delivery_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (approval_request_id) REFERENCES projection_delivery_approval_requests(approval_request_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (validation_profile_id) REFERENCES projection_verification_profiles(verification_profile_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_deployment_plans_project_created
    ON projection_delivery_deployment_plans(project_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_deployment_plans_recovery
    ON projection_delivery_deployment_plans(status, updated_at, deployment_plan_id)
    WHERE status IN ('pending_approval', 'approved', 'executing', 'interrupted')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_deployment_plans_approved_immutable
    BEFORE UPDATE ON projection_delivery_deployment_plans
    WHEN OLD.status IN ('approved', 'executing', 'completed') AND (
      NEW.project_id IS NOT OLD.project_id OR NEW.mission_id IS NOT OLD.mission_id OR
      NEW.release_plan_id IS NOT OLD.release_plan_id OR
      NEW.deployment_environment_id IS NOT OLD.deployment_environment_id OR
      NEW.delivery_policy_id IS NOT OLD.delivery_policy_id OR
      NEW.plan_digest IS NOT OLD.plan_digest OR NEW.source_commit IS NOT OLD.source_commit OR
      NEW.source_type IS NOT OLD.source_type OR NEW.source_reference IS NOT OLD.source_reference OR
      NEW.strategy IS NOT OLD.strategy OR NEW.configuration_json IS NOT OLD.configuration_json OR
      NEW.configuration_snapshot_json IS NOT OLD.configuration_snapshot_json OR
      NEW.validation_profile_id IS NOT OLD.validation_profile_id OR NEW.rollback_plan_id IS NOT OLD.rollback_plan_id OR
      NEW.approval_request_id IS NOT OLD.approval_request_id
    )
    BEGIN SELECT RAISE(ABORT, 'approved deployment plans are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_deployment_executions (
      deployment_execution_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      deployment_plan_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
      source_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'validating', 'succeeded', 'succeeded_with_warnings', 'failed', 'cancelled', 'interrupted', 'indeterminate', 'rolled_back')),
      provider_state_json TEXT NOT NULL CHECK (json_valid(provider_state_json)),
      remote_execution_id TEXT,
      endpoint TEXT,
      deployment_url TEXT,
      log_reference TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (deployment_plan_id) REFERENCES projection_delivery_deployment_plans(deployment_plan_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_deployment_executions_plan_created
    ON projection_delivery_deployment_executions(deployment_plan_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_deployment_executions_recovery
    ON projection_delivery_deployment_executions(status, created_at, deployment_execution_id)
    WHERE status IN ('queued', 'preparing', 'running', 'interrupted', 'indeterminate')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_deployment_executions_source_insert
    BEFORE INSERT ON projection_delivery_deployment_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_deployment_plans plan
      WHERE plan.deployment_plan_id = NEW.deployment_plan_id AND plan.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'deployment execution source does not match plan'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_deployment_executions_source_update
    BEFORE UPDATE ON projection_delivery_deployment_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_deployment_plans plan
      WHERE plan.deployment_plan_id = NEW.deployment_plan_id AND plan.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'deployment execution source does not match plan'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_validation_runs (
      deployment_validation_run_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      deployment_execution_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'cancelled', 'interrupted')),
      result TEXT CHECK (result IS NULL OR result IN ('passed', 'passed_with_warnings', 'failed', 'unknown')),
      source_commit TEXT NOT NULL,
      evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE (deployment_execution_id, kind),
      FOREIGN KEY (deployment_execution_id) REFERENCES projection_delivery_deployment_executions(deployment_execution_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_validation_runs_execution_status
    ON projection_delivery_validation_runs(deployment_execution_id, status, created_at)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_validation_runs_recovery
    ON projection_delivery_validation_runs(status, created_at, deployment_validation_run_id)
    WHERE status IN ('pending', 'running', 'interrupted')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_validation_runs_source_insert
    BEFORE INSERT ON projection_delivery_validation_runs
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_deployment_executions execution
      WHERE execution.deployment_execution_id = NEW.deployment_execution_id
        AND execution.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'deployment validation source does not match execution'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_validation_runs_source_update
    BEFORE UPDATE ON projection_delivery_validation_runs
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_deployment_executions execution
      WHERE execution.deployment_execution_id = NEW.deployment_execution_id
        AND execution.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'deployment validation source does not match execution'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_rollback_plans (
      rollback_plan_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      mission_id TEXT,
      deployment_execution_id TEXT NOT NULL,
      deployment_environment_id TEXT NOT NULL,
      delivery_policy_id TEXT NOT NULL,
      target_deployment_execution_id TEXT,
      plan_digest TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      restore_source_commit TEXT NOT NULL,
      rollback_type TEXT NOT NULL CHECK (rollback_type IN ('provider_rollback', 'previous_release', 'previous_deployment', 'git_revert', 'redeploy_known_good', 'manual')),
      target_reference TEXT NOT NULL,
      reversibility TEXT NOT NULL CHECK (reversibility IN ('reversible', 'best_effort', 'irreversible', 'unknown')),
      requires_approval INTEGER NOT NULL CHECK (requires_approval IN (0, 1)),
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'executing', 'completed', 'superseded', 'cancelled', 'failed', 'interrupted')),
      approval_request_id TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (deployment_execution_id, plan_digest, source_commit),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (deployment_execution_id) REFERENCES projection_delivery_deployment_executions(deployment_execution_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (deployment_environment_id) REFERENCES projection_delivery_environments(deployment_environment_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (delivery_policy_id) REFERENCES projection_delivery_policies(delivery_policy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (target_deployment_execution_id) REFERENCES projection_delivery_deployment_executions(deployment_execution_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (approval_request_id) REFERENCES projection_delivery_approval_requests(approval_request_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_rollback_plans_project_created
    ON projection_delivery_rollback_plans(project_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_rollback_plans_recovery
    ON projection_delivery_rollback_plans(status, updated_at, rollback_plan_id)
    WHERE status IN ('pending_approval', 'approved', 'executing', 'interrupted')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_rollback_plans_approved_immutable
    BEFORE UPDATE ON projection_delivery_rollback_plans
    WHEN OLD.status IN ('approved', 'executing', 'completed') AND (
      NEW.project_id IS NOT OLD.project_id OR NEW.mission_id IS NOT OLD.mission_id OR
      NEW.deployment_execution_id IS NOT OLD.deployment_execution_id OR
      NEW.deployment_environment_id IS NOT OLD.deployment_environment_id OR
      NEW.delivery_policy_id IS NOT OLD.delivery_policy_id OR
      NEW.target_deployment_execution_id IS NOT OLD.target_deployment_execution_id OR
      NEW.plan_digest IS NOT OLD.plan_digest OR NEW.source_commit IS NOT OLD.source_commit OR
      NEW.restore_source_commit IS NOT OLD.restore_source_commit OR NEW.rollback_type IS NOT OLD.rollback_type OR
      NEW.target_reference IS NOT OLD.target_reference OR NEW.reversibility IS NOT OLD.reversibility OR
      NEW.requires_approval IS NOT OLD.requires_approval OR NEW.reason IS NOT OLD.reason OR
      NEW.approval_request_id IS NOT OLD.approval_request_id
    )
    BEGIN SELECT RAISE(ABORT, 'approved rollback plans are immutable'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_rollback_executions (
      rollback_execution_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      rollback_plan_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      source_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'validating', 'succeeded', 'succeeded_with_warnings', 'failed', 'cancelled', 'interrupted', 'indeterminate', 'rolled_back')),
      remote_execution_id TEXT,
      result_reference TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (rollback_plan_id) REFERENCES projection_delivery_rollback_plans(rollback_plan_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_rollback_executions_plan_created
    ON projection_delivery_rollback_executions(rollback_plan_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_rollback_executions_recovery
    ON projection_delivery_rollback_executions(status, created_at, rollback_execution_id)
    WHERE status IN ('queued', 'preparing', 'running', 'interrupted', 'indeterminate')
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_rollback_executions_source_insert
    BEFORE INSERT ON projection_delivery_rollback_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_rollback_plans plan
      WHERE plan.rollback_plan_id = NEW.rollback_plan_id AND plan.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'rollback execution source does not match plan'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_rollback_executions_source_update
    BEFORE UPDATE ON projection_delivery_rollback_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM projection_delivery_rollback_plans plan
      WHERE plan.rollback_plan_id = NEW.rollback_plan_id AND plan.source_commit = NEW.source_commit
    )
    BEGIN SELECT RAISE(ABORT, 'rollback execution source does not match plan'); END
  `;

  yield* sql`
    CREATE TABLE projection_delivery_audit_entries (
      delivery_audit_entry_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(record_json) <= 1048576),
      project_id TEXT NOT NULL,
      mission_id TEXT,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system')),
      actor_id TEXT,
      source_commit TEXT,
      public_metadata_json TEXT NOT NULL CHECK (json_valid(public_metadata_json)),
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_delivery_audit_entries_project_occurred
    ON projection_delivery_audit_entries(project_id, occurred_at DESC, delivery_audit_entry_id)
  `;
  yield* sql`
    CREATE INDEX idx_delivery_audit_entries_aggregate
    ON projection_delivery_audit_entries(aggregate_type, aggregate_id, occurred_at DESC)
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_audit_entries_immutable_update
    BEFORE UPDATE ON projection_delivery_audit_entries
    BEGIN SELECT RAISE(ABORT, 'delivery audit entries are immutable'); END
  `;
  yield* sql`
    CREATE TRIGGER projection_delivery_audit_entries_immutable_delete
    BEFORE DELETE ON projection_delivery_audit_entries
    BEGIN SELECT RAISE(ABORT, 'delivery audit entries are immutable'); END
  `;
});
