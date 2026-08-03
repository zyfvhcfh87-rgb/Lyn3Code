import {
  ORCHESTRATION_WS_METHODS,
  type AgentHandoff,
  type AgentRun,
  type EnvironmentId,
  type ManagedWorktree,
  type MissionBoardSnapshot,
  type MissionId,
  type MissionSummary,
  type MissionAgent,
  type MissionTask,
  type OrchestrationEvent,
  type OrchestrationMissionBoardStreamItem,
  type OrchestrationMissionDetailSnapshot,
  type OrchestrationMissionStreamItem,
  type ProjectId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { followStreamInEnvironment } from "./runtime.ts";

export type MissionSynchronizationStatus = "empty" | "cached" | "synchronizing" | "live";

export interface EnvironmentMissionBoardState {
  readonly snapshot: Option.Option<MissionBoardSnapshot>;
  readonly status: MissionSynchronizationStatus;
  readonly error: Option.Option<string>;
}

export interface EnvironmentMissionDetailState {
  readonly snapshot: Option.Option<OrchestrationMissionDetailSnapshot>;
  readonly status: MissionSynchronizationStatus;
  readonly error: Option.Option<string>;
}

export const EMPTY_ENVIRONMENT_MISSION_BOARD_STATE: EnvironmentMissionBoardState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

export const EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE: EnvironmentMissionDetailState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

const MISSION_STATE_IDLE_TTL_MS = 5 * 60_000;

function statusWithoutLiveData(snapshot: Option.Option<unknown>): MissionSynchronizationStatus {
  return Option.isSome(snapshot) ? "cached" : "empty";
}

function formatMissionSynchronizationError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize mission data.";
}

export function applyMissionBoardStreamItem(
  state: EnvironmentMissionBoardState,
  item: OrchestrationMissionBoardStreamItem,
): EnvironmentMissionBoardState {
  if (item.kind === "synchronized") {
    return Option.isSome(state.snapshot)
      ? { ...state, status: "live", error: Option.none() }
      : state;
  }

  if (item.kind === "snapshot") {
    const currentSequence = Option.match(state.snapshot, {
      onNone: () => -1,
      onSome: (snapshot) => snapshot.snapshotSequence,
    });
    return item.snapshot.snapshotSequence < currentSequence
      ? state
      : { snapshot: Option.some(item.snapshot), status: "synchronizing", error: Option.none() };
  }

  if (Option.isNone(state.snapshot) || item.sequence <= state.snapshot.value.snapshotSequence) {
    return state;
  }

  const current = state.snapshot.value;
  const missions =
    item.kind === "mission-removed"
      ? current.missions.filter((summary) => summary.mission.id !== item.missionId)
      : current.missions.some((summary) => summary.mission.id === item.summary.mission.id)
        ? current.missions.map((summary) =>
            summary.mission.id === item.summary.mission.id ? item.summary : summary,
          )
        : [...current.missions, item.summary];

  return {
    snapshot: Option.some({
      ...current,
      missions,
      snapshotSequence: item.sequence,
      updatedAt:
        item.kind === "mission-upserted" ? item.summary.mission.updatedAt : current.updatedAt,
    }),
    status: state.status,
    error: Option.none(),
  };
}

function updateTask(
  tasks: ReadonlyArray<MissionTask>,
  taskId: string,
  update: (task: MissionTask) => MissionTask,
): ReadonlyArray<MissionTask> {
  return tasks.map((task) => (task.id === taskId ? update(task) : task));
}

function updateAgentRun(
  runs: ReadonlyArray<AgentRun>,
  agentRunId: string,
  update: (run: AgentRun) => AgentRun,
): ReadonlyArray<AgentRun> {
  return runs.map((run) => (run.id === agentRunId ? update(run) : run));
}

function upsertById<T extends { readonly id: string }>(
  items: ReadonlyArray<T>,
  item: T,
): ReadonlyArray<T> {
  return items.some((candidate) => candidate.id === item.id)
    ? items.map((candidate) => (candidate.id === item.id ? item : candidate))
    : [...items, item];
}

function updateById<T extends { readonly id: string }>(
  items: ReadonlyArray<T>,
  id: string,
  update: (item: T) => T,
): ReadonlyArray<T> {
  return items.map((item) => (item.id === id ? update(item) : item));
}

