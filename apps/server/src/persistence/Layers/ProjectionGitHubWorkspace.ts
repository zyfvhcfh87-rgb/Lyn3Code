import {
  GetGitHubAccountInput,
  GetGitHubIssueInput,
  GetPullRequestByIdInput,
  GetPullRequestInput,
  GetReviewCommentByIdInput,
  GetReviewThreadByIdInput,
  GetRepositoryConnectionByProjectInput,
  GetRepositoryConnectionInput,
  GitHubActor,
  GitHubDataFreshness,
  GitHubLabel,
  GitHubMilestone,
  ListGitHubAccountsInput,
  ListGitHubBranchObservationsInput,
  ListGitHubChecksInput,
  ListGitHubIssuesInput,
  ListGitHubRateLimitsInput,
  ListIssueMissionLinksInput,
  ListMissionPullRequestLinksInput,
  ListPullRequestReviewsInput,
  ListPullRequestsInput,
  ListRepositoryConnectionsByAccountInput,
  ListReviewCommentsInput,
  ListReviewCommentTaskLinksInput,
  ListReviewThreadsInput,
  ListSyncCursorsInput,
  ParentRepositoryReference,
  RepositoryPermissions,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionGitHubAccount,
  ProjectionGitHubBranchObservation,
  ProjectionGitHubCheckRecord,
  ProjectionGitHubIssueRecord,
  ProjectionGitHubPullRequestCommitRecord,
  ProjectionGitHubPullRequestFileRecord,
  ProjectionGitHubRateLimitState,
  ProjectionGitHubWorkspaceRepository,
  type ProjectionGitHubWorkspaceRepositoryShape,
  ProjectionIssueMissionLink,
  ProjectionMissionPullRequestLink,
  ProjectionPullRequestRecord,
  ProjectionPullRequestReviewRecord,
  ProjectionRepositoryConnection,
  ProjectionReviewCommentRecord,
  ProjectionReviewCommentTaskLink,
  ProjectionReviewThreadRecord,
  ProjectionSyncCursor,
} from "../Services/ProjectionGitHubWorkspace.ts";

const AccountDbRow = ProjectionGitHubAccount.mapFields(
  Struct.assign({ scopes: Schema.fromJsonString(ProjectionGitHubAccount.fields.scopes) }),
);
const ConnectionDbRow = ProjectionRepositoryConnection.mapFields(
  Struct.assign({
    permissions: Schema.fromJsonString(RepositoryPermissions),
    isArchived: Schema.Number,
    isFork: Schema.Number,
    parentRepository: Schema.NullOr(Schema.fromJsonString(ParentRepositoryReference)),
  }),
);
const IssueDbRow = ProjectionGitHubIssueRecord.mapFields(
  Struct.assign({
    author: Schema.fromJsonString(GitHubActor),
    assignees: Schema.fromJsonString(Schema.Array(GitHubActor)),
    labels: Schema.fromJsonString(Schema.Array(GitHubLabel)),
    milestone: Schema.NullOr(Schema.fromJsonString(GitHubMilestone)),
  }),
);
const PullRequestDbRow = ProjectionPullRequestRecord.mapFields(
  Struct.assign({
    isDraft: Schema.Number,
    author: Schema.fromJsonString(GitHubActor),
    requiredCheckNames: Schema.fromJsonString(Schema.Array(Schema.String)),
  }),
);
const ReviewDbRow = ProjectionPullRequestReviewRecord.mapFields(
  Struct.assign({ author: Schema.fromJsonString(GitHubActor) }),
);
const ThreadDbRow = ProjectionReviewThreadRecord.mapFields(
  Struct.assign({ isResolved: Schema.Number, isOutdated: Schema.Number }),
);
const CommentDbRow = ProjectionReviewCommentRecord.mapFields(
  Struct.assign({ author: Schema.fromJsonString(GitHubActor) }),
);
const CheckDbRow = ProjectionGitHubCheckRecord.mapFields(
  Struct.assign({ isRequired: Schema.Number }),
);
const CommitDbRow = ProjectionGitHubPullRequestCommitRecord.mapFields(
  Struct.assign({ author: Schema.NullOr(Schema.fromJsonString(GitHubActor)) }),
);

const encodeScopes = Schema.encodeSync(
  Schema.fromJsonString(ProjectionGitHubAccount.fields.scopes),
);
const encodePermissions = Schema.encodeSync(Schema.fromJsonString(RepositoryPermissions));
const encodeParentRepository = Schema.encodeSync(Schema.fromJsonString(ParentRepositoryReference));
const encodeActor = Schema.encodeSync(Schema.fromJsonString(GitHubActor));
const encodeActors = Schema.encodeSync(Schema.fromJsonString(Schema.Array(GitHubActor)));
const encodeLabels = Schema.encodeSync(Schema.fromJsonString(Schema.Array(GitHubLabel)));
const encodeMilestone = Schema.encodeSync(Schema.fromJsonString(GitHubMilestone));
const encodeStrings = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const toConnection = (row: typeof ConnectionDbRow.Type): ProjectionRepositoryConnection => ({
  ...row,
  isArchived: row.isArchived === 1,
  isFork: row.isFork === 1,
});
const toPullRequest = (row: typeof PullRequestDbRow.Type): ProjectionPullRequestRecord => ({
  ...row,
  isDraft: row.isDraft === 1,
});
const toThread = (row: typeof ThreadDbRow.Type): ProjectionReviewThreadRecord => ({
  ...row,
  isResolved: row.isResolved === 1,
  isOutdated: row.isOutdated === 1,
});
const toCheck = (row: typeof CheckDbRow.Type): ProjectionGitHubCheckRecord => ({
  ...row,
  isRequired: row.isRequired === 1,
});

const accountColumns = `
  github_account_id AS "id", provider_account_id AS "providerAccountId", login,
  display_name AS "displayName", avatar_url AS "avatarUrl", server_url AS "serverUrl",
  authentication_type AS "authenticationType", scopes_json AS "scopes", status,
  created_at AS "createdAt", updated_at AS "updatedAt", last_validated_at AS "lastValidatedAt"
`;
const connectionColumns = `
  repository_connection_id AS "id", project_id AS "projectId",
  github_account_id AS "githubAccountId", owner, repository,
  repository_id AS "repositoryId", server_url AS "serverUrl", html_url AS "htmlUrl",
  remote_name AS "remoteName", remote_url AS "remoteUrl", default_branch AS "defaultBranch",
  visibility, permissions_json AS "permissions", is_archived AS "isArchived",
  is_fork AS "isFork", parent_repository_json AS "parentRepository",
  sync_status AS "syncStatus", last_synced_at AS "lastSyncedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;
const issueColumns = `
  github_issue_record_id AS "id", repository_connection_id AS "repositoryConnectionId",
  github_issue_id AS "githubIssueId", issue_number AS "number", title,
  body_preview AS "bodyPreview", state, author_json AS "author",
  assignees_json AS "assignees", labels_json AS "labels", milestone_json AS "milestone",
  comment_count AS "commentCount", html_url AS "htmlUrl",
  created_at_remote AS "createdAtRemote", updated_at_remote AS "updatedAtRemote",
  closed_at_remote AS "closedAtRemote", synced_at AS "syncedAt"
