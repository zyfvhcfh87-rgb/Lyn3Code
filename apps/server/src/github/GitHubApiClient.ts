import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";

const DEFAULT_ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const BODY_PREVIEW_LENGTH = 8_000;
const SUMMARY_LENGTH = 4_000;

export type GitHubApiOperation =
  | "validateAccount"
  | "listRepositories"
  | "getRepository"
  | "listIssues"
  | "getIssue"
  | "listIssueComments"
  | "listLabels"
  | "listMilestones"
  | "listPullRequests"
  | "getPullRequest"
  | "getPullRequestReviewDecision"
  | "listPullRequestFiles"
  | "listPullRequestCommits"
  | "listPullRequestReviews"
  | "listPullRequestReviewComments"
  | "listReviewThreads"
  | "listReviewThreadComments"
  | "listChecks"
  | "listCommitStatuses"
  | "listBranches"
  | "getBranch"
  | "getRequiredChecks"
  | "getRateLimit"
  | "createPullRequest"
  | "updatePullRequest"
  | "convertPullRequestToDraft"
  | "markPullRequestReadyForReview"
  | "resolveReviewThread";

export type GitHubApiFailureKind =
  | "authentication_required"
  | "permission_denied"
  | "rate_limited"
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "transient"
  | "remote_error";

const errorFields = {
  operation: Schema.String,
  endpoint: Schema.String,
} as const;

export class GitHubApiTransportError extends Schema.TaggedErrorClass<GitHubApiTransportError>()(
  "GitHubApiTransportError",
  {
    ...errorFields,
    retryable: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `GitHub API failed in ${this.operation}: the GitHub CLI request could not complete.`;
  }
}

export class GitHubApiResponseError extends Schema.TaggedErrorClass<GitHubApiResponseError>()(
  "GitHubApiResponseError",
  {
    ...errorFields,
    status: Schema.Number,
    kind: Schema.Literals([
      "authentication_required",
      "permission_denied",
      "rate_limited",
      "not_found",
      "conflict",
      "validation_failed",
      "transient",
      "remote_error",
    ]),
    retryable: Schema.Boolean,
    responseBodyLength: Schema.Number,
    retryAfterSeconds: Schema.NullOr(Schema.Number),
    rateLimitResetAt: Schema.NullOr(Schema.String),
    secondaryRateLimit: Schema.Boolean,
  },
) {
  override get message(): string {
    return `GitHub API failed in ${this.operation}: GitHub returned HTTP ${this.status}.`;
  }
}

export class GitHubApiDecodeError extends Schema.TaggedErrorClass<GitHubApiDecodeError>()(
  "GitHubApiDecodeError",
  {
    ...errorFields,
    status: Schema.Number,
    responseBodyLength: Schema.Number,
  },
) {
  override get message(): string {
    return `GitHub API failed in ${this.operation}: GitHub returned an invalid response.`;
  }
}

export const GitHubApiError = Schema.Union([
  GitHubApiTransportError,
  GitHubApiResponseError,
  GitHubApiDecodeError,
]);
export type GitHubApiError = typeof GitHubApiError.Type;

export interface GitHubRateLimit {
  readonly kind: "core" | "search" | "graphql" | "integration_manifest" | "secondary" | "unknown";
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly used: number | null;
  readonly resetAt: string | null;
  readonly retryAfterSeconds: number | null;
  readonly secondary: boolean;
}

export interface GitHubConditionalRequest {
  readonly etag?: string | null;
  readonly lastModified?: string | null;
}

export interface GitHubResponseMetadata {
  readonly status: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly nextCursor: string | null;
  readonly oauthScopes: ReadonlyArray<string>;
  readonly rateLimit: GitHubRateLimit;
}

export type GitHubApiResult<A> =
  | ({ readonly notModified: true; readonly data: null } & GitHubResponseMetadata)
  | ({ readonly notModified: false; readonly data: A } & GitHubResponseMetadata);

export interface GitHubPageInfo {
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
  readonly totalCount: number | null;
}

export interface GitHubPage<A> {
  readonly records: ReadonlyArray<A>;
  readonly pageInfo: GitHubPageInfo;
}

export interface GitHubApiActor {
  readonly login: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly htmlUrl: string | null;
}

export interface GitHubApiAccountIdentity extends GitHubApiActor {
  readonly providerAccountId: string;
  readonly nodeId: string;
  readonly scopes: ReadonlyArray<string>;
  readonly serverUrl: string;
}

export interface GitHubApiRepository {
  readonly repositoryId: string;
  readonly nodeId: string;
  readonly owner: string;
  readonly repository: string;
  readonly htmlUrl: string;
  readonly cloneUrl: string;
  readonly sshUrl: string;
  readonly defaultBranch: string;
  readonly visibility: "public" | "private" | "internal" | "unknown";
  readonly permissions: {
    readonly level: "none" | "read" | "triage" | "write" | "maintain" | "admin";
    readonly canRead: boolean;
    readonly canTriage: boolean;
    readonly canPush: boolean;
    readonly canMaintain: boolean;
    readonly canAdmin: boolean;
  };
  readonly isArchived: boolean;
  readonly isFork: boolean;
  readonly parentRepository: {
    readonly repositoryId: string;
    readonly owner: string;
    readonly repository: string;
    readonly htmlUrl: string;
  } | null;
}

export interface GitHubApiIssue {
  readonly githubIssueId: string;
  readonly nodeId: string;
  readonly number: number;
  readonly title: string;
  readonly bodyPreview: string | null;
  readonly state: "open" | "closed";
  readonly author: GitHubApiActor;
  readonly assignees: ReadonlyArray<GitHubApiActor>;
  readonly labels: ReadonlyArray<{
    readonly name: string;
    readonly color: string | null;
    readonly description: string | null;
  }>;
  readonly milestone: {
    readonly number: number;
    readonly title: string;
    readonly state: "open" | "closed";
    readonly dueOn: string | null;
  } | null;
  readonly commentCount: number;
  readonly htmlUrl: string;
  readonly createdAtRemote: string;
  readonly updatedAtRemote: string;
  readonly closedAtRemote: string | null;
}

export interface GitHubApiIssueComment {
  readonly githubCommentId: string;
  readonly nodeId: string;
  readonly author: GitHubApiActor;
  readonly body: string;
  readonly htmlUrl: string;
  readonly createdAtRemote: string;
  readonly updatedAtRemote: string;
}

export interface GitHubApiPullRequest {
  readonly githubPullRequestId: string;
  readonly nodeId: string;
  readonly number: number;
  readonly title: string;
  readonly bodyPreview: string | null;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft: boolean;
  readonly author: GitHubApiActor;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly mergeableState:
    | "unknown"
    | "mergeable"
    | "conflicting"
    | "behind"
    | "blocked"
    | "unstable"
    | "draft";
  readonly reviewDecision: "none" | "review_required" | "approved" | "changes_requested";
  readonly changedFileCount: number;
  readonly commitCount: number;
  readonly commentCount: number;
  readonly requiredCheckNames: ReadonlyArray<string>;
  readonly htmlUrl: string;
  readonly createdAtRemote: string;
  readonly updatedAtRemote: string;
  readonly mergedAtRemote: string | null;
  readonly closedAtRemote: string | null;
}

export interface GitHubApiPullRequestFile {
  readonly path: string;
  readonly status:
    | "added"
    | "modified"
    | "removed"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged"
    | "unknown";
  readonly additions: number;
  readonly deletions: number;
  readonly changes: number;
  readonly previousPath: string | null;
  readonly blobUrl: string | null;
  readonly rawUrl: string | null;
  readonly patch: string | null;
}

export interface GitHubApiPullRequestCommit {
  readonly sha: string;
  readonly message: string;
  readonly author: GitHubApiActor | null;
  readonly authoredAt: string | null;
  readonly committedAt: string | null;
  readonly htmlUrl: string;
}

