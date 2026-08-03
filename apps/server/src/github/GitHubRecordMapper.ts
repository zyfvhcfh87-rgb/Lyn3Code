import {
  GitHubAccountId,
  GitHubBranchObservationId,
  GitHubCheckRecordId,
  GitHubIssueRecordId,
  GitHubRateLimitStateId,
  type GitHubActor,
  type GitHubCheckRecord,
  type GitHubIssueRecord,
  type GitHubPullRequestCommitRecord,
  type GitHubPullRequestFileRecord,
  type GitHubRateLimitState,
  type GitHubSyncResourceType,
  PullRequestRecordId,
  type PullRequestRecord,
  PullRequestReviewRecordId,
  type PullRequestReviewRecord,
  RepositoryConnectionId,
  ReviewCommentRecordId,
  type ReviewCommentRecord,
  ReviewThreadRecordId,
  type ReviewThreadRecord,
  SyncCursorId,
  type SyncCursor,
  type RepositoryConnection,
  type GitHubAccount,
} from "@t3tools/contracts";

import type {
  GitHubApiAccountIdentity,
  GitHubApiActor,
  GitHubApiCheck,
  GitHubApiIssue,
  GitHubApiPullRequest,
  GitHubApiPullRequestCommit,
  GitHubApiPullRequestFile,
  GitHubApiRateLimitResource,
  GitHubApiRepository,
  GitHubApiReview,
  GitHubApiReviewComment,
  GitHubApiReviewThread,
  GitHubRateLimit,
  GitHubResponseMetadata,
} from "./GitHubApiClient.ts";

const keyPart = (value: string) => encodeURIComponent(value.toLowerCase());

export const accountIdFor = (serverUrl: string, providerAccountId: string) =>
  GitHubAccountId.make(`github-account:${keyPart(serverUrl)}:${keyPart(providerAccountId)}`);

export const repositoryConnectionIdFor = (accountId: GitHubAccountId, repositoryId: string) =>
  RepositoryConnectionId.make(`github-repository:${accountId}:${keyPart(repositoryId)}`);

export const issueRecordIdFor = (connectionId: RepositoryConnectionId, githubIssueId: string) =>
  GitHubIssueRecordId.make(`github-issue:${connectionId}:${keyPart(githubIssueId)}`);

export const pullRequestRecordIdFor = (
  connectionId: RepositoryConnectionId,
  githubPullRequestId: string,
) => PullRequestRecordId.make(`github-pr:${connectionId}:${keyPart(githubPullRequestId)}`);

export const reviewRecordIdFor = (pullRequestId: PullRequestRecordId, githubReviewId: string) =>
  PullRequestReviewRecordId.make(`github-review:${pullRequestId}:${keyPart(githubReviewId)}`);

export const reviewThreadRecordIdFor = (
  pullRequestId: PullRequestRecordId,
  githubThreadId: string,
) => ReviewThreadRecordId.make(`github-thread:${pullRequestId}:${keyPart(githubThreadId)}`);

export const reviewCommentRecordIdFor = (threadId: ReviewThreadRecordId, githubCommentId: string) =>
  ReviewCommentRecordId.make(`github-comment:${threadId}:${keyPart(githubCommentId)}`);

export const toGitHubActor = (actor: GitHubApiActor): GitHubActor => ({ ...actor });

export function toGitHubAccount(input: {
  readonly identity: GitHubApiAccountIdentity;
  readonly now: string;
  readonly existing: GitHubAccount | null;
}): GitHubAccount {
  const id = accountIdFor(input.identity.serverUrl, input.identity.providerAccountId);
  return {
    id,
    providerAccountId: input.identity.providerAccountId,
    login: input.identity.login,
    displayName: input.identity.displayName,
    avatarUrl: input.identity.avatarUrl,
    serverUrl: input.identity.serverUrl,
    authenticationType: "gh_cli",
    scopes: [...input.identity.scopes],
    status: "connected",
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
    lastValidatedAt: input.now,
  };
}

