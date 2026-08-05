import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("043_ControlledDelivery migration", (it) => {
  it.effect("upgrades 042 data and creates normalized, secret-free delivery projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-08-05T12:00:00.000Z";
      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('delivery-project', 'Delivery', '/delivery', NULL, '[]', ${now}, ${now}, NULL)
      `;

      yield* runMigrations({ toMigrationInclusive: 43 });

      assert.deepStrictEqual(
        yield* sql`SELECT project_id FROM projection_projects WHERE project_id = 'delivery-project'`,
        [{ project_id: "delivery-project" }],
      );
      const requiredTables = [
        "projection_delivery_policies",
        "projection_delivery_merge_assessments",
        "projection_delivery_approval_requests",
        "projection_delivery_approval_decisions",
        "projection_delivery_merge_executions",
        "projection_delivery_release_configurations",
        "projection_delivery_release_plans",
        "projection_delivery_release_artifacts",
        "projection_delivery_environments",
        "projection_delivery_deployment_plans",
        "projection_delivery_deployment_executions",
        "projection_delivery_validation_runs",
        "projection_delivery_rollback_plans",
        "projection_delivery_rollback_executions",
        "projection_delivery_audit_entries",
      ];
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND ${sql.in("name", requiredTables)}
      `;
      assert.deepStrictEqual(tables.map((row) => row.name).sort(), [...requiredTables].sort());

      const requiredIndexes = [
        "idx_delivery_merge_assessments_recovery",
        "idx_delivery_approval_requests_recovery",
        "idx_delivery_merge_executions_recovery",
        "idx_delivery_release_plans_recovery",
        "idx_delivery_deployment_plans_recovery",
        "idx_delivery_deployment_executions_recovery",
        "idx_delivery_validation_runs_recovery",
        "idx_delivery_rollback_plans_recovery",
        "idx_delivery_rollback_executions_recovery",
      ];
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND ${sql.in("name", requiredIndexes)}
      `;
      assert.deepStrictEqual(indexes.map((row) => row.name).sort(), [...requiredIndexes].sort());

      for (const table of requiredTables) {
        const columns = yield* sql.unsafe<{ readonly name: string }>(`PRAGMA table_info(${table})`);
        assert.isFalse(
          columns.some((column) =>
            /secret|token|password|credential|private_key|api_key/iu.test(column.name),
          ),
          `${table} must not persist secret-bearing columns`,
        );
      }
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );

  it.effect("enforces source-bound immutable approvals and approved plans", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-08-05T12:00:00.000Z";
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('project', 'Delivery', '/delivery', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_delivery_policies (
          delivery_policy_id, record_json, project_id, name, description, is_default,
          version, policy_digest, enabled,
          merge_policy_json, release_policy_json, deployment_policy_json, rollback_policy_json,
          created_at, updated_at
        ) VALUES ('policy', '{}', 'project', 'protected-main', 'Protected main', 1, 1, 'policy-digest', 1,
          '{}', '{}', '{}', '{}', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_delivery_approval_requests (
          approval_request_id, record_json, project_id, delivery_policy_id, approval_type, target_type,
          target_id, plan_digest, source_commit, status, required_decision_count,
          policy_snapshot_json, context_snapshot_json, requested_by, requested_at
        ) VALUES ('approval', '{}', 'project', 'policy', 'release', 'release_plan', 'release-plan',
          'plan-digest', 'abc123', 'pending', 1, '{}', '{}', 'maintainer', ${now})
      `;
      yield* sql`
        INSERT INTO projection_delivery_approval_decisions (
          approval_decision_id, record_json, approval_request_id, actor_id, actor_type, decision,
          plan_digest, source_commit, decided_at
        ) VALUES ('decision', '{}', 'approval', 'maintainer', 'user', 'approve',
          'plan-digest', 'abc123', ${now})
      `;

      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(sql`
        UPDATE projection_delivery_approval_decisions SET decision = 'reject'
        WHERE approval_decision_id = 'decision'
      `),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(sql`
        DELETE FROM projection_delivery_approval_decisions WHERE approval_decision_id = 'decision'
      `),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(sql`
        INSERT INTO projection_delivery_approval_decisions (
          approval_decision_id, record_json, approval_request_id, actor_id, actor_type, decision,
          plan_digest, source_commit, decided_at
        ) VALUES ('decision-stale', '{}', 'approval', 'second', 'user', 'approve',
          'plan-digest', 'changed-head', ${now})
      `),
        ),
      );

      yield* sql`
        INSERT INTO projection_delivery_release_configurations (
          release_configuration_id, record_json, project_id, name, provider, repository, release_channel,
          tag_pattern, artifact_globs_json, version_strategy, version_source, changelog_mode,
          artifact_configuration_json, github_release_enabled, package_publishing_enabled,
          enabled, version, configuration_digest, public_metadata_json, created_at, updated_at
        ) VALUES ('release-config', '{}', 'project', 'stable', 'github', 'acme/widget', 'stable',
          'v{version}', '[]', 'semantic_explicit', 'package', 'generated', '{}', 1, 0, 1, 1,
          'config-digest', '{}', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_delivery_release_plans (
          release_plan_id, record_json, project_id, release_configuration_id, delivery_policy_id,
          plan_digest, source_commit, version, tag_name, release_name, source_branch,
          change_summary, changelog_draft, release_notes_draft, included_missions_json,
          included_pull_requests_json, artifact_plan_json, publication_plan_json, status,
          approval_request_id, approved_at, created_at, updated_at
        ) VALUES ('release-plan', '{}', 'project', 'release-config', 'policy', 'plan-digest', 'abc123',
          '1.0.0', 'v1.0.0', 'Release 1.0.0', 'main', 'Changes', 'Draft', 'Notes', '[]', '[]',
          '{}', '{}', 'approved', 'approval', ${now}, ${now}, ${now})
      `;
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(sql`
        UPDATE projection_delivery_release_plans SET source_commit = 'changed-head'
        WHERE release_plan_id = 'release-plan'
      `),
        ),
      );
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );
});
