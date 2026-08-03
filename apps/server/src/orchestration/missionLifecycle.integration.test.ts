import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentRunId,
  CommandId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

interface MissionHarness {
  readonly model: OrchestrationReadModel;
  readonly events: ReadonlyArray<OrchestrationEvent>;
}

const projectId = ProjectId.make("project-mission-integration");
const missionId = MissionId.make("mission-integration");
const taskId = MissionTaskId.make("mission-task-integration");
const firstRunId = AgentRunId.make("mission-run-first");
const providerInstanceId = ProviderInstanceId.make("codex");

function commandId(value: string) {
  return CommandId.make(value);
}

function dispatchCommand(harness: MissionHarness, command: OrchestrationCommand) {
  return Effect.gen(function* () {
    const decided = yield* decideOrchestrationCommand({ command, readModel: harness.model });
    const plannedEvents = Array.isArray(decided) ? decided : [decided];
    let model = harness.model;
    const events = [...harness.events];

    for (const plannedEvent of plannedEvents) {
      const event = {
        ...plannedEvent,
        sequence: model.snapshotSequence + 1,
      } satisfies OrchestrationEvent;
      model = yield* projectEvent(model, event);
      events.push(event);
    }

    return { model, events } satisfies MissionHarness;
  });
}

function seedMission() {
  return Effect.gen(function* () {
    let harness: MissionHarness = {
      model: createEmptyReadModel("2026-08-03T00:00:00.000Z"),
      events: [],
    };
    harness = yield* dispatchCommand(harness, {
      type: "project.create",
      commandId: commandId("command-project-create"),
      projectId,
      title: "Mission integration",
      workspaceRoot: "/tmp/mission-integration",
      defaultModelSelection: null,
      createdAt: "2026-08-03T00:00:01.000Z",
    });
    harness = yield* dispatchCommand(harness, {
      type: "mission.create",
      commandId: commandId("command-mission-create"),
      missionId,
      projectId,
      title: "Exercise mission lifecycle",
      description: "Prove the Phase 1 state machine.",
      createdAt: "2026-08-03T00:00:02.000Z",
    });
    return yield* dispatchCommand(harness, {
      type: "mission.task.create",
      commandId: commandId("command-task-create"),
      missionId,
      taskId,
      title: "Run one agent",
      description: "Complete the mission with one provider session.",
      position: 0,
      createdAt: "2026-08-03T00:00:03.000Z",
    });
  });
}

function startMission(
  harness: MissionHarness,
  input: {
    readonly commandType?: "mission.start" | "mission.retry";
    readonly runId?: AgentRunId;
    readonly threadId?: ThreadId;
    readonly createdAt?: string;
  } = {},
) {
  const runId = input.runId ?? firstRunId;
  return dispatchCommand(harness, {
    type: input.commandType ?? "mission.start",
    commandId: commandId(`command-${runId}`),
    missionId,
    taskId,
    agentRunId: runId,
    threadId: input.threadId ?? ThreadId.make("mission-thread-first"),
    providerInstanceId,
    modelSelection: {
      instanceId: providerInstanceId,
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    createdAt: input.createdAt ?? "2026-08-03T00:00:04.000Z",
  });
}

function assertTerminalTaskMutationsRejected(harness: MissionHarness, suffix: string) {
  return Effect.gen(function* () {
    const newTask = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: harness.model,
        command: {
          type: "mission.task.create",
          commandId: commandId(`command-terminal-task-create-${suffix}`),
          missionId,
          taskId: MissionTaskId.make(`mission-terminal-task-${suffix}`),
          title: "Late task",
          description: "Must not mutate a terminal mission.",
          position: 1,
          createdAt: "2026-08-03T00:04:00.000Z",
        },
      }),
    );
    expect(newTask.message).toContain("terminal");

    const taskUpdate = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: harness.model,
        command: {
          type: "mission.task.update",
          commandId: commandId(`command-terminal-task-update-${suffix}`),
          missionId,
          taskId,
          title: "Late mutation",
          updatedAt: "2026-08-03T00:04:01.000Z",
        },
      }),
    );
    expect(taskUpdate.message).toContain("terminal");
  });
}

