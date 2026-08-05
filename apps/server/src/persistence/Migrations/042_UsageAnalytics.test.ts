import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("042_UsageAnalytics migration", (it) => {
  it.effect("upgrades 041 data and creates normalized analytics tables and indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-08-04T10:00:00.000Z";
      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('analytics-project', 'Analytics', '/analytics', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_routing_provider_profiles (
          provider_profile_id, provider_type, display_name, account_reference, endpoint_class,
          status, is_enabled, is_local, supports_model_discovery, configuration_metadata_json,
          created_at, updated_at, last_validated_at
        ) VALUES (
          'analytics-provider', 'codex', 'Analytics provider', NULL, 'official_cloud',
          'available', 1, 0, 1, '{}', ${now}, ${now}, ${now}
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 42 });

      assert.deepStrictEqual(
        yield* sql`SELECT project_id FROM projection_projects WHERE project_id = 'analytics-project'`,
        [{ project_id: "analytics-project" }],
      );
      assert.deepStrictEqual(
        yield* sql`
          SELECT provider_profile_id FROM projection_routing_provider_profiles
          WHERE provider_profile_id = 'analytics-provider'
        `,
        [{ provider_profile_id: "analytics-provider" }],
      );

      const requiredTables = [
        "projection_analytics_usage_records",
        "projection_analytics_tool_metrics",
        "projection_analytics_run_performance",
        "projection_analytics_pricing_snapshots",
        "projection_analytics_cost_records",
        "projection_analytics_subscription_usage",
        "projection_analytics_subscription_attribution_rules",
        "projection_analytics_subscription_allocation_entries",
        "projection_analytics_subscription_allocation_current",
        "projection_analytics_task_outcomes",
        "projection_analytics_human_dispositions",
        "projection_analytics_mission_outcomes",
        "projection_analytics_aggregates",
        "projection_analytics_budget_policies",
        "projection_analytics_budget_events",
        "projection_analytics_budget_overrides",
        "projection_analytics_annotations",
        "projection_analytics_alerts",
        "projection_analytics_recommendations",
        "projection_analytics_exports",
        "projection_analytics_retention_operations",
        "projection_analytics_exchange_rate_snapshots",
        "projection_analytics_settings",
      ];
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND ${sql.in("name", requiredTables)}
      `;
      assert.deepStrictEqual(tables.map((row) => row.name).sort(), [...requiredTables].sort());

      const requiredIndexes = [
        "idx_analytics_usage_project_recorded",
        "idx_analytics_usage_provisional_recovery",
        "idx_analytics_pricing_model_effective",
        "idx_analytics_cost_project_created",
        "idx_analytics_subscription_rules_provider_period",
        "idx_analytics_subscription_allocation_current_period",
        "idx_analytics_aggregates_scope_period",
        "idx_analytics_human_dispositions_task_marked",
        "idx_analytics_exports_recovery",
        "idx_analytics_retention_recovery",
      ];
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND ${sql.in("name", requiredIndexes)}
      `;
      assert.deepStrictEqual(indexes.map((row) => row.name).sort(), [...requiredIndexes].sort());

      const pricingColumns = yield* sql<{ readonly name: string; readonly type: string }>`
        PRAGMA table_info(projection_analytics_pricing_snapshots)
      `;
      const decimalColumns = [
        "input_token_rate",
        "output_token_rate",
        "reasoning_token_rate",
        "cached_input_rate",
        "cache_write_rate",
        "cache_read_rate",
        "request_rate",
      ];
      assert.deepStrictEqual(
        pricingColumns
          .filter((column) => decimalColumns.includes(column.name))
          .map((column) => column.type),
        decimalColumns.map(() => "TEXT"),
      );
      const usageForeignKeys = yield* sql<{ readonly table: string }>`
        PRAGMA foreign_key_list(projection_analytics_usage_records)
      `;
      assert.isFalse(
        usageForeignKeys.some(
          (foreignKey) => foreignKey.table === "projection_routing_model_profiles",
        ),
      );
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
    }),
  );

  it.effect("enforces immutable pricing snapshots", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-08-04T10:00:00.000Z";
      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`
        INSERT INTO projection_routing_provider_profiles (
          provider_profile_id, provider_type, display_name, endpoint_class, status,
          is_enabled, is_local, supports_model_discovery, configuration_metadata_json,
          created_at, updated_at
        ) VALUES ('provider', 'codex', 'Provider', 'official_cloud', 'available', 1, 0, 1, '{}', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_routing_model_profiles (
          model_profile_id, provider_profile_id, provider_model_id, display_name, status,
          is_enabled, is_deprecated, discovered_automatically, created_at, updated_at
        ) VALUES ('model', 'provider', 'model', 'Model', 'available', 1, 0, 1, ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_analytics_pricing_snapshots (
          pricing_snapshot_id, provider_profile_id, model_profile_id, currency,
          pricing_source, effective_from, input_token_rate, tool_rate_metadata_json,
          billing_unit, confidence, metadata_json, created_at
        ) VALUES (
          'pricing', 'provider', 'model', 'USD', 'official_catalog', ${now}, '1.250000000000000001',
          '{}', 'per_million_tokens', 'confirmed', '{}', ${now}
        )
      `;
      const updateExit = yield* Effect.exit(sql`
        UPDATE projection_analytics_pricing_snapshots
        SET input_token_rate = '99'
        WHERE pricing_snapshot_id = 'pricing'
      `);
      assert.isTrue(Exit.isFailure(updateExit));
      assert.deepStrictEqual(
        yield* sql`
          SELECT input_token_rate FROM projection_analytics_pricing_snapshots
          WHERE pricing_snapshot_id = 'pricing'
        `,
        [{ input_token_rate: "1.250000000000000001" }],
      );
    }),
  );

  it.effect("enforces immutable subscription accounting rules", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`
        INSERT INTO projection_routing_provider_profiles (
          provider_profile_id, provider_type, display_name, endpoint_class, status,
          is_enabled, is_local, supports_model_discovery, configuration_metadata_json,
          created_at, updated_at
        ) VALUES ('subscription-provider', 'codex', 'Provider', 'official_cloud', 'available', 1, 0, 1, '{}', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_analytics_subscription_attribution_rules (
          subscription_attribution_rule_id, provider_profile_id, model_profile_id, label, mode,
          period_start, period_end, currency, monthly_amount, fixed_internal_rate,
          fixed_rate_unit, created_at
        ) VALUES (
          'subscription-rule', 'subscription-provider', NULL, 'January plan',
          'flat_monthly_by_runs', ${now}, '2026-02-01T00:00:00.000Z', 'USD', '30', NULL, NULL, ${now}
        )
      `;
      const updateExit = yield* Effect.exit(sql`
        UPDATE projection_analytics_subscription_attribution_rules
        SET monthly_amount = '99' WHERE subscription_attribution_rule_id = 'subscription-rule'
      `);
      assert.isTrue(Exit.isFailure(updateExit));
      assert.deepStrictEqual(
        yield* sql`SELECT monthly_amount FROM projection_analytics_subscription_attribution_rules`,
        [{ monthly_amount: "30" }],
      );
    }),
  );
});
