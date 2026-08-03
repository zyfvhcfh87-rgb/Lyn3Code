import {
  type GitHubAccount,
  type GitHubAccountId,
  type GitHubBranchObservation,
  type GitHubConnectAccountInput,
  type GitHubConnectRepositoryInput,
  type GitHubDataFreshness,
  type GitHubIssuePageSnapshot,
  type GitHubIssueQueryInput,
  type GitHubPullRequestDetailSnapshot,
  type GitHubPullRequestPageSnapshot,
  type GitHubPullRequestQueryInput,
  type GitHubRepositoryWorkspaceSnapshot,
  GitHubWorkspaceMutationError,
  GitHubWorkspaceQueryError,
  type ProjectId,
  type RepositoryConnection,
  type RepositoryConnectionId,
  type RepositorySyncStatus,
  SyncCursorId,
  type GitHubSyncResourceType,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProjectionGitHubWorkspaceRepository } from "../persistence/Services/ProjectionGitHubWorkspace.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  GitHubApiClient,
  type GitHubApiError,
  type GitHubApiResult,
  type GitHubPage,
  type GitHubResponseMetadata,
} from "./GitHubApiClient.ts";
import { GitHubEventRecorder } from "./GitHubEventRecorder.ts";
import {
  accountIdFor,
  branchObservationIdFor,
  cursorFor,
  rateLimitFor,
  repositoryConnectionIdFor,
  reviewThreadRecordIdFor,
  toCheckRecord,
  toCommitRecord,
  toFileRecord,
  toGitHubAccount,
  toIssueRecord,
  toPullRequestRecord,
  toRepositoryConnection,
  toReviewCommentRecord,
  toReviewRecord,
  toReviewThreadRecord,
} from "./GitHubRecordMapper.ts";
import { parseGitHubRemote, parseGitHubRepositoryInput } from "./GitHubRemote.ts";

const DEFAULT_SYNC_RESOURCES: ReadonlyArray<GitHubSyncResourceType> = [
  "repository",
  "issues",
  "pull_requests",
  "branches",
];
const BACKGROUND_REFRESH_INTERVAL = Duration.minutes(5);
const BACKGROUND_REFRESH_INITIAL_DELAY = Duration.seconds(30);
const MAX_PAGES_PER_SYNC = 100;

const localCursorOffset = (cursor: string | null) => {
  if (cursor === null) return 0;
  const match = /^local:(\d+)$/u.exec(cursor);
  if (match?.[1] === undefined) return 0;
  const offset = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

export function parseLocalBranchRefs(
  stdout: string,
): ReadonlyArray<{ readonly name: string; readonly sha: string }> {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const separator = line.indexOf("\t");
      if (separator <= 0) return [];
      const name = line.slice(0, separator);
      const sha = line.slice(separator + 1);
      return /^[0-9a-f]{40,64}$/iu.test(sha) ? [{ name, sha }] : [];
    });
}

const aheadBehindFromGit = (stdout: string) => {
  const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(stdout);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const ahead = Number.parseInt(match[1], 10);
  const behind = Number.parseInt(match[2], 10);
  return Number.isSafeInteger(ahead) && Number.isSafeInteger(behind) ? { ahead, behind } : null;
};

export function classifyGitHubSyncFailure(error: unknown): {
  readonly connectionStatus: RepositorySyncStatus;
  readonly accountStatus: "expired" | "insufficient_permissions" | "rate_limited" | "error" | null;
  readonly eventType:
    | "github.authentication_expired"
    | "github.permissions_changed"
    | "github.rate_limited"
    | null;
} {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return { connectionStatus: "failed", accountStatus: "error", eventType: null };
  }
  const tagged = error as {
    readonly _tag: string;
    readonly kind?: string;
    readonly reason?: string;
  };
  const nestedCause =
    "cause" in tagged && typeof tagged.cause === "object" && tagged.cause !== null
      ? (tagged.cause as { readonly _tag?: string })
      : null;
  const reason = tagged.kind ?? tagged.reason;
  if (nestedCause?._tag === "GitHubCliAuthenticationError") {
    return {
      connectionStatus: "authentication_required",
      accountStatus: "expired",
      eventType: "github.authentication_expired",
    };
  }
  if (tagged._tag === "GitHubApiTransportError" || reason === "offline") {
    return { connectionStatus: "offline", accountStatus: null, eventType: null };
  }
  if (reason === "authentication_required") {
    return {
      connectionStatus: "authentication_required",
      accountStatus: "expired",
      eventType: "github.authentication_expired",
    };
  }
  if (reason === "permission_denied") {
    return {
      connectionStatus: "failed",
      accountStatus: "insufficient_permissions",
      eventType: "github.permissions_changed",
    };
  }
  if (reason === "rate_limited") {
    return {
      connectionStatus: "rate_limited",
      accountStatus: "rate_limited",
      eventType: "github.rate_limited",
    };
  }
  if (reason === "not_found") {
    return { connectionStatus: "remote_deleted", accountStatus: null, eventType: null };
  }
  return { connectionStatus: "failed", accountStatus: "error", eventType: null };
}

type WorkspaceChange = {
  readonly projectId: ProjectId;
  readonly reason: "account" | "connection" | "sync" | "workflow";
};

type MutationEffect<A> = Effect.Effect<A, GitHubWorkspaceMutationError>;
type QueryEffect<A> = Effect.Effect<A, GitHubWorkspaceQueryError>;

const normalizeServer = (
  value: string,
): {
  readonly serverUrl: string;
  readonly hostname: string;
  readonly apiHost: string;
} | null => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname.length === 0) return null;
    const serverUrl = `https://${hostname}${url.port ? `:${url.port}` : ""}`;
    return { serverUrl, hostname, apiHost: url.host.toLowerCase() };
  } catch {
    return null;
  }
};

const freshnessForStatus = (
  status: RepositorySyncStatus,
  lastSyncedAt: string | null,
): GitHubDataFreshness => {
  if (lastSyncedAt === null || status === "not_synced") return "never_synced";
  if (status === "current" || status === "syncing") return "current";
  if (status === "offline") return "offline";
  if (status === "partially_stale") return "partial";
  return "stale";
};

const queryError = (
  operation: string,
  reason: GitHubWorkspaceQueryError["reason"],
  message: string,
  retryAt?: string,
) => new GitHubWorkspaceQueryError({ operation, reason, message, ...(retryAt ? { retryAt } : {}) });

const mutationError = (
  operation: string,
  reason: GitHubWorkspaceMutationError["reason"],
  message: string,
  retryAt?: string,
) =>
  new GitHubWorkspaceMutationError({ operation, reason, message, ...(retryAt ? { retryAt } : {}) });

const apiReason = (
  error: GitHubApiError,
): { reason: GitHubWorkspaceQueryError["reason"]; retryAt?: string } => {
  if (error._tag === "GitHubApiTransportError") {
    if (
      typeof error.cause === "object" &&
      error.cause !== null &&
      "_tag" in error.cause &&
      error.cause._tag === "GitHubCliAuthenticationError"
    ) {
      return { reason: "authentication_required" };
    }
    return { reason: "offline" };
  }
  if (error._tag === "GitHubApiDecodeError") {
    return { reason: "remote_error" };
  }
  switch (error.kind) {
    case "authentication_required":
      return { reason: "authentication_required" };
    case "permission_denied":
      return { reason: "permission_denied" };
    case "rate_limited":
      return {
        reason: "rate_limited",
        ...(error.rateLimitResetAt ? { retryAt: error.rateLimitResetAt } : {}),
      };
    case "not_found":
      return { reason: "not_found" };
    case "conflict":
      return { reason: "conflict" };
    case "validation_failed":
      return { reason: "invalid_request" };
    case "transient":
      return { reason: "offline" };
    case "remote_error":
      return { reason: "remote_error" };
  }
};