function applyMissionEventToSnapshot(
  snapshot: OrchestrationMissionDetailSnapshot,
  event: OrchestrationEvent,
): OrchestrationMissionDetailSnapshot {
  let mission = snapshot.mission;
  let tasks = snapshot.tasks;
  let agentRuns = snapshot.agentRuns;
  let missionAgents = snapshot.missionAgents;
  let taskDependencies = snapshot.taskDependencies;
  let managedWorktrees = snapshot.managedWorktrees;
  let agentHandoffs = snapshot.agentHandoffs;

  switch (event.type) {
    case "mission.created":
      mission = event.payload.mission;
      break;
    case "mission.updated":
      mission = {
        ...mission,
        ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
        ...(event.payload.description === undefined
          ? {}
          : { description: event.payload.description }),
        ...(event.payload.status === undefined ? {} : { status: event.payload.status }),
        updatedAt: event.payload.updatedAt,
      };
      break;
    case "mission.started":
      mission = {
        ...mission,
        status: "running",
        startedAt: mission.startedAt ?? event.payload.startedAt,
        updatedAt: event.payload.startedAt,
      };
      break;
    case "mission.cancelled":
      mission = {
        ...mission,
        status: "cancelled",
        cancelledAt: event.payload.cancelledAt,
        updatedAt: event.payload.cancelledAt,
      };
      break;
    case "mission.completed":
      mission = {
        ...mission,
        status: "completed",
        completedAt: event.payload.completedAt,
        updatedAt: event.payload.completedAt,
      };
      break;
    case "mission.failed":
      mission = { ...mission, status: "failed", updatedAt: event.payload.failedAt };
      break;
    case "mission.recovery-blocked":
      mission = { ...mission, status: "blocked", updatedAt: event.payload.recoveredAt };
      break;
    case "task.created":
      tasks = [...tasks, event.payload.task].toSorted(
        (left, right) => left.position - right.position || left.id.localeCompare(right.id),
      );
      break;
    case "task.updated":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
        ...(event.payload.description === undefined
          ? {}
          : { description: event.payload.description }),
        ...(event.payload.status === undefined ? {} : { status: event.payload.status }),
        ...(event.payload.position === undefined ? {} : { position: event.payload.position }),
        ...(event.payload.assignedMissionAgentId === undefined
          ? {}
          : { assignedMissionAgentId: event.payload.assignedMissionAgentId }),
        ...(event.payload.maximumAttempts === undefined
          ? {}
          : { maximumAttempts: event.payload.maximumAttempts }),
        ...(event.payload.requiresDependencyHandoffs === undefined
          ? {}
          : { requiresDependencyHandoffs: event.payload.requiresDependencyHandoffs }),
        updatedAt: event.payload.updatedAt,
      }));
      break;
    case "mission.team-configured":
      mission = {
        ...mission,
        teamSettings: event.payload.settings,
        updatedAt: event.payload.updatedAt,
      };
      break;
    case "mission.agent-upserted":
      missionAgents = upsertById(missionAgents, event.payload.agent);
      break;
    case "mission.agent-removed":
      missionAgents = missionAgents.filter((agent) => agent.id !== event.payload.missionAgentId);
      break;
    case "mission.agent-permissions-updated":
      missionAgents = updateById(
        missionAgents,
        event.payload.missionAgentId,
        (agent): MissionAgent => ({
          ...agent,
          permissions: event.payload.permissions,
          updatedAt: event.payload.updatedAt,
        }),
      );
      break;
    case "task.dependency-added":
      taskDependencies = upsertById(taskDependencies, event.payload.dependency);
      break;
    case "task.dependency-removed":
      taskDependencies = taskDependencies.filter(
        (dependency) => dependency.id !== event.payload.dependencyId,
      );
      break;
    case "task.ready":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        status: "ready",
        readyAt: event.payload.readyAt,
        blockedReason: null,
        updatedAt: event.payload.readyAt,
      }));
      break;
    case "task.blocked":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        status: "blocked",
        blockedReason: event.payload.reason,
        updatedAt: event.payload.blockedAt,
      }));
      break;
    case "task.retry-requested":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        attemptCount: event.payload.attemptNumber,
        blockedReason: null,
        updatedAt: event.payload.requestedAt,
      }));
      break;
    case "task.cancellation-requested":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        updatedAt: event.payload.requestedAt,
      }));
      break;
    case "managed_worktree.recorded":
      managedWorktrees = upsertById(managedWorktrees, event.payload.worktree);
      break;
    case "managed_worktree.status-updated":
      managedWorktrees = updateById(
        managedWorktrees,
        event.payload.worktreeId,
        (worktree): ManagedWorktree => ({
          ...worktree,
          status: event.payload.status,
          ...(event.payload.headCommit === undefined
            ? {}
            : { headCommit: event.payload.headCommit }),
          ...(event.payload.changedFileCount === undefined
            ? {}
            : { changedFileCount: event.payload.changedFileCount }),
          ...(event.payload.hasUncommittedChanges === undefined
            ? {}
            : { hasUncommittedChanges: event.payload.hasUncommittedChanges }),
          ...(event.payload.conflictingFiles === undefined
            ? {}
            : { conflictingFiles: event.payload.conflictingFiles }),
          ...(event.payload.errorSummary === undefined
            ? {}
            : { errorSummary: event.payload.errorSummary }),
          ...(event.payload.removedAt === undefined ? {} : { removedAt: event.payload.removedAt }),
          updatedAt: event.payload.updatedAt,
        }),
      );
      break;
    case "managed_worktree.removal-requested":
      managedWorktrees = updateById(
        managedWorktrees,
        event.payload.worktreeId,
        (worktree): ManagedWorktree => ({
          ...worktree,
          status: "removing",
          updatedAt: event.payload.requestedAt,
        }),
      );
      break;
    case "agent_handoff.created":
      agentHandoffs = upsertById(agentHandoffs, event.payload.handoff);
      break;
    case "agent_handoff.reconciled":
      agentHandoffs = updateById(
        agentHandoffs,
        event.payload.handoffId,
        (handoff): AgentHandoff => ({
          ...handoff,
          reconciliationStatus: event.payload.reconciliationStatus,
          changedFiles: event.payload.changedFiles,
          reconciledAt: event.payload.reconciledAt,
        }),
      );
      break;
    case "scheduler.started":
    case "scheduler.paused":
    case "scheduler.resumed":
      mission = {
        ...mission,
        schedulerStatus: event.payload.status,
        updatedAt: event.payload.occurredAt,
      };
      break;
    case "scheduler.concurrency-limited":
      break;
    case "integration.requested":
    case "integration.approved":
    case "integration.started":
    case "integration.completed":
    case "integration.conflicted":
    case "integration.aborted":
    case "integration.failed":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        integrationStatus: event.payload.integrationStatus,
        updatedAt: event.payload.occurredAt,
      }));
      managedWorktrees = updateById(
        managedWorktrees,
        event.payload.worktreeId,
        (worktree): ManagedWorktree => ({
          ...worktree,
          ...(event.payload.headCommit === undefined
            ? {}
            : { headCommit: event.payload.headCommit }),
          ...(event.payload.conflictingFiles === undefined
            ? {}
            : { conflictingFiles: event.payload.conflictingFiles }),
          ...(event.payload.errorSummary === undefined
            ? {}
            : { errorSummary: event.payload.errorSummary }),
          updatedAt: event.payload.occurredAt,
        }),
      );
      break;
    case "task.started":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        status: "running",
        startedAt: event.payload.occurredAt,
        updatedAt: event.payload.occurredAt,
      }));
      break;
    case "task.completed":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        status: "completed",
        completedAt: event.payload.occurredAt,
        updatedAt: event.payload.occurredAt,
      }));
      break;
    case "task.cancelled":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        status: "cancelled",
        updatedAt: event.payload.occurredAt,
      }));
      break;
    case "task.failed":
      tasks = updateTask(tasks, event.payload.taskId, (task) => ({
        ...task,
        status: "failed",
        updatedAt: event.payload.occurredAt,
      }));
      break;
    case "agent_run.started":
      agentRuns = agentRuns.some((run) => run.id === event.payload.run.id)
        ? agentRuns.map((run) => (run.id === event.payload.run.id ? event.payload.run : run))
        : [...agentRuns, event.payload.run];
      break;
    case "agent_run.running":
      agentRuns = updateAgentRun(agentRuns, event.payload.agentRunId, (run) => ({
        ...run,
        status: "running",
        ...(event.payload.providerSessionId === undefined
          ? {}
          : { providerSessionId: event.payload.providerSessionId }),
        updatedAt: event.payload.occurredAt,
      }));
      break;
    case "agent_run.cancellation-requested":
      agentRuns = updateAgentRun(agentRuns, event.payload.agentRunId, (run) => ({
        ...run,
        status: "cancelling",
        updatedAt: event.payload.occurredAt,
      }));
      break;
    case "agent_run.completed":
    case "agent_run.cancelled":
    case "agent_run.failed":
    case "agent_run.interrupted": {
      const status =
        event.type === "agent_run.completed"
          ? "completed"
          : event.type === "agent_run.cancelled"
            ? "cancelled"
            : event.type === "agent_run.failed"
              ? "failed"
              : "interrupted";
      agentRuns = updateAgentRun(agentRuns, event.payload.agentRunId, (run) => ({
        ...run,
        status,
        updatedAt: event.payload.occurredAt,
        completedAt: event.payload.occurredAt,
        errorSummary: event.payload.errorSummary ?? run.errorSummary,
      }));
      break;
    }
    default:
      break;
  }

  return {
    mission,
    tasks,
    agentRuns,
    agentRoles: snapshot.agentRoles,
    missionAgents,
    taskDependencies,
    managedWorktrees,
    agentHandoffs,
    events: [...snapshot.events, event],
    snapshotSequence: event.sequence,
  };
}

