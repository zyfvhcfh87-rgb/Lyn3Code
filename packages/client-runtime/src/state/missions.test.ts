import { describe, expect, it } from "vite-plus/test";

import {
  AgentRunId,
  DEFAULT_MISSION_TEAM_SETTINGS,
  EventId,
  ManagedWorktreeId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentRun,
  type Mission,
  type MissionBoardSnapshot,
  type MissionTask,
  type OrchestrationEvent,
  type OrchestrationMissionDetailSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  applyMissionBoardStreamItem,
  applyMissionDetailStreamItem,
  EMPTY_ENVIRONMENT_MISSION_BOARD_STATE,
  EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE,
} from "./missions.ts";

const NOW = "2026-08-03T12:00:00.000Z";
const missionId = MissionId.make("mission-1");
const projectId = ProjectId.make("project-1");
const taskId = MissionTaskId.make("task-1");
const agentRunId = AgentRunId.make("run-1");

const mission: Mission = {
  id: missionId,
  projectId,
  title: "Mission one",
  description: "A persisted mission",
  status: "ready",
  createdAt: NOW,
  updatedAt: NOW,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  teamSettings: DEFAULT_MISSION_TEAM_SETTINGS,
  schedulerStatus: "idle",
};

const task: MissionTask = {
  id: taskId,
  missionId,
  title: "Task one",
  description: "Do the thing",
  status: "ready",
  position: 0,
  createdAt: NOW,
  updatedAt: NOW,
  startedAt: null,
  completedAt: null,
  assignedMissionAgentId: null,
  worktreeId: null,
  attemptCount: 0,
  maximumAttempts: 3,
  readyAt: null,
  blockedReason: null,
  integrationStatus: "not_requested",
  requiresDependencyHandoffs: true,
};

const agentRun: AgentRun = {
  id: agentRunId,
  missionId,
  taskId,
  threadId: ThreadId.make("thread-1"),
  provider: "codex",
  providerInstanceId: ProviderInstanceId.make("provider-instance-1"),
  providerSessionId: null,
  missionAgentId: null,
  worktreeId: null,
  attemptNumber: 1,
  permissions: ["read_files", "search_repository", "run_safe_commands", "run_tests"],
  writeCapable: false,
  status: "starting",
  createdAt: NOW,
  startedAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  errorSummary: null,
};

const boardSnapshot: MissionBoardSnapshot = {
  snapshotSequence: 4,
  projectId: null,
  missions: [
    {
      mission,
      taskProgress: { total: 1, completed: 0 },
      activeAgentRun: null,
      activeAgentRuns: [],
      latestAgentRun: null,
    },
  ],
  updatedAt: NOW,
};

const detailSnapshot: OrchestrationMissionDetailSnapshot = {
  snapshotSequence: 4,
  mission,
  tasks: [task],
  agentRuns: [],
  agentRoles: [],
  missionAgents: [],
  taskDependencies: [],
  managedWorktrees: [],
  agentHandoffs: [],
  events: [],
};

function missionEvent(
  event: Pick<OrchestrationEvent, "sequence" | "type" | "payload">,
): OrchestrationEvent {
  return {
    sequence: event.sequence,
    eventId: EventId.make(`event-${event.sequence}`),
    aggregateKind: "mission",
    aggregateId: missionId,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: event.type,
    payload: event.payload,
  } as OrchestrationEvent;
}

