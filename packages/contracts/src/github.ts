import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

const BoundedString = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));
const BoundedNonEmptyString = (maximumLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maximumLength));
const RemoteId = BoundedNonEmptyString(255);
const GitObjectId = BoundedNonEmptyString(255);
const GitRefName = BoundedNonEmptyString(1_024);
const RemoteUrl = BoundedNonEmptyString(2_048);
const BodyPreview = Schema.NullOr(BoundedString(8_000));
const ErrorSummary = Schema.NullOr(BoundedString(4_000));

export const GitHubAccountId = entityId("GitHubAccountId");
export type GitHubAccountId = typeof GitHubAccountId.Type;
export const RepositoryConnectionId = entityId("RepositoryConnectionId");
export type RepositoryConnectionId = typeof RepositoryConnectionId.Type;
export const GitHubIssueRecordId = entityId("GitHubIssueRecordId");
export type GitHubIssueRecordId = typeof GitHubIssueRecordId.Type;
export const IssueMissionLinkId = entityId("IssueMissionLinkId");
export type IssueMissionLinkId = typeof IssueMissionLinkId.Type;
export const PullRequestRecordId = entityId("PullRequestRecordId");
export type PullRequestRecordId = typeof PullRequestRecordId.Type;
export const MissionPullRequestLinkId = entityId("MissionPullRequestLinkId");
export type MissionPullRequestLinkId = typeof MissionPullRequestLinkId.Type;
export const PullRequestReviewRecordId = entityId("PullRequestReviewRecordId");
export type PullRequestReviewRecordId = typeof PullRequestReviewRecordId.Type;
export const ReviewThreadRecordId = entityId("ReviewThreadRecordId");
export type ReviewThreadRecordId = typeof ReviewThreadRecordId.Type;
export const ReviewCommentRecordId = entityId("ReviewCommentRecordId");
export type ReviewCommentRecordId = typeof ReviewCommentRecordId.Type;
export const ReviewCommentTaskLinkId = entityId("ReviewCommentTaskLinkId");
export type ReviewCommentTaskLinkId = typeof ReviewCommentTaskLinkId.Type;
export const GitHubCheckRecordId = entityId("GitHubCheckRecordId");
export type GitHubCheckRecordId = typeof GitHubCheckRecordId.Type;
export const SyncCursorId = entityId("SyncCursorId");
export type SyncCursorId = typeof SyncCursorId.Type;
export const GitHubRateLimitStateId = entityId("GitHubRateLimitStateId");
export type GitHubRateLimitStateId = typeof GitHubRateLimitStateId.Type;
export const GitHubBranchObservationId = entityId("GitHubBranchObservationId");
export type GitHubBranchObservationId = typeof GitHubBranchObservationId.Type;

export const GitHubProvider = Schema.Literal("github");
export type GitHubProvider = typeof GitHubProvider.Type;

export const GitHubAuthenticationType = Schema.Literals([
  "oauth_device_flow",
  "oauth_browser_flow",
  "github_app",
  "gh_cli",
]);
export type GitHubAuthenticationType = typeof GitHubAuthenticationType.Type;

export const GitHubAccountStatus = Schema.Literals([
  "connected",
  "expired",
  "revoked",
  "insufficient_permissions",
  "rate_limited",
  "disconnected",
  "error",
]);
export type GitHubAccountStatus = typeof GitHubAccountStatus.Type;

export const RepositorySyncStatus = Schema.Literals([
  "not_synced",
  "syncing",
  "current",
  "stale",
  "offline",
  "partially_stale",
  "rate_limited",
  "authentication_required",
  "remote_deleted",
  "failed",
]);
export type RepositorySyncStatus = typeof RepositorySyncStatus.Type;

export const RepositoryVisibility = Schema.Literals(["public", "private", "internal", "unknown"]);
export type RepositoryVisibility = typeof RepositoryVisibility.Type;

export const RepositoryPermissionLevel = Schema.Literals([
  "none",
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
]);
export type RepositoryPermissionLevel = typeof RepositoryPermissionLevel.Type;

export const GitHubIssueState = Schema.Literals(["open", "closed"]);
export type GitHubIssueState = typeof GitHubIssueState.Type;

export const IssueMissionLinkType = Schema.Literals([
  "implements",
  "investigates",
  "reviews",
  "follow_up",
  "related",
]);
export type IssueMissionLinkType = typeof IssueMissionLinkType.Type;

