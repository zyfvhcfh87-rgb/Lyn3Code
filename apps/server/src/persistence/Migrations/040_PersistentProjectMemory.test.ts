import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("040_PersistentProjectMemory migration", (it) => {
  it.effect("migrates a Phase 4 database with constrained durable memory and FTS", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 39 });
      const now = "2026-08-03T10:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('memory-project', 'Memory', '/repo', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_missions (
          mission_id, project_id, title, description, status, created_at, updated_at,
          started_at, completed_at, cancelled_at
        ) VALUES (
          'memory-mission', 'memory-project', 'Remember', '', 'running', ${now}, ${now},
          ${now}, NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_mission_tasks (
          task_id, mission_id, title, description, status, position, created_at, updated_at,
          started_at, completed_at
        ) VALUES (
          'memory-task', 'memory-mission', 'Persist', '', 'running', 0, ${now}, ${now},
          ${now}, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 40 });

      const requiredTables = [
        "projection_memory_entries",
        "projection_memory_sources",
        "projection_memory_relations",
        "projection_memory_proposals",
        "projection_memory_proposal_sources",
        "projection_memory_indexed_sources",
        "projection_memory_indexed_chunks",
        "projection_memory_settings",
        "projection_memory_index_operations",
        "projection_memory_lifecycle",
        "projection_memory_retrieval_records",
        "projection_memory_entries_fts",
        "projection_memory_indexed_chunks_fts",
      ];
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND ${sql.in("name", requiredTables)}
      `;
      assert.deepStrictEqual(tables.map((row) => row.name).sort(), [...requiredTables].sort());

      yield* sql`
        INSERT INTO projection_memory_entries (
          memory_entry_id, scope_type, scope_id, project_id, branch_name, mission_id,
          task_id, type, title, content, structured_data_json, trust_level, status,
          confidence, created_by_type, created_by_id, creation_mode, pinned,
          claim_fingerprint, duplicate_key, created_at, updated_at
        ) VALUES (
          'memory-a', 'project', 'memory-project', 'memory-project', NULL, NULL, NULL,
          'architecture_decision', 'Preload bridge',
          'Desktop renderer uses the preload bridge for filesystem access.', NULL,
          'verified', 'proposed', 0.95, 'user', 'maintainer', 'explicit', 0,
          'claim-a', 'duplicate-a', ${now}, ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_memory_sources (
          memory_source_id, memory_entry_id, source_type, source_identifier, project_id,
          file_path, start_line, end_line, source_status, created_at
        ) VALUES (
          'source-a', 'memory-a', 'repository_file', 'apps/desktop/src/preload.ts',
          'memory-project', 'apps/desktop/src/preload.ts', 1, 80, 'resolved', ${now}
        )
      `;
      yield* sql`
        UPDATE projection_memory_entries SET status = 'active' WHERE memory_entry_id = 'memory-a'
      `;
      const phraseMatches = yield* sql<{ readonly id: string }>`
        SELECT entry.memory_entry_id AS id
        FROM projection_memory_entries_fts AS search
        JOIN projection_memory_entries AS entry ON entry.rowid = search.rowid
        WHERE projection_memory_entries_fts MATCH '"preload bridge"'
      `;
      assert.deepStrictEqual(phraseMatches, [{ id: "memory-a" }]);

      assert.strictEqual(
        yield* Effect.isFailure(
          sql`DELETE FROM projection_memory_sources WHERE memory_source_id = 'source-a'`,
        ),
        true,
      );
      assert.strictEqual(
        yield* Effect.isFailure(sql`
          INSERT INTO projection_memory_entries (
            memory_entry_id, scope_type, scope_id, project_id, branch_name, mission_id,
            task_id, type, title, content, trust_level, status, confidence, created_by_type,
            creation_mode, pinned, claim_fingerprint, duplicate_key, created_at, updated_at
          ) VALUES (
            'bad-task-memory', 'task', 'memory-task', 'memory-project', NULL,
            'missing-mission', 'memory-task', 'custom', 'Bad', 'Bad scope', 'unverified',
            'proposed', 0.1, 'agent', 'proposed', 0, 'bad-claim', 'bad-key', ${now}, ${now}
          )
        `),
        true,
      );
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );
});