export interface GitHubApiReview {
  readonly githubReviewId: string;
  readonly nodeId: string;
  readonly author: GitHubApiActor;
  readonly state: "pending" | "commented" | "approved" | "changes_requested" | "dismissed";
  readonly bodyPreview: string | null;
  readonly submittedAt: string | null;
  readonly commitSha: string | null;
  readonly htmlUrl: string | null;
}

export interface GitHubApiReviewThread {
  readonly githubThreadId: string;
  readonly path: string;
  readonly line: number | null;
  readonly originalLine: number | null;
  readonly side: "LEFT" | "RIGHT" | null;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly createdAtRemote: string;
  readonly updatedAtRemote: string;
  readonly comments: ReadonlyArray<GitHubApiReviewComment>;
  readonly commentPageInfo: GitHubPageInfo;
}

export interface GitHubApiReviewComment {
  readonly githubCommentId: string;
  readonly nodeId: string;
  readonly author: GitHubApiActor;
  readonly body: string;
  readonly path: string;
  readonly line: number | null;
  readonly originalLine: number | null;
  readonly side: "LEFT" | "RIGHT" | null;
  readonly commitSha: string | null;
  readonly htmlUrl: string;
  readonly createdAtRemote: string;
  readonly updatedAtRemote: string;
  readonly reviewId: string | null;
  readonly inReplyToId: string | null;
}

export interface GitHubApiCheck {
  readonly githubCheckId: string;
  readonly name: string;
  readonly provider: string;
  readonly headSha: string;
  readonly status: "queued" | "in_progress" | "completed";
  readonly conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | "stale"
    | "unknown"
    | null;
  readonly detailsUrl: string | null;
  readonly startedAtRemote: string | null;
  readonly completedAtRemote: string | null;
  readonly summary: string | null;
}

export interface GitHubApiBranch {
  readonly name: string;
  readonly sha: string;
  readonly protected: boolean;
}

interface RepositoryInput {
  readonly cwd: string;
  readonly hostname: string;
  readonly owner: string;
  readonly repository: string;
  readonly conditional?: GitHubConditionalRequest;
}

interface PageInput {
  readonly cursor?: string | null;
  readonly pageSize?: number;
}

interface RetryInput {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
}

const Id = Schema.Union([Schema.Number, Schema.String]);
const NullableString = Schema.NullOr(Schema.String);
const RawActor = Schema.Struct({
  login: Schema.String,
  name: Schema.optional(NullableString),
  avatar_url: Schema.optional(NullableString),
  html_url: Schema.optional(NullableString),
});
const NullableActor = Schema.NullOr(RawActor);
const RawLabel = Schema.Struct({
  name: Schema.String,
  color: Schema.optional(NullableString),
  description: Schema.optional(NullableString),
});
const RawMilestone = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  due_on: Schema.optional(NullableString),
});
const RawIssue = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(NullableString),
  state: Schema.String,
  user: NullableActor,
  assignees: Schema.optional(Schema.Array(RawActor)),
  labels: Schema.optional(Schema.Array(RawLabel)),
  milestone: Schema.optional(Schema.NullOr(RawMilestone)),
  comments: Schema.Number,
  html_url: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  closed_at: Schema.optional(NullableString),
  pull_request: Schema.optional(Schema.Unknown),
});
const RawPullRequestRef = Schema.Struct({
  ref: Schema.String,
  sha: Schema.String,
});
const RawPullRequest = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(NullableString),
  state: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  user: NullableActor,
  head: RawPullRequestRef,
  base: RawPullRequestRef,
  mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable_state: Schema.optional(Schema.String),
  changed_files: Schema.optional(Schema.Number),
  commits: Schema.optional(Schema.Number),
  comments: Schema.optional(Schema.Number),
  review_comments: Schema.optional(Schema.Number),
  html_url: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  merged_at: Schema.optional(NullableString),
  closed_at: Schema.optional(NullableString),
});
const RawIssueComment = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  user: NullableActor,
  body: Schema.String,
  html_url: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
});
const RawPullRequestFile = Schema.Struct({
  filename: Schema.String,
  status: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  changes: Schema.Number,
  previous_filename: Schema.optional(Schema.String),
  blob_url: Schema.optional(NullableString),
  raw_url: Schema.optional(NullableString),
  patch: Schema.optional(NullableString),
});
const RawCommit = Schema.Struct({
  sha: Schema.String,
  html_url: Schema.String,
  author: Schema.optional(NullableActor),
  commit: Schema.Struct({
    message: Schema.String,
    author: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          name: Schema.optional(NullableString),
          date: Schema.optional(NullableString),
        }),
      ),
    ),
    committer: Schema.optional(
      Schema.NullOr(Schema.Struct({ date: Schema.optional(NullableString) })),
    ),
  }),
});
const RawReview = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  user: NullableActor,
  state: Schema.String,
  body: Schema.optional(NullableString),
  submitted_at: Schema.optional(NullableString),
  commit_id: Schema.optional(NullableString),
  html_url: Schema.optional(NullableString),
});
const RawReviewComment = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  user: NullableActor,
  body: Schema.String,
  path: Schema.String,
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  original_line: Schema.optional(Schema.NullOr(Schema.Number)),
  side: Schema.optional(NullableString),
  commit_id: Schema.optional(NullableString),
  html_url: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  pull_request_review_id: Schema.optional(Schema.NullOr(Id)),
  in_reply_to_id: Schema.optional(Schema.NullOr(Id)),
});
const RawCheckRun = Schema.Struct({
  id: Id,
  node_id: Schema.optional(Schema.String),
  name: Schema.String,
  head_sha: Schema.String,
  status: Schema.String,
  conclusion: Schema.optional(NullableString),
  details_url: Schema.optional(NullableString),
  started_at: Schema.optional(NullableString),
  completed_at: Schema.optional(NullableString),
  app: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  output: Schema.optional(Schema.Struct({ summary: Schema.optional(NullableString) })),
});
const RawCheckRuns = Schema.Struct({
  total_count: Schema.Number,
  check_runs: Schema.Array(RawCheckRun),
});
const RawCommitStatus = Schema.Struct({
  id: Id,
  node_id: Schema.optional(Schema.String),
  context: Schema.String,
  state: Schema.String,
  target_url: Schema.optional(NullableString),
  creator: Schema.optional(NullableActor),
  created_at: Schema.optional(NullableString),
  updated_at: Schema.optional(NullableString),
});
const RawBranch = Schema.Struct({
  name: Schema.String,
  protected: Schema.Boolean,
  commit: Schema.Struct({ sha: Schema.String }),
});
const RawRepository = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  name: Schema.String,
  full_name: Schema.String,
  owner: RawActor,
  html_url: Schema.String,
  clone_url: Schema.String,
  ssh_url: Schema.String,
  default_branch: Schema.String,
  visibility: Schema.optional(Schema.String),
  private: Schema.Boolean,
  permissions: Schema.optional(
    Schema.Struct({
      pull: Schema.optional(Schema.Boolean),
      triage: Schema.optional(Schema.Boolean),
      push: Schema.optional(Schema.Boolean),
      maintain: Schema.optional(Schema.Boolean),
      admin: Schema.optional(Schema.Boolean),
    }),
  ),
  archived: Schema.Boolean,
  fork: Schema.Boolean,
  parent: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Id, full_name: Schema.String, html_url: Schema.String })),
  ),
});
const RawAccount = Schema.Struct({
  id: Id,
  node_id: Schema.String,
  login: Schema.String,
  name: Schema.optional(NullableString),
  avatar_url: Schema.optional(NullableString),
  html_url: Schema.optional(NullableString),
});
const RawRequiredChecks = Schema.Struct({
  checks: Schema.optional(Schema.Array(Schema.Struct({ context: Schema.String }))),
  contexts: Schema.optional(Schema.Array(Schema.String)),
});

type SchemaType<S extends Schema.Top> = Schema.Schema.Type<S>;

function bodyPreview(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  return body.length <= BODY_PREVIEW_LENGTH ? body : body.slice(0, BODY_PREVIEW_LENGTH);
}