export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const PullRequestMergeableState = Schema.Literals([
  "unknown",
  "mergeable",
  "conflicting",
  "behind",
  "blocked",
  "unstable",
  "draft",
]);
export type PullRequestMergeableState = typeof PullRequestMergeableState.Type;

export const PullRequestReviewDecision = Schema.Literals([
  "none",
  "review_required",
  "approved",
  "changes_requested",
]);
export type PullRequestReviewDecision = typeof PullRequestReviewDecision.Type;

export const MissionPullRequestRelationship = Schema.Literals([
  "primary",
  "follow_up",
  "review_only",
  "dependency",
]);
export type MissionPullRequestRelationship = typeof MissionPullRequestRelationship.Type;

export const PullRequestReviewState = Schema.Literals([
  "pending",
  "commented",
  "approved",
  "changes_requested",
  "dismissed",
]);
export type PullRequestReviewState = typeof PullRequestReviewState.Type;

export const ReviewCommentTaskStatus = Schema.Literals([
  "linked",
  "addressing",
  "addressed",
  "verified",
  "resolved",
  "dismissed",
]);
export type ReviewCommentTaskStatus = typeof ReviewCommentTaskStatus.Type;

export const GitHubCheckStatus = Schema.Literals(["queued", "in_progress", "completed"]);
export type GitHubCheckStatus = typeof GitHubCheckStatus.Type;

export const GitHubCheckConclusion = Schema.Literals([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "unknown",
]);
export type GitHubCheckConclusion = typeof GitHubCheckConclusion.Type;

export const GitHubSyncResourceType = Schema.Literals([
  "repository",
  "issues",
  "pull_requests",
  "pull_request_detail",
  "reviews",
  "review_threads",
  "checks",
  "branches",
  "labels",
  "milestones",
]);
export type GitHubSyncResourceType = typeof GitHubSyncResourceType.Type;

export const GitHubRateLimitKind = Schema.Literals([
  "core",
  "search",
  "graphql",
  "integration_manifest",
  "secondary",
  "unknown",
]);
export type GitHubRateLimitKind = typeof GitHubRateLimitKind.Type;

export const GitHubBranchRelation = Schema.Literals([
  "unknown",
  "missing_local",
  "missing_remote",
  "equal",
  "ahead",
  "behind",
  "diverged",
]);
export type GitHubBranchRelation = typeof GitHubBranchRelation.Type;

export const GitHubDataFreshness = Schema.Literals([
  "never_synced",
  "current",
  "stale",
  "partial",
  "offline",
]);
export type GitHubDataFreshness = typeof GitHubDataFreshness.Type;

export const GitHubActor = Schema.Struct({
  login: BoundedNonEmptyString(255),
  displayName: Schema.NullOr(BoundedString(255)),
  avatarUrl: Schema.NullOr(RemoteUrl),
  htmlUrl: Schema.NullOr(RemoteUrl),
});
export type GitHubActor = typeof GitHubActor.Type;

export const GitHubLabel = Schema.Struct({
  name: BoundedNonEmptyString(255),
  color: Schema.NullOr(BoundedString(32)),
  description: Schema.NullOr(BoundedString(1_024)),
});
export type GitHubLabel = typeof GitHubLabel.Type;

export const GitHubMilestone = Schema.Struct({
  number: PositiveInt,
  title: BoundedNonEmptyString(255),
  state: Schema.Literals(["open", "closed"]),
  dueOn: Schema.NullOr(IsoDateTime),
});
export type GitHubMilestone = typeof GitHubMilestone.Type;

export const RepositoryPermissions = Schema.Struct({
  level: RepositoryPermissionLevel,
  canRead: Schema.Boolean,
  canTriage: Schema.Boolean,
  canPush: Schema.Boolean,
  canMaintain: Schema.Boolean,
  canAdmin: Schema.Boolean,
});
export type RepositoryPermissions = typeof RepositoryPermissions.Type;

export const ParentRepositoryReference = Schema.Struct({
  repositoryId: RemoteId,
  owner: BoundedNonEmptyString(255),
  repository: BoundedNonEmptyString(255),
  htmlUrl: RemoteUrl,
});
export type ParentRepositoryReference = typeof ParentRepositoryReference.Type;

