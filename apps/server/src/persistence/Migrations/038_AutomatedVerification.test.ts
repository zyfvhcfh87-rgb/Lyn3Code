import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("038_AutomatedVerification clean database", (it) => {
  it.effect("creates verification evidence tables, indexes, and lifecycle columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 38 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'projection_verification_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        [
          "projection_verification_artifacts",
          "projection_verification_check_definitions",
          "projection_verification_check_runs",
          "projection_verification_diagnostics",
          "projection_verification_gates",
          "projection_verification_overrides",
          "projection_verification_profiles",
          "projection_verification_repair_attempts",
          "projection_verification_runs",
        ],
      );

      const taskColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_mission_tasks)
      `;
      assert.ok(taskColumns.some((column) => column.name === "implementation_completed_at"));
      assert.ok(taskColumns.some((column) => column.name === "verification_status"));
      assert.ok(taskColumns.some((column) => column.name === "latest_verification_run_id"));

      const runColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_agent_runs)
      `;
      assert.ok(runColumns.some((column) => column.name === "purpose"));
      assert.ok(runColumns.some((column) => column.name === "repair_attempt_id"));

      const activeIndexes = yield* sql<{
        readonly name: string;
        readonly partial: number;
        readonly unique: number;
      }>`PRAGMA index_list(projection_verification_runs)`;
      assert.ok(
        activeIndexes.some(
          (index) =>
            index.name === "idx_projection_verification_runs_one_active_per_task" &&
            index.unique === 1 &&
            index.partial === 1,
        ),
      );

      const now = "2026-08-03T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('project-settings-first', 'Settings first', '/repo', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_project_verification_settings (
          project_id, configuration_path, configuration_source, accepted_configuration_digest,
          accepted_at, accepted_by, default_profile_id, pre_integration_profile_id,
          automatic_task_verification_enabled, maximum_repair_attempts, automatic_repair_enabled,
          created_at, updated_at
        ) VALUES (
          'project-settings-first', 't3.json', 'repository', 'accepted-digest', ${now}, 'tester',
          'verification-profile:project-settings-first:standard',
          'verification-profile:project-settings-first:standard',
          1, 2, 0, ${now}, ${now}
        )
      `;
      const desiredProfiles = yield* sql<{
        readonly defaultProfileId: string;
        readonly preIntegrationProfileId: string;
      }>`
        SELECT default_profile_id AS "defaultProfileId",
          pre_integration_profile_id AS "preIntegrationProfileId"
        FROM projection_project_verification_settings
        WHERE project_id = 'project-settings-first'
      `;
      assert.deepStrictEqual(desiredProfiles, [
        {
          defaultProfileId: "verification-profile:project-settings-first:standard",
          preIntegrationProfileId: "verification-profile:project-settings-first:standard",
        },
      ]);
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );
});

const upgradeDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

upgradeDatabaseLayer("038_AutomatedVerification Phase 2 upgrade", (it) => {
  it.effect("preserves Phase 2 task relationships while extending task status", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 37 });

      const now = "2026-08-03T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('project-v38', 'V38', '/repo', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_missions (
          mission_id, project_id, title, description, status, created_at, updated_at,
          started_at, completed_at, cancelled_at
        ) VALUES ('mission-v38', 'project-v38', 'V38', '', 'running', ${now}, ${now}, ${now}, NULL, NULL)
      `;
      yield* sql`
        INSERT INTO projection_mission_tasks (
          task_id, mission_id, title, description, status, position, created_at, updated_at,
          started_at, completed_at
        ) VALUES
          ('task-v38-a', 'mission-v38', 'A', '', 'running', 0, ${now}, ${now}, ${now}, NULL),
          ('task-v38-b', 'mission-v38', 'B', '', 'ready', 1, ${now}, ${now}, NULL, NULL)
      `;
      yield* sql`
        INSERT INTO projection_task_dependencies (
          task_dependency_id, mission_id, task_id, depends_on_task_id, created_at
        ) VALUES ('dependency-v38', 'mission-v38', 'task-v38-b', 'task-v38-a', ${now})
      `;
      yield* sql`
        INSERT INTO projection_managed_worktrees (
          managed_worktree_id, project_id, mission_id, task_id, purpose, repository_path,
          worktree_path, branch_name, base_branch, base_commit, head_commit, status,
          changed_file_count, has_uncommitted_changes, conflicting_files_json,
          created_at, updated_at, removed_at, error_summary
        ) VALUES (
          'worktree-v38', 'project-v38', 'mission-v38', 'task-v38-a', 'task', '/repo',
          '/worktree', 'agent/v38', 'main', 'abc', NULL, 'ready', 0, 0, '[]',
          ${now}, ${now}, NULL, NULL
        )
      `;
      yield* sql`
        UPDATE projection_mission_tasks SET worktree_id = 'worktree-v38' WHERE task_id = 'task-v38-a'
      `;
      yield* sql`
        INSERT INTO projection_agent_runs (
          agent_run_id, mission_id, task_id, thread_id, provider, provider_instance_id,
          provider_session_id, status, created_at, updated_at, started_at, completed_at,
          error_summary, worktree_id
        ) VALUES (
          'run-v38', 'mission-v38', 'task-v38-a', 'thread-v38', 'codex', 'codex', NULL,
          'completed', ${now}, ${now}, ${now}, ${now}, NULL, 'worktree-v38'
        )
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 38 });
      assert.deepStrictEqual(executed, [[38, "AutomatedVerification"]]);

      const tasks = yield* sql<{
        readonly id: string;
        readonly status: string;
        readonly verificationStatus: string;
        readonly worktreeId: string | null;
      }>`
        SELECT task_id AS "id", status, verification_status AS "verificationStatus",
          worktree_id AS "worktreeId"
        FROM projection_mission_tasks
        WHERE mission_id = 'mission-v38'
        ORDER BY position
      `;
      assert.deepStrictEqual(tasks, [
        {
          id: "task-v38-a",
          status: "running",
          verificationStatus: "not_required",
          worktreeId: "worktree-v38",
        },
        {
          id: "task-v38-b",
          status: "ready",
          verificationStatus: "not_required",
          worktreeId: null,
        },
      ]);

      yield* sql`
        UPDATE projection_mission_tasks
        SET status = 'verification', verification_status = 'queued'
        WHERE task_id = 'task-v38-a'
      `;

      const relationships = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT count(*) FROM projection_task_dependencies WHERE task_dependency_id = 'dependency-v38') +
          (SELECT count(*) FROM projection_managed_worktrees WHERE managed_worktree_id = 'worktree-v38') +
          (SELECT count(*) FROM projection_agent_runs WHERE agent_run_id = 'run-v38') AS count
      `;
      assert.deepStrictEqual(relationships, [{ count: 3 }]);
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );
});
