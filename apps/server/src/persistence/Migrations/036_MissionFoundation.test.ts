import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("036_MissionFoundation clean database", (it) => {
  it.effect("creates mission projections and lookup indexes on a clean database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('projection_missions', 'projection_mission_tasks', 'projection_agent_runs')
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["projection_agent_runs", "projection_mission_tasks", "projection_missions"],
      );

      const agentRunIndexes = yield* sql<{
        readonly name: string;
        readonly partial: number;
        readonly unique: number;
      }>`
        PRAGMA index_list(projection_agent_runs)
      `;
      assert.ok(
        agentRunIndexes.some(
          (index) =>
            index.name === "idx_projection_agent_runs_one_active_per_mission" &&
            index.unique === 1 &&
            index.partial === 1,
        ),
      );

      const taskIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_mission_tasks)
      `;
      assert.ok(
        taskIndexes.some((index) => index.name === "idx_projection_mission_tasks_mission_position"),
      );

      const eventIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(orchestration_events)
      `;
      assert.ok(
        eventIndexes.some(
          (index) => index.name === "idx_orchestration_events_stream_occurred_sequence",
        ),
      );
    }),
  );
});

const existingDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

existingDatabaseLayer("036_MissionFoundation existing database", (it) => {
  it.effect("upgrades without losing orchestration history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          actor_kind,
          payload_json,
          metadata_json,
          command_id,
          correlation_id,
          causation_event_id
        ) VALUES (
          'evt-existing-before-mission-foundation',
          'project',
          'project-existing-before-mission-foundation',
          1,
          'project.created',
          '2026-08-03T00:00:00.000Z',
          'user',
          '{}',
          '{}',
          'cmd-existing-before-mission-foundation',
          'corr-existing-before-mission-foundation',
          NULL
        )
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 36 });
      assert.deepStrictEqual(executed, [[36, "MissionFoundation"]]);

      const existingEvents = yield* sql<{ readonly eventId: string }>`
        SELECT event_id AS "eventId"
        FROM orchestration_events
        WHERE event_id = 'evt-existing-before-mission-foundation'
      `;
      assert.deepStrictEqual(existingEvents, [
        { eventId: "evt-existing-before-mission-foundation" },
      ]);
    }),
  );
});