export const GitHubAccount = Schema.Struct({
  id: GitHubAccountId,
  providerAccountId: RemoteId,
  login: BoundedNonEmptyString(255),
  displayName: Schema.NullOr(BoundedString(255)),
  avatarUrl: Schema.NullOr(RemoteUrl),
  serverUrl: RemoteUrl,
  authenticationType: GitHubAuthenticationType,
  scopes: Schema.Array(BoundedNonEmptyString(255)).check(Schema.isMaxLength(128)),
  status: GitHubAccountStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastValidatedAt: Schema.NullOr(IsoDateTime),
});
export type GitHubAccount = typeof GitHubAccount.Type;

export const RepositoryConnection = Schema.Struct({
  id: RepositoryConnectionId,
  projectId: ProjectId,
  githubAccountId: GitHubAccountId,
  owner: BoundedNonEmptyString(255),
  repository: BoundedNonEmptyString(255),
  repositoryId: RemoteId,
  serverUrl: RemoteUrl,
  htmlUrl: RemoteUrl,
  remoteName: BoundedNonEmptyString(255),
  remoteUrl: RemoteUrl,
  defaultBranch: GitRefName,
  visibility: RepositoryVisibility,
  permissions: RepositoryPermissions,
  isArchived: Schema.Boolean,
  isFork: Schema.Boolean,
  parentRepository: Schema.NullOr(ParentRepositoryReference),
  syncStatus: RepositorySyncStatus,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RepositoryConnection = typeof RepositoryConnection.Type;

export const GitHubIssueRecord = Schema.Struct({
  id: GitHubIssueRecordId,
  repositoryConnectionId: RepositoryConnectionId,
  githubIssueId: RemoteId,
  number: PositiveInt,
  title: BoundedNonEmptyString(1_024),
  bodyPreview: BodyPreview,
  state: GitHubIssueState,
  author: GitHubActor,
  assignees: Schema.Array(GitHubActor).check(Schema.isMaxLength(100)),
  labels: Schema.Array(GitHubLabel).check(Schema.isMaxLength(100)),
  milestone: Schema.NullOr(GitHubMilestone),
  commentCount: NonNegativeInt,
  htmlUrl: RemoteUrl,
  createdAtRemote: IsoDateTime,
  updatedAtRemote: IsoDateTime,
  closedAtRemote: Schema.NullOr(IsoDateTime),
  syncedAt: IsoDateTime,
});
export type GitHubIssueRecord = typeof GitHubIssueRecord.Type;

export const IssueMissionLink = Schema.Struct({
  id: IssueMissionLinkId,
  repositoryConnectionId: RepositoryConnectionId,
  githubIssueNumber: PositiveInt,
  missionId: MissionId,
  linkType: IssueMissionLinkType,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IssueMissionLink = typeof IssueMissionLink.Type;

export const PullRequestRecord = Schema.Struct({
  id: PullRequestRecordId,
  repositoryConnectionId: RepositoryConnectionId,
  githubPullRequestId: RemoteId,
  number: PositiveInt,
  title: BoundedNonEmptyString(1_024),
  bodyPreview: BodyPreview,
  state: PullRequestState,
  isDraft: Schema.Boolean,
  author: GitHubActor,
  headRef: GitRefName,
  headSha: GitObjectId,
  baseRef: GitRefName,
  baseSha: GitObjectId,
  mergeableState: PullRequestMergeableState,
  reviewDecision: PullRequestReviewDecision,
  changedFileCount: NonNegativeInt,
  commitCount: NonNegativeInt,
  commentCount: NonNegativeInt,
  requiredCheckNames: Schema.Array(BoundedNonEmptyString(255)).check(Schema.isMaxLength(500)),
  htmlUrl: RemoteUrl,
  createdAtRemote: IsoDateTime,
  updatedAtRemote: IsoDateTime,
  mergedAtRemote: Schema.NullOr(IsoDateTime),
  closedAtRemote: Schema.NullOr(IsoDateTime),
  syncedAt: IsoDateTime,
});
export type PullRequestRecord = typeof PullRequestRecord.Type;

export const MissionPullRequestLink = Schema.Struct({
  id: MissionPullRequestLinkId,
  missionId: MissionId,
  pullRequestRecordId: PullRequestRecordId,
  relationship: MissionPullRequestRelationship,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MissionPullRequestLink = typeof MissionPullRequestLink.Type;

export const PullRequestReviewRecord = Schema.Struct({
  id: PullRequestReviewRecordId,
  pullRequestRecordId: PullRequestRecordId,
  githubReviewId: RemoteId,
  author: GitHubActor,
  state: PullRequestReviewState,
  bodyPreview: BodyPreview,
  submittedAt: Schema.NullOr(IsoDateTime),
  commitSha: Schema.NullOr(GitObjectId),
  syncedAt: IsoDateTime,
});
export type PullRequestReviewRecord = typeof PullRequestReviewRecord.Type;

export const ReviewThreadRecord = Schema.Struct({
  id: ReviewThreadRecordId,
  pullRequestRecordId: PullRequestRecordId,
  githubThreadId: RemoteId,
  path: BoundedNonEmptyString(2_048),
  line: Schema.NullOr(PositiveInt),
  originalLine: Schema.NullOr(PositiveInt),
  side: Schema.NullOr(Schema.Literals(["LEFT", "RIGHT"])),
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  createdAtRemote: IsoDateTime,
  updatedAtRemote: IsoDateTime,
  syncedAt: IsoDateTime,
});
export type ReviewThreadRecord = typeof ReviewThreadRecord.Type;

export const ReviewCommentRecord = Schema.Struct({
  id: ReviewCommentRecordId,
  reviewThreadId: ReviewThreadRecordId,
  githubCommentId: RemoteId,
  author: GitHubActor,
  body: BoundedString(65_536),
  path: BoundedNonEmptyString(2_048),
  line: Schema.NullOr(PositiveInt),
  commitSha: Schema.NullOr(GitObjectId),
  htmlUrl: RemoteUrl,
  createdAtRemote: IsoDateTime,
  updatedAtRemote: IsoDateTime,
  syncedAt: IsoDateTime,
});
export type ReviewCommentRecord = typeof ReviewCommentRecord.Type;

export const ReviewCommentTaskLink = Schema.Struct({
  id: ReviewCommentTaskLinkId,
  reviewCommentRecordId: ReviewCommentRecordId,
  taskId: MissionTaskId,
  status: ReviewCommentTaskStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewCommentTaskLink = typeof ReviewCommentTaskLink.Type;

export const GitHubCheckRecord = Schema.Struct({
  id: GitHubCheckRecordId,
  pullRequestRecordId: Schema.NullOr(PullRequestRecordId),
  repositoryConnectionId: RepositoryConnectionId,
  githubCheckId: RemoteId,
  name: BoundedNonEmptyString(512),
  provider: BoundedNonEmptyString(255),
  headSha: GitObjectId,
  status: GitHubCheckStatus,
  conclusion: Schema.NullOr(GitHubCheckConclusion),
  isRequired: Schema.Boolean,
  detailsUrl: Schema.NullOr(RemoteUrl),
  startedAtRemote: Schema.NullOr(IsoDateTime),
  completedAtRemote: Schema.NullOr(IsoDateTime),
  summary: ErrorSummary,
  syncedAt: IsoDateTime,
});
export type GitHubCheckRecord = typeof GitHubCheckRecord.Type;

export const SyncCursor = Schema.Struct({
  id: SyncCursorId,
  repositoryConnectionId: RepositoryConnectionId,
  resourceType: GitHubSyncResourceType,
  cursor: Schema.NullOr(BoundedString(4_096)),
  etag: Schema.NullOr(BoundedString(1_024)),
  lastModified: Schema.NullOr(BoundedString(1_024)),
  lastSuccessfulSyncAt: Schema.NullOr(IsoDateTime),
  lastAttemptAt: Schema.NullOr(IsoDateTime),
  errorSummary: ErrorSummary,
});
export type SyncCursor = typeof SyncCursor.Type;

export const GitHubRateLimitState = Schema.Struct({
  id: GitHubRateLimitStateId,
  githubAccountId: GitHubAccountId,
  kind: GitHubRateLimitKind,
  limit: Schema.NullOr(NonNegativeInt),
  remaining: Schema.NullOr(NonNegativeInt),
  used: Schema.NullOr(NonNegativeInt),
  resetAt: Schema.NullOr(IsoDateTime),
  retryAfterSeconds: Schema.NullOr(NonNegativeInt),
  blockedOperation: Schema.NullOr(BoundedString(255)),
  observedAt: IsoDateTime,
});
export type GitHubRateLimitState = typeof GitHubRateLimitState.Type;

export const GitHubBranchObservation = Schema.Struct({
  id: GitHubBranchObservationId,
  repositoryConnectionId: RepositoryConnectionId,
  remoteName: BoundedNonEmptyString(255),
  branchName: GitRefName,
  localSha: Schema.NullOr(GitObjectId),
  remoteSha: Schema.NullOr(GitObjectId),
  relation: GitHubBranchRelation,
  aheadCount: Schema.NullOr(NonNegativeInt),
  behindCount: Schema.NullOr(NonNegativeInt),
  observedAt: IsoDateTime,
});
export type GitHubBranchObservation = typeof GitHubBranchObservation.Type;

export const GitHubPullRequestCommitRecord = Schema.Struct({
  pullRequestRecordId: PullRequestRecordId,
  sha: GitObjectId,
  message: BoundedString(8_000),
  author: Schema.NullOr(GitHubActor),
  authoredAt: Schema.NullOr(IsoDateTime),
  committedAt: Schema.NullOr(IsoDateTime),
  htmlUrl: RemoteUrl,
  syncedAt: IsoDateTime,
});
export type GitHubPullRequestCommitRecord = typeof GitHubPullRequestCommitRecord.Type;

export const GitHubPullRequestFileStatus = Schema.Literals([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
  "unchanged",
  "unknown",
]);
export type GitHubPullRequestFileStatus = typeof GitHubPullRequestFileStatus.Type;

export const GitHubPullRequestFileRecord = Schema.Struct({
  pullRequestRecordId: PullRequestRecordId,
  path: BoundedNonEmptyString(2_048),
  status: GitHubPullRequestFileStatus,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changes: NonNegativeInt,
  previousPath: Schema.NullOr(BoundedString(2_048)),
  blobUrl: Schema.NullOr(RemoteUrl),
  rawUrl: Schema.NullOr(RemoteUrl),
  patch: Schema.NullOr(BoundedString(65_536)),
  syncedAt: IsoDateTime,
});
export type GitHubPullRequestFileRecord = typeof GitHubPullRequestFileRecord.Type;

export const GitHubPageInfo = Schema.Struct({
  endCursor: Schema.NullOr(BoundedString(4_096)),
  hasNextPage: Schema.Boolean,
  totalCount: Schema.NullOr(NonNegativeInt),
});
export type GitHubPageInfo = typeof GitHubPageInfo.Type;

export const GitHubIssuePageSnapshot = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  records: Schema.Array(GitHubIssueRecord),
  pageInfo: GitHubPageInfo,
  freshness: GitHubDataFreshness,
  syncedAt: Schema.NullOr(IsoDateTime),
});
export type GitHubIssuePageSnapshot = typeof GitHubIssuePageSnapshot.Type;

export const GitHubPullRequestPageSnapshot = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  records: Schema.Array(PullRequestRecord),
  pageInfo: GitHubPageInfo,
  freshness: GitHubDataFreshness,
  syncedAt: Schema.NullOr(IsoDateTime),
});
export type GitHubPullRequestPageSnapshot = typeof GitHubPullRequestPageSnapshot.Type;

export const GitHubPullRequestDetailSnapshot = Schema.Struct({
  pullRequest: PullRequestRecord,
  missionLinks: Schema.Array(MissionPullRequestLink),
  reviews: Schema.Array(PullRequestReviewRecord),
  threads: Schema.Array(ReviewThreadRecord),
  comments: Schema.Array(ReviewCommentRecord),
  taskLinks: Schema.Array(ReviewCommentTaskLink),
  checks: Schema.Array(GitHubCheckRecord),
  commits: Schema.Array(GitHubPullRequestCommitRecord),
  changedFiles: Schema.Array(GitHubPullRequestFileRecord),
  freshness: GitHubDataFreshness,
  syncedAt: IsoDateTime,
});
export type GitHubPullRequestDetailSnapshot = typeof GitHubPullRequestDetailSnapshot.Type;

export const GitHubRepositoryWorkspaceSnapshot = Schema.Struct({
  account: Schema.NullOr(GitHubAccount),
  connection: RepositoryConnection,
  issueLinks: Schema.Array(IssueMissionLink),
  pullRequestLinks: Schema.Array(MissionPullRequestLink),
  rateLimits: Schema.Array(GitHubRateLimitState),
  branches: Schema.Array(GitHubBranchObservation),
  cursors: Schema.Array(SyncCursor),
  freshness: GitHubDataFreshness,
  capturedAt: IsoDateTime,
});
export type GitHubRepositoryWorkspaceSnapshot = typeof GitHubRepositoryWorkspaceSnapshot.Type;

const PageQuery = {
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(250)),
  offset: NonNegativeInt,
};

export const GetGitHubAccountInput = Schema.Struct({ githubAccountId: GitHubAccountId });
export type GetGitHubAccountInput = typeof GetGitHubAccountInput.Type;
export const ListGitHubAccountsInput = Schema.Struct({ includeDisconnected: Schema.Boolean });
export type ListGitHubAccountsInput = typeof ListGitHubAccountsInput.Type;
export const GetRepositoryConnectionInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
});
export type GetRepositoryConnectionInput = typeof GetRepositoryConnectionInput.Type;
export const GetRepositoryConnectionByProjectInput = Schema.Struct({ projectId: ProjectId });
export type GetRepositoryConnectionByProjectInput =
  typeof GetRepositoryConnectionByProjectInput.Type;
export const ListRepositoryConnectionsByAccountInput = Schema.Struct({
  githubAccountId: GitHubAccountId,
});
export type ListRepositoryConnectionsByAccountInput =
  typeof ListRepositoryConnectionsByAccountInput.Type;
export const DeleteRepositoryConnectionInput = GetRepositoryConnectionInput;
export type DeleteRepositoryConnectionInput = typeof DeleteRepositoryConnectionInput.Type;

export const GetGitHubIssueInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  number: PositiveInt,
});
export type GetGitHubIssueInput = typeof GetGitHubIssueInput.Type;
export const ListGitHubIssuesInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  state: Schema.NullOr(GitHubIssueState),
  ...PageQuery,
});
export type ListGitHubIssuesInput = typeof ListGitHubIssuesInput.Type;
export const ListIssueMissionLinksInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  githubIssueNumber: Schema.NullOr(PositiveInt),
  missionId: Schema.NullOr(MissionId),
});
export type ListIssueMissionLinksInput = typeof ListIssueMissionLinksInput.Type;
export const LinkIssueMissionInput = IssueMissionLink;
export type LinkIssueMissionInput = typeof LinkIssueMissionInput.Type;
export const UnlinkIssueMissionInput = Schema.Struct({ issueMissionLinkId: IssueMissionLinkId });
export type UnlinkIssueMissionInput = typeof UnlinkIssueMissionInput.Type;