`;
const issueLinkColumns = `
  issue_mission_link_id AS "id", repository_connection_id AS "repositoryConnectionId",
  github_issue_number AS "githubIssueNumber", mission_id AS "missionId",
  link_type AS "linkType", created_at AS "createdAt", updated_at AS "updatedAt"
`;
const pullRequestColumns = `
  pull_request_record_id AS "id", repository_connection_id AS "repositoryConnectionId",
  github_pull_request_id AS "githubPullRequestId", pull_request_number AS "number", title,
  body_preview AS "bodyPreview", state, is_draft AS "isDraft", author_json AS "author",
  head_ref AS "headRef", head_sha AS "headSha", base_ref AS "baseRef", base_sha AS "baseSha",
  mergeable_state AS "mergeableState", review_decision AS "reviewDecision",
  changed_file_count AS "changedFileCount", commit_count AS "commitCount",
  comment_count AS "commentCount", required_check_names_json AS "requiredCheckNames",
  html_url AS "htmlUrl", created_at_remote AS "createdAtRemote",
  updated_at_remote AS "updatedAtRemote", merged_at_remote AS "mergedAtRemote",
  closed_at_remote AS "closedAtRemote", synced_at AS "syncedAt"
`;
const missionPullRequestLinkColumns = `
  mission_pull_request_link_id AS "id", mission_id AS "missionId",
  pull_request_record_id AS "pullRequestRecordId", relationship,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;
