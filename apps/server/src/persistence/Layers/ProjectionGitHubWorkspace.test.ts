// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  GitHubAccountId,
  GitHubBranchObservationId,
  GitHubCheckRecordId,
  GitHubIssueRecordId,
  GitHubRateLimitStateId,
  IssueMissionLinkId,
  MissionId,
  MissionPullRequestLinkId,
  MissionTaskId,
  ProjectId,
  PullRequestRecordId,
  PullRequestReviewRecordId,
  RepositoryConnectionId,
  ReviewCommentRecordId,
  ReviewCommentTaskLinkId,
  ReviewThreadRecordId,
  SyncCursorId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlClientService from "effect/unstable/sql/SqlClient";

import { ProjectionGitHubWorkspaceRepository } from "../Services/ProjectionGitHubWorkspace.ts";
import { ProjectionGitHubWorkspaceRepositoryLive } from "./ProjectionGitHubWorkspace.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";

const now = "2026-08-03T08:00:00.000Z";
const later = "2026-08-03T08:05:00.000Z";
const earlier = "2026-08-03T07:55:00.000Z";
const projectId = ProjectId.make("github-project");
const missionId = MissionId.make("github-mission");
const taskId = MissionTaskId.make("github-task");
const accountId = GitHubAccountId.make("github-account");
const connectionId = RepositoryConnectionId.make("github-repository-connection");
const issueId = GitHubIssueRecordId.make("github-issue-7");
const pullRequestId = PullRequestRecordId.make("github-pr-11");

const actor = {
  login: "octocat",
  displayName: "The Octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  htmlUrl: "https://github.com/octocat",
};
const account = {
  id: accountId,
  providerAccountId: "1",
  login: "octocat",
  displayName: "The Octocat",
  avatarUrl: actor.avatarUrl,
  serverUrl: "https://github.com",
  authenticationType: "oauth_device_flow" as const,
  scopes: ["repo:status", "read:user"],
  status: "connected" as const,
  createdAt: now,
  updatedAt: now,
  lastValidatedAt: now,
};
const connection = {
  id: connectionId,
  projectId,
  githubAccountId: accountId,
  owner: "acme",
  repository: "widget",
  repositoryId: "9001",
  serverUrl: "https://github.com",
  htmlUrl: "https://github.com/acme/widget",
  remoteName: "origin",
  remoteUrl: "git@github.com:acme/widget.git",
  defaultBranch: "main",
  visibility: "private" as const,
  permissions: {
    level: "write" as const,
    canRead: true,
    canTriage: true,
    canPush: true,
    canMaintain: false,
    canAdmin: false,
  },
  isArchived: false,
  isFork: false,
  parentRepository: null,
  syncStatus: "current" as const,
  lastSyncedAt: now,
  createdAt: now,
  updatedAt: now,
};
const issue = {
  id: issueId,
  repositoryConnectionId: connectionId,
  githubIssueId: "issue-node-7",
  number: 7,
  title: "Persist GitHub state",
  bodyPreview: "Keep cached records available while offline.",
  state: "open" as const,
  author: actor,
  assignees: [actor],
  labels: [{ name: "phase-4", color: "663399", description: null }],
  milestone: { number: 4, title: "Phase 4", state: "open" as const, dueOn: null },
  commentCount: 2,
  htmlUrl: "https://github.com/acme/widget/issues/7",
  createdAtRemote: now,
  updatedAtRemote: now,
  closedAtRemote: null,
  syncedAt: now,
};
const pullRequest = {
  id: pullRequestId,
  repositoryConnectionId: connectionId,
  githubPullRequestId: "pr-node-11",
  number: 11,
  title: "Draft GitHub workspace",
  bodyPreview: "Local evidence and remote checks stay separate.",
  state: "open" as const,
  isDraft: true,
  author: actor,
  headRef: "agent/mission/github",
  headSha: "abc123",
  baseRef: "main",
  baseSha: "def456",
  mergeableState: "draft" as const,
  reviewDecision: "review_required" as const,
  changedFileCount: 1,
  commitCount: 1,
  commentCount: 1,
  requiredCheckNames: ["test"],
  htmlUrl: "https://github.com/acme/widget/pull/11",
  createdAtRemote: now,
  updatedAtRemote: now,
  mergedAtRemote: null,
  closedAtRemote: null,
  syncedAt: now,
};