export const GetPullRequestInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  number: PositiveInt,
});
export type GetPullRequestInput = typeof GetPullRequestInput.Type;
export const GetPullRequestByIdInput = Schema.Struct({
  pullRequestRecordId: PullRequestRecordId,
});
export type GetPullRequestByIdInput = typeof GetPullRequestByIdInput.Type;
export const ListPullRequestsInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  state: Schema.NullOr(PullRequestState),
  ...PageQuery,
});
export type ListPullRequestsInput = typeof ListPullRequestsInput.Type;
export const ListMissionPullRequestLinksInput = Schema.Struct({
  missionId: Schema.NullOr(MissionId),
  pullRequestRecordId: Schema.NullOr(PullRequestRecordId),
});
export type ListMissionPullRequestLinksInput = typeof ListMissionPullRequestLinksInput.Type;
export const LinkMissionPullRequestInput = MissionPullRequestLink;
export type LinkMissionPullRequestInput = typeof LinkMissionPullRequestInput.Type;
export const UnlinkMissionPullRequestInput = Schema.Struct({
  missionPullRequestLinkId: MissionPullRequestLinkId,
});
export type UnlinkMissionPullRequestInput = typeof UnlinkMissionPullRequestInput.Type;

export const ListPullRequestReviewsInput = GetPullRequestByIdInput;
export type ListPullRequestReviewsInput = typeof ListPullRequestReviewsInput.Type;
export const ListReviewThreadsInput = GetPullRequestByIdInput;
export type ListReviewThreadsInput = typeof ListReviewThreadsInput.Type;
export const GetReviewThreadByIdInput = Schema.Struct({
  reviewThreadRecordId: ReviewThreadRecordId,
});
export type GetReviewThreadByIdInput = typeof GetReviewThreadByIdInput.Type;
export const ListReviewCommentsInput = Schema.Struct({ reviewThreadId: ReviewThreadRecordId });
export type ListReviewCommentsInput = typeof ListReviewCommentsInput.Type;
export const GetReviewCommentByIdInput = Schema.Struct({
  reviewCommentRecordId: ReviewCommentRecordId,
});
export type GetReviewCommentByIdInput = typeof GetReviewCommentByIdInput.Type;
export const ListReviewCommentTaskLinksInput = Schema.Struct({
  reviewCommentRecordId: Schema.NullOr(ReviewCommentRecordId),
  taskId: Schema.NullOr(MissionTaskId),
});
export type ListReviewCommentTaskLinksInput = typeof ListReviewCommentTaskLinksInput.Type;
export const LinkReviewCommentTaskInput = ReviewCommentTaskLink;
export type LinkReviewCommentTaskInput = typeof LinkReviewCommentTaskInput.Type;
export const UnlinkReviewCommentTaskInput = Schema.Struct({
  reviewCommentTaskLinkId: ReviewCommentTaskLinkId,
});
export type UnlinkReviewCommentTaskInput = typeof UnlinkReviewCommentTaskInput.Type;
export const ListGitHubChecksInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  pullRequestRecordId: Schema.NullOr(PullRequestRecordId),
  headSha: Schema.NullOr(GitObjectId),
});
export type ListGitHubChecksInput = typeof ListGitHubChecksInput.Type;
export const ListSyncCursorsInput = GetRepositoryConnectionInput;
export type ListSyncCursorsInput = typeof ListSyncCursorsInput.Type;
export const ListGitHubRateLimitsInput = GetGitHubAccountInput;
export type ListGitHubRateLimitsInput = typeof ListGitHubRateLimitsInput.Type;
export const ListGitHubBranchObservationsInput = GetRepositoryConnectionInput;
export type ListGitHubBranchObservationsInput = typeof ListGitHubBranchObservationsInput.Type;

export const SaveGitHubIssuePageInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  records: Schema.Array(GitHubIssueRecord),
  cursor: SyncCursor,
  pageInfo: GitHubPageInfo,
});
export type SaveGitHubIssuePageInput = typeof SaveGitHubIssuePageInput.Type;
export const ReplaceGitHubIssuePageInput = SaveGitHubIssuePageInput;
export type ReplaceGitHubIssuePageInput = typeof ReplaceGitHubIssuePageInput.Type;

export const SaveGitHubPullRequestPageInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  records: Schema.Array(PullRequestRecord),
  cursor: SyncCursor,
  pageInfo: GitHubPageInfo,
});
export type SaveGitHubPullRequestPageInput = typeof SaveGitHubPullRequestPageInput.Type;
export const ReplaceGitHubPullRequestPageInput = SaveGitHubPullRequestPageInput;
export type ReplaceGitHubPullRequestPageInput = typeof ReplaceGitHubPullRequestPageInput.Type;

export const SaveGitHubPullRequestDetailInput = Schema.Struct({
  pullRequest: PullRequestRecord,
  reviews: Schema.Array(PullRequestReviewRecord),
  threads: Schema.Array(ReviewThreadRecord),
  comments: Schema.Array(ReviewCommentRecord),
  checks: Schema.Array(GitHubCheckRecord),
  commits: Schema.Array(GitHubPullRequestCommitRecord),
  changedFiles: Schema.Array(GitHubPullRequestFileRecord),
  cursor: SyncCursor,
});
export type SaveGitHubPullRequestDetailInput = typeof SaveGitHubPullRequestDetailInput.Type;