const toQueryApiError = (operation: string) => (error: GitHubApiError) => {
  const classified = apiReason(error);
  const message =
    classified.reason === "authentication_required"
      ? "GitHub CLI is not authenticated for this host. Run `gh auth login` on the environment host and retry."
      : error.message;
  return queryError(operation, classified.reason, message, classified.retryAt);
};

const toMutationApiError = (operation: string) => (error: GitHubApiError) => {
  const classified = apiReason(error);
  const message =
    classified.reason === "authentication_required"
      ? "GitHub CLI is not authenticated for this host. Run `gh auth login` on the environment host and retry."
      : error.message;
  return mutationError(operation, classified.reason, message, classified.retryAt);
};

interface CollectedPages<A> {
  readonly records: ReadonlyArray<A>;
  readonly metadata: GitHubResponseMetadata;
  readonly rateMetadata: GitHubResponseMetadata;
  readonly notModified: boolean;
  readonly endCursor: string | null;
  readonly totalCount: number | null;
}

export interface GitHubWorkspaceServiceShape {
  readonly listAccounts: (
    includeDisconnected: boolean,
  ) => QueryEffect<ReadonlyArray<GitHubAccount>>;
  readonly connectAccount: (input: GitHubConnectAccountInput) => MutationEffect<GitHubAccount>;
  readonly disconnectAccount: (accountId: GitHubAccountId) => MutationEffect<GitHubAccount>;
  readonly connectRepository: (
    input: GitHubConnectRepositoryInput,
  ) => MutationEffect<RepositoryConnection>;
  readonly disconnectRepository: (connectionId: RepositoryConnectionId) => MutationEffect<void>;
  readonly getWorkspace: (
    projectId: ProjectId,
  ) => QueryEffect<GitHubRepositoryWorkspaceSnapshot | null>;
  readonly listIssues: (input: GitHubIssueQueryInput) => QueryEffect<GitHubIssuePageSnapshot>;
  readonly listPullRequests: (
    input: GitHubPullRequestQueryInput,
  ) => QueryEffect<GitHubPullRequestPageSnapshot>;
  readonly getPullRequest: (input: {
    readonly repositoryConnectionId: RepositoryConnectionId;
    readonly number: number;
    readonly refresh: boolean;
  }) => QueryEffect<GitHubPullRequestDetailSnapshot>;
  readonly refresh: (input: {
    readonly repositoryConnectionId: RepositoryConnectionId;
    readonly resources: ReadonlyArray<GitHubSyncResourceType>;
  }) => MutationEffect<GitHubRepositoryWorkspaceSnapshot>;
  readonly changes: Stream.Stream<WorkspaceChange>;
  readonly startBackgroundRefresh: () => Effect.Effect<void, never, Scope.Scope>;
  readonly notifyWorkflowChange: (projectId: ProjectId) => Effect.Effect<void>;
}

const unavailableQuery = () =>
  Effect.fail(
    queryError("github_runtime", "remote_error", "The GitHub workspace service is unavailable."),
  );
const unavailableMutation = () =>
  Effect.fail(
    mutationError("github_runtime", "remote_error", "The GitHub workspace service is unavailable."),
  );

export class GitHubWorkspaceService extends Context.Reference<GitHubWorkspaceServiceShape>(
  "t3/github/GitHubWorkspaceService",
  {
    defaultValue: () => ({
      listAccounts: unavailableQuery,
      connectAccount: unavailableMutation,
      disconnectAccount: unavailableMutation,
      connectRepository: unavailableMutation,
      disconnectRepository: unavailableMutation,
      getWorkspace: unavailableQuery,
      listIssues: unavailableQuery,
      listPullRequests: unavailableQuery,
      getPullRequest: unavailableQuery,
      refresh: unavailableMutation,
      changes: Stream.empty,
      startBackgroundRefresh: () => Effect.void,
      notifyWorkflowChange: () => Effect.void,
    }),
  },
) {}

