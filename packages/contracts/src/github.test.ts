import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import {
  GitHubAccount,
  GitHubAccountId,
  GitHubCheckRecord,
  GitHubCheckRecordId,
  ListGitHubIssuesInput,
  PullRequestRecordId,
  RepositoryConnection,
  RepositoryConnectionId,
  canTransitionGitHubAccount,
  canTransitionGitHubCheck,
  canTransitionRepositorySync,
  canTransitionReviewCommentTask,
} from "./github.ts";

const now = "2026-08-03T00:00:00.000Z";
const accountId = GitHubAccountId.make("github-account-contract");
const connectionId = RepositoryConnectionId.make("github-connection-contract");
const decodeAccount = Schema.decodeUnknownSync(GitHubAccount);
const decodeConnection = Schema.decodeUnknownSync(RepositoryConnection);
const decodeIssueListInput = Schema.decodeUnknownSync(ListGitHubIssuesInput);
const decodeCheck = Schema.decodeUnknownSync(GitHubCheckRecord);

it("decodes account and repository metadata without retaining credentials", () => {
  const account = decodeAccount({
    id: accountId,
    providerAccountId: "42",
    login: "octocat",
    displayName: null,
    avatarUrl: null,
    serverUrl: "https://github.com",
    authenticationType: "oauth_device_flow",
    scopes: ["read:user"],
    status: "connected",
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: now,
    token: "must-not-cross-the-contract",
  });
  assert.strictEqual("token" in account, false);

  const connection = decodeConnection({
    id: connectionId,
    projectId: ProjectId.make("github-project-contract"),
    githubAccountId: accountId,
    owner: "acme",
    repository: "widget",
    repositoryId: "9001",
    serverUrl: "https://github.com",
    htmlUrl: "https://github.com/acme/widget",
    remoteName: "origin",
    remoteUrl: "git@github.com:acme/widget.git",
    defaultBranch: "main",
    visibility: "private",
    permissions: {
      level: "read",
      canRead: true,
      canTriage: false,
      canPush: false,
      canMaintain: false,
      canAdmin: false,
    },
    isArchived: false,
    isFork: false,
    parentRepository: null,
    syncStatus: "current",
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  assert.strictEqual(connection.permissions.canPush, false);
});

it("bounds local page queries and validates normalized check state", () => {
  assert.throws(() =>
    decodeIssueListInput({
      repositoryConnectionId: connectionId,
      state: null,
      limit: 251,
      offset: 0,
    }),
  );

  const check = decodeCheck({
    id: GitHubCheckRecordId.make("github-check-contract"),
    pullRequestRecordId: PullRequestRecordId.make("github-pr-contract"),
    repositoryConnectionId: connectionId,
    githubCheckId: "100",
    name: "test",
    provider: "GitHub Actions",
    headSha: "abc123",
    status: "completed",
    conclusion: "timed_out",
    isRequired: true,
    detailsUrl: null,
    startedAtRemote: now,
    completedAtRemote: now,
    summary: null,
    syncedAt: now,
  });
  assert.strictEqual(check.conclusion, "timed_out");
  assert.throws(() => decodeCheck({ ...check, status: "passed" }));
});

it("allows recovery transitions while keeping completed checks terminal", () => {
  assert.strictEqual(canTransitionGitHubAccount("expired", "connected"), true);
  assert.strictEqual(canTransitionGitHubAccount("disconnected", "revoked"), false);
  assert.strictEqual(canTransitionRepositorySync("current", "partially_stale"), true);
  assert.strictEqual(canTransitionReviewCommentTask("verified", "resolved"), true);
  assert.strictEqual(canTransitionReviewCommentTask("resolved", "addressing"), true);
  assert.strictEqual(canTransitionGitHubCheck("queued", "completed"), true);
  assert.strictEqual(canTransitionGitHubCheck("completed", "in_progress"), false);
});
