import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const cleanDatabaseLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanDatabaseLayer("039_GitHubWorkspace migration", (it) => {
  it.effect("migrates a Phase 3 database and creates constrained GitHub cache tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 38 });

      const now = "2026-08-03T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES ('project-v39', 'GitHub workspace', '/repo', NULL, '[]', ${now}, ${now}, NULL)
      `;
      yield* sql`
        INSERT INTO projection_missions (
          mission_id, project_id, title, description, status, created_at, updated_at,
          started_at, completed_at, cancelled_at
        ) VALUES (
          'mission-v39', 'project-v39', 'Implement GitHub', '', 'running', ${now}, ${now},
          ${now}, NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_mission_tasks (
          task_id, mission_id, title, description, status, position, created_at, updated_at,
          started_at, completed_at
        ) VALUES (
          'task-v39', 'mission-v39', 'Persist links', '', 'running', 0, ${now}, ${now},
          ${now}, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 39 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'projection_github_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        [
          "projection_github_accounts",
          "projection_github_branch_observations",
          "projection_github_checks",
          "projection_github_issue_mission_links",
          "projection_github_issues",
          "projection_github_mission_pull_request_links",
          "projection_github_pull_request_commits",
          "projection_github_pull_request_files",
          "projection_github_pull_request_reviews",
          "projection_github_pull_requests",
          "projection_github_rate_limits",
          "projection_github_repository_connections",
          "projection_github_review_comment_task_links",
          "projection_github_review_comments",
          "projection_github_review_threads",
          "projection_github_sync_cursors",
        ],
      );
      const accountColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_github_accounts)
      `;
      assert.strictEqual(
        accountColumns.some((column) => /token|secret|credential/iu.test(column.name)),
        false,
      );

      yield* sql`
        INSERT INTO projection_github_accounts (
          github_account_id, provider_account_id, login, display_name, avatar_url, server_url,
          authentication_type, scopes_json, status, created_at, updated_at, last_validated_at
        ) VALUES (
          'github-account-v39', '42', 'octocat', NULL, NULL, 'https://github.com',
          'oauth_device_flow', '["repo:status"]', 'connected', ${now}, ${now}, ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_github_repository_connections (
          repository_connection_id, project_id, github_account_id, owner, repository,
          repository_id, server_url, html_url, remote_name, remote_url, default_branch,
          visibility, permissions_json, is_archived, is_fork, parent_repository_json,
          sync_status, last_synced_at, created_at, updated_at
        ) VALUES (
          'repository-connection-v39', 'project-v39', 'github-account-v39', 'acme', 'widget',
          '9001', 'https://github.com', 'https://github.com/acme/widget', 'origin',
          'git@github.com:acme/widget.git', 'main', 'private',
          '{"level":"write","canRead":true,"canTriage":true,"canPush":true,"canMaintain":false,"canAdmin":false}',
          0, 0, NULL, 'current', ${now}, ${now}, ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_github_issues (
          github_issue_record_id, repository_connection_id, github_issue_id, issue_number,
          title, body_preview, state, author_json, assignees_json, labels_json, milestone_json,
          comment_count, html_url, created_at_remote, updated_at_remote, closed_at_remote, synced_at
        ) VALUES (
          'issue-v39', 'repository-connection-v39', 'issue-node-v39', 7, 'Persist GitHub', NULL,
          'open', '{"login":"octocat","displayName":null,"avatarUrl":null,"htmlUrl":null}',
          '[]', '[]', NULL, 0, 'https://github.com/acme/widget/issues/7', ${now}, ${now}, NULL,
          ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_github_issue_mission_links (
          issue_mission_link_id, repository_connection_id, github_issue_number, mission_id,
          link_type, created_at, updated_at
        ) VALUES (
          'issue-link-v39', 'repository-connection-v39', 7, 'mission-v39', 'implements',
          ${now}, ${now}
        )
      `;

      const phase3Rows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count FROM projection_mission_tasks WHERE task_id = 'task-v39'
      `;
      assert.deepStrictEqual(phase3Rows, [{ count: 1 }]);
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);

      const conflictingProjectConnection = sql`
        INSERT INTO projection_github_repository_connections (
          repository_connection_id, project_id, github_account_id, owner, repository,
          repository_id, server_url, html_url, remote_name, remote_url, default_branch,
          visibility, permissions_json, is_archived, is_fork, parent_repository_json,
          sync_status, last_synced_at, created_at, updated_at
        ) SELECT
          'repository-connection-conflict', project_id, github_account_id, 'acme', 'other',
          '9002', server_url, 'https://github.com/acme/other', remote_name,
          'git@github.com:acme/other.git', default_branch, visibility, permissions_json,
          is_archived, is_fork, parent_repository_json, sync_status, last_synced_at,
          created_at, updated_at
        FROM projection_github_repository_connections
        WHERE repository_connection_id = 'repository-connection-v39'
      `;
      assert.strictEqual(yield* Effect.isFailure(conflictingProjectConnection), true);
    }),
  );
});
