import {
  DeleteRepositoryConnectionInput,
  GetGitHubAccountInput,
  GetGitHubIssueInput,
  GetPullRequestByIdInput,
  GetPullRequestInput,
  GetReviewCommentByIdInput,
  GetReviewThreadByIdInput,
  GetRepositoryConnectionByProjectInput,
  GetRepositoryConnectionInput,
  GitHubAccount,
  GitHubBranchObservation,
  GitHubCheckRecord,
  GitHubIssueRecord,
  GitHubPullRequestCommitRecord,
  GitHubPullRequestDetailSnapshot,
  GitHubPullRequestFileRecord,
  GitHubRateLimitState,
  IssueMissionLink,
  LinkIssueMissionInput,
  LinkMissionPullRequestInput,
  LinkReviewCommentTaskInput,
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
  MissionPullRequestLink,
  PullRequestRecord,
  PullRequestReviewRecord,
  RepositoryConnection,
  ReviewCommentRecord,
  ReviewCommentTaskLink,
  ReviewThreadRecord,
  SaveGitHubIssuePageInput,
  SaveGitHubPullRequestDetailInput,
  SaveGitHubPullRequestPageInput,
  SyncCursor,
  UnlinkIssueMissionInput,
  UnlinkMissionPullRequestInput,
  UnlinkReviewCommentTaskInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionGitHubAccount = GitHubAccount;
export type ProjectionGitHubAccount = typeof ProjectionGitHubAccount.Type;
export const ProjectionRepositoryConnection = RepositoryConnection;
export type ProjectionRepositoryConnection = typeof ProjectionRepositoryConnection.Type;
export const ProjectionGitHubIssueRecord = GitHubIssueRecord;
export type ProjectionGitHubIssueRecord = typeof ProjectionGitHubIssueRecord.Type;
export const ProjectionIssueMissionLink = IssueMissionLink;
export type ProjectionIssueMissionLink = typeof ProjectionIssueMissionLink.Type;
export const ProjectionPullRequestRecord = PullRequestRecord;
export type ProjectionPullRequestRecord = typeof ProjectionPullRequestRecord.Type;
export const ProjectionMissionPullRequestLink = MissionPullRequestLink;
export type ProjectionMissionPullRequestLink = typeof ProjectionMissionPullRequestLink.Type;
export const ProjectionPullRequestReviewRecord = PullRequestReviewRecord;
export type ProjectionPullRequestReviewRecord = typeof ProjectionPullRequestReviewRecord.Type;
export const ProjectionReviewThreadRecord = ReviewThreadRecord;
export type ProjectionReviewThreadRecord = typeof ProjectionReviewThreadRecord.Type;
export const ProjectionReviewCommentRecord = ReviewCommentRecord;
export type ProjectionReviewCommentRecord = typeof ProjectionReviewCommentRecord.Type;
export const ProjectionReviewCommentTaskLink = ReviewCommentTaskLink;
export type ProjectionReviewCommentTaskLink = typeof ProjectionReviewCommentTaskLink.Type;
export const ProjectionGitHubCheckRecord = GitHubCheckRecord;
export type ProjectionGitHubCheckRecord = typeof ProjectionGitHubCheckRecord.Type;
export const ProjectionSyncCursor = SyncCursor;
export type ProjectionSyncCursor = typeof ProjectionSyncCursor.Type;
export const ProjectionGitHubRateLimitState = GitHubRateLimitState;
export type ProjectionGitHubRateLimitState = typeof ProjectionGitHubRateLimitState.Type;
export const ProjectionGitHubBranchObservation = GitHubBranchObservation;
export type ProjectionGitHubBranchObservation = typeof ProjectionGitHubBranchObservation.Type;
export const ProjectionGitHubPullRequestCommitRecord = GitHubPullRequestCommitRecord;
export type ProjectionGitHubPullRequestCommitRecord =
  typeof ProjectionGitHubPullRequestCommitRecord.Type;
export const ProjectionGitHubPullRequestFileRecord = GitHubPullRequestFileRecord;
export type ProjectionGitHubPullRequestFileRecord =
  typeof ProjectionGitHubPullRequestFileRecord.Type;

type RepositoryEffect<A> = Effect.Effect<A, ProjectionRepositoryError>;

export interface ProjectionGitHubWorkspaceRepositoryShape {
  readonly saveAccount: (row: ProjectionGitHubAccount) => RepositoryEffect<void>;
  readonly getAccountById: (
    input: GetGitHubAccountInput,
  ) => RepositoryEffect<Option.Option<ProjectionGitHubAccount>>;
  readonly listAccounts: (
    input: ListGitHubAccountsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionGitHubAccount>>;

  readonly saveRepositoryConnection: (
    row: ProjectionRepositoryConnection,
  ) => RepositoryEffect<void>;
  readonly getRepositoryConnectionById: (
    input: GetRepositoryConnectionInput,
  ) => RepositoryEffect<Option.Option<ProjectionRepositoryConnection>>;
  readonly getRepositoryConnectionByProjectId: (
    input: GetRepositoryConnectionByProjectInput,
  ) => RepositoryEffect<Option.Option<ProjectionRepositoryConnection>>;
  readonly listRepositoryConnectionsByAccountId: (
    input: ListRepositoryConnectionsByAccountInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionRepositoryConnection>>;
  readonly deleteRepositoryConnection: (
    input: DeleteRepositoryConnectionInput,
  ) => RepositoryEffect<void>;

  readonly saveIssuePage: (input: SaveGitHubIssuePageInput) => RepositoryEffect<void>;
  readonly upsertIssue: (row: ProjectionGitHubIssueRecord) => RepositoryEffect<void>;
  readonly getIssue: (
    input: GetGitHubIssueInput,
  ) => RepositoryEffect<Option.Option<ProjectionGitHubIssueRecord>>;
  readonly listIssues: (
    input: ListGitHubIssuesInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionGitHubIssueRecord>>;
  readonly linkIssueMission: (input: LinkIssueMissionInput) => RepositoryEffect<void>;
  readonly unlinkIssueMission: (input: UnlinkIssueMissionInput) => RepositoryEffect<void>;
  readonly listIssueMissionLinks: (
    input: ListIssueMissionLinksInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionIssueMissionLink>>;

  readonly savePullRequestPage: (input: SaveGitHubPullRequestPageInput) => RepositoryEffect<void>;
  readonly savePullRequestDetail: (
    input: SaveGitHubPullRequestDetailInput,
  ) => RepositoryEffect<void>;
  readonly upsertPullRequest: (row: ProjectionPullRequestRecord) => RepositoryEffect<void>;
  readonly getPullRequest: (
    input: GetPullRequestInput,
  ) => RepositoryEffect<Option.Option<ProjectionPullRequestRecord>>;
  readonly getPullRequestById: (
    input: GetPullRequestByIdInput,
  ) => RepositoryEffect<Option.Option<ProjectionPullRequestRecord>>;
  readonly listPullRequests: (
    input: ListPullRequestsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionPullRequestRecord>>;
  readonly getPullRequestDetail: (
    input: GetPullRequestByIdInput,
  ) => RepositoryEffect<Option.Option<GitHubPullRequestDetailSnapshot>>;
  readonly linkMissionPullRequest: (input: LinkMissionPullRequestInput) => RepositoryEffect<void>;
  readonly unlinkMissionPullRequest: (
    input: UnlinkMissionPullRequestInput,
  ) => RepositoryEffect<void>;
  readonly listMissionPullRequestLinks: (
    input: ListMissionPullRequestLinksInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionMissionPullRequestLink>>;
  readonly listPullRequestReviews: (
    input: ListPullRequestReviewsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionPullRequestReviewRecord>>;
  readonly upsertPullRequestReview: (
    row: ProjectionPullRequestReviewRecord,
  ) => RepositoryEffect<void>;
  readonly listReviewThreads: (
    input: ListReviewThreadsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionReviewThreadRecord>>;
  readonly getReviewThreadById: (
    input: GetReviewThreadByIdInput,
  ) => RepositoryEffect<Option.Option<ProjectionReviewThreadRecord>>;
  readonly upsertReviewThread: (row: ProjectionReviewThreadRecord) => RepositoryEffect<void>;
  readonly listReviewComments: (
    input: ListReviewCommentsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionReviewCommentRecord>>;
  readonly getReviewCommentById: (
    input: GetReviewCommentByIdInput,
  ) => RepositoryEffect<Option.Option<ProjectionReviewCommentRecord>>;
  readonly upsertReviewComment: (row: ProjectionReviewCommentRecord) => RepositoryEffect<void>;
  readonly linkReviewCommentTask: (input: LinkReviewCommentTaskInput) => RepositoryEffect<void>;
  readonly unlinkReviewCommentTask: (input: UnlinkReviewCommentTaskInput) => RepositoryEffect<void>;
  readonly listReviewCommentTaskLinks: (
    input: ListReviewCommentTaskLinksInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionReviewCommentTaskLink>>;
  readonly listChecks: (
    input: ListGitHubChecksInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionGitHubCheckRecord>>;
  readonly upsertCheck: (row: ProjectionGitHubCheckRecord) => RepositoryEffect<void>;
  readonly upsertPullRequestCommit: (
    row: ProjectionGitHubPullRequestCommitRecord,
  ) => RepositoryEffect<void>;
  readonly upsertPullRequestFile: (
    row: ProjectionGitHubPullRequestFileRecord,
  ) => RepositoryEffect<void>;

  readonly saveSyncCursor: (row: ProjectionSyncCursor) => RepositoryEffect<void>;
  readonly listSyncCursors: (
    input: ListSyncCursorsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionSyncCursor>>;
  readonly saveRateLimit: (row: ProjectionGitHubRateLimitState) => RepositoryEffect<void>;
  readonly listRateLimits: (
    input: ListGitHubRateLimitsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionGitHubRateLimitState>>;
  readonly saveBranchObservation: (
    row: ProjectionGitHubBranchObservation,
  ) => RepositoryEffect<void>;
  readonly listBranchObservations: (
    input: ListGitHubBranchObservationsInput,
  ) => RepositoryEffect<ReadonlyArray<ProjectionGitHubBranchObservation>>;
}

export class ProjectionGitHubWorkspaceRepository extends Context.Service<
  ProjectionGitHubWorkspaceRepository,
  ProjectionGitHubWorkspaceRepositoryShape
>()("t3/persistence/Services/ProjectionGitHubWorkspace/ProjectionGitHubWorkspaceRepository") {}
