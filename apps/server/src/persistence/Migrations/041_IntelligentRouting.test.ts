import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("041_IntelligentRouting migration", (it) => {
  it.effect("preserves Phase 5 data and enforces immutable routed-run history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 40 });
      const now = "2026-08-03T12:00:00.000Z";
      const later = "2026-08-03T12:01:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('routing-project', 'Routing', '/routing', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_missions (
          mission_id, project_id, title, description, status, created_at, updated_at,
          started_at, completed_at, cancelled_at
        ) VALUES (
          'routing-mission', 'routing-project', 'Route', '', 'running', ${now}, ${now},
          ${now}, NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_mission_tasks (
          task_id, mission_id, title, description, status, position, created_at, updated_at,
          started_at, completed_at
        ) VALUES (
          'routing-task', 'routing-mission', 'Choose', '', 'running', 0, ${now}, ${now},
          ${now}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_agent_runs (
          agent_run_id, mission_id, task_id, thread_id, provider, provider_instance_id,
          provider_session_id, status, created_at, updated_at, started_at, completed_at,
          error_summary
        ) VALUES (
          'legacy-run', 'routing-mission', 'routing-task', 'legacy-thread', 'codex', 'codex',
          NULL, 'completed', ${now}, ${now}, ${now}, ${now}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_memory_entries (
          memory_entry_id, scope_type, scope_id, project_id, branch_name, mission_id,
          task_id, type, title, content, structured_data_json, trust_level, status,
          confidence, created_by_type, created_by_id, creation_mode, pinned,
          claim_fingerprint, duplicate_key, created_at, updated_at
        ) VALUES (
          'routing-memory', 'project', 'routing-project', 'routing-project', NULL, NULL, NULL,
          'architecture_decision', 'Routing identity', 'Provider instance ids remain canonical.',
          NULL, 'verified', 'proposed', 1, 'user', 'maintainer', 'explicit', 0,
          'routing-identity', 'routing-identity', ${now}, ${now}
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 41 });

      const requiredTables = [
        "projection_routing_provider_profiles",
        "projection_routing_model_profiles",
        "projection_routing_model_capability_snapshots",
        "projection_routing_policies",
        "projection_routing_rules",
        "projection_agent_role_routing_profiles",
        "projection_task_routing_assessments",
        "projection_routing_decisions",
        "projection_routing_candidate_records",
        "projection_provider_health_records",
        "projection_routing_overrides",
        "projection_routed_run_outcomes",
      ];
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND ${sql.in("name", requiredTables)}
      `;
      assert.deepStrictEqual(tables.map((row) => row.name).sort(), [...requiredTables].sort());
      assert.deepStrictEqual(
        yield* sql`
          SELECT name, fallback_mode, privacy_mode, budget_mode
          FROM projection_routing_policies
          WHERE routing_policy_id = 'routing-policy:balanced-default'
        `,
        [
          {
            name: "Balanced automatic routing",
            fallback_mode: "any_compatible",
            privacy_mode: "remote_allowed",
            budget_mode: "balanced",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* sql`
          SELECT routing_decision_id, model_selection_json, routing_reasoning_level
          FROM projection_agent_runs WHERE agent_run_id = 'legacy-run'
        `,
        [
          {
            routing_decision_id: null,
            model_selection_json: null,
            routing_reasoning_level: null,
          },
        ],
      );
      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.strictEqual(
        sessionColumns.some((column) => column.name === "runtime_error_class"),
        true,
      );
      assert.deepStrictEqual(
        yield* sql`SELECT memory_entry_id FROM projection_memory_entries WHERE memory_entry_id = 'routing-memory'`,
        [{ memory_entry_id: "routing-memory" }],
      );

      yield* sql`
        INSERT INTO projection_routing_provider_profiles (
          provider_profile_id, provider_type, display_name, account_reference, endpoint_class,
          status, is_enabled, is_local, supports_model_discovery, configuration_metadata_json,
          created_at, updated_at, last_validated_at
        ) VALUES (
          'codex-work', 'codex', 'Codex Work', NULL, 'official_cloud', 'available',
          1, 0, 1, '{"region":"eu"}', ${now}, ${now}, ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_routing_model_profiles (
          model_profile_id, provider_profile_id, provider_model_id, display_name, family,
          version, release_channel, status, is_enabled, is_deprecated,
          discovered_automatically, created_at, updated_at, last_discovered_at
        ) VALUES (
          'model-gpt', 'codex-work', 'gpt-5.6', 'GPT 5.6', 'gpt', NULL, NULL,
          'available', 1, 0, 1, ${now}, ${now}, ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_routing_model_capability_snapshots (
          capability_snapshot_id, model_profile_id, snapshot_version, source,
          capabilities_json, context_limits_json, reasoning_options_json, tool_support_json,
          modality_support_json, output_support_json, privacy_metadata_json, captured_at, expires_at
        ) VALUES (
          'snapshot-gpt-1', 'model-gpt', 1, 'provider_reported',
          '{"toolCalling":"supported"}',
          '{"maximumInputTokens":128000}',
          '{"supportedLevels":["medium","high"]}', '{}', '{}', '{}', '{}', ${now}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_routing_policies (
          routing_policy_id, scope_type, scope_id, name, description, priority, is_enabled,
          default_provider_profile_id, default_model_profile_id, default_reasoning_level,
          fallback_mode, privacy_mode, budget_mode, created_at, updated_at
        ) VALUES (
          'policy-project', 'project', 'routing-project', 'Project default', '', 10, 1,
          'codex-work', 'model-gpt', 'high', 'same_provider', 'remote_allowed', 'balanced',
          ${now}, ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_task_routing_assessments (
          task_routing_assessment_id, task_id, agent_role, task_type, complexity,
          required_capabilities_json, preferred_capabilities_json, estimated_context_tokens,
          privacy_classification, write_access_required, vision_required,
          structured_output_required, assessment_source, assessment_explanation, version,
          created_at, updated_at, superseded_by_id
        ) VALUES (
          'assessment-1', 'routing-task', 'implementer', 'implementation', 'high',
          '["code_editing"]', '[]', 64000, 'normal', 1, 0, 1, 'inferred',
          'Implementation task with a large working set.', 1, ${now}, ${now}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_routing_decisions (
          routing_decision_id, project_id, mission_id, task_id, mission_agent_id, agent_run_id,
          assessment_id, decision_type, selected_provider_profile_id, selected_model_profile_id,
          selected_capability_snapshot_id, selected_reasoning_level, manual_provider_pin,
          manual_model_pin, manual_reasoning_pin, fallback_plan_json, candidate_summary_json,
          selection_explanation, constraints_snapshot_json, policy_snapshot_json, status,
          created_at, applied_at, terminal_at, failure_summary, superseded_by_id
        ) VALUES (
          'decision-1', 'routing-project', 'routing-mission', 'routing-task', NULL, NULL,
          'assessment-1', 'automatic', 'codex-work', 'model-gpt', 'snapshot-gpt-1', 'high',
          0, 0, 0, '[]', '{"consideredCount":1,"eligibleCount":1}',
          'The selected model is the only eligible candidate.',
          '{"minimumContextTokens":64000,"contextStrategy":"full"}',
          '{"policyIds":["policy-project"]}', 'planned', ${now}, NULL, NULL, NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_routing_candidate_records (
          routing_candidate_record_id, routing_decision_id, provider_profile_id,
          model_profile_id, eligible, score, rejection_reasons_json,
          preference_reasons_json, capability_snapshot_id, created_at
        ) VALUES (
          'candidate-1', 'decision-1', 'codex-work', 'model-gpt', 1, 0.92, '[]',
          '["project default"]', 'snapshot-gpt-1', ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_agent_runs (
          agent_run_id, mission_id, task_id, thread_id, provider, provider_instance_id,
          provider_session_id, status, created_at, updated_at, started_at, completed_at,
          error_summary, routing_decision_id, model_selection_json, routing_reasoning_level
        ) VALUES (
          'routed-run', 'routing-mission', 'routing-task', 'routed-thread', 'codex', 'codex-work',
          NULL, 'starting', ${later}, ${later}, ${later}, NULL, NULL, 'decision-1',
          '{"instanceId":"codex-work","model":"gpt-5.6"}', 'high'
        )
      `;
      yield* sql`
        UPDATE projection_routing_decisions
        SET status = 'applied', agent_run_id = 'routed-run', applied_at = ${later}
        WHERE routing_decision_id = 'decision-1'
      `;

      assert.strictEqual(
        yield* Effect.isFailure(sql`
          UPDATE projection_routing_decisions
          SET selected_reasoning_level = 'low'
          WHERE routing_decision_id = 'decision-1'
        `),
        true,
      );
      assert.strictEqual(
        yield* Effect.isFailure(sql`
          UPDATE projection_routing_model_capability_snapshots
          SET source = 'inferred' WHERE capability_snapshot_id = 'snapshot-gpt-1'
        `),
        true,
      );
      assert.strictEqual(
        yield* Effect.isFailure(sql`
          INSERT INTO projection_routing_policies (
            routing_policy_id, scope_type, scope_id, name, description, priority, is_enabled,
            fallback_mode, privacy_mode, budget_mode, created_at, updated_at
          ) VALUES (
            'bad-policy', 'project', 'missing-project', 'Bad', '', 0, 1,
            'none', 'inherit', 'inherit', ${now}, ${now}
          )
        `),
        true,
      );
      assert.strictEqual(
        yield* Effect.isFailure(sql`
          UPDATE projection_agent_runs
          SET routing_reasoning_level = 'low' WHERE agent_run_id = 'routed-run'
        `),
        true,
      );
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );
});