export const GetGitHubRepositoryWorkspaceInput = GetRepositoryConnectionInput;
export type GetGitHubRepositoryWorkspaceInput = typeof GetGitHubRepositoryWorkspaceInput.Type;

export const GitHubWorkspaceErrorReason = Schema.Literals([
  "authentication_required",
  "permission_denied",
  "rate_limited",
  "offline",
  "stale_data",
  "not_found",
  "conflict",
  "invalid_request",
  "remote_error",
  "partial_sync",
]);
export type GitHubWorkspaceErrorReason = typeof GitHubWorkspaceErrorReason.Type;

const GitHubWorkspaceErrorFields = {
  operation: BoundedNonEmptyString(255),
  reason: GitHubWorkspaceErrorReason,
  message: BoundedString(4_000),
  retryAt: Schema.optional(IsoDateTime),
};

export class GitHubWorkspaceQueryError extends Schema.TaggedErrorClass<GitHubWorkspaceQueryError>()(
  "GitHubWorkspaceQueryError",
  GitHubWorkspaceErrorFields,
) {}

export class GitHubWorkspaceMutationError extends Schema.TaggedErrorClass<GitHubWorkspaceMutationError>()(
  "GitHubWorkspaceMutationError",
  GitHubWorkspaceErrorFields,
) {}