it.layer(NodeServices.layer)("mission lifecycle integration", (it) => {
  it.effect("orders a complete single-agent lifecycle and projects terminal state", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
        "mission.started",
        "task.started",
        "agent_run.started",
      ]);

      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.mark-running",
        commandId: commandId("command-run-running"),
        missionId,
        agentRunId: firstRunId,
        startedAt: "2026-08-03T00:00:05.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-run-complete"),
        missionId,
        agentRunId: firstRunId,
        completedAt: "2026-08-03T00:00:06.000Z",
      });

      expect(harness.events.slice(-4).map((event) => event.type)).toEqual([
        "agent_run.running",
        "agent_run.completed",
        "task.completed",
        "mission.completed",
      ]);
      expect(harness.events.map((event) => event.sequence)).toEqual(
        harness.events.map((_, index) => index + 1),
      );
      expect(harness.model.missions?.[0]?.status).toBe("completed");
      expect(harness.model.missionTasks?.[0]?.status).toBe("completed");
      expect(harness.model.agentRuns?.[0]?.status).toBe("completed");

      const duplicate = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: harness.model,
          command: {
            type: "mission.agent-run.complete",
            commandId: commandId("command-run-complete-duplicate"),
            missionId,
            agentRunId: firstRunId,
            completedAt: "2026-08-03T00:00:07.000Z",
          },
        }),
      );
      expect(duplicate.message).toContain("cannot transition from 'completed' to 'completed'");
    }),
  );

  it.effect("keeps cancellation distinct from completion and rejects a late completion", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.mark-running",
        commandId: commandId("command-cancel-run-running"),
        missionId,
        agentRunId: firstRunId,
        startedAt: "2026-08-03T00:01:00.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.cancel",
        commandId: commandId("command-cancel-request"),
        missionId,
        createdAt: "2026-08-03T00:01:01.000Z",
      });

      expect(harness.events.slice(-2).map((event) => event.type)).toEqual([
        "mission.cancellation-requested",
        "agent_run.cancellation-requested",
      ]);
      expect(harness.model.missions?.[0]?.status).toBe("running");
      expect(harness.model.agentRuns?.[0]?.status).toBe("cancelling");

      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.cancel",
        commandId: commandId("command-cancel-confirm"),
        missionId,
        agentRunId: firstRunId,
        cancelledAt: "2026-08-03T00:01:02.000Z",
      });
      expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
        "agent_run.cancelled",
        "task.cancelled",
        "mission.cancelled",
      ]);
      expect(harness.model.missions?.[0]?.status).toBe("cancelled");
      expect(harness.model.missionTasks?.[0]?.status).toBe("cancelled");
      expect(harness.model.agentRuns?.[0]?.status).toBe("cancelled");

      const lateCompletion = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: harness.model,
          command: {
            type: "mission.agent-run.complete",
            commandId: commandId("command-late-completion"),
            missionId,
            agentRunId: firstRunId,
            completedAt: "2026-08-03T00:01:03.000Z",
          },
        }),
      );
      expect(lateCompletion.message).toContain("cannot transition from 'cancelled' to 'completed'");
    }),
  );

  it.effect(
    "records provider failure and permits an explicit retry without rewriting history",
    () =>
      Effect.gen(function* () {
        let harness = yield* seedMission();
        harness = yield* startMission(harness);
        harness = yield* dispatchCommand(harness, {
          type: "mission.agent-run.fail",
          commandId: commandId("command-run-fail"),
          missionId,
          agentRunId: firstRunId,
          errorSummary: "Provider exited before completing the turn.",
          failedAt: "2026-08-03T00:02:00.000Z",
        });

        expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
          "agent_run.failed",
          "task.failed",
          "mission.failed",
        ]);
        expect(harness.model.agentRuns?.[0]?.errorSummary).toBe(
          "Provider exited before completing the turn.",
        );

        const retryRunId = AgentRunId.make("mission-run-retry");
        harness = yield* startMission(harness, {
          commandType: "mission.retry",
          runId: retryRunId,
          threadId: ThreadId.make("mission-thread-retry"),
          createdAt: "2026-08-03T00:02:01.000Z",
        });

        expect(harness.model.missions?.[0]?.status).toBe("running");
        expect(harness.model.missionTasks?.[0]?.status).toBe("running");
        expect(harness.model.agentRuns?.map((run) => [run.id, run.status])).toEqual([
          [firstRunId, "failed"],
          [retryRunId, "starting"],
        ]);
      }),
  );

  it.effect("projects interrupted restart recovery deterministically and remains retryable", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.interrupt",
        commandId: commandId("command-restart-interrupt"),
        missionId,
        agentRunId: firstRunId,
        reason: "Server restarted while the provider run was active.",
        interruptedAt: "2026-08-03T00:03:00.000Z",
      });

      expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
        "agent_run.interrupted",
        "task.updated",
        "mission.recovery-blocked",
      ]);
      expect(harness.model.missions?.[0]?.status).toBe("blocked");
      expect(harness.model.missionTasks?.[0]?.status).toBe("blocked");
      expect(harness.model.agentRuns?.[0]?.status).toBe("interrupted");

      const retryRunId = AgentRunId.make("mission-run-after-restart");
      harness = yield* startMission(harness, {
        commandType: "mission.retry",
        runId: retryRunId,
        threadId: ThreadId.make("mission-thread-after-restart"),
        createdAt: "2026-08-03T00:03:01.000Z",
      });
      expect(harness.model.missions?.[0]?.status).toBe("running");
      expect(harness.model.agentRuns?.at(-1)?.id).toBe(retryRunId);
    }),
  );

  it.effect("rejects task creation and updates after mission completion", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-terminal-complete"),
        missionId,
        agentRunId: firstRunId,
        completedAt: "2026-08-03T00:04:00.000Z",
      });

      expect(harness.model.missions?.[0]?.status).toBe("completed");
      yield* assertTerminalTaskMutationsRejected(harness, "completed");
      expect(harness.model.missionTasks).toHaveLength(1);
      expect(harness.model.missionTasks?.[0]?.status).toBe("completed");
    }),
  );

  it.effect("rejects task creation and updates after mission cancellation", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.cancel",
        commandId: commandId("command-terminal-cancel-request"),
        missionId,
        createdAt: "2026-08-03T00:05:00.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.cancel",
        commandId: commandId("command-terminal-cancel"),
        missionId,
        agentRunId: firstRunId,
        cancelledAt: "2026-08-03T00:05:01.000Z",
      });

      expect(harness.model.missions?.[0]?.status).toBe("cancelled");
      yield* assertTerminalTaskMutationsRejected(harness, "cancelled");
      expect(harness.model.missionTasks).toHaveLength(1);
      expect(harness.model.missionTasks?.[0]?.status).toBe("cancelled");
    }),
  );

  it.effect("rejects mismatched run and model provider instances", () =>
    Effect.gen(function* () {
      const harness = yield* seedMission();
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: harness.model,
          command: {
            type: "mission.start",
            commandId: commandId("command-provider-mismatch"),
            missionId,
            taskId,
            agentRunId: AgentRunId.make("mission-run-provider-mismatch"),
            threadId: ThreadId.make("mission-thread-provider-mismatch"),
            providerInstanceId,
            modelSelection: {
              instanceId: ProviderInstanceId.make("claude"),
              model: "claude-opus-4-1",
            },
            runtimeMode: "full-access",
            createdAt: "2026-08-03T00:06:00.000Z",
          },
        }),
      );

      expect(error.message).toContain(
        "Agent-run provider instance must match the selected model provider instance",
      );
      expect(harness.model.missions?.[0]?.status).toBe("backlog");
      expect(harness.model.agentRuns).toHaveLength(0);
    }),
  );
});