function summaryPreview(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  return body.length <= SUMMARY_LENGTH ? body : body.slice(0, SUMMARY_LENGTH);
}

function normalizeActor(actor: SchemaType<typeof NullableActor>): GitHubApiActor {
  return actor === null
    ? { login: "ghost", displayName: null, avatarUrl: null, htmlUrl: null }
    : {
        login: actor.login,
        displayName: actor.name ?? null,
        avatarUrl: actor.avatar_url ?? null,
        htmlUrl: actor.html_url ?? null,
      };
}

function normalizeIssue(issue: SchemaType<typeof RawIssue>): GitHubApiIssue {
  return {
    githubIssueId: String(issue.id),
    nodeId: issue.node_id,
    number: issue.number,
    title: issue.title,
    bodyPreview: bodyPreview(issue.body),
    state: issue.state.toLowerCase() === "closed" ? "closed" : "open",
    author: normalizeActor(issue.user),
    assignees: (issue.assignees ?? []).map(normalizeActor),
    labels: (issue.labels ?? []).map((label) => ({
      name: label.name,
      color: label.color ?? null,
      description: label.description ?? null,
    })),
    milestone: issue.milestone
      ? {
          number: issue.milestone.number,
          title: issue.milestone.title,
          state: issue.milestone.state.toLowerCase() === "closed" ? "closed" : "open",
          dueOn: issue.milestone.due_on ?? null,
        }
      : null,
    commentCount: issue.comments,
    htmlUrl: issue.html_url,
    createdAtRemote: issue.created_at,
    updatedAtRemote: issue.updated_at,
    closedAtRemote: issue.closed_at ?? null,
  };
}

function normalizeRepository(repository: SchemaType<typeof RawRepository>): GitHubApiRepository {
  const permissions = repository.permissions ?? {};
  const canAdmin = permissions.admin ?? false;
  const canMaintain = canAdmin || (permissions.maintain ?? false);
  const canPush = canMaintain || (permissions.push ?? false);
  const canTriage = canPush || (permissions.triage ?? false);
  const canRead = canTriage || (permissions.pull ?? true);
  const level = canAdmin
    ? "admin"
    : canMaintain
      ? "maintain"
      : canPush
        ? "write"
        : canTriage
          ? "triage"
          : canRead
            ? "read"
            : "none";
  const [owner = repository.owner.login, name = repository.name] = repository.full_name.split(
    "/",
    2,
  );
  let parentRepository: GitHubApiRepository["parentRepository"] = null;
  if (repository.parent) {
    const [parentOwner = "unknown", parentName = "unknown"] = repository.parent.full_name.split(
      "/",
      2,
    );
    parentRepository = {
      repositoryId: String(repository.parent.id),
      owner: parentOwner,
      repository: parentName,
      htmlUrl: repository.parent.html_url,
    };
  }
  const visibility =
    repository.visibility === "public" ||
    repository.visibility === "private" ||
    repository.visibility === "internal"
      ? repository.visibility
      : repository.private
        ? "private"
        : "unknown";
  return {
    repositoryId: String(repository.id),
    nodeId: repository.node_id,
    owner,
    repository: name,
    htmlUrl: repository.html_url,
    cloneUrl: repository.clone_url,
    sshUrl: repository.ssh_url,
    defaultBranch: repository.default_branch,
    visibility,
    permissions: { level, canRead, canTriage, canPush, canMaintain, canAdmin },
    isArchived: repository.archived,
    isFork: repository.fork,
    parentRepository,
  };
}

function normalizeMergeableState(
  pullRequest: SchemaType<typeof RawPullRequest>,
): GitHubApiPullRequest["mergeableState"] {
  if (pullRequest.draft === true) return "draft";
  if (pullRequest.mergeable === true) return "mergeable";
  if (pullRequest.mergeable === false) return "conflicting";
  switch (pullRequest.mergeable_state?.toLowerCase()) {
    case "behind":
      return "behind";
    case "blocked":
      return "blocked";
    case "unstable":
      return "unstable";
    case "dirty":
      return "conflicting";
    case "clean":
      return "mergeable";
    default:
      return "unknown";
  }
}

function normalizePullRequest(
  pullRequest: SchemaType<typeof RawPullRequest>,
): GitHubApiPullRequest {
  const mergedAt = pullRequest.merged_at ?? null;
  return {
    githubPullRequestId: String(pullRequest.id),
    nodeId: pullRequest.node_id,
    number: pullRequest.number,
    title: pullRequest.title,
    bodyPreview: bodyPreview(pullRequest.body),
    state:
      mergedAt !== null
        ? "merged"
        : pullRequest.state.toLowerCase() === "closed"
          ? "closed"
          : "open",
    isDraft: pullRequest.draft ?? false,
    author: normalizeActor(pullRequest.user),
    headRef: pullRequest.head.ref,
    headSha: pullRequest.head.sha,
    baseRef: pullRequest.base.ref,
    baseSha: pullRequest.base.sha,
    mergeableState: normalizeMergeableState(pullRequest),
    reviewDecision: "none",
    changedFileCount: pullRequest.changed_files ?? 0,
    commitCount: pullRequest.commits ?? 0,
    commentCount: (pullRequest.comments ?? 0) + (pullRequest.review_comments ?? 0),
    requiredCheckNames: [],
    htmlUrl: pullRequest.html_url,
    createdAtRemote: pullRequest.created_at,
    updatedAtRemote: pullRequest.updated_at,
    mergedAtRemote: mergedAt,
    closedAtRemote: pullRequest.closed_at ?? null,
  };
}

function normalizeReviewState(state: string): GitHubApiReview["state"] {
  switch (state.toLowerCase()) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes_requested";
    case "dismissed":
      return "dismissed";
    case "pending":
      return "pending";
    default:
      return "commented";
  }
}

function normalizeCheckConclusion(value: string | null | undefined): GitHubApiCheck["conclusion"] {
  if (value === null || value === undefined) return null;
  switch (value.toLowerCase()) {
    case "success":
    case "failure":
    case "neutral":
    case "cancelled":
    case "skipped":
    case "timed_out":
    case "action_required":
    case "stale":
      return value.toLowerCase() as GitHubApiCheck["conclusion"];
    default:
      return "unknown";
  }
}

function normalizeCheckStatus(value: string): GitHubApiCheck["status"] {
  return value === "completed" ? "completed" : value === "in_progress" ? "in_progress" : "queued";
}

function normalizeFileStatus(value: string): GitHubApiPullRequestFile["status"] {
  switch (value.toLowerCase()) {
    case "added":
    case "modified":
    case "removed":
    case "renamed":
    case "copied":
    case "changed":
    case "unchanged":
      return value.toLowerCase() as GitHubApiPullRequestFile["status"];
    default:
      return "unknown";
  }
}

function normalizePageSize(value: number | undefined): number {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(value ?? DEFAULT_PAGE_SIZE)));
}

function addQuery(
  endpoint: string,
  values: Readonly<Record<string, string | number | null | undefined>>,
): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) params.set(name, String(value));
  }
  const query = params.toString();
  return query.length === 0 ? endpoint : `${endpoint}${separator}${query}`;
}

function repositoryEndpoint(
  input: Pick<RepositoryInput, "owner" | "repository">,
  suffix = "",
): string {
  return `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}${suffix}`;
}

function diagnosticEndpoint(endpoint: string): string {
  const [path, query = ""] = endpoint.split("?", 2);
  if (query.length === 0) return path ?? "github-api";
  const names = Array.from(new URLSearchParams(query).keys()).toSorted();
  return `${path ?? "github-api"}?${names.join("&")}`.slice(0, 1_024);
}

function conditionHeaders(condition: GitHubConditionalRequest | undefined): Record<string, string> {
  return {
    Accept: DEFAULT_ACCEPT,
    "X-GitHub-Api-Version": API_VERSION,
    ...(condition?.etag ? { "If-None-Match": condition.etag } : {}),
    ...(condition?.lastModified ? { "If-Modified-Since": condition.lastModified } : {}),
  };
}

