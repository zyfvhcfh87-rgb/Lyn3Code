import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("037_MissionTeamsAndWorktrees clean database", (it) => {
  it.effect("creates the Phase 2 projections, columns, and concurrency indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 37 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'projection_agent_roles',
          'projection_mission_agents',
          'projection_task_dependencies',
          'projection_managed_worktrees',
          'projection_agent_handoffs'
        )
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        [
          "projection_agent_handoffs",
          "projection_agent_roles",
          "projection_managed_worktrees",
          "projection_mission_agents",
          "projection_task_dependencies",
        ],
      );

      const missionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_missions)
      `;
      assert.ok(missionColumns.some((column) => column.name === "maximum_concurrent_agents"));
      assert.ok(missionColumns.some((column) => column.name === "integration_mode"));

      const runIndexes = yield* sql<{
        readonly name: string;
        readonly partial: number;
        readonly unique: number;
      }>`PRAGMA index_list(projection_agent_runs)`;
      assert.ok(
        runIndexes.some(
          (index) =>
            index.name === "idx_projection_agent_runs_one_active_writer_per_worktree" &&
            index.unique === 1 &&
            index.partial === 1,
        ),
      );
      assert.ok(
        !runIndexes.some(
          (index) => index.name === "idx_projection_agent_runs_one_active_per_mission",
        ),
      );

      const builtInRoles = yield* sql<{ readonly id: string }>`
        SELECT agent_role_id AS "id"
        FROM projection_agent_roles
        ORDER BY agent_role_id
      `;
      assert.deepStrictEqual(
        builtInRoles.map((role) => role.id),
        [
          "built-in:coordinator",
          "built-in:implementer",
          "built-in:researcher",
          "built-in:reviewer",
          "built-in:verifier",
        ],
      );
    }),
  );
});

const upgradeDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

upgradeDatabaseLayer("037_MissionTeamsAndWorktrees upgrade", (it) => {
  it.effect("preserves Phase 1 rows and enforces dependency graph integrity", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 36 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-phase2', 'Phase 2', '/repo', NULL, '[]',
          '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_missions (
          mission_id, project_id, title, description, status,
          created_at, updated_at, started_at, completed_at, cancelled_at
        ) VALUES
          ('mission-phase2-a', 'project-phase2', 'A', '', 'ready',
            '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', NULL, NULL, NULL),
          ('mission-phase2-b', 'project-phase2', 'B', '', 'ready',
            '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', NULL, NULL, NULL)
      `;
      yield* sql`
        INSERT INTO projection_mission_tasks (
          task_id, mission_id, title, description, status, position,
          created_at, updated_at, started_at, completed_at
        ) VALUES
          ('task-phase2-a', 'mission-phase2-a', 'A', '', 'ready', 0,
            '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', NULL, NULL),
          ('task-phase2-b', 'mission-phase2-a', 'B', '', 'ready', 1,
            '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', NULL, NULL),
          ('task-phase2-other', 'mission-phase2-b', 'Other', '', 'ready', 0,
            '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', NULL, NULL)
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 37 });
      assert.deepStrictEqual(executed, [[37, "MissionTeamsAndWorktrees"]]);

      const upgraded = yield* sql<{
        readonly autoStart: number;
        readonly integrationMode: string;
        readonly maximumAgents: number;
      }>`
        SELECT
          maximum_concurrent_agents AS "maximumAgents",
          auto_start_ready_tasks AS "autoStart",
          integration_mode AS "integrationMode"
        FROM projection_missions
        WHERE mission_id = 'mission-phase2-a'
      `;
      assert.deepStrictEqual(upgraded, [
        { maximumAgents: 3, autoStart: 0, integrationMode: "manual" },
      ]);

      yield* sql`
        INSERT INTO projection_task_dependencies (
          task_dependency_id, mission_id, task_id, depends_on_task_id, created_at
        ) VALUES (
          'dependency-valid', 'mission-phase2-a', 'task-phase2-b', 'task-phase2-a',
          '2026-08-03T00:00:00.000Z'
        )
      `;

      const selfDependencyError = yield* Effect.flip(sql`
        INSERT INTO projection_task_dependencies (
          task_dependency_id, mission_id, task_id, depends_on_task_id, created_at
        ) VALUES (
          'dependency-self', 'mission-phase2-a', 'task-phase2-a', 'task-phase2-a',
          '2026-08-03T00:00:00.000Z'
        )
      `);
      assert.ok(selfDependencyError);

      const duplicateDependencyError = yield* Effect.flip(sql`
        INSERT INTO projection_task_dependencies (
          task_dependency_id, mission_id, task_id, depends_on_task_id, created_at
        ) VALUES (
          'dependency-duplicate', 'mission-phase2-a', 'task-phase2-b', 'task-phase2-a',
          '2026-08-03T00:00:00.000Z'
        )
      `);
      assert.ok(duplicateDependencyError);

      const crossMissionError = yield* Effect.flip(sql`
        INSERT INTO projection_task_dependencies (
          task_dependency_id, mission_id, task_id, depends_on_task_id, created_at
        ) VALUES (
          'dependency-cross-mission', 'mission-phase2-a', 'task-phase2-b', 'task-phase2-other',
          '2026-08-03T00:00:00.000Z'
        )
      `);
      assert.ok(crossMissionError);
    }),
  );
});