export const make = Effect.gen(function* () {
  const api = yield* GitHubApiClient;
  const repository = yield* ProjectionGitHubWorkspaceRepository;
  const projects = yield* ProjectionProjectRepository;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const config = yield* ServerConfig;
  const events = yield* GitHubEventRecorder;
  const changesPubSub = yield* PubSub.unbounded<WorkspaceChange>();

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const persistenceQuery = <A>(
    operation: string,
    effect: Effect.Effect<A, ProjectionRepositoryError>,
  ): QueryEffect<A> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logError("GitHub cache query failed", {
          operation,
          errorTag: error._tag,
          causeType:
            "cause" in error && error.cause instanceof Error ? error.cause.name : "unavailable",
        }),
      ),
      Effect.mapError(() =>
        queryError(operation, "remote_error", "The local GitHub cache could not be read."),
      ),
    );
  const persistenceMutation = <A>(
    operation: string,
    effect: Effect.Effect<A, ProjectionRepositoryError>,
  ): MutationEffect<A> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logError("GitHub cache mutation failed", {
          operation,
          errorTag: error._tag,
          causeType:
            "cause" in error && error.cause instanceof Error ? error.cause.name : "unavailable",
        }),
      ),
      Effect.mapError(() =>
        mutationError(operation, "remote_error", "The local GitHub cache could not be updated."),
      ),
    );

  const publish = (projectId: ProjectId, reason: WorkspaceChange["reason"]) =>
    PubSub.publish(changesPubSub, { projectId, reason }).pipe(Effect.asVoid);

  const loadProject = (
    projectId: ProjectId,
  ): MutationEffect<{
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
  }> =>
    persistenceMutation("load_project", projects.getById({ projectId })).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              mutationError("load_project", "not_found", `Project ${projectId} was not found.`),
            ),
          onSome: (project) => Effect.succeed(project),
        }),
      ),
    );

  const loadConnectionQuery = (
    connectionId: RepositoryConnectionId,
  ): QueryEffect<RepositoryConnection> =>
    persistenceQuery(
      "load_repository_connection",
      repository.getRepositoryConnectionById({ repositoryConnectionId: connectionId }),
    ).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              queryError(
                "load_repository_connection",
                "not_found",
                "The GitHub repository connection was not found.",
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const loadConnectionMutation = (
    connectionId: RepositoryConnectionId,
  ): MutationEffect<RepositoryConnection> =>
    persistenceMutation(
      "load_repository_connection",
      repository.getRepositoryConnectionById({ repositoryConnectionId: connectionId }),
    ).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              mutationError(
                "load_repository_connection",
                "not_found",
                "The GitHub repository connection was not found.",
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const loadAccountMutation = (accountId: GitHubAccountId): MutationEffect<GitHubAccount> =>
    persistenceMutation(
      "load_github_account",
      repository.getAccountById({ githubAccountId: accountId }),
    ).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              mutationError(
                "load_github_account",
                "not_found",
                "The GitHub account was not found.",
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const hostnameFor = (connection: RepositoryConnection) =>
    normalizeServer(connection.serverUrl)?.apiHost ?? "github.com";

  const observeRateLimit = (
    accountId: GitHubAccountId,
    operation: string,
    result: GitHubResponseMetadata,
    now: string,
  ) =>
    repository
      .saveRateLimit(
        rateLimitFor({
          accountId,
          rateLimit: result.rateLimit,
          now,
          blockedOperation:
            result.rateLimit.remaining === 0 || result.rateLimit.secondary ? operation : null,
        }),
      )
      .pipe(Effect.ignore);

  const repoBase = (connection: RepositoryConnection, cwd: string) => ({
    cwd,
    hostname: hostnameFor(connection),
    owner: connection.owner,
    repository: connection.repository,
  });

  const collectPages = <A>(
    load: (cursor: string | null) => Effect.Effect<GitHubApiResult<GitHubPage<A>>, GitHubApiError>,
    initialCursor: string | null = null,
  ): Effect.Effect<CollectedPages<A>, GitHubApiError> =>
    Effect.gen(function* () {
      const records: A[] = [];
      let cursor: string | null = initialCursor;
      let metadata: GitHubResponseMetadata | null = null;
      let rateMetadata: GitHubResponseMetadata | null = null;
      let totalCount: number | null = null;
      for (let page = 0; page < MAX_PAGES_PER_SYNC; page += 1) {
        const result: GitHubApiResult<GitHubPage<A>> = yield* load(cursor);
        metadata ??= result;
        rateMetadata = result;
        if (result.notModified) {
          return {
            records,
            metadata: result,
            rateMetadata: result,
            notModified: true,
            endCursor: null,
            totalCount,
          };
        }
        records.push(...result.data.records);
        totalCount = result.data.pageInfo.totalCount ?? totalCount;
        cursor = result.data.pageInfo.endCursor ?? result.nextCursor;
        if (!result.data.pageInfo.hasNextPage || cursor === null) {
          return {
            records,
            metadata: metadata ?? result,
            rateMetadata: result,
            notModified: false,
            endCursor: null,
            totalCount,
          };
        }
      }
      const last = metadata;
      if (last === null || rateMetadata === null) {
        return yield* Effect.die("GitHub pagination returned no response metadata.");
      }
      return {
        records,
        metadata: last,
        rateMetadata,
        notModified: false,
        endCursor: cursor,
        totalCount,
      };
    });

  const listAccounts: GitHubWorkspaceServiceShape["listAccounts"] = (includeDisconnected) =>
    persistenceQuery("list_accounts", repository.listAccounts({ includeDisconnected }));

  const connectAccount: GitHubWorkspaceServiceShape["connectAccount"] = Effect.fn(
    "GitHubWorkspaceService.connectAccount",
  )(function* (input) {
    const server = normalizeServer(input.serverUrl || "https://github.com");
    if (server === null) {
      return yield* mutationError(
        "connect_account",
        "invalid_request",
        "GitHub server URLs must be credential-free HTTPS origins.",
      );
    }
    const result = yield* api
      .validateAccount({ cwd: config.cwd, hostname: server.apiHost })
      .pipe(Effect.mapError(toMutationApiError("connect_account")));
    if (result.notModified) {
      return yield* mutationError(
        "connect_account",
        "remote_error",
        "GitHub did not return an account identity.",
      );
    }
    const now = yield* nowIso;
    const accountId = accountIdFor(server.serverUrl, result.data.providerAccountId);
    const existing = yield* persistenceMutation(
      "connect_account",
      repository.getAccountById({ githubAccountId: accountId }),
    );
    const account = toGitHubAccount({
      identity: { ...result.data, serverUrl: server.serverUrl },
      now,
      existing: Option.getOrNull(existing),
    });
    yield* persistenceMutation("connect_account", repository.saveAccount(account));
    yield* observeRateLimit(account.id, "connect_account", result, now);
    const connections = yield* persistenceMutation(
      "connect_account",
      repository.listRepositoryConnectionsByAccountId({ githubAccountId: account.id }),
    );
    yield* Effect.forEach(
      connections,
      (connection) =>
        events
          .record({
            eventType: "github.account_connected",
            projectId: connection.projectId,
            accountId: account.id,
            repositoryConnectionId: connection.id,
          })
          .pipe(Effect.ignore, Effect.andThen(publish(connection.projectId, "account"))),
      { concurrency: 1, discard: true },
    );
    return account;
  });

  const disconnectAccount: GitHubWorkspaceServiceShape["disconnectAccount"] = Effect.fn(
    "GitHubWorkspaceService.disconnectAccount",
  )(function* (accountId) {
    const account = yield* loadAccountMutation(accountId);
    const now = yield* nowIso;
    const disconnected = { ...account, status: "disconnected" as const, updatedAt: now };
    yield* persistenceMutation("disconnect_account", repository.saveAccount(disconnected));
    const connections = yield* persistenceMutation(
      "disconnect_account",
      repository.listRepositoryConnectionsByAccountId({ githubAccountId: accountId }),
    );
    yield* Effect.forEach(
      connections,
      (connection) =>
        events
          .record({
            eventType: "github.account_disconnected",
            projectId: connection.projectId,
            accountId,
            repositoryConnectionId: connection.id,
          })
          .pipe(Effect.ignore, Effect.andThen(publish(connection.projectId, "account"))),
      { concurrency: 1, discard: true },
    );
    return disconnected;
  });

  const readRemote = (cwd: string, requestedRemote: string | null) =>
    Effect.gen(function* () {
      const remotes = yield* git.execute({
        operation: "GitHubWorkspaceService.listRemotes",
        cwd,
        args: ["remote"],
      });
      const names = remotes.stdout
        .split(/\r?\n/u)
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      const remoteName =
        requestedRemote ?? (names.includes("origin") ? "origin" : (names[0] ?? "origin"));
      if (!names.includes(remoteName)) return { remoteName, remoteUrl: null };
      const url = yield* git.execute({
        operation: "GitHubWorkspaceService.getRemoteUrl",
        cwd,
        args: ["remote", "get-url", remoteName],
      });
      return { remoteName, remoteUrl: url.stdout.trim() || null };
    }).pipe(
      Effect.mapError(() =>
        mutationError(
          "connect_repository",
          "invalid_request",
          "The project's Git remotes could not be inspected.",
        ),
      ),
    );

  const connectRepository: GitHubWorkspaceServiceShape["connectRepository"] = Effect.fn(
    "GitHubWorkspaceService.connectRepository",
  )(function* (input) {
    const [project, account] = yield* Effect.all([
      loadProject(input.projectId),
      loadAccountMutation(input.githubAccountId),
    ]);
    if (account.status !== "connected" && account.status !== "insufficient_permissions") {
      return yield* mutationError(
        "connect_repository",
        "authentication_required",
        "Reconnect the GitHub account before connecting a repository.",
      );
    }
    const detected = yield* readRemote(project.workspaceRoot, input.remoteName);
    const explicit = input.repositoryUrl
      ? parseGitHubRepositoryInput(input.repositoryUrl, account.serverUrl)
      : input.owner && input.repository
        ? parseGitHubRepositoryInput(`${input.owner}/${input.repository}`, account.serverUrl)
        : null;
    const remote = explicit ?? parseGitHubRemote(detected.remoteUrl);
    if (remote === null) {
      return yield* mutationError(
        "connect_repository",
        "invalid_request",
        "Choose a GitHub repository or a detected GitHub remote.",
      );
    }
    const accountServer = normalizeServer(account.serverUrl);
    if (accountServer === null || remote.host !== accountServer.hostname) {
      return yield* mutationError(
        "connect_repository",
        "conflict",
        "The repository host does not match the selected GitHub account.",
      );
    }
    const result = yield* api
      .getRepository({
        cwd: project.workspaceRoot,
        hostname: normalizeServer(remote.serverUrl)?.apiHost ?? remote.host,
        owner: remote.owner,
        repository: remote.repository,
      })
      .pipe(Effect.mapError(toMutationApiError("connect_repository")));
    if (result.notModified) {
      return yield* mutationError(
        "connect_repository",
        "remote_error",
        "GitHub did not return repository metadata.",
      );
    }
    const existingForProject = yield* persistenceMutation(
      "connect_repository",
      repository.getRepositoryConnectionByProjectId({ projectId: input.projectId }),
    );
    const expectedConnectionId = repositoryConnectionIdFor(account.id, result.data.repositoryId);
    if (Option.isSome(existingForProject) && existingForProject.value.id !== expectedConnectionId) {
      return yield* mutationError(
        "connect_repository",
        "conflict",
        "This project is already connected to a different repository. Disconnect it explicitly first.",
      );
    }
    const now = yield* nowIso;
    const connection = toRepositoryConnection({
      projectId: input.projectId,
      accountId: account.id,
      repository: result.data,
      remoteName: detected.remoteName,
      remoteUrl: remote.canonicalRemoteUrl,
      serverUrl: remote.serverUrl,
      now,
      existing: Option.getOrNull(existingForProject),
    });
    yield* persistenceMutation(
      "connect_repository",
      repository.saveRepositoryConnection(connection),
    );
    yield* observeRateLimit(account.id, "connect_repository", result, now);
    yield* events
      .record({
        eventType: "github.repository_connected",
        projectId: connection.projectId,
        accountId: account.id,
        repositoryConnectionId: connection.id,
      })
      .pipe(
        Effect.mapError(() =>
          mutationError(
            "connect_repository",
            "remote_error",
            "The repository connected, but its orchestration event could not be recorded.",
          ),
        ),
      );
    yield* events
      .record({
        eventType: "github.account_connected",
        projectId: connection.projectId,
        accountId: account.id,
        repositoryConnectionId: connection.id,
      })
      .pipe(Effect.ignore);
    yield* publish(connection.projectId, "connection");
    return connection;
  });

  const disconnectRepository: GitHubWorkspaceServiceShape["disconnectRepository"] = Effect.fn(
    "GitHubWorkspaceService.disconnectRepository",
  )(function* (connectionId) {
    const connection = yield* loadConnectionMutation(connectionId);
    yield* persistenceMutation(
      "disconnect_repository",
      repository.deleteRepositoryConnection({ repositoryConnectionId: connectionId }),
    );
    yield* events
      .record({
        eventType: "github.repository_disconnected",
        projectId: connection.projectId,
        accountId: connection.githubAccountId,
        repositoryConnectionId: connection.id,
      })
      .pipe(Effect.ignore);
    yield* publish(connection.projectId, "connection");
  });

  const getWorkspace: GitHubWorkspaceServiceShape["getWorkspace"] = Effect.fn(
    "GitHubWorkspaceService.getWorkspace",
  )(function* (projectId) {
    const connectionOption = yield* persistenceQuery(
      "get_workspace",
      repository.getRepositoryConnectionByProjectId({ projectId }),
    );
    if (Option.isNone(connectionOption)) return null;
    const connection = connectionOption.value;
    const [account, issueLinks, pullRequestLinks, rateLimits, branches, cursors] =
      yield* Effect.all([
        persistenceQuery(
          "get_workspace",
          repository.getAccountById({ githubAccountId: connection.githubAccountId }),
        ),
        persistenceQuery(
          "get_workspace",
          repository.listIssueMissionLinks({
            repositoryConnectionId: connection.id,
            githubIssueNumber: null,
            missionId: null,
          }),
        ),
        persistenceQuery(
          "get_workspace",
          repository.listMissionPullRequestLinks({ missionId: null, pullRequestRecordId: null }),
        ),
        persistenceQuery(
          "get_workspace",
          repository.listRateLimits({ githubAccountId: connection.githubAccountId }),
        ),
        persistenceQuery(
          "get_workspace",
          repository.listBranchObservations({ repositoryConnectionId: connection.id }),
        ),
        persistenceQuery(
          "get_workspace",
          repository.listSyncCursors({ repositoryConnectionId: connection.id }),
        ),
      ]);
    const capturedAt = yield* nowIso;
    return {
      account: Option.getOrNull(account),
      connection,
      issueLinks,
      pullRequestLinks: pullRequestLinks.filter((link) =>
        // The persistence query is global by mission/PR; only retain links to
        // this repository's cached PRs below through the PR id prefix.
        String(link.pullRequestRecordId).includes(String(connection.id)),
      ),
      rateLimits,
      branches,
      cursors,
      freshness: freshnessForStatus(connection.syncStatus, connection.lastSyncedAt),
      capturedAt,
    } satisfies GitHubRepositoryWorkspaceSnapshot;
  });

  const syncIssues = Effect.fn("GitHubWorkspaceService.syncIssues")(function* (
    connection: RepositoryConnection,
    projectRoot: string,
    input?: GitHubIssueQueryInput,
  ) {
    const now = yield* nowIso;
    const previous =
      (yield* persistenceQuery(
        "sync_issues",
        repository.listSyncCursors({ repositoryConnectionId: connection.id }),
      )).find((cursor) => cursor.resourceType === "issues") ?? null;
    const collected = yield* collectPages((cursor) =>
      api.listIssues({
        ...repoBase(connection, projectRoot),
        cursor,
        pageSize: input?.limit ?? 100,
        state: input?.state ?? "all",
        labels: input?.labels ?? [],
        assignee: input?.assignee ?? null,
        milestone: input?.milestone ?? null,
        ...(cursor === null && previous !== null
          ? { conditional: { etag: previous.etag, lastModified: previous.lastModified } }
          : {}),
      }),
    ).pipe(Effect.mapError(toQueryApiError("sync_issues")));
    yield* observeRateLimit(connection.githubAccountId, "sync_issues", collected.rateMetadata, now);
    if (!collected.notModified) {
      const records = collected.records.map((issue) => toIssueRecord(connection.id, issue, now));
      const cursor = cursorFor({
        connectionId: connection.id,
        resourceType: "issues",
        cursor: collected.endCursor,
        metadata: collected.metadata,
        now,
        successful: true,
        previous,
      });
      yield* persistenceQuery(
        "sync_issues",
        repository.saveIssuePage({
          repositoryConnectionId: connection.id,
          records,
          cursor,
          pageInfo: {
            endCursor: collected.endCursor,
            hasNextPage: collected.endCursor !== null,
            totalCount: collected.totalCount,
          },
        }),
      );
      return records;
    }
    yield* persistenceQuery(
      "sync_issues",
      repository.saveSyncCursor(
        cursorFor({
          connectionId: connection.id,
          resourceType: "issues",
          cursor: previous?.cursor ?? null,
          metadata: collected.metadata,
          now,
          successful: true,
          previous,
        }),
      ),
    );
    return yield* persistenceQuery(
      "sync_issues",
      repository.listIssues({
        repositoryConnectionId: connection.id,
        state: input?.state ?? null,
        offset: 0,
        limit: input?.limit ?? 100,
      }),
    );
  });

  const syncPullRequests = Effect.fn("GitHubWorkspaceService.syncPullRequests")(function* (
    connection: RepositoryConnection,
    projectRoot: string,
    input?: GitHubPullRequestQueryInput,
  ) {
    const now = yield* nowIso;
    const previous =
      (yield* persistenceQuery(
        "sync_pull_requests",
        repository.listSyncCursors({ repositoryConnectionId: connection.id }),
      )).find((cursor) => cursor.resourceType === "pull_requests") ?? null;
    const collected = yield* collectPages((cursor) =>
      api.listPullRequests({
        ...repoBase(connection, projectRoot),
        cursor,
        pageSize: input?.limit ?? 100,
        state: input?.state === "merged" ? "closed" : (input?.state ?? "all"),
        ...(cursor === null && previous !== null
          ? { conditional: { etag: previous.etag, lastModified: previous.lastModified } }
          : {}),
      }),
    ).pipe(Effect.mapError(toQueryApiError("sync_pull_requests")));
    yield* observeRateLimit(
      connection.githubAccountId,
      "sync_pull_requests",
      collected.rateMetadata,
      now,
    );
    if (!collected.notModified) {
      const records = collected.records.map((pullRequest) =>
        toPullRequestRecord({ connectionId: connection.id, pullRequest, syncedAt: now }),
      );
      const cursor = cursorFor({
        connectionId: connection.id,
        resourceType: "pull_requests",
        cursor: collected.endCursor,
        metadata: collected.metadata,
        now,
        successful: true,
        previous,
      });
      yield* persistenceQuery(
        "sync_pull_requests",
        repository.savePullRequestPage({
          repositoryConnectionId: connection.id,
          records,
          cursor,
          pageInfo: {
            endCursor: collected.endCursor,
            hasNextPage: collected.endCursor !== null,
            totalCount: collected.totalCount,
          },
        }),
      );
      return records;
    }
    yield* persistenceQuery(
      "sync_pull_requests",
      repository.saveSyncCursor(
        cursorFor({
          connectionId: connection.id,
          resourceType: "pull_requests",
          cursor: previous?.cursor ?? null,
          metadata: collected.metadata,
          now,
          successful: true,
          previous,
        }),
      ),
    );
    return yield* persistenceQuery(
      "sync_pull_requests",
      repository.listPullRequests({
        repositoryConnectionId: connection.id,
        state: input?.state ?? null,
        offset: 0,
        limit: input?.limit ?? 100,
      }),
    );
  });

  const syncBranches = Effect.fn("GitHubWorkspaceService.syncBranches")(function* (
    connection: RepositoryConnection,
    projectRoot: string,
  ) {
    const observedAt = yield* nowIso;
    const remotePages = yield* collectPages((cursor) =>
      api.listBranches({
        ...repoBase(connection, projectRoot),
        cursor,
        pageSize: 100,
      }),
    ).pipe(Effect.mapError(toQueryApiError("sync_branches")));
    const localResult = yield* git
      .execute({
        operation: "GitHubWorkspaceService.listLocalBranches",
        cwd: projectRoot,
        args: ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"],
        maxOutputBytes: 2 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError(() =>
          queryError("sync_branches", "remote_error", "Local Git branches could not be inspected."),
        ),
      );
    const localByName = new Map(
      parseLocalBranchRefs(localResult.stdout).map((branch) => [branch.name, branch]),
    );
    const remoteByName = new Map(remotePages.records.map((branch) => [branch.name, branch]));
    const names = [...new Set([...localByName.keys(), ...remoteByName.keys()])].toSorted();
    const observations = yield* Effect.forEach(
      names,
      (branchName): QueryEffect<GitHubBranchObservation> =>
        Effect.gen(function* () {
          const local = localByName.get(branchName) ?? null;
          const remote = remoteByName.get(branchName) ?? null;
          let aheadCount: number | null = null;
          let behindCount: number | null = null;
          if (local !== null && remote !== null && local.sha !== remote.sha) {
            const comparison = yield* git
              .execute({
                operation: "GitHubWorkspaceService.compareBranchHeads",
                cwd: projectRoot,
                args: ["rev-list", "--left-right", "--count", `${local.sha}...${remote.sha}`],
                allowNonZeroExit: true,
                maxOutputBytes: 64 * 1024,
              })
              .pipe(Effect.orElseSucceed(() => null));
            if (comparison?.exitCode === 0) {
              const counts = aheadBehindFromGit(comparison.stdout);
              aheadCount = counts?.ahead ?? null;
              behindCount = counts?.behind ?? null;
            }
          }
          const relation =
            local === null
              ? "missing_local"
              : remote === null
                ? "missing_remote"
                : local.sha === remote.sha
                  ? "equal"
                  : aheadCount === null || behindCount === null
                    ? "unknown"
                    : aheadCount > 0 && behindCount > 0
                      ? "diverged"
                      : aheadCount > 0
                        ? "ahead"
                        : behindCount > 0
                          ? "behind"
                          : "unknown";
          return {
            id: branchObservationIdFor(connection.id, connection.remoteName, branchName),
            repositoryConnectionId: connection.id,
            remoteName: connection.remoteName,
            branchName,
            localSha: local?.sha ?? null,
            remoteSha: remote?.sha ?? null,
            relation,
            aheadCount,
            behindCount,
            observedAt,
          };
        }),
      { concurrency: 8 },
    );
    yield* persistenceQuery(
      "sync_branches",
      Effect.forEach(observations, repository.saveBranchObservation, {
        concurrency: 1,
        discard: true,
      }),
    );
    yield* observeRateLimit(
      connection.githubAccountId,
      "sync_branches",
      remotePages.rateMetadata,
      observedAt,
    );
    return observations;
  });

  const syncPullRequestDetail = Effect.fn("GitHubWorkspaceService.syncPullRequestDetail")(
    function* (connection: RepositoryConnection, projectRoot: string, number: number) {
      const base = repoBase(connection, projectRoot);
      const pullRequestResult = yield* api
        .getPullRequest({ ...base, number })
        .pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail")));
      if (pullRequestResult.notModified) {
        const cached = yield* persistenceQuery(
          "sync_pull_request_detail",
          repository.getPullRequest({
            repositoryConnectionId: connection.id,
            number,
          }),
        );
        if (Option.isNone(cached)) {
          return yield* queryError(
            "sync_pull_request_detail",
            "stale_data",
            "GitHub returned not-modified without cached pull request data.",
          );
        }
        return yield* persistenceQuery(
          "sync_pull_request_detail",
          repository.getPullRequestDetail({ pullRequestRecordId: cached.value.id }),
        ).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  queryError(
                    "sync_pull_request_detail",
                    "stale_data",
                    "Cached pull request detail was not found.",
                  ),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
      }
      const now = yield* nowIso;
      const pullRequestId = toPullRequestRecord({
        connectionId: connection.id,
        pullRequest: pullRequestResult.data,
        syncedAt: now,
      }).id;
      const previousDetail = yield* repository
        .getPullRequestDetail({ pullRequestRecordId: pullRequestId })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Ignoring unreadable cached pull request detail during refresh", {
              repositoryConnectionId: connection.id,
              pullRequestNumber: number,
              errorTag: error._tag,
            }).pipe(Effect.as(Option.none())),
          ),
        );
      const requiredResult = yield* api
        .getRequiredChecks({
          ...base,
          branch: pullRequestResult.data.baseRef,
          retry: { maxRetries: 0 },
        })
        .pipe(
          Effect.catch((error) =>
            error._tag === "GitHubApiResponseError" && error.kind === "not_found"
              ? Effect.succeed(null)
              : Effect.fail(toQueryApiError("sync_pull_request_detail")(error)),
          ),
        );
      const reviewDecisionResult = yield* api
        .getPullRequestReviewDecision({ ...base, number, retry: { maxRetries: 0 } })
        .pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail")));
      const requiredCheckNames =
        requiredResult === null
          ? []
          : requiredResult.notModified
            ? Option.match(previousDetail, {
                onNone: () => [],
                onSome: (detail) => detail.pullRequest.requiredCheckNames,
              })
            : requiredResult.data;
      const pullRequest = toPullRequestRecord({
        connectionId: connection.id,
        pullRequest: {
          ...pullRequestResult.data,
          reviewDecision: reviewDecisionResult.notModified
            ? Option.match(previousDetail, {
                onNone: () => pullRequestResult.data.reviewDecision,
                onSome: (detail) => detail.pullRequest.reviewDecision,
              })
            : reviewDecisionResult.data,
        },
        requiredCheckNames,
        syncedAt: now,
      });
      const { files, commits, reviews, threads, checks, statuses } = yield* Effect.all(
        {
          files: collectPages((cursor) =>
            api.listPullRequestFiles({ ...base, number, cursor, pageSize: 100 }),
          ).pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail"))),
          commits: collectPages((cursor) =>
            api.listPullRequestCommits({ ...base, number, cursor, pageSize: 100 }),
          ).pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail"))),
          reviews: collectPages((cursor) =>
            api.listPullRequestReviews({ ...base, number, cursor, pageSize: 100 }),
          ).pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail"))),
          threads: collectPages((cursor) =>
            api.listReviewThreads({ ...base, number, cursor, pageSize: 100 }),
          ).pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail"))),
          checks: collectPages((cursor) =>
            api.listChecks({ ...base, headSha: pullRequest.headSha, cursor, pageSize: 100 }),
          ).pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail"))),
          statuses: collectPages((cursor) =>
            api.listCommitStatuses({
              ...base,
              headSha: pullRequest.headSha,
              cursor,
              pageSize: 100,
            }),
          ).pipe(Effect.mapError(toQueryApiError("sync_pull_request_detail"))),
        },
        { concurrency: 2 },
      );
      const completeThreads = yield* Effect.forEach(
        threads.records,
        (thread) => {
          if (!thread.commentPageInfo.hasNextPage || thread.commentPageInfo.endCursor === null) {
            return Effect.succeed(thread);
          }
          return collectPages(
            (cursor) =>
              api.listReviewThreadComments({
                cwd: projectRoot,
                hostname: hostnameFor(connection),
                threadNodeId: thread.githubThreadId,
                cursor,
                pageSize: 100,
              }),
            thread.commentPageInfo.endCursor,
          ).pipe(
            Effect.mapError(toQueryApiError("sync_pull_request_detail")),
            Effect.map((extra) => ({
              ...thread,
              comments: [
                ...thread.comments,
                ...extra.records.filter(
                  (comment) =>
                    !thread.comments.some(
                      (existing) => existing.githubCommentId === comment.githubCommentId,
                    ),
                ),
              ],
              commentPageInfo: {
                endCursor: extra.endCursor,
                hasNextPage: extra.endCursor !== null,
                totalCount: thread.commentPageInfo.totalCount,
              },
            })),
          );
        },
        { concurrency: 4 },
      );
      const threadRecords = completeThreads.map((thread) =>
        toReviewThreadRecord(pullRequest.id, thread, now),
      );
      const reviewRecords = reviews.records.map((review) =>
        toReviewRecord(pullRequest.id, review, now),
      );
      const comments = completeThreads.flatMap((thread) => {
        const threadId = reviewThreadRecordIdFor(pullRequest.id, thread.githubThreadId);
        return thread.comments.map((comment) => toReviewCommentRecord(threadId, comment, now));
      });
      const required = new Set(requiredCheckNames);
      const normalizedChecks = [...checks.records, ...statuses.records].map((check) =>
        toCheckRecord({
          connectionId: connection.id,
          pullRequestId: pullRequest.id,
          check,
          requiredCheckNames: required,
          syncedAt: now,
        }),
      );
      const cursor = cursorFor({
        connectionId: connection.id,
        resourceType: "pull_request_detail",
        cursor: null,
        metadata: pullRequestResult,
        now,
        successful: true,
        previous: null,
      });
      yield* persistenceQuery(
        "sync_pull_request_detail",
        repository.savePullRequestDetail({
          pullRequest,
          reviews: reviewRecords,
          threads: threadRecords,
          comments,
          checks: normalizedChecks,
          commits: commits.records.map((commit) => toCommitRecord(pullRequest.id, commit, now)),
          changedFiles: files.records.map((file) => toFileRecord(pullRequest.id, file, now)),
          cursor,
        }),
      );
      yield* observeRateLimit(
        connection.githubAccountId,
        "sync_pull_request_detail",
        pullRequestResult,
        now,
      );
      const previous = Option.getOrNull(previousDetail);
      const missionId = previous?.missionLinks[0]?.missionId ?? null;
      const eventBase = {
        projectId: connection.projectId,
        missionId,
        accountId: connection.githubAccountId,
        repositoryConnectionId: connection.id,
        pullRequestRecordId: pullRequest.id,
        pullRequestNumber: pullRequest.number,
        headSha: pullRequest.headSha,
      } as const;
      if (
        previous !== null &&
        previous.pullRequest.updatedAtRemote !== pullRequest.updatedAtRemote
      ) {
        yield* events
          .record({ ...eventBase, eventType: "github.pull_request_updated" })
          .pipe(Effect.ignore);
      }
      if (previous?.pullRequest.state !== pullRequest.state) {
        if (pullRequest.state === "merged") {
          yield* events
            .record({ ...eventBase, eventType: "github.pull_request_merged" })
            .pipe(Effect.ignore);
        } else if (pullRequest.state === "closed") {
          yield* events
            .record({ ...eventBase, eventType: "github.pull_request_closed" })
            .pipe(Effect.ignore);
        }
      }
      const previousReviewIds = new Set(
        previous?.reviews.map((review) => review.githubReviewId) ?? [],
      );
      for (const review of reviewRecords) {
        if (previousReviewIds.has(review.githubReviewId)) continue;
        yield* events
          .record({
            ...eventBase,
            eventType: "github.review_received",
            summary: `Review ${review.state} from ${review.author.login}`,
          })
          .pipe(Effect.ignore);
        if (review.state === "changes_requested") {
          yield* events
            .record({
              ...eventBase,
              eventType: "github.changes_requested",
              summary: `Changes requested by ${review.author.login}`,
            })
            .pipe(Effect.ignore);
        }
      }
      const previousThreadIds = new Set(
        previous?.threads.map((thread) => thread.githubThreadId) ?? [],
      );
      for (const thread of threadRecords) {
        if (previousThreadIds.has(thread.githubThreadId)) continue;
        yield* events
          .record({
            ...eventBase,
            eventType: "github.review_thread_linked",
            reviewThreadRecordId: thread.id,
            summary: `${thread.path}${thread.line === null ? "" : `:${thread.line}`}`,
          })
          .pipe(Effect.ignore);
      }
      const previousChecks = new Map(
        (previous?.checks ?? []).map((check) => [check.githubCheckId, check]),
      );
      const failedConclusions = new Set(["failure", "timed_out", "action_required"]);
      for (const check of normalizedChecks) {
        const old = previousChecks.get(check.githubCheckId);
        if (
          old !== undefined &&
          old.status === check.status &&
          old.conclusion === check.conclusion &&
          old.headSha === check.headSha
        ) {
          continue;
        }
        const eventType =
          check.status === "queued"
            ? "github.check_queued"
            : check.status === "in_progress"
              ? "github.check_started"
              : check.conclusion !== null && failedConclusions.has(check.conclusion)
                ? "github.check_failed"
                : "github.check_completed";
        yield* events
          .record({
            ...eventBase,
            eventType,
            summary: `${check.name}: ${check.conclusion ?? check.status}`,
          })
          .pipe(Effect.ignore);
      }
      for (const check of previous?.checks ?? []) {
        if (check.headSha === pullRequest.headSha || check.conclusion === "stale") continue;
        yield* events
          .record({
            ...eventBase,
            eventType: "github.check_stale",
            headSha: check.headSha,
            summary: `${check.name}: superseded by ${pullRequest.headSha}`,
          })
          .pipe(Effect.ignore);
      }
      return yield* persistenceQuery(
        "sync_pull_request_detail",
        repository.getPullRequestDetail({ pullRequestRecordId: pullRequest.id }),
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die("Pull request detail did not persist."),
            onSome: Effect.succeed,
          }),
        ),
      );
    },
  );

  const listIssues: GitHubWorkspaceServiceShape["listIssues"] = Effect.fn(
    "GitHubWorkspaceService.listIssues",
  )(function* (input) {
    const connection = yield* loadConnectionQuery(input.repositoryConnectionId);
    const offset = localCursorOffset(input.cursor);
    let records = input.refresh
      ? yield* loadProject(connection.projectId).pipe(
          Effect.mapError((error) =>
            queryError("list_issues", error.reason, error.message, error.retryAt),
          ),
          Effect.flatMap((project) => syncIssues(connection, project.workspaceRoot)),
        )
      : yield* persistenceQuery(
          "list_issues",
          repository.listIssues({
            repositoryConnectionId: connection.id,
            state: input.state,
            offset: 0,
            limit: Math.min(1_000, Math.max(offset + input.limit + 1, 100)),
          }),
        );
    const search = input.search?.trim().toLowerCase() ?? "";
    records = records.filter(
      (issue) =>
        (search.length === 0 ||
          issue.title.toLowerCase().includes(search) ||
          issue.bodyPreview?.toLowerCase().includes(search)) &&
        (input.labels.length === 0 ||
          input.labels.every((label) => issue.labels.some((entry) => entry.name === label))) &&
        (input.assignee === null ||
          issue.assignees.some((assignee) => assignee.login === input.assignee)) &&
        (input.milestone === null || issue.milestone?.number === input.milestone),
    );
    const syncedAt = records.reduce<string | null>(
      (latest, issue) => (latest === null || issue.syncedAt > latest ? issue.syncedAt : latest),
      null,
    );
    return {
      repositoryConnectionId: connection.id,
      records: records.slice(offset, offset + input.limit),
      pageInfo: {
        endCursor: records.length > offset + input.limit ? `local:${offset + input.limit}` : null,
        hasNextPage: records.length > offset + input.limit,
        totalCount: records.length,
      },
      freshness: freshnessForStatus(connection.syncStatus, connection.lastSyncedAt),
      syncedAt,
    } satisfies GitHubIssuePageSnapshot;
  });

  const listPullRequests: GitHubWorkspaceServiceShape["listPullRequests"] = Effect.fn(
    "GitHubWorkspaceService.listPullRequests",
  )(function* (input) {
    const connection = yield* loadConnectionQuery(input.repositoryConnectionId);
    const offset = localCursorOffset(input.cursor);
    let records = input.refresh
      ? yield* loadProject(connection.projectId).pipe(
          Effect.mapError((error) =>
            queryError("list_pull_requests", error.reason, error.message, error.retryAt),
          ),
          Effect.flatMap((project) => syncPullRequests(connection, project.workspaceRoot)),
        )
      : yield* persistenceQuery(
          "list_pull_requests",
          repository.listPullRequests({
            repositoryConnectionId: connection.id,
            state: input.state,
            offset: 0,
            limit: Math.min(1_000, Math.max(offset + input.limit + 1, 100)),
          }),
        );
    const search = input.search?.trim().toLowerCase() ?? "";
    if (search.length > 0) {
      records = records.filter(
        (pullRequest) =>
          pullRequest.title.toLowerCase().includes(search) ||
          pullRequest.bodyPreview?.toLowerCase().includes(search),
      );
    }
    const syncedAt = records.reduce<string | null>(
      (latest, pullRequest) =>
        latest === null || pullRequest.syncedAt > latest ? pullRequest.syncedAt : latest,
      null,
    );
    return {
      repositoryConnectionId: connection.id,
      records: records.slice(offset, offset + input.limit),
      pageInfo: {
        endCursor: records.length > offset + input.limit ? `local:${offset + input.limit}` : null,
        hasNextPage: records.length > offset + input.limit,
        totalCount: records.length,
      },
      freshness: freshnessForStatus(connection.syncStatus, connection.lastSyncedAt),
      syncedAt,
    } satisfies GitHubPullRequestPageSnapshot;
  });

  const getPullRequest: GitHubWorkspaceServiceShape["getPullRequest"] = Effect.fn(
    "GitHubWorkspaceService.getPullRequest",
  )(function* (input) {
    const connection = yield* loadConnectionQuery(input.repositoryConnectionId);
    if (input.refresh) {
      const project = yield* loadProject(connection.projectId).pipe(
        Effect.mapError((error) =>
          queryError("get_pull_request", error.reason, error.message, error.retryAt),
        ),
      );
      return yield* syncPullRequestDetail(connection, project.workspaceRoot, input.number);
    }
    const pullRequest = yield* persistenceQuery(
      "get_pull_request",
      repository.getPullRequest({
        repositoryConnectionId: connection.id,
        number: input.number,
      }),
    );
    if (Option.isNone(pullRequest)) {
      return yield* queryError("get_pull_request", "not_found", "The pull request was not cached.");
    }
    const detail = yield* persistenceQuery(
      "get_pull_request",
      repository.getPullRequestDetail({ pullRequestRecordId: pullRequest.value.id }),
    );
    if (Option.isNone(detail)) {
      return yield* queryError(
        "get_pull_request",
        "stale_data",
        "Pull request detail has not been synchronized yet.",
      );
    }
    return detail.value;
  });

  const refresh: GitHubWorkspaceServiceShape["refresh"] = Effect.fn(
    "GitHubWorkspaceService.refresh",
  )(function* (input) {
    let connection = yield* loadConnectionMutation(input.repositoryConnectionId);
    const project = yield* loadProject(connection.projectId);
    const resources = [
      ...new Set(input.resources.length === 0 ? DEFAULT_SYNC_RESOURCES : input.resources),
    ];
    const startAt = yield* nowIso;
    connection = { ...connection, syncStatus: "syncing", updatedAt: startAt };
    yield* persistenceMutation("refresh", repository.saveRepositoryConnection(connection));
    yield* events
      .record({
        eventType: "github.sync_started",
        projectId: connection.projectId,
        accountId: connection.githubAccountId,
        repositoryConnectionId: connection.id,
      })
      .pipe(Effect.ignore);

    const previousCursors = yield* persistenceMutation(
      "refresh",
      repository.listSyncCursors({ repositoryConnectionId: connection.id }),
    );
    const failures = new Set<GitHubSyncResourceType>();
    const failureEvents = new Set<
      "github.authentication_expired" | "github.permissions_changed" | "github.rate_limited"
    >();
    const failureState: {
      connectionStatus: RepositorySyncStatus | null;
      accountStatus: "expired" | "insufficient_permissions" | "rate_limited" | "error" | null;
    } = { connectionStatus: null, accountStatus: null };
    const statusPriority: Readonly<Record<RepositorySyncStatus, number>> = {
      authentication_required: 100,
      rate_limited: 90,
      offline: 80,
      remote_deleted: 70,
      failed: 60,
      partially_stale: 50,
      stale: 40,
      not_synced: 30,
      syncing: 20,
      current: 10,
    };
    const attempt = (
      attemptedResources: ReadonlyArray<GitHubSyncResourceType>,
      effect: Effect.Effect<
        unknown,
        GitHubApiError | GitHubWorkspaceQueryError | ProjectionRepositoryError
      >,
    ) =>
      effect.pipe(
        Effect.catch((cause) => {
          const disposition = classifyGitHubSyncFailure(cause);
          if (
            failureState.connectionStatus === null ||
            statusPriority[disposition.connectionStatus] >
              statusPriority[failureState.connectionStatus]
          ) {
            failureState.connectionStatus = disposition.connectionStatus;
          }
          failureState.accountStatus = disposition.accountStatus ?? failureState.accountStatus;
          if (disposition.eventType !== null) failureEvents.add(disposition.eventType);
          for (const resource of attemptedResources) failures.add(resource);
          const persistAttempts = Effect.forEach(
            attemptedResources,
            (resource) => {
              const previous = previousCursors.find((cursor) => cursor.resourceType === resource);
              return repository
                .saveSyncCursor({
                  id:
                    previous?.id ?? SyncCursorId.make(`github-cursor:${connection.id}:${resource}`),
                  repositoryConnectionId: connection.id,
                  resourceType: resource,
                  cursor: previous?.cursor ?? null,
                  etag: previous?.etag ?? null,
                  lastModified: previous?.lastModified ?? null,
                  lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
                  lastAttemptAt: startAt,
                  errorSummary: `${resource.replaceAll("_", " ")} synchronization failed.`,
                })
                .pipe(Effect.ignore);
            },
            { concurrency: 1, discard: true },
          );
          const persistRateLimit =
            disposition.connectionStatus === "rate_limited"
              ? repository
                  .saveRateLimit(
                    rateLimitFor({
                      accountId: connection.githubAccountId,
                      rateLimit: {
                        kind:
                          cause._tag === "GitHubApiResponseError" && cause.secondaryRateLimit
                            ? "secondary"
                            : "unknown",
                        limit: null,
                        remaining: 0,
                        used: null,
                        resetAt:
                          cause._tag === "GitHubApiResponseError"
                            ? cause.rateLimitResetAt
                            : "retryAt" in cause
                              ? (cause.retryAt ?? null)
                              : null,
                        retryAfterSeconds:
                          cause._tag === "GitHubApiResponseError" ? cause.retryAfterSeconds : null,
                        secondary:
                          cause._tag === "GitHubApiResponseError" && cause.secondaryRateLimit,
                      },
                      now: startAt,
                      blockedOperation: attemptedResources.join(",").slice(0, 255),
                    }),
                  )
                  .pipe(Effect.ignore)
              : Effect.void;
          return Effect.all([persistAttempts, persistRateLimit], { discard: true }).pipe(
            Effect.andThen(
              Effect.logWarning("GitHub resource synchronization failed", {
                resources: attemptedResources.join(","),
                repositoryConnectionId: connection.id,
                cause: cause instanceof Error ? cause.message : String(cause),
              }),
            ),
          );
        }),
      );

    if (resources.includes("repository")) {
      yield* attempt(
        ["repository"],
        api.getRepository({ ...repoBase(connection, project.workspaceRoot) }).pipe(
          Effect.flatMap((result) => {
            if (result.notModified) return Effect.void;
            return nowIso.pipe(
              Effect.flatMap((now) => {
                connection = toRepositoryConnection({
                  projectId: connection.projectId,
                  accountId: connection.githubAccountId,
                  repository: result.data,
                  remoteName: connection.remoteName,
                  remoteUrl: connection.remoteUrl,
                  serverUrl: connection.serverUrl,
                  now,
                  existing: connection,
                });
                return repository.saveRepositoryConnection(connection);
              }),
            );
          }),
        ),
      );
    }
    const issueResources = resources.filter(
      (resource) => resource === "issues" || resource === "labels" || resource === "milestones",
    );
    if (issueResources.length > 0) {
      yield* attempt(issueResources, syncIssues(connection, project.workspaceRoot));
    }
    if (resources.includes("pull_requests")) {
      yield* attempt(["pull_requests"], syncPullRequests(connection, project.workspaceRoot));
    }
    const detailResources = resources.filter(
      (resource) =>
        resource === "pull_request_detail" ||
        resource === "reviews" ||
        resource === "review_threads" ||
        resource === "checks",
    );
    if (detailResources.length > 0) {
      yield* attempt(
        detailResources,
        repository
          .listPullRequests({
            repositoryConnectionId: connection.id,
            state: "open",
            offset: 0,
            limit: 1_000,
          })
          .pipe(
            Effect.flatMap((pullRequests) =>
              Effect.forEach(
                pullRequests,
                (pullRequest) =>
                  syncPullRequestDetail(connection, project.workspaceRoot, pullRequest.number),
                { concurrency: 2, discard: true },
              ),
            ),
          ),
      );
    }
    if (resources.includes("branches")) {
      yield* attempt(["branches"], syncBranches(connection, project.workspaceRoot));
    }

    const finishedAt = yield* nowIso;
    const failureCount = failures.size;
    const syncStatus: RepositorySyncStatus =
      failureCount === 0
        ? "current"
        : (failureState.connectionStatus ??
          (failureCount < resources.length ? "partially_stale" : "failed"));
    connection = {
      ...connection,
      syncStatus,
      lastSyncedAt: failureCount === resources.length ? connection.lastSyncedAt : finishedAt,
      updatedAt: finishedAt,
    };
    yield* persistenceMutation("refresh", repository.saveRepositoryConnection(connection));
    const account = yield* persistenceMutation(
      "refresh",
      repository.getAccountById({ githubAccountId: connection.githubAccountId }),
    );
    if (Option.isSome(account)) {
      const recovered =
        failureCount === 0 &&
        (account.value.status === "expired" ||
          account.value.status === "rate_limited" ||
          account.value.status === "error");
      yield* persistenceMutation(
        "refresh",
        repository.saveAccount({
          ...account.value,
          status: failureState.accountStatus ?? (recovered ? "connected" : account.value.status),
          updatedAt: finishedAt,
          lastValidatedAt: failureCount === 0 ? finishedAt : account.value.lastValidatedAt,
        }),
      );
    }
    yield* Effect.forEach(
      failureEvents,
      (eventType) =>
        events
          .record({
            eventType,
            projectId: connection.projectId,
            accountId: connection.githubAccountId,
            repositoryConnectionId: connection.id,
            summary:
              eventType === "github.rate_limited"
                ? `Blocked resources: ${[...failures].join(", ")}`
                : null,
          })
          .pipe(Effect.ignore),
      { concurrency: 1, discard: true },
    );
    yield* events
      .record({
        eventType:
          failureCount === 0
            ? "github.sync_completed"
            : failureCount < resources.length
              ? "github.sync_partially_failed"
              : "github.sync_failed",
        projectId: connection.projectId,
        accountId: connection.githubAccountId,
        repositoryConnectionId: connection.id,
        summary: failureCount === 0 ? null : `Failed resources: ${[...failures].join(", ")}`,
      })
      .pipe(Effect.ignore);
    yield* publish(connection.projectId, "sync");
    if (failureCount === resources.length) {
      const reason =
        syncStatus === "authentication_required"
          ? "authentication_required"
          : syncStatus === "rate_limited"
            ? "rate_limited"
            : syncStatus === "offline"
              ? "offline"
              : syncStatus === "remote_deleted"
                ? "not_found"
                : "partial_sync";
      return yield* mutationError(
        "refresh",
        reason,
        `GitHub synchronization failed for: ${[...failures].join(", ")}. Cached data was preserved.`,
      );
    }
    const workspace = yield* getWorkspace(connection.projectId).pipe(
      Effect.mapError((error) =>
        mutationError("refresh", error.reason, error.message, error.retryAt),
      ),
    );
    if (workspace === null) {
      return yield* mutationError("refresh", "not_found", "The repository connection disappeared.");
    }
    return workspace;
  });

  const startBackgroundRefresh: GitHubWorkspaceServiceShape["startBackgroundRefresh"] = Effect.fn(
    "GitHubWorkspaceService.startBackgroundRefresh",
  )(function* () {
    const cycle = Effect.gen(function* () {
      const accounts = yield* repository
        .listAccounts({ includeDisconnected: false })
        .pipe(Effect.orElseSucceed(() => []));
      for (const account of accounts) {
        const connections = yield* repository
          .listRepositoryConnectionsByAccountId({ githubAccountId: account.id })
          .pipe(Effect.orElseSucceed(() => []));
        yield* Effect.forEach(
          connections,
          (connection) =>
            refresh({
              repositoryConnectionId: connection.id,
              resources: ["repository", "issues", "pull_requests"],
            }).pipe(Effect.ignore),
          { concurrency: 1, discard: true },
        );
      }
    });
    yield* Effect.forkScoped(
      Effect.sleep(BACKGROUND_REFRESH_INITIAL_DELAY).pipe(
        Effect.andThen(
          cycle.pipe(Effect.andThen(Effect.sleep(BACKGROUND_REFRESH_INTERVAL)), Effect.forever),
        ),
        Effect.ignore,
      ),
    );
  });

  const notifyWorkflowChange = (projectId: ProjectId) => publish(projectId, "workflow");

  return GitHubWorkspaceService.of({
    listAccounts,
    connectAccount,
    disconnectAccount,
    connectRepository,
    disconnectRepository,
    getWorkspace,
    listIssues,
    listPullRequests,
    getPullRequest,
    refresh,
    changes: Stream.fromPubSub(changesPubSub),
    startBackgroundRefresh,
    notifyWorkflowChange,
  });
});

export const layer = Layer.effect(GitHubWorkspaceService, make);