export function toRepositoryConnection(input: {
  readonly projectId: RepositoryConnection["projectId"];
  readonly accountId: GitHubAccountId;
  readonly repository: GitHubApiRepository;
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly serverUrl: string;
  readonly now: string;
  readonly existing: RepositoryConnection | null;
}): RepositoryConnection {
  const id = repositoryConnectionIdFor(input.accountId, input.repository.repositoryId);
  return {
    id,
    projectId: input.projectId,
    githubAccountId: input.accountId,
    owner: input.repository.owner,
    repository: input.repository.repository,
    repositoryId: input.repository.repositoryId,
    serverUrl: input.serverUrl,
    htmlUrl: input.repository.htmlUrl,
    remoteName: input.remoteName,
    remoteUrl: input.remoteUrl,
    defaultBranch: input.repository.defaultBranch,
    visibility: input.repository.visibility,
    permissions: input.repository.permissions,
    isArchived: input.repository.isArchived,
    isFork: input.repository.isFork,
    parentRepository: input.repository.parentRepository,
    syncStatus: "current",
    lastSyncedAt: input.now,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

export function toIssueRecord(
  connectionId: RepositoryConnectionId,
  issue: GitHubApiIssue,
  syncedAt: string,
): GitHubIssueRecord {
  return {
    id: issueRecordIdFor(connectionId, issue.githubIssueId),
    repositoryConnectionId: connectionId,
    githubIssueId: issue.githubIssueId,
    number: issue.number,
    title: issue.title,
    bodyPreview: issue.bodyPreview,
    state: issue.state,
    author: toGitHubActor(issue.author),
    assignees: issue.assignees.map(toGitHubActor),
    labels: issue.labels.map((label) => ({ ...label })),
    milestone: issue.milestone,
    commentCount: issue.commentCount,
    htmlUrl: issue.htmlUrl,
    createdAtRemote: issue.createdAtRemote,
    updatedAtRemote: issue.updatedAtRemote,
    closedAtRemote: issue.closedAtRemote,
    syncedAt,
  };
}

export function toPullRequestRecord(input: {
  readonly connectionId: RepositoryConnectionId;
  readonly pullRequest: GitHubApiPullRequest;
  readonly requiredCheckNames?: ReadonlyArray<string>;
  readonly syncedAt: string;
}): PullRequestRecord {
  const pullRequest = input.pullRequest;
  return {
    id: pullRequestRecordIdFor(input.connectionId, pullRequest.githubPullRequestId),
    repositoryConnectionId: input.connectionId,
    githubPullRequestId: pullRequest.githubPullRequestId,
    number: pullRequest.number,
    title: pullRequest.title,
    bodyPreview: pullRequest.bodyPreview,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    author: toGitHubActor(pullRequest.author),
    headRef: pullRequest.headRef,
    headSha: pullRequest.headSha,
    baseRef: pullRequest.baseRef,
    baseSha: pullRequest.baseSha,
    mergeableState: pullRequest.mergeableState,
    reviewDecision: pullRequest.reviewDecision,
    changedFileCount: pullRequest.changedFileCount,
    commitCount: pullRequest.commitCount,
    commentCount: pullRequest.commentCount,
    requiredCheckNames: [...(input.requiredCheckNames ?? pullRequest.requiredCheckNames)],
    htmlUrl: pullRequest.htmlUrl,
    createdAtRemote: pullRequest.createdAtRemote,
    updatedAtRemote: pullRequest.updatedAtRemote,
    mergedAtRemote: pullRequest.mergedAtRemote,
    closedAtRemote: pullRequest.closedAtRemote,
    syncedAt: input.syncedAt,
  };
}

export function toReviewRecord(
  pullRequestId: PullRequestRecordId,
  review: GitHubApiReview,
  syncedAt: string,
): PullRequestReviewRecord {
  return {
    id: reviewRecordIdFor(pullRequestId, review.githubReviewId),
    pullRequestRecordId: pullRequestId,
    githubReviewId: review.githubReviewId,
    author: toGitHubActor(review.author),
    state: review.state,
    bodyPreview: review.bodyPreview,
    submittedAt: review.submittedAt,
    commitSha: review.commitSha,
    syncedAt,
  };
}

export function toReviewThreadRecord(
  pullRequestId: PullRequestRecordId,
  thread: GitHubApiReviewThread,
  syncedAt: string,
): ReviewThreadRecord {
  return {
    id: reviewThreadRecordIdFor(pullRequestId, thread.githubThreadId),
    pullRequestRecordId: pullRequestId,
    githubThreadId: thread.githubThreadId,
    path: thread.path,
    line: thread.line,
    originalLine: thread.originalLine,
    side: thread.side,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    createdAtRemote: thread.createdAtRemote,
    updatedAtRemote: thread.updatedAtRemote,
    syncedAt,
  };
}

export function toReviewCommentRecord(
  threadId: ReviewThreadRecordId,
  comment: GitHubApiReviewComment,
  syncedAt: string,
): ReviewCommentRecord {
  return {
    id: reviewCommentRecordIdFor(threadId, comment.githubCommentId),
    reviewThreadId: threadId,
    githubCommentId: comment.githubCommentId,
    author: toGitHubActor(comment.author),
    body: comment.body,
    path: comment.path,
    line: comment.line,
    commitSha: comment.commitSha,
    htmlUrl: comment.htmlUrl,
    createdAtRemote: comment.createdAtRemote,
    updatedAtRemote: comment.updatedAtRemote,
    syncedAt,
  };
}

export function toCheckRecord(input: {
  readonly connectionId: RepositoryConnectionId;
  readonly pullRequestId: PullRequestRecordId | null;
  readonly check: GitHubApiCheck;
  readonly requiredCheckNames: ReadonlySet<string>;
  readonly syncedAt: string;
}): GitHubCheckRecord {
  return {
    id: GitHubCheckRecordId.make(
      `github-check:${input.connectionId}:${keyPart(input.check.githubCheckId)}`,
    ),
    pullRequestRecordId: input.pullRequestId,
    repositoryConnectionId: input.connectionId,
    githubCheckId: input.check.githubCheckId,
    name: input.check.name,
    provider: input.check.provider,
    headSha: input.check.headSha,
    status: input.check.status,
    conclusion: input.check.conclusion,
    isRequired: input.requiredCheckNames.has(input.check.name),
    detailsUrl: input.check.detailsUrl,
    startedAtRemote: input.check.startedAtRemote,
    completedAtRemote: input.check.completedAtRemote,
    summary: input.check.summary,
    syncedAt: input.syncedAt,
  };
}

export function toCommitRecord(
  pullRequestId: PullRequestRecordId,
  commit: GitHubApiPullRequestCommit,
  syncedAt: string,
): GitHubPullRequestCommitRecord {
  return {
    pullRequestRecordId: pullRequestId,
    sha: commit.sha,
    message: commit.message,
    author: commit.author === null ? null : toGitHubActor(commit.author),
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt,
    htmlUrl: commit.htmlUrl,
    syncedAt,
  };
}

export function toFileRecord(
  pullRequestId: PullRequestRecordId,
  file: GitHubApiPullRequestFile,
  syncedAt: string,
): GitHubPullRequestFileRecord {
  return {
    pullRequestRecordId: pullRequestId,
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    previousPath: file.previousPath,
    blobUrl: file.blobUrl,
    rawUrl: file.rawUrl,
    patch: file.patch,
    syncedAt,
  };
}

export function cursorFor(input: {
  readonly connectionId: RepositoryConnectionId;
  readonly resourceType: GitHubSyncResourceType;
  readonly cursor: string | null;
  readonly metadata: GitHubResponseMetadata;
  readonly now: string;
  readonly successful: boolean;
  readonly previous: SyncCursor | null;
  readonly errorSummary?: string | null;
}): SyncCursor {
  return {
    id: SyncCursorId.make(`github-cursor:${input.connectionId}:${input.resourceType}`),
    repositoryConnectionId: input.connectionId,
    resourceType: input.resourceType,
    cursor: input.cursor,
    etag: input.metadata.etag ?? input.previous?.etag ?? null,
    lastModified: input.metadata.lastModified ?? input.previous?.lastModified ?? null,
    lastSuccessfulSyncAt: input.successful
      ? input.now
      : (input.previous?.lastSuccessfulSyncAt ?? null),
    lastAttemptAt: input.now,
    errorSummary: input.errorSummary ?? null,
  };
}

export function rateLimitFor(input: {
  readonly accountId: GitHubAccountId;
  readonly rateLimit: GitHubRateLimit | GitHubApiRateLimitResource;
  readonly now: string;
  readonly blockedOperation: string | null;
}): GitHubRateLimitState {
  return {
    id: GitHubRateLimitStateId.make(`github-rate:${input.accountId}:${input.rateLimit.kind}`),
    githubAccountId: input.accountId,
    kind: input.rateLimit.kind,
    limit: input.rateLimit.limit,
    remaining: input.rateLimit.remaining,
    used: input.rateLimit.used,
    resetAt: input.rateLimit.resetAt,
    retryAfterSeconds:
      "retryAfterSeconds" in input.rateLimit ? input.rateLimit.retryAfterSeconds : null,
    blockedOperation: input.blockedOperation,
    observedAt: input.now,
  };
}

export const branchObservationIdFor = (
  connectionId: RepositoryConnectionId,
  remoteName: string,
  branchName: string,
) =>
  GitHubBranchObservationId.make(
    `github-branch:${connectionId}:${keyPart(remoteName)}:${keyPart(branchName)}`,
  );