interface ParsedIncludedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function parseIncludedResponse(stdout: string): ParsedIncludedResponse | null {
  let offset = 0;
  let latest: ParsedIncludedResponse | null = null;
  while (stdout.slice(offset).startsWith("HTTP/")) {
    const headerEndMatch = /\r?\n\r?\n/u.exec(stdout.slice(offset));
    if (!headerEndMatch || headerEndMatch.index === undefined) return null;
    const headerEnd = offset + headerEndMatch.index;
    const separatorLength = headerEndMatch[0].length;
    const headerLines = stdout.slice(offset, headerEnd).split(/\r?\n/u);
    const statusMatch = /^HTTP\/\S+\s+(\d{3})(?:\s|$)/u.exec(headerLines[0] ?? "");
    if (!statusMatch?.[1]) return null;
    const headers: Record<string, string> = {};
    for (const line of headerLines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
    }
    const bodyOffset = headerEnd + separatorLength;
    latest = { status: Number(statusMatch[1]), headers, body: stdout.slice(bodyOffset) };
    if (!stdout.slice(bodyOffset).startsWith("HTTP/")) break;
    offset = bodyOffset;
  }
  return latest;
}

function headerInteger(headers: Readonly<Record<string, string>>, name: string): number | null {
  const value = headers[name];
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function rateLimitFromHeaders(
  headers: Readonly<Record<string, string>>,
  body: string,
  status: number,
): GitHubRateLimit {
  const reset = headerInteger(headers, "x-ratelimit-reset");
  const remaining = headerInteger(headers, "x-ratelimit-remaining");
  const retryAfterSeconds = headerInteger(headers, "retry-after");
  const secondary =
    remaining !== 0 &&
    (status === 429 ||
      (status === 403 &&
        (retryAfterSeconds !== null ||
          body.slice(0, 4_096).toLowerCase().includes("secondary rate limit"))));
  const resource = headers["x-ratelimit-resource"]?.toLowerCase();
  const kind = secondary
    ? "secondary"
    : resource === "core" ||
        resource === "search" ||
        resource === "graphql" ||
        resource === "integration_manifest"
      ? resource
      : "unknown";
  const resetAt =
    reset === null
      ? null
      : Option.match(DateTime.make(reset * 1_000), {
          onNone: () => null,
          onSome: DateTime.formatIso,
        });
  return {
    kind,
    limit: headerInteger(headers, "x-ratelimit-limit"),
    remaining,
    used: headerInteger(headers, "x-ratelimit-used"),
    resetAt,
    retryAfterSeconds,
    secondary,
  };
}

function normalizeNextCursor(link: string | undefined, hostname: string): string | null {
  if (!link) return null;
  const next = link
    .split(",")
    .map((part) => /<([^>]+)>;\s*rel="next"/u.exec(part)?.[1] ?? null)
    .find((value): value is string => value !== null);
  if (!next) return null;
  try {
    const parsed = new URL(next);
    const configuredHost = hostname.toLowerCase();
    const allowedHost = configuredHost === "github.com" ? "api.github.com" : configuredHost;
    if (parsed.host.toLowerCase() !== allowedHost && parsed.host.toLowerCase() !== configuredHost) {
      return null;
    }
    const pathname = parsed.pathname.replace(/^\/api\/v3\//u, "").replace(/^\//u, "");
    return `${pathname}${parsed.search}`.slice(0, 4_096);
  } catch {
    return null;
  }
}

function responseKind(
  response: ParsedIncludedResponse,
  rateLimit: GitHubRateLimit,
): GitHubApiFailureKind {
  if (response.status === 401) return "authentication_required";
  if (
    response.status === 429 ||
    (response.status === 403 && (rateLimit.remaining === 0 || rateLimit.secondary))
  ) {
    return "rate_limited";
  }
  if (response.status === 403) return "permission_denied";
  if (response.status === 404 || response.status === 410) return "not_found";
  if (response.status === 409) return "conflict";
  if (response.status === 422) return "validation_failed";
  if ([408, 425, 500, 502, 503, 504].includes(response.status)) return "transient";
  return "remote_error";
}

export function isRetryableGitHubStatus(status: number): boolean {
  return [408, 425, 500, 502, 503, 504].includes(status);
}

function cliFailureIsRetryable(error: GitHubCli.GitHubCliError): boolean {
  return error._tag === "GitHubCliCommandError";
}

const jsonDecoder = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));

function decodeResponse<S extends Schema.Top>(
  response: ParsedIncludedResponse,
  schema: S,
  operation: GitHubApiOperation,
  endpoint: string,
): Effect.Effect<S["Type"], GitHubApiDecodeError, S["DecodingServices"]> {
  return jsonDecoder(schema)(response.body).pipe(
    Effect.mapError(
      () =>
        new GitHubApiDecodeError({
          operation,
          endpoint: diagnosticEndpoint(endpoint),
          status: response.status,
          responseBodyLength: response.body.length,
        }),
    ),
  );
}

function metadata(response: ParsedIncludedResponse, hostname: string): GitHubResponseMetadata {
  return {
    status: response.status,
    etag: response.headers.etag ?? null,
    lastModified: response.headers["last-modified"] ?? null,
    nextCursor: normalizeNextCursor(response.headers.link, hostname),
    oauthScopes: (response.headers["x-oauth-scopes"] ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
    rateLimit: rateLimitFromHeaders(response.headers, response.body, response.status),
  };
}

const GraphQlActor = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.optional(NullableString),
  url: Schema.optional(NullableString),
});
const GraphQlComment = Schema.Struct({
  id: Schema.String,
  databaseId: Schema.optional(Schema.NullOr(Id)),
  body: Schema.String,
  path: Schema.String,
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  originalLine: Schema.optional(Schema.NullOr(Schema.Number)),
  diffSide: Schema.optional(NullableString),
  author: Schema.optional(Schema.NullOr(GraphQlActor)),
  commit: Schema.optional(Schema.NullOr(Schema.Struct({ oid: Schema.String }))),
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  pullRequestReview: Schema.optional(
    Schema.NullOr(Schema.Struct({ databaseId: Schema.optional(Schema.NullOr(Id)) })),
  ),
});
const GraphQlPageInfo = Schema.Struct({
  endCursor: Schema.optional(NullableString),
  hasNextPage: Schema.Boolean,
});
const GraphQlComments = Schema.Struct({
  totalCount: Schema.Number,
  pageInfo: GraphQlPageInfo,
  nodes: Schema.Array(GraphQlComment),
});
const GraphQlThread = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  originalLine: Schema.optional(Schema.NullOr(Schema.Number)),
  diffSide: Schema.optional(NullableString),
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  comments: GraphQlComments,
});
const GraphQlThreadsResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            reviewThreads: Schema.Struct({
              totalCount: Schema.Number,
              pageInfo: GraphQlPageInfo,
              nodes: Schema.Array(GraphQlThread),
            }),
          }),
        ),
      }),
    ),
  }),
});
const GraphQlReviewDecisionResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            reviewDecision: Schema.optional(NullableString),
          }),
        ),
      }),
    ),
  }),
});
const GraphQlThreadCommentsResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(
      Schema.Struct({
        comments: GraphQlComments,
      }),
    ),
  }),
});
const GraphQlReadyResponse = Schema.Struct({
  data: Schema.Struct({
    markPullRequestReadyForReview: Schema.NullOr(
      Schema.Struct({ pullRequest: Schema.NullOr(Schema.Struct({ id: Schema.String })) }),
    ),
  }),
});
const GraphQlDraftResponse = Schema.Struct({
  data: Schema.Struct({
    convertPullRequestToDraft: Schema.NullOr(
      Schema.Struct({ pullRequest: Schema.NullOr(Schema.Struct({ id: Schema.String })) }),
    ),
  }),
});
const GraphQlResolveResponse = Schema.Struct({
  data: Schema.Struct({
    resolveReviewThread: Schema.NullOr(
      Schema.Struct({
        thread: Schema.NullOr(Schema.Struct({ id: Schema.String, isResolved: Schema.Boolean })),
      }),
    ),
  }),
});
const RawRateLimitResource = Schema.Struct({
  limit: Schema.Number,
  remaining: Schema.Number,
  used: Schema.optional(Schema.Number),
  reset: Schema.String,
});
const RawRateLimitResponse = Schema.Struct({
  resources: Schema.Struct({
    core: Schema.optional(RawRateLimitResource),
    search: Schema.optional(RawRateLimitResource),
    graphql: Schema.optional(RawRateLimitResource),
    integration_manifest: Schema.optional(RawRateLimitResource),
  }),
});