export function applyMissionDetailStreamItem(
  state: EnvironmentMissionDetailState,
  item: OrchestrationMissionStreamItem,
): EnvironmentMissionDetailState {
  if (item.kind === "synchronized") {
    return Option.isSome(state.snapshot)
      ? { ...state, status: "live", error: Option.none() }
      : state;
  }

  if (item.kind === "snapshot") {
    const currentSequence = Option.match(state.snapshot, {
      onNone: () => -1,
      onSome: (snapshot) => snapshot.snapshotSequence,
    });
    return item.snapshot.snapshotSequence < currentSequence
      ? state
      : { snapshot: Option.some(item.snapshot), status: "synchronizing", error: Option.none() };
  }

  if (
    Option.isNone(state.snapshot) ||
    item.event.sequence <= state.snapshot.value.snapshotSequence
  ) {
    return state;
  }

  return {
    snapshot: Option.some(applyMissionEventToSnapshot(state.snapshot.value, item.event)),
    status: state.status,
    error: Option.none(),
  };
}

function makeMissionBoardState(projectId: ProjectId | undefined) {
  return Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
    const state = yield* SubscriptionRef.make(EMPTY_ENVIRONMENT_MISSION_BOARD_STATE);

    const setSynchronizing = SubscriptionRef.update(state, (current) => ({
      ...current,
      status: "synchronizing" as const,
      error: Option.none(),
    }));
    const setDisconnected = SubscriptionRef.update(state, (current) => ({
      ...current,
      status: statusWithoutLiveData(current.snapshot),
    }));
    const setStreamError = (cause: Cause.Cause<unknown>) =>
      SubscriptionRef.update(state, (current) => ({
        ...current,
        status: statusWithoutLiveData(current.snapshot),
        error: Option.some(formatMissionSynchronizationError(cause)),
      }));
    const foregroundResubscriptions = Option.match(wakeups, {
      onNone: () => Stream.never,
      onSome: (service) =>
        service.changes.pipe(Stream.filter(ConnectionWakeups.shouldResubscribeAfterWakeup)),
    });

    yield* setSynchronizing;
    yield* subscribeDynamic(
      ORCHESTRATION_WS_METHODS.subscribeMissions,
      Effect.fn("EnvironmentMissionBoardState.makeSubscribeInput")(function* () {
        yield* setSynchronizing;
        const current = yield* SubscriptionRef.get(state);
        const afterSequence = Option.map(current.snapshot, (snapshot) => snapshot.snapshotSequence);
        return {
          ...(projectId === undefined ? {} : { projectId }),
          ...(Option.isSome(afterSequence) ? { afterSequence: afterSequence.value } : {}),
          requestCompletionMarker: true,
        };
      }),
      {
        onExpectedFailure: setStreamError,
        retryExpectedFailureAfter: "250 millis",
        resubscribe: foregroundResubscriptions,
      },
    ).pipe(
      Stream.runForEach((item) =>
        SubscriptionRef.update(state, (current) => applyMissionBoardStreamItem(current, item)),
      ),
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(supervisor.state).pipe(
      Stream.runForEach((connectionState) => {
        switch (connectionProjectionPhase(connectionState)) {
          case "synchronizing":
            return setSynchronizing;
          case "disconnected":
            return setDisconnected;
          case "ready":
            return Effect.void;
        }
      }),
      Effect.forkScoped,
    );

    return state;
  });
}