describe("mission stream reducers", () => {
  it("hydrates the board, marks synchronization complete, and ignores stale updates", () => {
    const hydrated = applyMissionBoardStreamItem(EMPTY_ENVIRONMENT_MISSION_BOARD_STATE, {
      kind: "snapshot",
      snapshot: boardSnapshot,
    });
    const live = applyMissionBoardStreamItem(hydrated, { kind: "synchronized" });
    const stale = applyMissionBoardStreamItem(live, {
      kind: "mission-upserted",
      sequence: 4,
      summary: {
        ...boardSnapshot.missions[0]!,
        mission: { ...mission, title: "Stale title" },
      },
    });

    expect(live.status).toBe("live");
    expect(stale).toBe(live);
    expect(Option.getOrThrow(stale.snapshot).missions[0]?.mission.title).toBe("Mission one");
  });

  it("applies only task patch fields and keeps event ordering sequence-authoritative", () => {
    const hydrated = applyMissionDetailStreamItem(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE, {
      kind: "snapshot",
      snapshot: detailSnapshot,
    });
    const updated = applyMissionDetailStreamItem(hydrated, {
      kind: "event",
      event: missionEvent({
        sequence: 5,
        type: "task.updated",
        payload: {
          missionId,
          taskId,
          title: "Renamed task",
          status: "blocked",
          updatedAt: NOW,
        },
      }),
    });
    const duplicate = applyMissionDetailStreamItem(updated, {
      kind: "event",
      event: missionEvent({
        sequence: 5,
        type: "task.updated",
        payload: { missionId, taskId, title: "Duplicate", updatedAt: NOW },
      }),
    });
    const updatedTask = Option.getOrThrow(updated.snapshot).tasks[0]!;

    expect(updatedTask.title).toBe("Renamed task");
    expect(updatedTask.status).toBe("blocked");
    expect((updatedTask as unknown as Record<string, unknown>).projectId).toBeUndefined();
    expect(duplicate).toBe(updated);
    expect(Option.getOrThrow(duplicate.snapshot).events).toHaveLength(1);
  });

  it("projects honest task cancellation without marking completion", () => {
    const hydrated = applyMissionDetailStreamItem(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE, {
      kind: "snapshot",
      snapshot: detailSnapshot,
    });
    const cancelled = applyMissionDetailStreamItem(hydrated, {
      kind: "event",
      event: missionEvent({
        sequence: 5,
        type: "task.cancelled",
        payload: { missionId, taskId, agentRunId, occurredAt: NOW },
      }),
    });
    const cancelledTask = Option.getOrThrow(cancelled.snapshot).tasks[0]!;

    expect(cancelledTask.status).toBe("cancelled");
    expect(cancelledTask.completedAt).toBeNull();
  });

  it("uses the latest task start time when a failed task is retried", () => {
    const firstStartedAt = "2026-08-03T12:01:00.000Z";
    const retryStartedAt = "2026-08-03T12:02:00.000Z";
    const hydrated = applyMissionDetailStreamItem(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE, {
      kind: "snapshot",
      snapshot: {
        ...detailSnapshot,
        tasks: [{ ...task, status: "failed", startedAt: firstStartedAt }],
      },
    });
    const retried = applyMissionDetailStreamItem(hydrated, {
      kind: "event",
      event: {
        ...missionEvent({
          sequence: 5,
          type: "task.started",
          payload: { missionId, taskId, agentRunId, occurredAt: retryStartedAt },
        }),
        occurredAt: retryStartedAt,
      },
    });

    expect(Option.getOrThrow(retried.snapshot).tasks[0]?.startedAt).toBe(retryStartedAt);
  });

  it("projects team settings, scheduler state, and task readiness from live events", () => {
    const hydrated = applyMissionDetailStreamItem(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE, {
      kind: "snapshot",
      snapshot: detailSnapshot,
    });
    const configured = applyMissionDetailStreamItem(hydrated, {
      kind: "event",
      event: missionEvent({
        sequence: 5,
        type: "mission.team-configured",
        payload: {
          missionId,
          settings: {
            ...DEFAULT_MISSION_TEAM_SETTINGS,
            maximumConcurrentAgents: 4,
            autoStartReadyTasks: true,
          },
          updatedAt: NOW,
        },
      }),
    });
    const ready = applyMissionDetailStreamItem(configured, {
      kind: "event",
      event: missionEvent({
        sequence: 6,
        type: "task.ready",
        payload: { missionId, taskId, readyAt: NOW },
      }),
    });
    const scheduled = applyMissionDetailStreamItem(ready, {
      kind: "event",
      event: missionEvent({
        sequence: 7,
        type: "scheduler.started",
        payload: { missionId, status: "running", occurredAt: NOW },
      }),
    });
    const projected = Option.getOrThrow(scheduled.snapshot);

    expect(projected.mission.teamSettings.maximumConcurrentAgents).toBe(4);
    expect(projected.mission.teamSettings.autoStartReadyTasks).toBe(true);
    expect(projected.mission.schedulerStatus).toBe("running");
    expect(projected.tasks[0]).toMatchObject({ status: "ready", readyAt: NOW });
  });

  it("projects managed worktree conflict evidence and integration status", () => {
    const worktreeId = ManagedWorktreeId.make("worktree-1");
    const hydrated = applyMissionDetailStreamItem(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE, {
      kind: "snapshot",
      snapshot: detailSnapshot,
    });
    const recorded = applyMissionDetailStreamItem(hydrated, {
      kind: "event",
      event: missionEvent({
        sequence: 5,
        type: "managed_worktree.recorded",
        payload: {
          worktree: {
            id: worktreeId,
            projectId,
            missionId,
            taskId,
            purpose: "task",
            repositoryPath: "C:/repo",
            worktreePath: "C:/worktrees/task-1",
            branchName: "agent/mission/task-1",
            baseBranch: "main",
            baseCommit: "abc123",
            headCommit: null,
            status: "ready",
            changedFileCount: 0,
            hasUncommittedChanges: false,
            conflictingFiles: [],
            createdAt: NOW,
            updatedAt: NOW,
            removedAt: null,
            errorSummary: null,
          },
        },
      }),
    });
    const conflicted = applyMissionDetailStreamItem(recorded, {
      kind: "event",
      event: missionEvent({
        sequence: 6,
        type: "integration.conflicted",
        payload: {
          missionId,
          taskId,
          worktreeId,
          integrationStatus: "conflicted",
          conflictingFiles: ["src/app.ts"],
          occurredAt: NOW,
        },
      }),
    });
    const projected = Option.getOrThrow(conflicted.snapshot);

    expect(projected.tasks[0]?.integrationStatus).toBe("conflicted");
    expect(projected.managedWorktrees[0]).toMatchObject({
      id: worktreeId,
      conflictingFiles: ["src/app.ts"],
    });
  });

  it("projects provider session association and an explicit unlink from running events", () => {
    const hydrated = applyMissionDetailStreamItem(EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE, {
      kind: "snapshot",
      snapshot: { ...detailSnapshot, agentRuns: [agentRun] },
    });
    const linked = applyMissionDetailStreamItem(hydrated, {
      kind: "event",
      event: missionEvent({
        sequence: 5,
        type: "agent_run.running",
        payload: {
          missionId,
          taskId,
          agentRunId,
          providerSessionId: "provider-session-1",
          occurredAt: NOW,
        },
      }),
    });
    const unlinked = applyMissionDetailStreamItem(linked, {
      kind: "event",
      event: missionEvent({
        sequence: 6,
        type: "agent_run.running",
        payload: {
          missionId,
          taskId,
          agentRunId,
          providerSessionId: null,
          occurredAt: NOW,
        },
      }),
    });

    expect(Option.getOrThrow(linked.snapshot).agentRuns[0]?.providerSessionId).toBe(
      "provider-session-1",
    );
    expect(Option.getOrThrow(unlinked.snapshot).agentRuns[0]?.providerSessionId).toBeNull();
  });
});