export interface GitHubApiRateLimitResource {
  readonly kind: "core" | "search" | "graphql" | "integration_manifest";
  readonly limit: number;
  readonly remaining: number;
  readonly used: number | null;
  readonly resetAt: string;
}

function normalizeGraphQlActor(
  actor: SchemaType<typeof GraphQlActor> | null | undefined,
): GitHubApiActor {
  return actor
    ? {
        login: actor.login,
        displayName: null,
        avatarUrl: actor.avatarUrl ?? null,
        htmlUrl: actor.url ?? null,
      }
    : { login: "ghost", displayName: null, avatarUrl: null, htmlUrl: null };
}

function normalizeGraphQlComment(
  comment: SchemaType<typeof GraphQlComment>,
): GitHubApiReviewComment {
  return {
    githubCommentId: String(comment.databaseId ?? comment.id),
    nodeId: comment.id,
    author: normalizeGraphQlActor(comment.author),
    body: comment.body,
    path: comment.path,
    line: comment.line ?? null,
    originalLine: comment.originalLine ?? null,
    side: comment.diffSide === "LEFT" || comment.diffSide === "RIGHT" ? comment.diffSide : null,
    commitSha: comment.commit?.oid ?? null,
    htmlUrl: comment.url,
    createdAtRemote: comment.createdAt,
    updatedAtRemote: comment.updatedAt,
    reviewId:
      comment.pullRequestReview?.databaseId === null ||
      comment.pullRequestReview?.databaseId === undefined
        ? null
        : String(comment.pullRequestReview.databaseId),
    inReplyToId: null,
  };
}

function normalizeGraphQlThread(thread: SchemaType<typeof GraphQlThread>): GitHubApiReviewThread {
  const comments = thread.comments.nodes.map(normalizeGraphQlComment);
  const first = comments[0];
  const last = comments[comments.length - 1];
  return {
    githubThreadId: thread.id,
    path: thread.path,
    line: thread.line ?? null,
    originalLine: thread.originalLine ?? null,
    side: thread.diffSide === "LEFT" || thread.diffSide === "RIGHT" ? thread.diffSide : null,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    createdAtRemote: first?.createdAtRemote ?? "1970-01-01T00:00:00.000Z",
    updatedAtRemote: last?.updatedAtRemote ?? first?.updatedAtRemote ?? "1970-01-01T00:00:00.000Z",
    comments,
    commentPageInfo: {
      endCursor: thread.comments.pageInfo.endCursor ?? null,
      hasNextPage: thread.comments.pageInfo.hasNextPage,
      totalCount: thread.comments.totalCount,
    },
  };
}