const reviewColumns = `
  pull_request_review_record_id AS "id", pull_request_record_id AS "pullRequestRecordId",
  github_review_id AS "githubReviewId", author_json AS "author", state,
  body_preview AS "bodyPreview", submitted_at AS "submittedAt", commit_sha AS "commitSha",
  synced_at AS "syncedAt"
`;
const threadColumns = `
  review_thread_record_id AS "id", pull_request_record_id AS "pullRequestRecordId",
  github_thread_id AS "githubThreadId", path, line, original_line AS "originalLine", side,
  is_resolved AS "isResolved", is_outdated AS "isOutdated",
  created_at_remote AS "createdAtRemote", updated_at_remote AS "updatedAtRemote",
  synced_at AS "syncedAt"
`;
const commentColumns = `
  review_comment_record_id AS "id", review_thread_record_id AS "reviewThreadId",
  github_comment_id AS "githubCommentId", author_json AS "author", body, path, line,
  commit_sha AS "commitSha", html_url AS "htmlUrl", created_at_remote AS "createdAtRemote",
  updated_at_remote AS "updatedAtRemote", synced_at AS "syncedAt"
`;
const joinedCommentColumns = `
  comments.review_comment_record_id AS "id",
  comments.review_thread_record_id AS "reviewThreadId",
  comments.github_comment_id AS "githubCommentId", comments.author_json AS "author",
  comments.body, comments.path, comments.line, comments.commit_sha AS "commitSha",
  comments.html_url AS "htmlUrl", comments.created_at_remote AS "createdAtRemote",
  comments.updated_at_remote AS "updatedAtRemote", comments.synced_at AS "syncedAt"
`;
const taskLinkColumns = `
  review_comment_task_link_id AS "id", review_comment_record_id AS "reviewCommentRecordId",
  task_id AS "taskId", status, created_at AS "createdAt", updated_at AS "updatedAt"
`;
const joinedTaskLinkColumns = `
  links.review_comment_task_link_id AS "id",
  links.review_comment_record_id AS "reviewCommentRecordId", links.task_id AS "taskId",
  links.status, links.created_at AS "createdAt", links.updated_at AS "updatedAt"
`;
const checkColumns = `
  github_check_record_id AS "id", pull_request_record_id AS "pullRequestRecordId",
  repository_connection_id AS "repositoryConnectionId", github_check_id AS "githubCheckId",
  name, provider, head_sha AS "headSha", status, conclusion, is_required AS "isRequired",
  details_url AS "detailsUrl", started_at_remote AS "startedAtRemote",
  completed_at_remote AS "completedAtRemote", summary, synced_at AS "syncedAt"
`;
const cursorColumns = `
  sync_cursor_id AS "id", repository_connection_id AS "repositoryConnectionId", resource_type AS "resourceType",
  cursor, etag, last_modified AS "lastModified", last_successful_sync_at AS "lastSuccessfulSyncAt",
  last_attempt_at AS "lastAttemptAt", error_summary AS "errorSummary"
`;
const rateLimitColumns = `
  github_rate_limit_state_id AS "id", github_account_id AS "githubAccountId", kind,
  request_limit AS "limit", remaining, used, reset_at AS "resetAt",
  retry_after_seconds AS "retryAfterSeconds", blocked_operation AS "blockedOperation",
  observed_at AS "observedAt"
`;
const branchColumns = `
  github_branch_observation_id AS "id", repository_connection_id AS "repositoryConnectionId",
  remote_name AS "remoteName", branch_name AS "branchName", local_sha AS "localSha",
  remote_sha AS "remoteSha", relation, ahead_count AS "aheadCount", behind_count AS "behindCount",
  observed_at AS "observedAt"
`;
const commitColumns = `
  pull_request_record_id AS "pullRequestRecordId", sha, message, author_json AS "author",
  authored_at AS "authoredAt", committed_at AS "committedAt", html_url AS "htmlUrl",
  synced_at AS "syncedAt"
`;
const fileColumns = `
  pull_request_record_id AS "pullRequestRecordId", path, status, additions, deletions, changes,
  previous_path AS "previousPath", blob_url AS "blobUrl", raw_url AS "rawUrl", patch,
  synced_at AS "syncedAt"
`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));
  const inconsistentPage = (operation: string, detail: string) =>
    new PersistenceSqlError({ operation, detail });

  const getAccountRow = SqlSchema.findOneOption({
    Request: GetGitHubAccountInput,
    Result: AccountDbRow,
    execute: ({ githubAccountId }) => sql`
      SELECT ${sql.unsafe(accountColumns)} FROM projection_github_accounts
      WHERE github_account_id = ${githubAccountId}
    `,
  });
  const listAccountRows = SqlSchema.findAll({
    Request: ListGitHubAccountsInput,
    Result: AccountDbRow,
    execute: ({ includeDisconnected }) => sql`
      SELECT ${sql.unsafe(accountColumns)} FROM projection_github_accounts
      WHERE ${includeDisconnected ? 1 : 0} = 1 OR status <> 'disconnected'
      ORDER BY updated_at DESC, github_account_id ASC
    `,
  });
  const getConnectionRow = SqlSchema.findOneOption({
    Request: GetRepositoryConnectionInput,
    Result: ConnectionDbRow,
    execute: ({ repositoryConnectionId }) => sql`
      SELECT ${sql.unsafe(connectionColumns)} FROM projection_github_repository_connections
      WHERE repository_connection_id = ${repositoryConnectionId}
    `,
  });
  const getConnectionByProjectRow = SqlSchema.findOneOption({
    Request: GetRepositoryConnectionByProjectInput,
    Result: ConnectionDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${sql.unsafe(connectionColumns)} FROM projection_github_repository_connections
      WHERE project_id = ${projectId}
    `,
  });
  const listConnectionsByAccountRows = SqlSchema.findAll({
    Request: ListRepositoryConnectionsByAccountInput,
    Result: ConnectionDbRow,
    execute: ({ githubAccountId }) => sql`
      SELECT ${sql.unsafe(connectionColumns)} FROM projection_github_repository_connections
      WHERE github_account_id = ${githubAccountId}
      ORDER BY updated_at DESC, repository_connection_id ASC
    `,
  });
  const getIssueRow = SqlSchema.findOneOption({
    Request: GetGitHubIssueInput,
    Result: IssueDbRow,
    execute: ({ repositoryConnectionId, number }) => sql`
      SELECT ${sql.unsafe(issueColumns)} FROM projection_github_issues
      WHERE repository_connection_id = ${repositoryConnectionId} AND issue_number = ${number}
    `,
  });
  const listIssueRows = SqlSchema.findAll({
    Request: ListGitHubIssuesInput,
    Result: IssueDbRow,
    execute: ({ repositoryConnectionId, state, limit, offset }) => sql`
      SELECT ${sql.unsafe(issueColumns)} FROM projection_github_issues
      WHERE repository_connection_id = ${repositoryConnectionId}
        AND (${state} IS NULL OR state = ${state})
      ORDER BY updated_at_remote DESC, issue_number DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const listIssueLinkRows = SqlSchema.findAll({
    Request: ListIssueMissionLinksInput,
    Result: ProjectionIssueMissionLink,
    execute: ({ repositoryConnectionId, githubIssueNumber, missionId }) => sql`
      SELECT ${sql.unsafe(issueLinkColumns)} FROM projection_github_issue_mission_links
      WHERE repository_connection_id = ${repositoryConnectionId}
        AND (${githubIssueNumber} IS NULL OR github_issue_number = ${githubIssueNumber})
        AND (${missionId} IS NULL OR mission_id = ${missionId})
      ORDER BY created_at ASC, issue_mission_link_id ASC
    `,
  });
  const getPullRequestRow = SqlSchema.findOneOption({
    Request: GetPullRequestInput,
    Result: PullRequestDbRow,
    execute: ({ repositoryConnectionId, number }) => sql`
      SELECT ${sql.unsafe(pullRequestColumns)} FROM projection_github_pull_requests
      WHERE repository_connection_id = ${repositoryConnectionId}
        AND pull_request_number = ${number}
    `,
  });
  const getPullRequestByIdRow = SqlSchema.findOneOption({
    Request: GetPullRequestByIdInput,
    Result: PullRequestDbRow,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(pullRequestColumns)} FROM projection_github_pull_requests
      WHERE pull_request_record_id = ${pullRequestRecordId}
    `,
  });
  const listPullRequestRows = SqlSchema.findAll({
    Request: ListPullRequestsInput,
    Result: PullRequestDbRow,
    execute: ({ repositoryConnectionId, state, limit, offset }) => sql`
      SELECT ${sql.unsafe(pullRequestColumns)} FROM projection_github_pull_requests
      WHERE repository_connection_id = ${repositoryConnectionId}
        AND (${state} IS NULL OR state = ${state})
      ORDER BY updated_at_remote DESC, pull_request_number DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const listMissionPullRequestLinkRows = SqlSchema.findAll({
    Request: ListMissionPullRequestLinksInput,
    Result: ProjectionMissionPullRequestLink,
    execute: ({ missionId, pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(missionPullRequestLinkColumns)}
      FROM projection_github_mission_pull_request_links
      WHERE (${missionId} IS NULL OR mission_id = ${missionId})
        AND (${pullRequestRecordId} IS NULL OR pull_request_record_id = ${pullRequestRecordId})
      ORDER BY created_at ASC, mission_pull_request_link_id ASC
    `,
  });
  const listReviewRows = SqlSchema.findAll({
    Request: ListPullRequestReviewsInput,
    Result: ReviewDbRow,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(reviewColumns)} FROM projection_github_pull_request_reviews
      WHERE pull_request_record_id = ${pullRequestRecordId}
      ORDER BY submitted_at ASC, pull_request_review_record_id ASC
    `,
  });
  const listThreadRows = SqlSchema.findAll({
    Request: ListReviewThreadsInput,
    Result: ThreadDbRow,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(threadColumns)} FROM projection_github_review_threads
      WHERE pull_request_record_id = ${pullRequestRecordId}
      ORDER BY path ASC, line ASC, review_thread_record_id ASC
    `,
  });
  const getReviewThreadByIdRow = SqlSchema.findOneOption({
    Request: GetReviewThreadByIdInput,
    Result: ThreadDbRow,
    execute: ({ reviewThreadRecordId }) => sql`
      SELECT ${sql.unsafe(threadColumns)} FROM projection_github_review_threads
      WHERE review_thread_record_id = ${reviewThreadRecordId}
    `,
  });
  const listCommentRows = SqlSchema.findAll({
    Request: ListReviewCommentsInput,
    Result: CommentDbRow,
    execute: ({ reviewThreadId }) => sql`
      SELECT ${sql.unsafe(commentColumns)} FROM projection_github_review_comments
      WHERE review_thread_record_id = ${reviewThreadId}
      ORDER BY created_at_remote ASC, review_comment_record_id ASC
    `,
  });
  const getReviewCommentByIdRow = SqlSchema.findOneOption({
    Request: GetReviewCommentByIdInput,
    Result: CommentDbRow,
    execute: ({ reviewCommentRecordId }) => sql`
      SELECT ${sql.unsafe(commentColumns)} FROM projection_github_review_comments
      WHERE review_comment_record_id = ${reviewCommentRecordId}
    `,
  });
  const listCommentsByPullRequestRows = SqlSchema.findAll({
    Request: GetPullRequestByIdInput,
    Result: CommentDbRow,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(joinedCommentColumns)} FROM projection_github_review_comments comments
      INNER JOIN projection_github_review_threads threads
        ON threads.review_thread_record_id = comments.review_thread_record_id
      WHERE threads.pull_request_record_id = ${pullRequestRecordId}
      ORDER BY comments.created_at_remote ASC, comments.review_comment_record_id ASC
    `,
  });
  const listTaskLinkRows = SqlSchema.findAll({
    Request: ListReviewCommentTaskLinksInput,
    Result: ProjectionReviewCommentTaskLink,
    execute: ({ reviewCommentRecordId, taskId }) => sql`
      SELECT ${sql.unsafe(taskLinkColumns)} FROM projection_github_review_comment_task_links
      WHERE (${reviewCommentRecordId} IS NULL OR review_comment_record_id = ${reviewCommentRecordId})
        AND (${taskId} IS NULL OR task_id = ${taskId})
      ORDER BY created_at ASC, review_comment_task_link_id ASC
    `,
  });
  const listTaskLinksByPullRequestRows = SqlSchema.findAll({
    Request: GetPullRequestByIdInput,
    Result: ProjectionReviewCommentTaskLink,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(joinedTaskLinkColumns)}
      FROM projection_github_review_comment_task_links links
      INNER JOIN projection_github_review_comments comments
        ON comments.review_comment_record_id = links.review_comment_record_id
      INNER JOIN projection_github_review_threads threads
        ON threads.review_thread_record_id = comments.review_thread_record_id
      WHERE threads.pull_request_record_id = ${pullRequestRecordId}
      ORDER BY links.created_at ASC, links.review_comment_task_link_id ASC
    `,
  });
  const listCheckRows = SqlSchema.findAll({
    Request: ListGitHubChecksInput,
    Result: CheckDbRow,
    execute: ({ repositoryConnectionId, pullRequestRecordId, headSha }) => sql`
      SELECT ${sql.unsafe(checkColumns)} FROM projection_github_checks
      WHERE repository_connection_id = ${repositoryConnectionId}
        AND (${pullRequestRecordId} IS NULL OR pull_request_record_id = ${pullRequestRecordId})
        AND (${headSha} IS NULL OR head_sha = ${headSha})
      ORDER BY name ASC, github_check_record_id ASC
    `,
  });
  const listChecksByPullRequestRows = SqlSchema.findAll({
    Request: GetPullRequestByIdInput,
    Result: CheckDbRow,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(checkColumns)} FROM projection_github_checks
      WHERE pull_request_record_id = ${pullRequestRecordId}
      ORDER BY name ASC, github_check_record_id ASC
    `,
  });
  const listCursorRows = SqlSchema.findAll({
    Request: ListSyncCursorsInput,
    Result: ProjectionSyncCursor,
    execute: ({ repositoryConnectionId }) => sql`
      SELECT ${sql.unsafe(cursorColumns)} FROM projection_github_sync_cursors
      WHERE repository_connection_id = ${repositoryConnectionId}
      ORDER BY resource_type ASC
    `,
  });
  const listRateLimitRows = SqlSchema.findAll({
    Request: ListGitHubRateLimitsInput,
    Result: ProjectionGitHubRateLimitState,
    execute: ({ githubAccountId }) => sql`
      SELECT ${sql.unsafe(rateLimitColumns)} FROM projection_github_rate_limits
      WHERE github_account_id = ${githubAccountId}
      ORDER BY kind ASC
    `,
  });
  const listBranchRows = SqlSchema.findAll({
    Request: ListGitHubBranchObservationsInput,
    Result: ProjectionGitHubBranchObservation,
    execute: ({ repositoryConnectionId }) => sql`
      SELECT ${sql.unsafe(branchColumns)} FROM projection_github_branch_observations
      WHERE repository_connection_id = ${repositoryConnectionId}
      ORDER BY remote_name ASC, branch_name ASC
    `,
  });
  const listCommitRows = SqlSchema.findAll({
    Request: GetPullRequestByIdInput,
    Result: CommitDbRow,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(commitColumns)} FROM projection_github_pull_request_commits
      WHERE pull_request_record_id = ${pullRequestRecordId}
      ORDER BY committed_at ASC, sha ASC
    `,
  });
  const listFileRows = SqlSchema.findAll({
    Request: GetPullRequestByIdInput,
    Result: ProjectionGitHubPullRequestFileRecord,
    execute: ({ pullRequestRecordId }) => sql`
      SELECT ${sql.unsafe(fileColumns)} FROM projection_github_pull_request_files
      WHERE pull_request_record_id = ${pullRequestRecordId}
      ORDER BY path ASC
    `,
  });

  const saveAccountRow = (row: ProjectionGitHubAccount) => sql`
    INSERT INTO projection_github_accounts (
      github_account_id, provider_account_id, login, display_name, avatar_url, server_url,
      authentication_type, scopes_json, status, created_at, updated_at, last_validated_at
    ) VALUES (
      ${row.id}, ${row.providerAccountId}, ${row.login}, ${row.displayName}, ${row.avatarUrl},
      ${row.serverUrl}, ${row.authenticationType}, ${encodeScopes(row.scopes)}, ${row.status},
      ${row.createdAt}, ${row.updatedAt}, ${row.lastValidatedAt}
    ) ON CONFLICT (github_account_id) DO UPDATE SET
      provider_account_id = excluded.provider_account_id, login = excluded.login,
      display_name = excluded.display_name, avatar_url = excluded.avatar_url,
      server_url = excluded.server_url, authentication_type = excluded.authentication_type,
      scopes_json = excluded.scopes_json, status = excluded.status,
      updated_at = excluded.updated_at, last_validated_at = excluded.last_validated_at
    WHERE excluded.updated_at >= projection_github_accounts.updated_at
  `;

  const saveConnectionRow = (row: ProjectionRepositoryConnection) => sql`
    INSERT INTO projection_github_repository_connections (
      repository_connection_id, project_id, github_account_id, owner, repository,
      repository_id, server_url, html_url, remote_name, remote_url, default_branch, visibility,
      permissions_json, is_archived, is_fork, parent_repository_json, sync_status,
      last_synced_at, created_at, updated_at
    ) VALUES (
      ${row.id}, ${row.projectId}, ${row.githubAccountId}, ${row.owner}, ${row.repository},
      ${row.repositoryId}, ${row.serverUrl}, ${row.htmlUrl}, ${row.remoteName}, ${row.remoteUrl},
      ${row.defaultBranch}, ${row.visibility}, ${encodePermissions(row.permissions)},
      ${row.isArchived ? 1 : 0}, ${row.isFork ? 1 : 0},
      ${row.parentRepository === null ? null : encodeParentRepository(row.parentRepository)},
      ${row.syncStatus}, ${row.lastSyncedAt}, ${row.createdAt}, ${row.updatedAt}
    ) ON CONFLICT (repository_connection_id) DO UPDATE SET
      project_id = excluded.project_id, github_account_id = excluded.github_account_id,
      owner = excluded.owner, repository = excluded.repository,
      repository_id = excluded.repository_id, server_url = excluded.server_url,
      html_url = excluded.html_url, remote_name = excluded.remote_name,
      remote_url = excluded.remote_url, default_branch = excluded.default_branch,
      visibility = excluded.visibility, permissions_json = excluded.permissions_json,
      is_archived = excluded.is_archived, is_fork = excluded.is_fork,
      parent_repository_json = excluded.parent_repository_json,
      sync_status = excluded.sync_status, last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= projection_github_repository_connections.updated_at
  `;

  const upsertIssueRow = (row: ProjectionGitHubIssueRecord) => sql`
    INSERT INTO projection_github_issues (
      github_issue_record_id, repository_connection_id, github_issue_id, issue_number, title,
      body_preview, state, author_json, assignees_json, labels_json, milestone_json,
      comment_count, html_url, created_at_remote, updated_at_remote, closed_at_remote, synced_at
    ) VALUES (
      ${row.id}, ${row.repositoryConnectionId}, ${row.githubIssueId}, ${row.number}, ${row.title},
      ${row.bodyPreview}, ${row.state}, ${encodeActor(row.author)}, ${encodeActors(row.assignees)},
      ${encodeLabels(row.labels)}, ${row.milestone === null ? null : encodeMilestone(row.milestone)},
      ${row.commentCount}, ${row.htmlUrl}, ${row.createdAtRemote}, ${row.updatedAtRemote},
      ${row.closedAtRemote}, ${row.syncedAt}
    ) ON CONFLICT (github_issue_record_id) DO UPDATE SET
      title = excluded.title, body_preview = excluded.body_preview, state = excluded.state,
      author_json = excluded.author_json, assignees_json = excluded.assignees_json,
      labels_json = excluded.labels_json, milestone_json = excluded.milestone_json,
      comment_count = excluded.comment_count, html_url = excluded.html_url,
      created_at_remote = excluded.created_at_remote, updated_at_remote = excluded.updated_at_remote,
      closed_at_remote = excluded.closed_at_remote, synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_issues.synced_at
  `;

  const upsertPullRequestRow = (
    row: ProjectionPullRequestRecord,
    preserveDetailEvidence = false,
  ) => sql`
    INSERT INTO projection_github_pull_requests (
      pull_request_record_id, repository_connection_id, github_pull_request_id,
      pull_request_number, title, body_preview, state, is_draft, author_json, head_ref, head_sha,
      base_ref, base_sha, mergeable_state, review_decision, changed_file_count, commit_count,
      comment_count, required_check_names_json, html_url, created_at_remote, updated_at_remote,
      merged_at_remote, closed_at_remote, synced_at
    ) VALUES (
      ${row.id}, ${row.repositoryConnectionId}, ${row.githubPullRequestId}, ${row.number},
      ${row.title}, ${row.bodyPreview}, ${row.state}, ${row.isDraft ? 1 : 0},
      ${encodeActor(row.author)}, ${row.headRef}, ${row.headSha}, ${row.baseRef}, ${row.baseSha},
      ${row.mergeableState}, ${row.reviewDecision}, ${row.changedFileCount}, ${row.commitCount},
      ${row.commentCount}, ${encodeStrings(row.requiredCheckNames)}, ${row.htmlUrl},
      ${row.createdAtRemote}, ${row.updatedAtRemote}, ${row.mergedAtRemote},
      ${row.closedAtRemote}, ${row.syncedAt}
    ) ON CONFLICT (pull_request_record_id) DO UPDATE SET
      title = excluded.title, body_preview = excluded.body_preview, state = excluded.state,
      is_draft = excluded.is_draft, author_json = excluded.author_json,
      head_ref = excluded.head_ref, head_sha = excluded.head_sha,
      base_ref = excluded.base_ref, base_sha = excluded.base_sha,
      mergeable_state = excluded.mergeable_state,
      review_decision = ${sql.unsafe(
        preserveDetailEvidence
          ? "projection_github_pull_requests.review_decision"
          : "excluded.review_decision",
      )},
      changed_file_count = excluded.changed_file_count, commit_count = excluded.commit_count,
      comment_count = excluded.comment_count,
      required_check_names_json = ${sql.unsafe(
        preserveDetailEvidence
          ? "projection_github_pull_requests.required_check_names_json"
          : "excluded.required_check_names_json",
      )},
      html_url = excluded.html_url, created_at_remote = excluded.created_at_remote,
      updated_at_remote = excluded.updated_at_remote, merged_at_remote = excluded.merged_at_remote,
      closed_at_remote = excluded.closed_at_remote, synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_pull_requests.synced_at
  `;

  const upsertReviewRow = (row: ProjectionPullRequestReviewRecord) => sql`
    INSERT INTO projection_github_pull_request_reviews (
      pull_request_review_record_id, pull_request_record_id, github_review_id, author_json,
      state, body_preview, submitted_at, commit_sha, synced_at
    ) VALUES (
      ${row.id}, ${row.pullRequestRecordId}, ${row.githubReviewId}, ${encodeActor(row.author)},
      ${row.state}, ${row.bodyPreview}, ${row.submittedAt}, ${row.commitSha}, ${row.syncedAt}
    ) ON CONFLICT (pull_request_review_record_id) DO UPDATE SET
      author_json = excluded.author_json, state = excluded.state,
      body_preview = excluded.body_preview, submitted_at = excluded.submitted_at,
      commit_sha = excluded.commit_sha, synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_pull_request_reviews.synced_at
  `;
  const upsertThreadRow = (row: ProjectionReviewThreadRecord) => sql`
    INSERT INTO projection_github_review_threads (
      review_thread_record_id, pull_request_record_id, github_thread_id, path, line,
      original_line, side, is_resolved, is_outdated, created_at_remote, updated_at_remote, synced_at
    ) VALUES (
      ${row.id}, ${row.pullRequestRecordId}, ${row.githubThreadId}, ${row.path}, ${row.line},
      ${row.originalLine}, ${row.side}, ${row.isResolved ? 1 : 0}, ${row.isOutdated ? 1 : 0},
      ${row.createdAtRemote}, ${row.updatedAtRemote}, ${row.syncedAt}
    ) ON CONFLICT (review_thread_record_id) DO UPDATE SET
      path = excluded.path, line = excluded.line, original_line = excluded.original_line,
      side = excluded.side, is_resolved = excluded.is_resolved,
      is_outdated = excluded.is_outdated, updated_at_remote = excluded.updated_at_remote,
      synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_review_threads.synced_at
  `;
  const upsertCommentRow = (row: ProjectionReviewCommentRecord) => sql`
    INSERT INTO projection_github_review_comments (
      review_comment_record_id, review_thread_record_id, github_comment_id, author_json, body,
      path, line, commit_sha, html_url, created_at_remote, updated_at_remote, synced_at
    ) VALUES (
      ${row.id}, ${row.reviewThreadId}, ${row.githubCommentId}, ${encodeActor(row.author)},
      ${row.body}, ${row.path}, ${row.line}, ${row.commitSha}, ${row.htmlUrl},
      ${row.createdAtRemote}, ${row.updatedAtRemote}, ${row.syncedAt}
    ) ON CONFLICT (review_comment_record_id) DO UPDATE SET
      author_json = excluded.author_json, body = excluded.body, path = excluded.path,
      line = excluded.line, commit_sha = excluded.commit_sha, html_url = excluded.html_url,
      updated_at_remote = excluded.updated_at_remote, synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_review_comments.synced_at
  `;
  const upsertCheckRow = (row: ProjectionGitHubCheckRecord) => sql`
    INSERT INTO projection_github_checks (
      github_check_record_id, pull_request_record_id, repository_connection_id,
      github_check_id, name, provider, head_sha, status, conclusion, is_required,
      details_url, started_at_remote, completed_at_remote, summary, synced_at
    ) VALUES (
      ${row.id}, ${row.pullRequestRecordId}, ${row.repositoryConnectionId},
      ${row.githubCheckId}, ${row.name}, ${row.provider}, ${row.headSha}, ${row.status},
      ${row.conclusion}, ${row.isRequired ? 1 : 0}, ${row.detailsUrl}, ${row.startedAtRemote},
      ${row.completedAtRemote}, ${row.summary}, ${row.syncedAt}
    ) ON CONFLICT (github_check_record_id) DO UPDATE SET
      pull_request_record_id = excluded.pull_request_record_id, name = excluded.name,
      provider = excluded.provider, head_sha = excluded.head_sha, status = excluded.status,
      conclusion = excluded.conclusion, is_required = excluded.is_required,
      details_url = excluded.details_url, started_at_remote = excluded.started_at_remote,
      completed_at_remote = excluded.completed_at_remote, summary = excluded.summary,
      synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_checks.synced_at
  `;
  const upsertCommitRow = (row: ProjectionGitHubPullRequestCommitRecord) => sql`
    INSERT INTO projection_github_pull_request_commits (
      pull_request_record_id, sha, message, author_json, authored_at, committed_at, html_url, synced_at
    ) VALUES (
      ${row.pullRequestRecordId}, ${row.sha}, ${row.message},
      ${row.author === null ? null : encodeActor(row.author)}, ${row.authoredAt},
      ${row.committedAt}, ${row.htmlUrl}, ${row.syncedAt}
    ) ON CONFLICT (pull_request_record_id, sha) DO UPDATE SET
      message = excluded.message, author_json = excluded.author_json,
      authored_at = excluded.authored_at, committed_at = excluded.committed_at,
      html_url = excluded.html_url, synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_pull_request_commits.synced_at
  `;
  const upsertFileRow = (row: ProjectionGitHubPullRequestFileRecord) => sql`
    INSERT INTO projection_github_pull_request_files (
      pull_request_record_id, path, status, additions, deletions, changes, previous_path,
      blob_url, raw_url, patch, synced_at
    ) VALUES (
      ${row.pullRequestRecordId}, ${row.path}, ${row.status}, ${row.additions}, ${row.deletions},
      ${row.changes}, ${row.previousPath}, ${row.blobUrl}, ${row.rawUrl}, ${row.patch}, ${row.syncedAt}
    ) ON CONFLICT (pull_request_record_id, path) DO UPDATE SET
      status = excluded.status, additions = excluded.additions, deletions = excluded.deletions,
      changes = excluded.changes, previous_path = excluded.previous_path,
      blob_url = excluded.blob_url, raw_url = excluded.raw_url, patch = excluded.patch,
      synced_at = excluded.synced_at
    WHERE excluded.synced_at >= projection_github_pull_request_files.synced_at
  `;
  const saveCursorRow = (row: ProjectionSyncCursor) => sql`
    INSERT INTO projection_github_sync_cursors (
      sync_cursor_id, repository_connection_id, resource_type, cursor, etag, last_modified,
      last_successful_sync_at, last_attempt_at, error_summary
    ) VALUES (
      ${row.id}, ${row.repositoryConnectionId}, ${row.resourceType}, ${row.cursor}, ${row.etag},
      ${row.lastModified}, ${row.lastSuccessfulSyncAt}, ${row.lastAttemptAt}, ${row.errorSummary}
    ) ON CONFLICT (repository_connection_id, resource_type) DO UPDATE SET
      cursor = excluded.cursor, etag = excluded.etag, last_modified = excluded.last_modified,
      last_successful_sync_at = excluded.last_successful_sync_at,
      last_attempt_at = excluded.last_attempt_at, error_summary = excluded.error_summary
    WHERE projection_github_sync_cursors.last_attempt_at IS NULL
      OR excluded.last_attempt_at IS NULL
      OR excluded.last_attempt_at >= projection_github_sync_cursors.last_attempt_at
  `;
  const saveRateLimitRow = (row: ProjectionGitHubRateLimitState) => sql`
    INSERT INTO projection_github_rate_limits (
      github_rate_limit_state_id, github_account_id, kind, request_limit, remaining, used,
      reset_at, retry_after_seconds, blocked_operation, observed_at
    ) VALUES (
      ${row.id}, ${row.githubAccountId}, ${row.kind}, ${row.limit}, ${row.remaining}, ${row.used},
      ${row.resetAt}, ${row.retryAfterSeconds}, ${row.blockedOperation}, ${row.observedAt}
    ) ON CONFLICT (github_account_id, kind) DO UPDATE SET
      request_limit = excluded.request_limit, remaining = excluded.remaining, used = excluded.used,
      reset_at = excluded.reset_at, retry_after_seconds = excluded.retry_after_seconds,
      blocked_operation = excluded.blocked_operation, observed_at = excluded.observed_at
    WHERE excluded.observed_at >= projection_github_rate_limits.observed_at
  `;
  const saveBranchRow = (row: ProjectionGitHubBranchObservation) => sql`
    INSERT INTO projection_github_branch_observations (
      github_branch_observation_id, repository_connection_id, remote_name, branch_name,
      local_sha, remote_sha, relation, ahead_count, behind_count, observed_at
    ) VALUES (
      ${row.id}, ${row.repositoryConnectionId}, ${row.remoteName}, ${row.branchName},
      ${row.localSha}, ${row.remoteSha}, ${row.relation}, ${row.aheadCount}, ${row.behindCount},
      ${row.observedAt}
    ) ON CONFLICT (repository_connection_id, remote_name, branch_name) DO UPDATE SET
      local_sha = excluded.local_sha, remote_sha = excluded.remote_sha,
      relation = excluded.relation, ahead_count = excluded.ahead_count,
      behind_count = excluded.behind_count, observed_at = excluded.observed_at
    WHERE excluded.observed_at >= projection_github_branch_observations.observed_at
  `;

  const getAccountById: ProjectionGitHubWorkspaceRepositoryShape["getAccountById"] = (input) =>
    getAccountRow(input).pipe(sqlError("GitHubWorkspace.getAccountById"));
  const getRepositoryConnectionById: ProjectionGitHubWorkspaceRepositoryShape["getRepositoryConnectionById"] =
    (input) =>
      getConnectionRow(input).pipe(
        Effect.map(Option.map(toConnection)),
        sqlError("GitHubWorkspace.getRepositoryConnectionById"),
      );
  const getPullRequestById: ProjectionGitHubWorkspaceRepositoryShape["getPullRequestById"] = (
    input,
  ) =>
    getPullRequestByIdRow(input).pipe(
      Effect.map(Option.map(toPullRequest)),
      sqlError("GitHubWorkspace.getPullRequestById"),
    );

  const saveIssuePage: ProjectionGitHubWorkspaceRepositoryShape["saveIssuePage"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          if (
            input.cursor.repositoryConnectionId !== input.repositoryConnectionId ||
            input.cursor.resourceType !== "issues" ||
            input.records.some(
              (record) => record.repositoryConnectionId !== input.repositoryConnectionId,
            )
          ) {
            return yield* inconsistentPage(
              "GitHubWorkspace.saveIssuePage",
              "page records and cursor must belong to the requested repository",
            );
          }
          for (const record of input.records) yield* upsertIssueRow(record);
          yield* saveCursorRow(input.cursor);
        }),
      )
      .pipe(sqlError("GitHubWorkspace.saveIssuePage"));

  const savePullRequestPage: ProjectionGitHubWorkspaceRepositoryShape["savePullRequestPage"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          if (
            input.cursor.repositoryConnectionId !== input.repositoryConnectionId ||
            input.cursor.resourceType !== "pull_requests" ||
            input.records.some(
              (record) => record.repositoryConnectionId !== input.repositoryConnectionId,
            )
          ) {
            return yield* inconsistentPage(
              "GitHubWorkspace.savePullRequestPage",
              "page records and cursor must belong to the requested repository",
            );
          }
          for (const record of input.records) yield* upsertPullRequestRow(record, true);
          yield* saveCursorRow(input.cursor);
        }),
      )
      .pipe(sqlError("GitHubWorkspace.savePullRequestPage"));

  const savePullRequestDetail: ProjectionGitHubWorkspaceRepositoryShape["savePullRequestDetail"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const pullRequestId = input.pullRequest.id;
          const repositoryConnectionId = input.pullRequest.repositoryConnectionId;
          const invalidOwnership =
            input.cursor.repositoryConnectionId !== repositoryConnectionId ||
            input.cursor.resourceType !== "pull_request_detail" ||
            input.reviews.some((row) => row.pullRequestRecordId !== pullRequestId) ||
            input.threads.some((row) => row.pullRequestRecordId !== pullRequestId) ||
            input.checks.some(
              (row) =>
                row.repositoryConnectionId !== repositoryConnectionId ||
                row.headSha !== input.pullRequest.headSha ||
                (row.pullRequestRecordId !== null && row.pullRequestRecordId !== pullRequestId),
            ) ||
            input.commits.some((row) => row.pullRequestRecordId !== pullRequestId) ||
            input.changedFiles.some((row) => row.pullRequestRecordId !== pullRequestId);
          const threadIds = new Set(input.threads.map((thread) => thread.id));
          if (
            invalidOwnership ||
            input.comments.some((comment) => !threadIds.has(comment.reviewThreadId))
          ) {
            return yield* inconsistentPage(
              "GitHubWorkspace.savePullRequestDetail",
              "detail records and cursor must belong to the pull request",
            );
          }
          yield* upsertPullRequestRow(input.pullRequest);
          yield* sql`
              UPDATE projection_github_checks
              SET status = 'completed', conclusion = 'stale', synced_at = ${input.pullRequest.syncedAt}
              WHERE pull_request_record_id = ${pullRequestId}
                AND head_sha <> ${input.pullRequest.headSha}
            `;
          for (const row of input.reviews) yield* upsertReviewRow(row);
          for (const row of input.threads) yield* upsertThreadRow(row);
          for (const row of input.comments) yield* upsertCommentRow(row);
          for (const row of input.checks) yield* upsertCheckRow(row);
          for (const row of input.commits) yield* upsertCommitRow(row);
          for (const row of input.changedFiles) yield* upsertFileRow(row);
          yield* saveCursorRow(input.cursor);
        }),
      )
      .pipe(sqlError("GitHubWorkspace.savePullRequestDetail"));

  const freshnessFrom = (
    connection: ProjectionRepositoryConnection,
    cursors: ReadonlyArray<ProjectionSyncCursor>,
  ): GitHubDataFreshness => {
    if (connection.syncStatus === "not_synced") return "never_synced";
    if (connection.syncStatus === "offline") return "offline";
    if (
      connection.syncStatus === "partially_stale" ||
      cursors.some((cursor) => cursor.errorSummary !== null)
    ) {
      return "partial";
    }
    return connection.syncStatus === "current" ? "current" : "stale";
  };

  const getPullRequestDetail: ProjectionGitHubWorkspaceRepositoryShape["getPullRequestDetail"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const pullRequest = yield* getPullRequestById(input);
      if (Option.isNone(pullRequest)) return Option.none();
      const connection = yield* getRepositoryConnectionById({
        repositoryConnectionId: pullRequest.value.repositoryConnectionId,
      });
      if (Option.isNone(connection)) return Option.none();
      const [
        missionLinks,
        reviews,
        threads,
        comments,
        taskLinks,
        checks,
        commits,
        changedFiles,
        cursors,
      ] = yield* Effect.all([
        listMissionPullRequestLinkRows({
          missionId: null,
          pullRequestRecordId: pullRequest.value.id,
        }),
        listReviewRows(input),
        listThreadRows(input).pipe(Effect.map((rows) => rows.map(toThread))),
        listCommentsByPullRequestRows(input),
        listTaskLinksByPullRequestRows(input),
        listChecksByPullRequestRows(input).pipe(Effect.map((rows) => rows.map(toCheck))),
        listCommitRows(input),
        listFileRows(input),
        listCursorRows({ repositoryConnectionId: pullRequest.value.repositoryConnectionId }),
      ]);
      return Option.some({
        pullRequest: pullRequest.value,
        missionLinks,
        reviews,
        threads,
        comments,
        taskLinks,
        checks,
        commits,
        changedFiles,
        freshness: freshnessFrom(connection.value, cursors),
        syncedAt: pullRequest.value.syncedAt,
      });
    }).pipe(sqlError("GitHubWorkspace.getPullRequestDetail"));

  return {
    saveAccount: (row) =>
      saveAccountRow(row).pipe(sqlError("GitHubWorkspace.saveAccount"), Effect.asVoid),
    getAccountById,
    listAccounts: (input) => listAccountRows(input).pipe(sqlError("GitHubWorkspace.listAccounts")),
    saveRepositoryConnection: (row) =>
      saveConnectionRow(row).pipe(
        sqlError("GitHubWorkspace.saveRepositoryConnection"),
        Effect.asVoid,
      ),
    getRepositoryConnectionById,
    getRepositoryConnectionByProjectId: (input) =>
      getConnectionByProjectRow(input).pipe(
        Effect.map(Option.map(toConnection)),
        sqlError("GitHubWorkspace.getRepositoryConnectionByProjectId"),
      ),
    listRepositoryConnectionsByAccountId: (input) =>
      listConnectionsByAccountRows(input).pipe(
        Effect.map((rows) => rows.map(toConnection)),
        sqlError("GitHubWorkspace.listRepositoryConnectionsByAccountId"),
      ),
    deleteRepositoryConnection: (input) =>
      sql`
        DELETE FROM projection_github_repository_connections
        WHERE repository_connection_id = ${input.repositoryConnectionId}
      `.pipe(sqlError("GitHubWorkspace.deleteRepositoryConnection"), Effect.asVoid),
    saveIssuePage,
    upsertIssue: (row) =>
      upsertIssueRow(row).pipe(sqlError("GitHubWorkspace.upsertIssue"), Effect.asVoid),
    getIssue: (input) => getIssueRow(input).pipe(sqlError("GitHubWorkspace.getIssue")),
    listIssues: (input) => listIssueRows(input).pipe(sqlError("GitHubWorkspace.listIssues")),
    linkIssueMission: (input) =>
      sql
        .withTransaction(sql`
          INSERT INTO projection_github_issue_mission_links (
            issue_mission_link_id, repository_connection_id, github_issue_number, mission_id,
            link_type, created_at, updated_at
          ) VALUES (
            ${input.id}, ${input.repositoryConnectionId}, ${input.githubIssueNumber},
            ${input.missionId}, ${input.linkType}, ${input.createdAt}, ${input.updatedAt}
          ) ON CONFLICT (issue_mission_link_id) DO UPDATE SET
            link_type = excluded.link_type, updated_at = excluded.updated_at
        `)
        .pipe(sqlError("GitHubWorkspace.linkIssueMission"), Effect.asVoid),
    unlinkIssueMission: (input) =>
      sql
        .withTransaction(sql`
          DELETE FROM projection_github_issue_mission_links
          WHERE issue_mission_link_id = ${input.issueMissionLinkId}
        `)
        .pipe(sqlError("GitHubWorkspace.unlinkIssueMission"), Effect.asVoid),
    listIssueMissionLinks: (input) =>
      listIssueLinkRows(input).pipe(sqlError("GitHubWorkspace.listIssueMissionLinks")),
    savePullRequestPage,
    savePullRequestDetail,
    upsertPullRequest: (row) =>
      upsertPullRequestRow(row).pipe(sqlError("GitHubWorkspace.upsertPullRequest"), Effect.asVoid),
    getPullRequest: (input) =>
      getPullRequestRow(input).pipe(
        Effect.map(Option.map(toPullRequest)),
        sqlError("GitHubWorkspace.getPullRequest"),
      ),
    getPullRequestById,
    listPullRequests: (input) =>
      listPullRequestRows(input).pipe(
        Effect.map((rows) => rows.map(toPullRequest)),
        sqlError("GitHubWorkspace.listPullRequests"),
      ),
    getPullRequestDetail,
    linkMissionPullRequest: (input) =>
      sql
        .withTransaction(sql`
          INSERT INTO projection_github_mission_pull_request_links (
            mission_pull_request_link_id, mission_id, pull_request_record_id, relationship,
            created_at, updated_at
          ) VALUES (
            ${input.id}, ${input.missionId}, ${input.pullRequestRecordId}, ${input.relationship},
            ${input.createdAt}, ${input.updatedAt}
          ) ON CONFLICT (mission_pull_request_link_id) DO UPDATE SET
            relationship = excluded.relationship, updated_at = excluded.updated_at
        `)
        .pipe(sqlError("GitHubWorkspace.linkMissionPullRequest"), Effect.asVoid),
    unlinkMissionPullRequest: (input) =>
      sql
        .withTransaction(sql`
          DELETE FROM projection_github_mission_pull_request_links
          WHERE mission_pull_request_link_id = ${input.missionPullRequestLinkId}
        `)
        .pipe(sqlError("GitHubWorkspace.unlinkMissionPullRequest"), Effect.asVoid),
    listMissionPullRequestLinks: (input) =>
      listMissionPullRequestLinkRows(input).pipe(
        sqlError("GitHubWorkspace.listMissionPullRequestLinks"),
      ),
    listPullRequestReviews: (input) =>
      listReviewRows(input).pipe(sqlError("GitHubWorkspace.listPullRequestReviews")),
    upsertPullRequestReview: (row) =>
      upsertReviewRow(row).pipe(sqlError("GitHubWorkspace.upsertPullRequestReview"), Effect.asVoid),
    listReviewThreads: (input) =>
      listThreadRows(input).pipe(
        Effect.map((rows) => rows.map(toThread)),
        sqlError("GitHubWorkspace.listReviewThreads"),
      ),
    getReviewThreadById: (input) =>
      getReviewThreadByIdRow(input).pipe(
        Effect.map(Option.map(toThread)),
        sqlError("GitHubWorkspace.getReviewThreadById"),
      ),
    upsertReviewThread: (row) =>
      upsertThreadRow(row).pipe(sqlError("GitHubWorkspace.upsertReviewThread"), Effect.asVoid),
    listReviewComments: (input) =>
      listCommentRows(input).pipe(sqlError("GitHubWorkspace.listReviewComments")),
    getReviewCommentById: (input) =>
      getReviewCommentByIdRow(input).pipe(sqlError("GitHubWorkspace.getReviewCommentById")),
    upsertReviewComment: (row) =>
      upsertCommentRow(row).pipe(sqlError("GitHubWorkspace.upsertReviewComment"), Effect.asVoid),
    linkReviewCommentTask: (input) =>
      sql
        .withTransaction(sql`
          INSERT INTO projection_github_review_comment_task_links (
            review_comment_task_link_id, review_comment_record_id, task_id, status,
            created_at, updated_at
          ) VALUES (
            ${input.id}, ${input.reviewCommentRecordId}, ${input.taskId}, ${input.status},
            ${input.createdAt}, ${input.updatedAt}
          ) ON CONFLICT (review_comment_task_link_id) DO UPDATE SET
            status = excluded.status, updated_at = excluded.updated_at
        `)
        .pipe(sqlError("GitHubWorkspace.linkReviewCommentTask"), Effect.asVoid),
    unlinkReviewCommentTask: (input) =>
      sql
        .withTransaction(sql`
          DELETE FROM projection_github_review_comment_task_links
          WHERE review_comment_task_link_id = ${input.reviewCommentTaskLinkId}
        `)
        .pipe(sqlError("GitHubWorkspace.unlinkReviewCommentTask"), Effect.asVoid),
    listReviewCommentTaskLinks: (input) =>
      listTaskLinkRows(input).pipe(sqlError("GitHubWorkspace.listReviewCommentTaskLinks")),
    listChecks: (input) =>
      listCheckRows(input).pipe(
        Effect.map((rows) => rows.map(toCheck)),
        sqlError("GitHubWorkspace.listChecks"),
      ),
    upsertCheck: (row) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            if (row.pullRequestRecordId === null) {
              yield* upsertCheckRow(row);
              return;
            }
            const pullRequest = yield* getPullRequestByIdRow({
              pullRequestRecordId: row.pullRequestRecordId,
            });
            yield* upsertCheckRow(
              Option.isSome(pullRequest) && pullRequest.value.headSha !== row.headSha
                ? { ...row, status: "completed", conclusion: "stale" }
                : row,
            );
          }),
        )
        .pipe(sqlError("GitHubWorkspace.upsertCheck"), Effect.asVoid),
    upsertPullRequestCommit: (row) =>
      upsertCommitRow(row).pipe(sqlError("GitHubWorkspace.upsertPullRequestCommit"), Effect.asVoid),
    upsertPullRequestFile: (row) =>
      upsertFileRow(row).pipe(sqlError("GitHubWorkspace.upsertPullRequestFile"), Effect.asVoid),
    saveSyncCursor: (row) =>
      saveCursorRow(row).pipe(sqlError("GitHubWorkspace.saveSyncCursor"), Effect.asVoid),
    listSyncCursors: (input) =>
      listCursorRows(input).pipe(sqlError("GitHubWorkspace.listSyncCursors")),
    saveRateLimit: (row) =>
      saveRateLimitRow(row).pipe(sqlError("GitHubWorkspace.saveRateLimit"), Effect.asVoid),
    listRateLimits: (input) =>
      listRateLimitRows(input).pipe(sqlError("GitHubWorkspace.listRateLimits")),
    saveBranchObservation: (row) =>
      saveBranchRow(row).pipe(sqlError("GitHubWorkspace.saveBranchObservation"), Effect.asVoid),
    listBranchObservations: (input) =>
      listBranchRows(input).pipe(sqlError("GitHubWorkspace.listBranchObservations")),
  } satisfies ProjectionGitHubWorkspaceRepositoryShape;
});

export const ProjectionGitHubWorkspaceRepositoryLive = Layer.effect(
  ProjectionGitHubWorkspaceRepository,
  make,
);
