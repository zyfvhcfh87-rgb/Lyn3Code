import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_github_accounts (
      github_account_id TEXT PRIMARY KEY,
      provider_account_id TEXT NOT NULL,
      login TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      server_url TEXT NOT NULL,
      authentication_type TEXT NOT NULL CHECK (
        authentication_type IN ('oauth_device_flow', 'oauth_browser_flow', 'github_app', 'gh_cli')
      ),
      scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
      status TEXT NOT NULL CHECK (
        status IN (
          'connected', 'expired', 'revoked', 'insufficient_permissions', 'rate_limited',
          'disconnected', 'error'
        )
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_validated_at TEXT,
      UNIQUE (server_url, provider_account_id)
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_repository_connections (
      repository_connection_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      github_account_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      repository TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      server_url TEXT NOT NULL,
      html_url TEXT NOT NULL,
      remote_name TEXT NOT NULL,
      remote_url TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'internal', 'unknown')),
      permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
      is_archived INTEGER NOT NULL CHECK (is_archived IN (0, 1)),
      is_fork INTEGER NOT NULL CHECK (is_fork IN (0, 1)),
      parent_repository_json TEXT CHECK (
        parent_repository_json IS NULL OR json_valid(parent_repository_json)
      ),
      sync_status TEXT NOT NULL CHECK (
        sync_status IN (
          'not_synced', 'syncing', 'current', 'stale', 'offline', 'partially_stale',
          'rate_limited', 'authentication_required', 'remote_deleted', 'failed'
        )
      ),
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (github_account_id) REFERENCES projection_github_accounts(github_account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_issues (
      github_issue_record_id TEXT PRIMARY KEY,
      repository_connection_id TEXT NOT NULL,
      github_issue_id TEXT NOT NULL,
      issue_number INTEGER NOT NULL CHECK (issue_number > 0),
      title TEXT NOT NULL,
      body_preview TEXT,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
      author_json TEXT NOT NULL CHECK (json_valid(author_json)),
      assignees_json TEXT NOT NULL CHECK (json_valid(assignees_json)),
      labels_json TEXT NOT NULL CHECK (json_valid(labels_json)),
      milestone_json TEXT CHECK (milestone_json IS NULL OR json_valid(milestone_json)),
      comment_count INTEGER NOT NULL CHECK (comment_count >= 0),
      html_url TEXT NOT NULL,
      created_at_remote TEXT NOT NULL,
      updated_at_remote TEXT NOT NULL,
      closed_at_remote TEXT,
      synced_at TEXT NOT NULL,
      UNIQUE (repository_connection_id, github_issue_id),
      UNIQUE (repository_connection_id, issue_number),
      FOREIGN KEY (repository_connection_id)
        REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_issue_mission_links (
      issue_mission_link_id TEXT PRIMARY KEY,
      repository_connection_id TEXT NOT NULL,
      github_issue_number INTEGER NOT NULL CHECK (github_issue_number > 0),
      mission_id TEXT NOT NULL,
      link_type TEXT NOT NULL CHECK (
        link_type IN ('implements', 'investigates', 'reviews', 'follow_up', 'related')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (repository_connection_id, github_issue_number, mission_id, link_type),
      FOREIGN KEY (repository_connection_id, github_issue_number)
        REFERENCES projection_github_issues(repository_connection_id, issue_number)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_projection_github_issue_links_one_implementation
    ON projection_github_issue_mission_links(repository_connection_id, github_issue_number)
    WHERE link_type = 'implements'
  `;

  yield* sql`
    CREATE TABLE projection_github_pull_requests (
      pull_request_record_id TEXT PRIMARY KEY,
      repository_connection_id TEXT NOT NULL,
      github_pull_request_id TEXT NOT NULL,
      pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
      title TEXT NOT NULL,
      body_preview TEXT,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
      is_draft INTEGER NOT NULL CHECK (is_draft IN (0, 1)),
      author_json TEXT NOT NULL CHECK (json_valid(author_json)),
      head_ref TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      mergeable_state TEXT NOT NULL CHECK (
        mergeable_state IN (
          'unknown', 'mergeable', 'conflicting', 'behind', 'blocked', 'unstable', 'draft'
        )
      ),
      review_decision TEXT NOT NULL CHECK (
        review_decision IN ('none', 'review_required', 'approved', 'changes_requested')
      ),
      changed_file_count INTEGER NOT NULL CHECK (changed_file_count >= 0),
      commit_count INTEGER NOT NULL CHECK (commit_count >= 0),
      comment_count INTEGER NOT NULL CHECK (comment_count >= 0),
      required_check_names_json TEXT NOT NULL CHECK (json_valid(required_check_names_json)),
      html_url TEXT NOT NULL,
      created_at_remote TEXT NOT NULL,
      updated_at_remote TEXT NOT NULL,
      merged_at_remote TEXT,
      closed_at_remote TEXT,
      synced_at TEXT NOT NULL,
      UNIQUE (repository_connection_id, github_pull_request_id),
      UNIQUE (repository_connection_id, pull_request_number),
      UNIQUE (repository_connection_id, pull_request_record_id),
      FOREIGN KEY (repository_connection_id)
        REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_mission_pull_request_links (
      mission_pull_request_link_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      pull_request_record_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK (
        relationship IN ('primary', 'follow_up', 'review_only', 'dependency')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (mission_id, pull_request_record_id, relationship),
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (pull_request_record_id)
        REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_projection_github_mission_pr_links_one_primary_per_mission
    ON projection_github_mission_pull_request_links(mission_id)
    WHERE relationship = 'primary'
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_projection_github_mission_pr_links_one_primary_mission_per_pr
    ON projection_github_mission_pull_request_links(pull_request_record_id)
    WHERE relationship = 'primary'
  `;

  yield* sql`
    CREATE TABLE projection_github_pull_request_reviews (
      pull_request_review_record_id TEXT PRIMARY KEY,
      pull_request_record_id TEXT NOT NULL,
      github_review_id TEXT NOT NULL,
      author_json TEXT NOT NULL CHECK (json_valid(author_json)),
      state TEXT NOT NULL CHECK (
        state IN ('pending', 'commented', 'approved', 'changes_requested', 'dismissed')
      ),
      body_preview TEXT,
      submitted_at TEXT,
      commit_sha TEXT,
      synced_at TEXT NOT NULL,
      UNIQUE (pull_request_record_id, github_review_id),
      FOREIGN KEY (pull_request_record_id)
        REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_review_threads (
      review_thread_record_id TEXT PRIMARY KEY,
      pull_request_record_id TEXT NOT NULL,
      github_thread_id TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER CHECK (line IS NULL OR line > 0),
      original_line INTEGER CHECK (original_line IS NULL OR original_line > 0),
      side TEXT CHECK (side IS NULL OR side IN ('LEFT', 'RIGHT')),
      is_resolved INTEGER NOT NULL CHECK (is_resolved IN (0, 1)),
      is_outdated INTEGER NOT NULL CHECK (is_outdated IN (0, 1)),
      created_at_remote TEXT NOT NULL,
      updated_at_remote TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      UNIQUE (pull_request_record_id, github_thread_id),
      FOREIGN KEY (pull_request_record_id)
        REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_review_comments (
      review_comment_record_id TEXT PRIMARY KEY,
      review_thread_record_id TEXT NOT NULL,
      github_comment_id TEXT NOT NULL,
      author_json TEXT NOT NULL CHECK (json_valid(author_json)),
      body TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER CHECK (line IS NULL OR line > 0),
      commit_sha TEXT,
      html_url TEXT NOT NULL,
      created_at_remote TEXT NOT NULL,
      updated_at_remote TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      UNIQUE (review_thread_record_id, github_comment_id),
      FOREIGN KEY (review_thread_record_id)
        REFERENCES projection_github_review_threads(review_thread_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_review_comment_task_links (
      review_comment_task_link_id TEXT PRIMARY KEY,
      review_comment_record_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('linked', 'addressing', 'addressed', 'verified', 'resolved', 'dismissed')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (review_comment_record_id, task_id),
      FOREIGN KEY (review_comment_record_id)
        REFERENCES projection_github_review_comments(review_comment_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES projection_mission_tasks(task_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_checks (
      github_check_record_id TEXT PRIMARY KEY,
      pull_request_record_id TEXT,
      repository_connection_id TEXT NOT NULL,
      github_check_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'completed')),
      conclusion TEXT CHECK (
        conclusion IS NULL OR conclusion IN (
          'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out',
          'action_required', 'stale', 'unknown'
        )
      ),
      is_required INTEGER NOT NULL CHECK (is_required IN (0, 1)),
      details_url TEXT,
      started_at_remote TEXT,
      completed_at_remote TEXT,
      summary TEXT,
      synced_at TEXT NOT NULL,
      UNIQUE (repository_connection_id, github_check_id),
      FOREIGN KEY (repository_connection_id)
        REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (repository_connection_id, pull_request_record_id)
        REFERENCES projection_github_pull_requests(repository_connection_id, pull_request_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_sync_cursors (
      sync_cursor_id TEXT PRIMARY KEY,
      repository_connection_id TEXT NOT NULL,
      resource_type TEXT NOT NULL CHECK (
        resource_type IN (
          'repository', 'issues', 'pull_requests', 'pull_request_detail', 'reviews',
          'review_threads', 'checks', 'branches', 'labels', 'milestones'
        )
      ),
      cursor TEXT,
      etag TEXT,
      last_modified TEXT,
      last_successful_sync_at TEXT,
      last_attempt_at TEXT,
      error_summary TEXT,
      UNIQUE (repository_connection_id, resource_type),
      FOREIGN KEY (repository_connection_id)
        REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_rate_limits (
      github_rate_limit_state_id TEXT PRIMARY KEY,
      github_account_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (
        kind IN ('core', 'search', 'graphql', 'integration_manifest', 'secondary', 'unknown')
      ),
      request_limit INTEGER CHECK (request_limit IS NULL OR request_limit >= 0),
      remaining INTEGER CHECK (remaining IS NULL OR remaining >= 0),
      used INTEGER CHECK (used IS NULL OR used >= 0),
      reset_at TEXT,
      retry_after_seconds INTEGER CHECK (retry_after_seconds IS NULL OR retry_after_seconds >= 0),
      blocked_operation TEXT,
      observed_at TEXT NOT NULL,
      UNIQUE (github_account_id, kind),
      FOREIGN KEY (github_account_id) REFERENCES projection_github_accounts(github_account_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_branch_observations (
      github_branch_observation_id TEXT PRIMARY KEY,
      repository_connection_id TEXT NOT NULL,
      remote_name TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      local_sha TEXT,
      remote_sha TEXT,
      relation TEXT NOT NULL CHECK (
        relation IN (
          'unknown', 'missing_local', 'missing_remote', 'equal', 'ahead', 'behind', 'diverged'
        )
      ),
      ahead_count INTEGER CHECK (ahead_count IS NULL OR ahead_count >= 0),
      behind_count INTEGER CHECK (behind_count IS NULL OR behind_count >= 0),
      observed_at TEXT NOT NULL,
      UNIQUE (repository_connection_id, remote_name, branch_name),
      FOREIGN KEY (repository_connection_id)
        REFERENCES projection_github_repository_connections(repository_connection_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_github_pull_request_commits (
      pull_request_record_id TEXT NOT NULL,
      sha TEXT NOT NULL,
      message TEXT NOT NULL,
      author_json TEXT CHECK (author_json IS NULL OR json_valid(author_json)),
      authored_at TEXT,
      committed_at TEXT,
      html_url TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (pull_request_record_id, sha),
      FOREIGN KEY (pull_request_record_id)
        REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE projection_github_pull_request_files (
      pull_request_record_id TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('added', 'modified', 'removed', 'renamed', 'copied', 'changed', 'unchanged', 'unknown')
      ),
      additions INTEGER NOT NULL CHECK (additions >= 0),
      deletions INTEGER NOT NULL CHECK (deletions >= 0),
      changes INTEGER NOT NULL CHECK (changes >= 0),
      previous_path TEXT,
      blob_url TEXT,
      raw_url TEXT,
      patch TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (pull_request_record_id, path),
      FOREIGN KEY (pull_request_record_id)
        REFERENCES projection_github_pull_requests(pull_request_record_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE INDEX idx_projection_github_issues_connection_state_updated
    ON projection_github_issues(repository_connection_id, state, updated_at_remote DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_github_pull_requests_connection_state_updated
    ON projection_github_pull_requests(repository_connection_id, state, updated_at_remote DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_github_checks_head_status
    ON projection_github_checks(repository_connection_id, head_sha, status, synced_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_github_review_threads_pr_resolved
    ON projection_github_review_threads(pull_request_record_id, is_resolved, is_outdated)
  `;
  yield* sql`
    CREATE INDEX idx_projection_github_review_comments_thread_created
    ON projection_github_review_comments(review_thread_record_id, created_at_remote ASC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_github_sync_cursors_retry
    ON projection_github_sync_cursors(last_attempt_at, last_successful_sync_at)
  `;
});