const githubAccountTransitions: Readonly<
  Record<GitHubAccountStatus, ReadonlySet<GitHubAccountStatus>>
> = {
  connected: new Set([
    "expired",
    "revoked",
    "insufficient_permissions",
    "rate_limited",
    "disconnected",
    "error",
  ]),
  expired: new Set(["connected", "revoked", "disconnected", "error"]),
  revoked: new Set(["connected", "disconnected"]),
  insufficient_permissions: new Set(["connected", "rate_limited", "disconnected", "error"]),
  rate_limited: new Set(["connected", "insufficient_permissions", "disconnected", "error"]),
  disconnected: new Set(["connected"]),
  error: new Set([
    "connected",
    "expired",
    "revoked",
    "insufficient_permissions",
    "rate_limited",
    "disconnected",
  ]),
};

const repositorySyncTransitions: Readonly<
  Record<RepositorySyncStatus, ReadonlySet<RepositorySyncStatus>>
> = {
  not_synced: new Set(["syncing", "offline", "authentication_required", "failed"]),
  syncing: new Set([
    "current",
    "stale",
    "offline",
    "partially_stale",
    "rate_limited",
    "authentication_required",
    "remote_deleted",
    "failed",
  ]),
  current: new Set([
    "syncing",
    "stale",
    "offline",
    "partially_stale",
    "rate_limited",
    "authentication_required",
    "remote_deleted",
    "failed",
  ]),
  stale: new Set([
    "syncing",
    "current",
    "offline",
    "partially_stale",
    "rate_limited",
    "authentication_required",
    "remote_deleted",
    "failed",
  ]),
  offline: new Set(["syncing", "current", "stale", "authentication_required", "failed"]),
  partially_stale: new Set([
    "syncing",
    "current",
    "stale",
    "offline",
    "rate_limited",
    "authentication_required",
    "remote_deleted",
    "failed",
  ]),
  rate_limited: new Set([
    "syncing",
    "current",
    "stale",
    "offline",
    "authentication_required",
    "failed",
  ]),
  authentication_required: new Set(["syncing", "current", "stale", "offline", "failed"]),
  remote_deleted: new Set(["syncing", "current", "failed"]),
  failed: new Set([
    "syncing",
    "current",
    "stale",
    "offline",
    "partially_stale",
    "rate_limited",
    "authentication_required",
    "remote_deleted",
  ]),
};