function makeMissionDetailState(missionId: MissionId) {
  return Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
    const state = yield* SubscriptionRef.make(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE);

    const setSynchronizing = SubscriptionRef.update(state, (current) => ({
      ...current,
      status: "synchronizing" as const,
      error: Option.none(),
    }));
    const setDisconnected = SubscriptionRef.update(state, (current) => ({
      ...current,
      status: statusWithoutLiveData(current.snapshot),
    }));
    const setStreamError = (cause: Cause.Cause<unknown>) =>
      SubscriptionRef.update(state, (current) => ({
        ...current,
        status: statusWithoutLiveData(current.snapshot),
        error: Option.some(formatMissionSynchronizationError(cause)),
      }));
    const foregroundResubscriptions = Option.match(wakeups, {
      onNone: () => Stream.never,
      onSome: (service) =>
        service.changes.pipe(Stream.filter(ConnectionWakeups.shouldResubscribeAfterWakeup)),
    });

    yield* setSynchronizing;
    yield* subscribeDynamic(
      ORCHESTRATION_WS_METHODS.subscribeMission,
      Effect.fn("EnvironmentMissionDetailState.makeSubscribeInput")(function* () {
        yield* setSynchronizing;
        const current = yield* SubscriptionRef.get(state);
        const afterSequence = Option.map(current.snapshot, (snapshot) => snapshot.snapshotSequence);
        return {
          missionId,
          ...(Option.isSome(afterSequence) ? { afterSequence: afterSequence.value } : {}),
          requestCompletionMarker: true,
        };
      }),
      {
        onExpectedFailure: setStreamError,
        retryExpectedFailureAfter: "250 millis",
        resubscribe: foregroundResubscriptions,
      },
    ).pipe(
      Stream.runForEach((item) =>
        SubscriptionRef.update(state, (current) => applyMissionDetailStreamItem(current, item)),
      ),
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(supervisor.state).pipe(
      Stream.runForEach((connectionState) => {
        switch (connectionProjectionPhase(connectionState)) {
          case "synchronizing":
            return setSynchronizing;
          case "disconnected":
            return setDisconnected;
          case "ready":
            return Effect.void;
        }
      }),
      Effect.forkScoped,
    );

    return state;
  });
}

