import {
  ORCHESTRATION_WS_METHODS,
  type AgentRun,
  type EnvironmentId,
  type MissionBoardSnapshot,
  type MissionId,
  type MissionSummary,
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

function applyMissionEventToSnapshot(
  snapshot: OrchestrationMissionDetailSnapshot,
  event: OrchestrationEvent,
): OrchestrationMissionDetailSnapshot {
  let mission = snapshot.mission;
  let tasks = snapshot.tasks;
  let agentRuns = snapshot.agentRuns;

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
        updatedAt: event.payload.updatedAt,
      }));
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
    return runtime.atom(
      followStreamInEnvironment(
        target.environmentId,
        Stream.unwrap(
          makeMissionBoardState(target.projectId).pipe(
            Effect.map((state) => SubscriptionRef.changes(state)),
          ),
        ),
      ),
      { initialValue: EMPTY_ENVIRONMENT_MISSION_BOARD_STATE },
    );
  });
  const detailFamily = Atom.family((key: string) => {
    const target = parseDetailKey(key);
    return runtime.atom(
      followStreamInEnvironment(
        target.environmentId,
        Stream.unwrap(
          makeMissionDetailState(target.missionId).pipe(
            Effect.map((state) => SubscriptionRef.changes(state)),
          ),
        ),
      ),
      { initialValue: EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE },
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