const reviewTaskTransitions: Readonly<
  Record<ReviewCommentTaskStatus, ReadonlySet<ReviewCommentTaskStatus>>
> = {
  linked: new Set(["addressing", "dismissed"]),
  addressing: new Set(["linked", "addressed", "dismissed"]),
  addressed: new Set(["addressing", "verified", "dismissed"]),
  verified: new Set(["addressing", "resolved", "dismissed"]),
  resolved: new Set(["addressing"]),
  dismissed: new Set(["linked", "addressing"]),
};

const githubCheckTransitions: Readonly<Record<GitHubCheckStatus, ReadonlySet<GitHubCheckStatus>>> =
  {
    queued: new Set(["in_progress", "completed"]),
    in_progress: new Set(["completed"]),
    completed: new Set(),
  };

export const canTransitionGitHubAccount = (
  from: GitHubAccountStatus,
  to: GitHubAccountStatus,
): boolean => from === to || githubAccountTransitions[from].has(to);

export const canTransitionRepositorySync = (
  from: RepositorySyncStatus,
  to: RepositorySyncStatus,
): boolean => from === to || repositorySyncTransitions[from].has(to);

export const canTransitionReviewCommentTask = (
  from: ReviewCommentTaskStatus,
  to: ReviewCommentTaskStatus,
): boolean => from === to || reviewTaskTransitions[from].has(to);

export const canTransitionGitHubCheck = (from: GitHubCheckStatus, to: GitHubCheckStatus): boolean =>
  from === to || githubCheckTransitions[from].has(to);