const seedLocalState = Effect.gen(function* () {
  const sql = yield* SqlClientService.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'GitHub', '/repo', NULL, '[]', ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_missions (
      mission_id, project_id, title, description, status, created_at, updated_at,
      started_at, completed_at, cancelled_at
    ) VALUES (${missionId}, ${projectId}, 'GitHub mission', '', 'review', ${now}, ${now}, ${now}, NULL, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_mission_tasks (
      task_id, mission_id, title, description, status, position, created_at, updated_at,
      started_at, completed_at
    ) VALUES (${taskId}, ${missionId}, 'Address review', '', 'running', 0, ${now}, ${now}, ${now}, NULL)
  `;
});

function makeLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  return Layer.mergeAll(
    ProjectionGitHubWorkspaceRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  );
}

const issueCursor = {
  id: SyncCursorId.make("github-issues-cursor"),
  repositoryConnectionId: connectionId,
  resourceType: "issues" as const,
  cursor: "page-2",
  etag: '"issues-etag"',
  lastModified: null,
  lastSuccessfulSyncAt: now,
  lastAttemptAt: now,
  errorSummary: null,
};

const layer = it.layer(makeLayer(SqlitePersistenceMemory));

layer("GitHub workspace persistence", (it) => {
  it.effect("persists paged caches, links, rate limits, and branch observations", () =>
    Effect.gen(function* () {
      yield* seedLocalState;
      const repository = yield* ProjectionGitHubWorkspaceRepository;
      yield* repository.saveAccount(account);
      yield* repository.saveRepositoryConnection(connection);
      yield* repository.saveIssuePage({
        repositoryConnectionId: connectionId,
        records: [issue],
        cursor: issueCursor,
        pageInfo: { endCursor: "page-2", hasNextPage: true, totalCount: 12 },
      });
      yield* repository.upsertIssue({ ...issue, title: "Stale title", syncedAt: earlier });
      yield* repository.linkIssueMission({
        id: IssueMissionLinkId.make("issue-mission-link"),
        repositoryConnectionId: connectionId,
        githubIssueNumber: 7,
        missionId,
        linkType: "implements",
        createdAt: now,
        updatedAt: now,
      });
      yield* repository.saveRateLimit({
        id: GitHubRateLimitStateId.make("github-rate-core"),
        githubAccountId: accountId,
        kind: "core",
        limit: 5_000,
        remaining: 4_999,
        used: 1,
        resetAt: later,
        retryAfterSeconds: null,
        blockedOperation: null,
        observedAt: now,
      });
      yield* repository.saveBranchObservation({
        id: GitHubBranchObservationId.make("github-branch-observation"),
        repositoryConnectionId: connectionId,
        remoteName: "origin",
        branchName: "agent/mission/github",
        localSha: "abc123",
        remoteSha: "abc123",
        relation: "equal",
        aheadCount: 0,
        behindCount: 0,
        observedAt: now,
      });

      const storedConnection = yield* repository.getRepositoryConnectionByProjectId({ projectId });
      assert.ok(Option.isSome(storedConnection));
      assert.deepStrictEqual(storedConnection.value.permissions, connection.permissions);
      assert.strictEqual(
        (yield* repository.listIssues({
          repositoryConnectionId: connectionId,
          state: "open",
          limit: 50,
          offset: 0,
        }))[0]?.title,
        issue.title,
      );
      assert.strictEqual(
        (yield* repository.listIssueMissionLinks({
          repositoryConnectionId: connectionId,
          githubIssueNumber: 7,
          missionId: null,
        })).length,
        1,
      );
      assert.strictEqual(
        (yield* repository.listSyncCursors({
          repositoryConnectionId: connectionId,
        }))[0]?.cursor,
        "page-2",
      );
      assert.strictEqual(
        (yield* repository.listRateLimits({ githubAccountId: accountId }))[0]?.remaining,
        4_999,
      );
      assert.strictEqual(
        (yield* repository.listBranchObservations({
          repositoryConnectionId: connectionId,
        }))[0]?.relation,
        "equal",
      );
    }),
  );

  it.effect("rolls back a mixed-repository page instead of partially caching it", () =>
    Effect.gen(function* () {
      yield* seedLocalState;
      const repository = yield* ProjectionGitHubWorkspaceRepository;
      yield* repository.saveAccount(account);
      yield* repository.saveRepositoryConnection(connection);
      const issueCountBefore = (yield* repository.listIssues({
        repositoryConnectionId: connectionId,
        state: null,
        limit: 50,
        offset: 0,
      })).length;
      const cursorsBefore = yield* repository.listSyncCursors({
        repositoryConnectionId: connectionId,
      });
      const failure = yield* Effect.flip(
        repository.saveIssuePage({
          repositoryConnectionId: connectionId,
          records: [
            issue,
            {
              ...issue,
              id: GitHubIssueRecordId.make("wrong-issue"),
              repositoryConnectionId: RepositoryConnectionId.make("another-repository"),
              githubIssueId: "wrong-node",
              number: 8,
            },
          ],
          cursor: issueCursor,
          pageInfo: { endCursor: null, hasNextPage: false, totalCount: 2 },
        }),
      );
      assert.strictEqual(failure._tag, "PersistenceSqlError");
      const issuesAfter = yield* repository.listIssues({
        repositoryConnectionId: connectionId,
        state: null,
        limit: 50,
        offset: 0,
      });
      assert.strictEqual(issuesAfter.length, issueCountBefore);
      assert.strictEqual(
        issuesAfter.some((record) => record.number === 8),
        false,
      );
      assert.deepStrictEqual(
        yield* repository.listSyncCursors({
          repositoryConnectionId: connectionId,
        }),
        cursorsBefore,
      );
    }),
  );

  it.effect(
    "persists PR detail evidence and review-comment task links without resolving threads",
    () =>
      Effect.gen(function* () {
        yield* seedLocalState;
        const repository = yield* ProjectionGitHubWorkspaceRepository;
        yield* repository.saveAccount(account);
        yield* repository.saveRepositoryConnection(connection);
        yield* repository.saveIssuePage({
          repositoryConnectionId: connectionId,
          records: [issue],
          cursor: issueCursor,
          pageInfo: { endCursor: "page-2", hasNextPage: true, totalCount: 12 },
        });
        const reviewId = PullRequestReviewRecordId.make("github-review-1");
        const threadId = ReviewThreadRecordId.make("github-thread-1");
        const commentId = ReviewCommentRecordId.make("github-comment-1");
        yield* repository.savePullRequestDetail({
          pullRequest,
          reviews: [
            {
              id: reviewId,
              pullRequestRecordId: pullRequestId,
              githubReviewId: "review-node-1",
              author: actor,
              state: "changes_requested",
              bodyPreview: "Please cover the offline case.",
              submittedAt: now,
              commitSha: "abc123",
              syncedAt: now,
            },
          ],
          threads: [
            {
              id: threadId,
              pullRequestRecordId: pullRequestId,
              githubThreadId: "thread-node-1",
              path: "src/github.ts",
              line: 42,
              originalLine: 40,
              side: "RIGHT",
              isResolved: false,
              isOutdated: false,
              createdAtRemote: now,
              updatedAtRemote: now,
              syncedAt: now,
            },
          ],
          comments: [
            {
              id: commentId,
              reviewThreadId: threadId,
              githubCommentId: "comment-node-1",
              author: actor,
              body: "Do not delete cached records after a failed refresh.",
              path: "src/github.ts",
              line: 42,
              commitSha: "abc123",
              htmlUrl: "https://github.com/acme/widget/pull/11#discussion_r1",
              createdAtRemote: now,
              updatedAtRemote: now,
              syncedAt: now,
            },
          ],
          checks: [
            {
              id: GitHubCheckRecordId.make("github-check-1"),
              pullRequestRecordId: pullRequestId,
              repositoryConnectionId: connectionId,
              githubCheckId: "check-run-1",
              name: "test",
              provider: "GitHub Actions",
              headSha: "abc123",
              status: "completed",
              conclusion: "success",
              isRequired: true,
              detailsUrl: "https://github.com/acme/widget/actions/runs/1",
              startedAtRemote: now,
              completedAtRemote: later,
              summary: "All tests passed",
              syncedAt: later,
            },
          ],
          commits: [
            {
              pullRequestRecordId: pullRequestId,
              sha: "abc123",
              message: "feat: add GitHub workspace",
              author: actor,
              authoredAt: now,
              committedAt: now,
              htmlUrl: "https://github.com/acme/widget/commit/abc123",
              syncedAt: now,
            },
          ],
          changedFiles: [
            {
              pullRequestRecordId: pullRequestId,
              path: "src/github.ts",
              status: "added",
              additions: 42,
              deletions: 0,
              changes: 42,
              previousPath: null,
              blobUrl: "https://github.com/acme/widget/blob/abc123/src/github.ts",
              rawUrl: null,
              patch: "@@ -0,0 +1 @@",
              syncedAt: now,
            },
          ],
          cursor: {
            ...issueCursor,
            id: SyncCursorId.make("github-pr-detail-cursor"),
            resourceType: "pull_request_detail",
            cursor: null,
          },
        });
        yield* repository.linkMissionPullRequest({
          id: MissionPullRequestLinkId.make("mission-pr-link"),
          missionId,
          pullRequestRecordId: pullRequestId,
          relationship: "primary",
          createdAt: now,
          updatedAt: now,
        });
        yield* repository.linkReviewCommentTask({
          id: ReviewCommentTaskLinkId.make("review-task-link"),
          reviewCommentRecordId: commentId,
          taskId,
          status: "addressed",
          createdAt: now,
          updatedAt: later,
        });

        const detail = yield* repository.getPullRequestDetail({
          pullRequestRecordId: pullRequestId,
        });
        assert.ok(Option.isSome(detail));
        assert.strictEqual(detail.value.reviews[0]?.state, "changes_requested");
        assert.strictEqual(detail.value.threads[0]?.isResolved, false);
        assert.strictEqual(detail.value.taskLinks[0]?.status, "addressed");
        assert.strictEqual(detail.value.checks[0]?.headSha, pullRequest.headSha);
        assert.strictEqual(detail.value.commits[0]?.sha, pullRequest.headSha);
        assert.strictEqual(detail.value.changedFiles[0]?.path, "src/github.ts");

        yield* repository.savePullRequestPage({
          repositoryConnectionId: connectionId,
          records: [
            {
              ...pullRequest,
              reviewDecision: "none",
              requiredCheckNames: [],
              syncedAt: later,
            },
          ],
          cursor: {
            ...issueCursor,
            id: SyncCursorId.make("github-pr-list-cursor"),
            resourceType: "pull_requests",
            cursor: null,
            lastSuccessfulSyncAt: later,
            lastAttemptAt: later,
          },
          pageInfo: { endCursor: null, hasNextPage: false, totalCount: 1 },
        });
        const afterSummaryRefresh = yield* repository.getPullRequestById({
          pullRequestRecordId: pullRequestId,
        });
        assert.ok(Option.isSome(afterSummaryRefresh));
        assert.strictEqual(afterSummaryRefresh.value.reviewDecision, "review_required");
        assert.deepStrictEqual(afterSummaryRefresh.value.requiredCheckNames, ["test"]);

        yield* repository.savePullRequestDetail({
          pullRequest: {
            ...pullRequest,
            headSha: "new789",
            updatedAtRemote: later,
            syncedAt: later,
          },
          reviews: [],
          threads: [],
          comments: [],
          checks: [],
          commits: [],
          changedFiles: [],
          cursor: {
            ...issueCursor,
            id: SyncCursorId.make("github-pr-detail-cursor-new-head"),
            resourceType: "pull_request_detail",
            cursor: null,
            lastSuccessfulSyncAt: later,
            lastAttemptAt: later,
          },
        });
        const newerHeadDetail = yield* repository.getPullRequestDetail({
          pullRequestRecordId: pullRequestId,
        });
        assert.ok(Option.isSome(newerHeadDetail));
        assert.strictEqual(newerHeadDetail.value.pullRequest.headSha, "new789");
        assert.strictEqual(newerHeadDetail.value.checks[0]?.conclusion, "stale");
        yield* repository.upsertCheck({
          ...detail.value.checks[0]!,
          conclusion: "success",
          syncedAt: later,
        });
        assert.strictEqual(
          (yield* repository.getPullRequestDetail({ pullRequestRecordId: pullRequestId })).pipe(
            Option.flatMap((snapshot) => Option.fromNullishOr(snapshot.checks[0])),
            Option.map((check) => check.conclusion),
            Option.getOrNull,
          ),
          "stale",
        );
        yield* repository.upsertPullRequest(pullRequest);
        assert.strictEqual(
          (yield* repository.getPullRequestById({ pullRequestRecordId: pullRequestId })).pipe(
            Option.map((record) => record.headSha),
            Option.getOrNull,
          ),
          "new789",
        );

        yield* repository.saveSyncCursor({
          ...issueCursor,
          lastAttemptAt: later,
          errorSummary: "Review-thread request failed",
        });
        assert.strictEqual(
          (yield* repository.listIssues({
            repositoryConnectionId: connectionId,
            state: null,
            limit: 50,
            offset: 0,
          })).some((record) => record.id === issueId),
          true,
        );
        assert.strictEqual(
          (yield* repository.getPullRequestDetail({ pullRequestRecordId: pullRequestId })).pipe(
            Option.map((snapshot) => snapshot.freshness),
            Option.getOrNull,
          ),
          "partial",
        );
      }),
  );
});

describe("GitHub workspace restart recovery", () => {
  it.effect("reopens cached records and sync cursors without duplicate links", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-github-workspace-"))),
      (tempDir) =>
        Effect.gen(function* () {
          const dbPath = NodePath.join(tempDir, "state.sqlite");
          yield* Effect.gen(function* () {
            yield* seedLocalState;
            const repository = yield* ProjectionGitHubWorkspaceRepository;
            yield* repository.saveAccount(account);
            yield* repository.saveRepositoryConnection(connection);
            yield* repository.saveIssuePage({
              repositoryConnectionId: connectionId,
              records: [issue],
              cursor: issueCursor,
              pageInfo: { endCursor: "page-2", hasNextPage: true, totalCount: 12 },
            });
            yield* repository.linkIssueMission({
              id: IssueMissionLinkId.make("restart-issue-link"),
              repositoryConnectionId: connectionId,
              githubIssueNumber: 7,
              missionId,
              linkType: "implements",
              createdAt: now,
              updatedAt: now,
            });
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));

          yield* Effect.gen(function* () {
            const repository = yield* ProjectionGitHubWorkspaceRepository;
            assert.strictEqual(
              (yield* repository.listIssues({
                repositoryConnectionId: connectionId,
                state: null,
                limit: 50,
                offset: 0,
              })).length,
              1,
            );
            assert.strictEqual(
              (yield* repository.listSyncCursors({
                repositoryConnectionId: connectionId,
              }))[0]?.cursor,
              "page-2",
            );
            assert.strictEqual(
              (yield* repository.listIssueMissionLinks({
                repositoryConnectionId: connectionId,
                githubIssueNumber: 7,
                missionId,
              })).length,
              1,
            );
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));
        }),
      (tempDir) => Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