function boardKey(environmentId: EnvironmentId, projectId: ProjectId | undefined): string {
  return JSON.stringify([environmentId, projectId ?? null]);
}

function parseBoardKey(key: string): {
  environmentId: EnvironmentId;
  projectId: ProjectId | undefined;
} {
  const [environmentId, projectId] = JSON.parse(key) as [EnvironmentId, ProjectId | null];
  return { environmentId, projectId: projectId ?? undefined };
}

function detailKey(environmentId: EnvironmentId, missionId: MissionId): string {
  return JSON.stringify([environmentId, missionId]);
}

function parseDetailKey(key: string): { environmentId: EnvironmentId; missionId: MissionId } {
  const [environmentId, missionId] = JSON.parse(key) as [EnvironmentId, MissionId];
  return { environmentId, missionId };
}

export function createMissionStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const boardFamily = Atom.family((key: string) => {
    const target = parseBoardKey(key);
    return runtime
      .atom(
        followStreamInEnvironment(
          target.environmentId,
          Stream.unwrap(
            makeMissionBoardState(target.projectId).pipe(
              Effect.map((state) => SubscriptionRef.changes(state)),
            ),
          ),
        ),
        { initialValue: EMPTY_ENVIRONMENT_MISSION_BOARD_STATE },
      )
      .pipe(
        Atom.setIdleTTL(MISSION_STATE_IDLE_TTL_MS),
        Atom.withLabel(`environment-mission-board:${key}`),
      );
  });
  const detailFamily = Atom.family((key: string) => {
    const target = parseDetailKey(key);
    return runtime
      .atom(
        followStreamInEnvironment(
          target.environmentId,
          Stream.unwrap(
            makeMissionDetailState(target.missionId).pipe(
              Effect.map((state) => SubscriptionRef.changes(state)),
            ),
          ),
        ),
        { initialValue: EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE },
      )
      .pipe(
        Atom.setIdleTTL(MISSION_STATE_IDLE_TTL_MS),
        Atom.withLabel(`environment-mission-detail:${key}`),
      );
  });

  return {
    boardStateAtom: (target: {
      readonly environmentId: EnvironmentId;
      readonly projectId?: ProjectId;
    }) => boardFamily(boardKey(target.environmentId, target.projectId)),
    detailStateAtom: (target: {
      readonly environmentId: EnvironmentId;
      readonly missionId: MissionId;
    }) => detailFamily(detailKey(target.environmentId, target.missionId)),
  };
}

export function missionBoardSnapshotFromState<E>(
  result: AsyncResult.AsyncResult<EnvironmentMissionBoardState, E>,
): MissionBoardSnapshot | null {
  return Option.match(AsyncResult.value(result), {
    onNone: () => null,
    onSome: (state) => Option.getOrNull(state.snapshot),
  });
}

export function missionSummariesFromState<E>(
  result: AsyncResult.AsyncResult<EnvironmentMissionBoardState, E>,
): ReadonlyArray<MissionSummary> {
  return missionBoardSnapshotFromState(result)?.missions ?? [];
}
