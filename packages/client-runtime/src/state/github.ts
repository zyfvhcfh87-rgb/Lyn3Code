import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/**
 * Project-scoped GitHub reads. Cached remote records remain useful while an
 * environment reconnects; mutations are deliberately kept in the command set.
 */
export function createGitHubStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    accountsAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "github:accounts",
      tag: WS_METHODS.githubListAccounts,
      staleTimeMs: 30_000,
    }),
    workspaceAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "github:workspace",
      tag: WS_METHODS.githubGetWorkspace,
      staleTimeMs: 15_000,
      refreshIntervalMs: 60_000,
    }),
    issuesAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "github:issues",
      tag: WS_METHODS.githubListIssues,
      staleTimeMs: 30_000,
      refreshIntervalMs: 60_000,
    }),
    pullRequestsAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "github:pull-requests",
      tag: WS_METHODS.githubListPullRequests,
      staleTimeMs: 20_000,
      refreshIntervalMs: 60_000,
    }),
    pullRequestDetailAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "github:pull-request-detail",
      tag: WS_METHODS.githubGetPullRequest,
      staleTimeMs: 15_000,
      idleTtlMs: 10 * 60_000,
      refreshIntervalMs: 60_000,
    }),
  };
}

/** Serializes writes per environment while allowing unrelated reads to stay concurrent. */
export function createGitHubCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialByEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  return {
    connectAccount: createEnvironmentRpcCommand(runtime, {
      label: "github:connect-account",
      tag: WS_METHODS.githubConnectAccount,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    disconnectAccount: createEnvironmentRpcCommand(runtime, {
      label: "github:disconnect-account",
      tag: WS_METHODS.githubDisconnectAccount,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    connectRepository: createEnvironmentRpcCommand(runtime, {
      label: "github:connect-repository",
      tag: WS_METHODS.githubConnectRepository,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    disconnectRepository: createEnvironmentRpcCommand(runtime, {
      label: "github:disconnect-repository",
      tag: WS_METHODS.githubDisconnectRepository,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "github:refresh",
      tag: WS_METHODS.githubRefresh,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createMissionFromIssue: createEnvironmentRpcCommand(runtime, {
      label: "github:create-mission-from-issue",
      tag: WS_METHODS.githubCreateMissionFromIssue,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    linkIssueMission: createEnvironmentRpcCommand(runtime, {
      label: "github:link-issue-mission",
      tag: WS_METHODS.githubLinkIssueMission,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createReviewTask: createEnvironmentRpcCommand(runtime, {
      label: "github:create-review-task",
      tag: WS_METHODS.githubCreateReviewTask,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    pushBranch: createEnvironmentRpcCommand(runtime, {
      label: "github:push-branch",
      tag: WS_METHODS.githubPushBranch,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createPullRequest: createEnvironmentRpcCommand(runtime, {
      label: "github:create-pull-request",
      tag: WS_METHODS.githubCreatePullRequest,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    updatePullRequest: createEnvironmentRpcCommand(runtime, {
      label: "github:update-pull-request",
      tag: WS_METHODS.githubUpdatePullRequest,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    markReadyForReview: createEnvironmentRpcCommand(runtime, {
      label: "github:mark-ready-for-review",
      tag: WS_METHODS.githubMarkReadyForReview,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    resolveReviewThread: createEnvironmentRpcCommand(runtime, {
      label: "github:resolve-review-thread",
      tag: WS_METHODS.githubResolveReviewThread,
      scheduler,
      concurrency: serialByEnvironment,
    }),
  };
}