export class GitHubApiClient extends Context.Service<
  GitHubApiClient,
  {
    readonly validateAccount: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly conditional?: GitHubConditionalRequest;
      readonly retry?: RetryInput;
    }) => Effect.Effect<GitHubApiResult<GitHubApiAccountIdentity>, GitHubApiError>;
    readonly listRepositories: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly cursor?: string | null;
      readonly pageSize?: number;
      readonly visibility?: "all" | "public" | "private";
      readonly affiliation?: ReadonlyArray<"owner" | "collaborator" | "organization_member">;
      readonly conditional?: GitHubConditionalRequest;
      readonly retry?: RetryInput;
    }) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiRepository>>, GitHubApiError>;
    readonly getRepository: (
      input: RepositoryInput & { readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubApiRepository>, GitHubApiError>;
    readonly listIssues: (
      input: RepositoryInput &
        PageInput & {
          readonly state?: "open" | "closed" | "all";
          readonly labels?: ReadonlyArray<string>;
          readonly assignee?: string | null;
          readonly milestone?: string | number | null;
          readonly retry?: RetryInput;
        },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiIssue>>, GitHubApiError>;
    readonly getIssue: (
      input: RepositoryInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubApiIssue>, GitHubApiError>;
    readonly listIssueComments: (
      input: RepositoryInput & PageInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiIssueComment>>, GitHubApiError>;
    readonly listLabels: (
      input: RepositoryInput & PageInput & { readonly retry?: RetryInput },
    ) => Effect.Effect<
      GitHubApiResult<
        GitHubPage<{
          readonly name: string;
          readonly color: string | null;
          readonly description: string | null;
        }>
      >,
      GitHubApiError
    >;
    readonly listMilestones: (
      input: RepositoryInput &
        PageInput & { readonly state?: "open" | "closed" | "all"; readonly retry?: RetryInput },
    ) => Effect.Effect<
      GitHubApiResult<
        GitHubPage<{
          readonly number: number;
          readonly title: string;
          readonly state: "open" | "closed";
          readonly dueOn: string | null;
        }>
      >,
      GitHubApiError
    >;
    readonly listPullRequests: (
      input: RepositoryInput &
        PageInput & { readonly state?: "open" | "closed" | "all"; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiPullRequest>>, GitHubApiError>;
    readonly getPullRequest: (
      input: RepositoryInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubApiPullRequest>, GitHubApiError>;
    readonly getPullRequestReviewDecision: (
      input: RepositoryInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubApiPullRequest["reviewDecision"]>, GitHubApiError>;
    readonly listPullRequestFiles: (
      input: RepositoryInput & PageInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiPullRequestFile>>, GitHubApiError>;
    readonly listPullRequestCommits: (
      input: RepositoryInput & PageInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiPullRequestCommit>>, GitHubApiError>;
    readonly listPullRequestReviews: (
      input: RepositoryInput & PageInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiReview>>, GitHubApiError>;
    readonly listPullRequestReviewComments: (
      input: RepositoryInput & PageInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiReviewComment>>, GitHubApiError>;
    readonly listReviewThreads: (
      input: RepositoryInput & PageInput & { readonly number: number; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiReviewThread>>, GitHubApiError>;
    readonly listReviewThreadComments: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly threadNodeId: string;
      readonly cursor?: string | null;
      readonly pageSize?: number;
      readonly retry?: RetryInput;
    }) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiReviewComment>>, GitHubApiError>;
    readonly listChecks: (
      input: RepositoryInput &
        PageInput & { readonly headSha: string; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiCheck>>, GitHubApiError>;
    readonly listCommitStatuses: (
      input: RepositoryInput &
        PageInput & { readonly headSha: string; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiCheck>>, GitHubApiError>;
    readonly listBranches: (
      input: RepositoryInput &
        PageInput & { readonly protectedOnly?: boolean; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubPage<GitHubApiBranch>>, GitHubApiError>;
    readonly getBranch: (
      input: RepositoryInput & { readonly branch: string; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<GitHubApiBranch>, GitHubApiError>;
    readonly getRequiredChecks: (
      input: RepositoryInput & { readonly branch: string; readonly retry?: RetryInput },
    ) => Effect.Effect<GitHubApiResult<ReadonlyArray<string>>, GitHubApiError>;
    readonly getRateLimit: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly retry?: RetryInput;
    }) => Effect.Effect<GitHubApiResult<ReadonlyArray<GitHubApiRateLimitResource>>, GitHubApiError>;
    readonly createPullRequest: (
      input: RepositoryInput & {
        readonly title: string;
        readonly body: string;
        readonly head: string;
        readonly base: string;
        readonly draft?: boolean;
        readonly retry?: RetryInput;
      },
    ) => Effect.Effect<GitHubApiResult<GitHubApiPullRequest>, GitHubApiError>;
    readonly updatePullRequest: (
      input: RepositoryInput & {
        readonly number: number;
        readonly title?: string;
        readonly body?: string;
        readonly state?: "open" | "closed";
        readonly base?: string;
        readonly retry?: RetryInput;
      },
    ) => Effect.Effect<GitHubApiResult<GitHubApiPullRequest>, GitHubApiError>;
    readonly convertPullRequestToDraft: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly pullRequestNodeId: string;
      readonly retry?: RetryInput;
    }) => Effect.Effect<GitHubApiResult<{ readonly pullRequestNodeId: string }>, GitHubApiError>;
    readonly markPullRequestReadyForReview: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly pullRequestNodeId: string;
      readonly retry?: RetryInput;
    }) => Effect.Effect<GitHubApiResult<{ readonly pullRequestNodeId: string }>, GitHubApiError>;
    readonly resolveReviewThread: (input: {
      readonly cwd: string;
      readonly hostname: string;
      readonly threadNodeId: string;
      readonly retry?: RetryInput;
    }) => Effect.Effect<
      GitHubApiResult<{ readonly threadNodeId: string; readonly isResolved: boolean }>,
      GitHubApiError
    >;
  }
>()("t3/github/GitHubApiClient") {}

export const make = Effect.gen(function* () {
  const cli = yield* GitHubCli.GitHubCli;

  const requestRaw = (input: {
    readonly cwd: string;
    readonly hostname: string;
    readonly operation: GitHubApiOperation;
    readonly endpoint: string;
    readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: unknown;
    readonly retry?: RetryInput;
  }): Effect.Effect<ParsedIncludedResponse, GitHubApiError> => {
    const maxRetries = Math.max(0, Math.min(3, Math.trunc(input.retry?.maxRetries ?? 2)));
    const baseDelayMs = Math.max(0, Math.min(10_000, Math.trunc(input.retry?.baseDelayMs ?? 250)));

    const runAttempt = (attempt: number): Effect.Effect<ParsedIncludedResponse, GitHubApiError> =>
      Effect.gen(function* () {
        const executed = yield* Effect.result(
          cli
            .executeApi({
              cwd: input.cwd,
              hostname: input.hostname,
              endpoint: input.endpoint,
              ...(input.method ? { method: input.method } : {}),
              ...(input.headers ? { headers: input.headers } : {}),
              ...(input.body === undefined ? {} : { body: input.body }),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new GitHubApiTransportError({
                    operation: input.operation,
                    endpoint: diagnosticEndpoint(input.endpoint),
                    retryable: cliFailureIsRetryable(cause),
                    cause,
                  }),
              ),
            ),
        );
        if (Result.isFailure(executed)) {
          const error = executed.failure;
          if (error.retryable && attempt < maxRetries) {
            const delay = baseDelayMs * 2 ** attempt;
            if (delay > 0) yield* Effect.sleep(Duration.millis(delay));
            return yield* runAttempt(attempt + 1);
          }
          return yield* error;
        }

        const output = executed.success;
        const response = parseIncludedResponse(output.stdout);
        if (response === null) {
          return yield* new GitHubApiDecodeError({
            operation: input.operation,
            endpoint: diagnosticEndpoint(input.endpoint),
            status: Number(output.exitCode),
            responseBodyLength: output.stdout.length,
          });
        }
        if (isRetryableGitHubStatus(response.status) && attempt < maxRetries) {
          const delay = baseDelayMs * 2 ** attempt;
          if (delay > 0) yield* Effect.sleep(Duration.millis(delay));
          return yield* runAttempt(attempt + 1);
        }
        return response;
      });

    return runAttempt(0);
  };

  const request = <S extends Schema.Top>(input: {
    readonly cwd: string;
    readonly hostname: string;
    readonly operation: GitHubApiOperation;
    readonly endpoint: string;
    readonly schema: S;
    readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: unknown;
    readonly retry?: RetryInput;
  }): Effect.Effect<GitHubApiResult<S["Type"]>, GitHubApiError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const response = yield* requestRaw(input);
      const responseMetadata = metadata(response, input.hostname);
      if (response.status === 304) {
        return { notModified: true, data: null, ...responseMetadata } as const;
      }
      if (response.status < 200 || response.status >= 300) {
        const rateLimit = responseMetadata.rateLimit;
        const kind = responseKind(response, rateLimit);
        return yield* new GitHubApiResponseError({
          operation: input.operation,
          endpoint: diagnosticEndpoint(input.endpoint),
          status: response.status,
          kind,
          retryable: kind === "transient",
          responseBodyLength: response.body.length,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          rateLimitResetAt: rateLimit.resetAt,
          secondaryRateLimit: rateLimit.secondary,
        });
      }
      const data = yield* decodeResponse(response, input.schema, input.operation, input.endpoint);
      return { notModified: false, data, ...responseMetadata } as const;
    });

  const rest = <S extends Schema.Top>(input: {
    readonly cwd: string;
    readonly hostname: string;
    readonly operation: GitHubApiOperation;
    readonly endpoint: string;
    readonly schema: S;
    readonly conditional?: GitHubConditionalRequest;
    readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    readonly body?: unknown;
    readonly retry?: RetryInput;
  }) =>
    request({
      ...input,
      headers: conditionHeaders(input.conditional),
    });

  const mapResult = <A, B>(result: GitHubApiResult<A>, map: (value: A) => B): GitHubApiResult<B> =>
    result.notModified ? result : { ...result, data: map(result.data) };

  const pageEndpoint = (
    base: string,
    input: PageInput,
    extra: Readonly<Record<string, string | number | null | undefined>> = {},
  ) => {
    const cursor = input.cursor?.trim();
    const cursorPath = cursor?.split("?", 1)[0]?.replace(/^\/+/, "");
    return cursor && cursorPath === base
      ? cursor
      : addQuery(base, { per_page: normalizePageSize(input.pageSize), ...extra });
  };

  return GitHubApiClient.of({
    validateAccount: (input) =>
      rest({ ...input, operation: "validateAccount", endpoint: "user", schema: RawAccount }).pipe(
        Effect.map((result) =>
          mapResult(result, (account) => ({
            providerAccountId: String(account.id),
            nodeId: account.node_id,
            login: account.login,
            displayName: account.name ?? null,
            avatarUrl: account.avatar_url ?? null,
            htmlUrl: account.html_url ?? null,
            scopes: result.oauthScopes,
            serverUrl:
              input.hostname === "github.com" ? "https://github.com" : `https://${input.hostname}`,
          })),
        ),
      ),
    listRepositories: (input) => {
      const endpoint = pageEndpoint("user/repos", input, {
        visibility: input.visibility ?? "all",
        affiliation: (input.affiliation ?? ["owner", "collaborator", "organization_member"]).join(
          ",",
        ),
        sort: "updated",
      });
      return rest({
        ...input,
        operation: "listRepositories",
        endpoint,
        schema: Schema.Array(RawRepository),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (repositories) => ({
            records: repositories.map(normalizeRepository),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    getRepository: (input) =>
      rest({
        ...input,
        operation: "getRepository",
        endpoint: repositoryEndpoint(input),
        schema: RawRepository,
      }).pipe(Effect.map((result) => mapResult(result, normalizeRepository))),
    listIssues: (input) => {
      const endpoint = pageEndpoint(repositoryEndpoint(input, "/issues"), input, {
        state: input.state ?? "open",
        labels: input.labels?.join(","),
        assignee: input.assignee,
        milestone: input.milestone,
      });
      return rest({
        ...input,
        operation: "listIssues",
        endpoint,
        schema: Schema.Array(RawIssue),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (issues) => ({
            records: issues.filter((issue) => issue.pull_request === undefined).map(normalizeIssue),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    getIssue: (input) =>
      rest({
        ...input,
        operation: "getIssue",
        endpoint: repositoryEndpoint(input, `/issues/${input.number}`),
        schema: RawIssue,
      }).pipe(Effect.map((result) => mapResult(result, normalizeIssue))),
    listIssueComments: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/issues/${input.number}/comments`),
        input,
      );
      return rest({
        ...input,
        operation: "listIssueComments",
        endpoint,
        schema: Schema.Array(RawIssueComment),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (comments) => ({
            records: comments.map((comment) => ({
              githubCommentId: String(comment.id),
              nodeId: comment.node_id,
              author: normalizeActor(comment.user),
              body: comment.body,
              htmlUrl: comment.html_url,
              createdAtRemote: comment.created_at,
              updatedAtRemote: comment.updated_at,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listLabels: (input) => {
      const endpoint = pageEndpoint(repositoryEndpoint(input, "/labels"), input);
      return rest({
        ...input,
        operation: "listLabels",
        endpoint,
        schema: Schema.Array(RawLabel),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (labels) => ({
            records: labels.map((label) => ({
              name: label.name,
              color: label.color ?? null,
              description: label.description ?? null,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listMilestones: (input) => {
      const endpoint = pageEndpoint(repositoryEndpoint(input, "/milestones"), input, {
        state: input.state ?? "open",
      });
      return rest({
        ...input,
        operation: "listMilestones",
        endpoint,
        schema: Schema.Array(RawMilestone),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (milestones) => ({
            records: milestones.map((milestone) => ({
              number: milestone.number,
              title: milestone.title,
              state: milestone.state === "closed" ? ("closed" as const) : ("open" as const),
              dueOn: milestone.due_on ?? null,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listPullRequests: (input) => {
      const endpoint = pageEndpoint(repositoryEndpoint(input, "/pulls"), input, {
        state: input.state ?? "open",
      });
      return rest({
        ...input,
        operation: "listPullRequests",
        endpoint,
        schema: Schema.Array(RawPullRequest),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (pullRequests) => ({
            records: pullRequests.map(normalizePullRequest),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    getPullRequest: (input) =>
      rest({
        ...input,
        operation: "getPullRequest",
        endpoint: repositoryEndpoint(input, `/pulls/${input.number}`),
        schema: RawPullRequest,
      }).pipe(Effect.map((result) => mapResult(result, normalizePullRequest))),
    getPullRequestReviewDecision: (input) =>
      request({
        ...input,
        operation: "getPullRequestReviewDecision",
        endpoint: "graphql",
        method: "POST",
        headers: { Accept: DEFAULT_ACCEPT },
        schema: GraphQlReviewDecisionResponse,
        body: {
          query: `query T3PullRequestReviewDecision($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { pullRequest(number: $number) { reviewDecision } } }`,
          variables: {
            owner: input.owner,
            repository: input.repository,
            number: input.number,
          },
        },
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (response) => {
            switch (response.data.repository?.pullRequest?.reviewDecision) {
              case "APPROVED":
                return "approved";
              case "CHANGES_REQUESTED":
                return "changes_requested";
              case "REVIEW_REQUIRED":
                return "review_required";
              default:
                return "none";
            }
          }),
        ),
      ),
    listPullRequestFiles: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/pulls/${input.number}/files`),
        input,
      );
      return rest({
        ...input,
        operation: "listPullRequestFiles",
        endpoint,
        schema: Schema.Array(RawPullRequestFile),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (files) => ({
            records: files.map((file) => ({
              path: file.filename,
              status: normalizeFileStatus(file.status),
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              previousPath: file.previous_filename ?? null,
              blobUrl: file.blob_url ?? null,
              rawUrl: file.raw_url ?? null,
              patch: file.patch ?? null,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listPullRequestCommits: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/pulls/${input.number}/commits`),
        input,
      );
      return rest({
        ...input,
        operation: "listPullRequestCommits",
        endpoint,
        schema: Schema.Array(RawCommit),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (commits) => ({
            records: commits.map((commit) => ({
              sha: commit.sha,
              message: bodyPreview(commit.commit.message) ?? "",
              author: commit.author ? normalizeActor(commit.author) : null,
              authoredAt: commit.commit.author?.date ?? null,
              committedAt: commit.commit.committer?.date ?? null,
              htmlUrl: commit.html_url,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listPullRequestReviews: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/pulls/${input.number}/reviews`),
        input,
      );
      return rest({
        ...input,
        operation: "listPullRequestReviews",
        endpoint,
        schema: Schema.Array(RawReview),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (reviews) => ({
            records: reviews.map((review) => ({
              githubReviewId: String(review.id),
              nodeId: review.node_id,
              author: normalizeActor(review.user),
              state: normalizeReviewState(review.state),
              bodyPreview: bodyPreview(review.body),
              submittedAt: review.submitted_at ?? null,
              commitSha: review.commit_id ?? null,
              htmlUrl: review.html_url ?? null,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listPullRequestReviewComments: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/pulls/${input.number}/comments`),
        input,
      );
      return rest({
        ...input,
        operation: "listPullRequestReviewComments",
        endpoint,
        schema: Schema.Array(RawReviewComment),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (comments) => ({
            records: comments.map(normalizeRestReviewComment),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listReviewThreads: (input) => {
      const endpoint = "graphql";
      return request({
        ...input,
        operation: "listReviewThreads",
        endpoint,
        schema: GraphQlThreadsResponse,
        method: "POST",
        headers: { Accept: DEFAULT_ACCEPT },
        body: {
          query: `query T3ReviewThreads($owner: String!, $repository: String!, $number: Int!, $first: Int!, $after: String) { repository(owner: $owner, name: $repository) { pullRequest(number: $number) { reviewThreads(first: $first, after: $after) { totalCount pageInfo { endCursor hasNextPage } nodes { id path line originalLine diffSide isResolved isOutdated comments(first: 100) { totalCount pageInfo { endCursor hasNextPage } nodes { id databaseId body path line originalLine diffSide author { login avatarUrl url } commit { oid } url createdAt updatedAt pullRequestReview { databaseId } } } } } } } }`,
          variables: {
            owner: input.owner,
            repository: input.repository,
            number: input.number,
            first: normalizePageSize(input.pageSize),
            after: input.cursor ?? null,
          },
        },
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (response) => {
            const threads = response.data.repository?.pullRequest?.reviewThreads;
            return {
              records: threads?.nodes.map(normalizeGraphQlThread) ?? [],
              pageInfo: {
                endCursor: threads?.pageInfo.endCursor ?? null,
                hasNextPage: threads?.pageInfo.hasNextPage ?? false,
                totalCount: threads?.totalCount ?? 0,
              },
            };
          }),
        ),
      );
    },
    listReviewThreadComments: (input) =>
      request({
        ...input,
        operation: "listReviewThreadComments",
        endpoint: "graphql",
        schema: GraphQlThreadCommentsResponse,
        method: "POST",
        headers: { Accept: DEFAULT_ACCEPT },
        body: {
          query: `query T3ReviewThreadComments($id: ID!, $first: Int!, $after: String) { node(id: $id) { ... on PullRequestReviewThread { comments(first: $first, after: $after) { totalCount pageInfo { endCursor hasNextPage } nodes { id databaseId body path line originalLine diffSide author { login avatarUrl url } commit { oid } url createdAt updatedAt pullRequestReview { databaseId } } } } } }`,
          variables: {
            id: input.threadNodeId,
            first: normalizePageSize(input.pageSize),
            after: input.cursor ?? null,
          },
        },
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (response) => {
            const comments = response.data.node?.comments;
            return {
              records: comments?.nodes.map(normalizeGraphQlComment) ?? [],
              pageInfo: {
                endCursor: comments?.pageInfo.endCursor ?? null,
                hasNextPage: comments?.pageInfo.hasNextPage ?? false,
                totalCount: comments?.totalCount ?? 0,
              },
            };
          }),
        ),
      ),
    listChecks: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/commits/${encodeURIComponent(input.headSha)}/check-runs`),
        input,
      );
      return rest({ ...input, operation: "listChecks", endpoint, schema: RawCheckRuns }).pipe(
        Effect.map((result) =>
          mapResult(result, (checks) => ({
            records: checks.check_runs.map((check) => ({
              githubCheckId: String(check.id),
              name: check.name,
              provider: check.app?.name ?? "GitHub",
              headSha: check.head_sha,
              status: normalizeCheckStatus(check.status),
              conclusion: normalizeCheckConclusion(check.conclusion),
              detailsUrl: check.details_url ?? null,
              startedAtRemote: check.started_at ?? null,
              completedAtRemote: check.completed_at ?? null,
              summary: summaryPreview(check.output?.summary),
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, checks.total_count),
          })),
        ),
      );
    },
    listCommitStatuses: (input) => {
      const endpoint = pageEndpoint(
        repositoryEndpoint(input, `/commits/${encodeURIComponent(input.headSha)}/statuses`),
        input,
      );
      return rest({
        ...input,
        operation: "listCommitStatuses",
        endpoint,
        schema: Schema.Array(RawCommitStatus),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (statuses) => ({
            records: statuses.map((status) => ({
              githubCheckId: `status:${String(status.id)}`,
              name: status.context,
              provider: status.creator?.login ?? "GitHub status",
              headSha: input.headSha,
              status:
                status.state === "pending" ? ("in_progress" as const) : ("completed" as const),
              conclusion:
                status.state === "success"
                  ? ("success" as const)
                  : status.state === "failure" || status.state === "error"
                    ? ("failure" as const)
                    : status.state === "pending"
                      ? null
                      : ("unknown" as const),
              detailsUrl: status.target_url ?? null,
              startedAtRemote: status.created_at ?? null,
              completedAtRemote:
                status.state === "pending"
                  ? null
                  : (status.updated_at ?? status.created_at ?? null),
              summary: null,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    listBranches: (input) => {
      const endpoint = pageEndpoint(repositoryEndpoint(input, "/branches"), input, {
        protected: input.protectedOnly === undefined ? undefined : String(input.protectedOnly),
      });
      return rest({
        ...input,
        operation: "listBranches",
        endpoint,
        schema: Schema.Array(RawBranch),
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (branches) => ({
            records: branches.map((branch) => ({
              name: branch.name,
              sha: branch.commit.sha,
              protected: branch.protected,
            })),
            pageInfo: pageInfoFromResult(result, input.hostname, null),
          })),
        ),
      );
    },
    getBranch: (input) =>
      rest({
        ...input,
        operation: "getBranch",
        endpoint: repositoryEndpoint(input, `/branches/${encodeURIComponent(input.branch)}`),
        schema: RawBranch,
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (branch) => ({
            name: branch.name,
            sha: branch.commit.sha,
            protected: branch.protected,
          })),
        ),
      ),
    getRequiredChecks: (input) =>
      rest({
        ...input,
        operation: "getRequiredChecks",
        endpoint: repositoryEndpoint(
          input,
          `/branches/${encodeURIComponent(input.branch)}/protection/required_status_checks`,
        ),
        schema: RawRequiredChecks,
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (required) =>
            Array.from(
              new Set([
                ...(required.contexts ?? []),
                ...(required.checks ?? []).map((check) => check.context),
              ]),
            ),
          ),
        ),
      ),
    getRateLimit: (input) =>
      rest({
        ...input,
        operation: "getRateLimit",
        endpoint: "rate_limit",
        schema: RawRateLimitResponse,
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (rateLimit) =>
            Object.entries(rateLimit.resources).flatMap(([kind, resource]) =>
              resource
                ? [
                    {
                      kind: kind as GitHubApiRateLimitResource["kind"],
                      limit: resource.limit,
                      remaining: resource.remaining,
                      used: resource.used ?? null,
                      resetAt: resource.reset,
                    },
                  ]
                : [],
            ),
          ),
        ),
      ),
    createPullRequest: (input) =>
      rest({
        ...input,
        operation: "createPullRequest",
        endpoint: repositoryEndpoint(input, "/pulls"),
        method: "POST",
        schema: RawPullRequest,
        body: {
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
          draft: input.draft ?? true,
        },
      }).pipe(Effect.map((result) => mapResult(result, normalizePullRequest))),
    updatePullRequest: (input) =>
      rest({
        ...input,
        operation: "updatePullRequest",
        endpoint: repositoryEndpoint(input, `/pulls/${input.number}`),
        method: "PATCH",
        schema: RawPullRequest,
        body: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.base === undefined ? {} : { base: input.base }),
        },
      }).pipe(Effect.map((result) => mapResult(result, normalizePullRequest))),
    convertPullRequestToDraft: (input) =>
      request({
        ...input,
        operation: "convertPullRequestToDraft",
        endpoint: "graphql",
        method: "POST",
        headers: { Accept: DEFAULT_ACCEPT },
        schema: GraphQlDraftResponse,
        body: {
          query: `mutation T3ConvertToDraft($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { id } } }`,
          variables: { id: input.pullRequestNodeId },
        },
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (response) => ({
            pullRequestNodeId:
              response.data.convertPullRequestToDraft?.pullRequest?.id ?? input.pullRequestNodeId,
          })),
        ),
      ),
    markPullRequestReadyForReview: (input) =>
      request({
        ...input,
        operation: "markPullRequestReadyForReview",
        endpoint: "graphql",
        method: "POST",
        headers: { Accept: DEFAULT_ACCEPT },
        schema: GraphQlReadyResponse,
        body: {
          query: `mutation T3ReadyForReview($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }`,
          variables: { id: input.pullRequestNodeId },
        },
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (response) => ({
            pullRequestNodeId:
              response.data.markPullRequestReadyForReview?.pullRequest?.id ??
              input.pullRequestNodeId,
          })),
        ),
      ),
    resolveReviewThread: (input) =>
      request({
        ...input,
        operation: "resolveReviewThread",
        endpoint: "graphql",
        method: "POST",
        headers: { Accept: DEFAULT_ACCEPT },
        schema: GraphQlResolveResponse,
        body: {
          query: `mutation T3ResolveReviewThread($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }`,
          variables: { id: input.threadNodeId },
        },
      }).pipe(
        Effect.map((result) =>
          mapResult(result, (response) => ({
            threadNodeId: response.data.resolveReviewThread?.thread?.id ?? input.threadNodeId,
            isResolved: response.data.resolveReviewThread?.thread?.isResolved ?? false,
          })),
        ),
      ),
  });
});

function pageInfoFromResult<A>(
  result: GitHubApiResult<A>,
  hostname: string,
  totalCount: number | null,
): GitHubPageInfo {
  void hostname;
  return { endCursor: result.nextCursor, hasNextPage: result.nextCursor !== null, totalCount };
}

function normalizeRestReviewComment(
  comment: SchemaType<typeof RawReviewComment>,
): GitHubApiReviewComment {
  return {
    githubCommentId: String(comment.id),
    nodeId: comment.node_id,
    author: normalizeActor(comment.user),
    body: comment.body,
    path: comment.path,
    line: comment.line ?? null,
    originalLine: comment.original_line ?? null,
    side: comment.side === "LEFT" || comment.side === "RIGHT" ? comment.side : null,
    commitSha: comment.commit_id ?? null,
    htmlUrl: comment.html_url,
    createdAtRemote: comment.created_at,
    updatedAtRemote: comment.updated_at,
    reviewId:
      comment.pull_request_review_id === null || comment.pull_request_review_id === undefined
        ? null
        : String(comment.pull_request_review_id),
    inReplyToId:
      comment.in_reply_to_id === null || comment.in_reply_to_id === undefined
        ? null
        : String(comment.in_reply_to_id),
  };
}

export const layer = Layer.effect(GitHubApiClient, make);
