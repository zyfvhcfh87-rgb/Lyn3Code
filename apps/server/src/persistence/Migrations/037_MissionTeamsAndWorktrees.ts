import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_missions ADD COLUMN maximum_concurrent_agents INTEGER NOT NULL DEFAULT 3 CHECK (maximum_concurrent_agents > 0)`;
  yield* sql`ALTER TABLE projection_missions ADD COLUMN maximum_concurrent_write_agents INTEGER NOT NULL DEFAULT 2 CHECK (maximum_concurrent_write_agents > 0 AND maximum_concurrent_write_agents <= maximum_concurrent_agents)`;
  yield* sql`ALTER TABLE projection_missions ADD COLUMN default_maximum_task_attempts INTEGER NOT NULL DEFAULT 3 CHECK (default_maximum_task_attempts > 0)`;
  yield* sql`ALTER TABLE projection_missions ADD COLUMN auto_start_ready_tasks INTEGER NOT NULL DEFAULT 0 CHECK (auto_start_ready_tasks IN (0, 1))`;
  yield* sql`ALTER TABLE projection_missions ADD COLUMN integration_mode TEXT NOT NULL DEFAULT 'manual' CHECK (integration_mode IN ('manual', 'sequential', 'automatic_when_clean'))`;
  yield* sql`ALTER TABLE projection_missions ADD COLUMN scheduler_status TEXT NOT NULL DEFAULT 'idle' CHECK (scheduler_status IN ('idle', 'running', 'paused'))`;

  yield* sql`
    CREATE TABLE projection_agent_roles (
      agent_role_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (
        kind IN ('coordinator', 'implementer', 'researcher', 'reviewer', 'verifier', 'custom')
      ),
      default_permissions_json TEXT NOT NULL CHECK (json_valid(default_permissions_json)),
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO projection_agent_roles (
      agent_role_id, name, kind, default_permissions_json, description, created_at, updated_at
    ) VALUES
      (
        'built-in:coordinator',
        'Coordinator',
        'coordinator',
        '["read_files","search_repository","run_safe_commands","manage_tasks"]',
        'Plans and coordinates mission work without source-write permission.',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z'
      ),
      (
        'built-in:implementer',
        'Implementer',
        'implementer',
        '["read_files","search_repository","run_safe_commands","run_tests","write_files","create_commits"]',
        'Implements an assigned task inside its managed worktree.',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z'
      ),
      (
        'built-in:researcher',
        'Researcher',
        'researcher',
        '["read_files","search_repository","run_safe_commands"]',
        'Investigates the repository with read-only permissions.',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z'
      ),
      (
        'built-in:reviewer',
        'Reviewer',
        'reviewer',
        '["read_files","search_repository","run_tests"]',
        'Reviews changes and may run existing checks without writing.',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z'
      ),
      (
        'built-in:verifier',
        'Verifier',
        'verifier',
        '["read_files","search_repository","run_tests"]',
        'Runs lightweight verification and reports results without writing.',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z'
      )
  `;

  yield* sql`
    CREATE TABLE projection_mission_agents (
      mission_agent_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      role_id TEXT,
      role_kind TEXT NOT NULL CHECK (
        role_kind IN ('coordinator', 'implementer', 'researcher', 'reviewer', 'verifier', 'custom')
      ),
      display_name TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      model TEXT,
      reasoning_level TEXT,
      permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
      maximum_concurrent_runs INTEGER NOT NULL CHECK (maximum_concurrent_runs > 0),
      status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'disabled', 'unavailable')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (mission_id, mission_agent_id),
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES projection_agent_roles(agent_role_id)
        ON UPDATE CASCADE ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE TABLE projection_managed_worktrees (
      managed_worktree_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      task_id TEXT,
      purpose TEXT NOT NULL CHECK (purpose IN ('integration', 'task')),
      repository_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL UNIQUE,
      branch_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      head_commit TEXT,
      status TEXT NOT NULL CHECK (
        status IN (
          'planned',
          'creating',
          'ready',
          'active',
          'dirty',
          'conflicted',
          'integration_ready',
          'integrated',
          'removing',
          'removed',
          'failed',
          'orphaned'
        )
      ),
      changed_file_count INTEGER NOT NULL DEFAULT 0 CHECK (changed_file_count >= 0),
      has_uncommitted_changes INTEGER NOT NULL DEFAULT 0 CHECK (has_uncommitted_changes IN (0, 1)),
      conflicting_files_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflicting_files_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT,
      error_summary TEXT,
      UNIQUE (repository_path, branch_name),
      UNIQUE (mission_id, managed_worktree_id),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN assigned_mission_agent_id TEXT REFERENCES projection_mission_agents(mission_agent_id) ON UPDATE CASCADE ON DELETE SET NULL`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN worktree_id TEXT REFERENCES projection_managed_worktrees(managed_worktree_id) ON UPDATE CASCADE ON DELETE SET NULL`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN maximum_attempts INTEGER NOT NULL DEFAULT 3 CHECK (maximum_attempts > 0)`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN ready_at TEXT`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN blocked_reason TEXT`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN integration_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (integration_status IN ('not_requested', 'pending', 'ready', 'integrating', 'integrated', 'conflicted', 'failed'))`;
  yield* sql`ALTER TABLE projection_mission_tasks ADD COLUMN requires_dependency_handoffs INTEGER NOT NULL DEFAULT 1 CHECK (requires_dependency_handoffs IN (0, 1))`;

  yield* sql`
    CREATE TABLE projection_task_dependencies (
      task_dependency_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (task_id <> depends_on_task_id),
      UNIQUE (mission_id, task_id, depends_on_task_id),
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, depends_on_task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN mission_agent_id TEXT REFERENCES projection_mission_agents(mission_agent_id) ON UPDATE CASCADE ON DELETE SET NULL`;
  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN worktree_id TEXT REFERENCES projection_managed_worktrees(managed_worktree_id) ON UPDATE CASCADE ON DELETE SET NULL`;
  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0)`;
  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '["read_files","search_repository","run_safe_commands","run_tests","write_files","create_commits","manage_tasks","manage_worktrees","integrate_branches"]' CHECK (json_valid(permissions_json))`;
  yield* sql`ALTER TABLE projection_agent_runs ADD COLUMN write_capable INTEGER NOT NULL DEFAULT 1 CHECK (write_capable IN (0, 1))`;

  yield* sql`
    CREATE TABLE projection_agent_handoffs (
      agent_handoff_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      from_mission_agent_id TEXT NOT NULL,
      to_mission_agent_id TEXT,
      summary TEXT NOT NULL,
      decisions_json TEXT NOT NULL CHECK (json_valid(decisions_json)),
      changed_files_json TEXT NOT NULL CHECK (json_valid(changed_files_json)),
      commands_run_json TEXT NOT NULL CHECK (json_valid(commands_run_json)),
      unresolved_problems_json TEXT NOT NULL CHECK (json_valid(unresolved_problems_json)),
      recommended_next_action TEXT NOT NULL,
      artifacts_json TEXT NOT NULL CHECK (json_valid(artifacts_json)),
      reconciliation_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        reconciliation_status IN ('pending', 'matched', 'corrected')
      ),
      reconciled_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (mission_id, agent_handoff_id),
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (from_mission_agent_id) REFERENCES projection_mission_agents(mission_agent_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (to_mission_agent_id) REFERENCES projection_mission_agents(mission_agent_id)
        ON UPDATE CASCADE ON DELETE SET NULL
    )
  `;

  yield* sql`DROP INDEX idx_projection_agent_runs_one_active_per_mission`;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_agent_runs_one_active_writer_per_worktree
    ON projection_agent_runs(worktree_id)
    WHERE worktree_id IS NOT NULL
      AND write_capable = 1
      AND status IN ('starting', 'running', 'cancelling')
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_managed_worktrees_one_live_task_worktree
    ON projection_managed_worktrees(mission_id, task_id)
    WHERE task_id IS NOT NULL
      AND status NOT IN ('integrated', 'removed', 'failed', 'orphaned')
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_managed_worktrees_one_live_integration_worktree
    ON projection_managed_worktrees(mission_id)
    WHERE purpose = 'integration'
      AND status NOT IN ('integrated', 'removed', 'failed', 'orphaned')
  `;
  yield* sql`
    CREATE INDEX idx_projection_mission_agents_mission_status
    ON projection_mission_agents(mission_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_task_dependencies_mission_task
    ON projection_task_dependencies(mission_id, task_id, depends_on_task_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_managed_worktrees_mission_status
    ON projection_managed_worktrees(mission_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_agent_handoffs_mission_task_created
    ON projection_agent_handoffs(mission_id, task_id, created_at ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_agent_runs_mission_agent_status
    ON projection_agent_runs(mission_agent_id, status, updated_at DESC)
  `;
});
