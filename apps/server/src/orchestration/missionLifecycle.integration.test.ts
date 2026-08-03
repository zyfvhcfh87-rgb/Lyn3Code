import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentRoleId,
  AgentRunId,
  CommandId,
  ManagedWorktreeId,
  MissionId,
  MissionAgentId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  VerificationProfileId,
  VerificationRunId,
  VerificationRepairAttemptId,
  VerificationCheckDefinitionId,
  VerificationGateId,
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

function recordPassingVerification(
  harness: MissionHarness,
  input: {
    readonly selectedTaskId?: MissionTaskId;
    readonly worktreeId?: ManagedWorktreeId | null;
    readonly agentRunId?: AgentRunId;
    readonly suffix?: string;
    readonly completedAt?: string;
  } = {},
) {
  const suffix = input.suffix ?? "default";
  const completedAt = input.completedAt ?? "2026-08-03T00:00:07.000Z";
  const profileId = VerificationProfileId.make("standard");
  const sourceFingerprint = `source-fingerprint-${suffix}`;
  const source = {
    worktreeRoot: `/tmp/verification-${suffix}`,
    branchName: `agent/mission/${suffix}`,
    commitHash: "1111111111111111111111111111111111111111",
    dirtyStateFingerprint: null,
    sourceFingerprint,
  } as const;
  const environment = {
    platform: "win32",
    architecture: "x64",
    runtimeVersions: {},
    continuousIntegration: false,
  } as const;
  const configurationRevision = `configuration-revision-${suffix}`;
  const configurationDigest = `configuration-digest-${suffix}`;
  return dispatchCommand(harness, {
    type: "verification.run.record",
    commandId: commandId(`command-verification-passed-${suffix}`),
    action: "passed",
    occurredAt: completedAt,
    run: {
      id: VerificationRunId.make(`verification-run-${suffix}`),
      projectId,
      missionId,
      taskId: input.selectedTaskId ?? taskId,
      worktreeId: input.worktreeId ?? null,
      agentRunId: input.agentRunId ?? firstRunId,
      profileId,
      requestedBy: "test",
      trigger: "task_completion",
      authorizationScope: "full_profile",
      sourceVerificationRunId: null,
      status: "passed",
      configurationRevision,
      configurationDigest,
      branchName: source.branchName,
      commitHash: source.commitHash,
      dirtyStateFingerprint: null,
      sourceFingerprint,
      changedFilesSnapshot: [],
      environmentSnapshot: environment,
      executionPlan: {
        version: 1,
        profileId,
        profileName: "Standard",
        configurationPath: "/tmp/t3.json",
        configurationRevision,
        configurationDigest,
        source,
        changedFiles: [],
        environment,
        gates: [],
        skippedChecks: [],
        createdAt: "2026-08-03T00:00:06.500Z",
      },
      startedAt: "2026-08-03T00:00:06.500Z",
      completedAt,
      cancelledAt: null,
      result: "passed",
      failureSummary: null,
      invalidatedAt: null,
      invalidationReason: null,
      createdAt: "2026-08-03T00:00:06.500Z",
    },
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
  it.effect("holds implementation completion for evidence-backed verification", () =>
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
        providerSessionId: "provider-session-run-1",
        startedAt: "2026-08-03T00:00:05.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-run-complete"),
        missionId,
        agentRunId: firstRunId,
        requiresVerification: true,
        completedAt: "2026-08-03T00:00:06.000Z",
      });

      expect(harness.events.slice(-4).map((event) => event.type)).toEqual([
        "agent_run.running",
        "agent_run.completed",
        "task.implementation-completed",
        "mission.updated",
      ]);
      expect(harness.model.missions?.[0]?.status).toBe("verification");
      expect(harness.model.missionTasks?.[0]?.status).toBe("verification");

      harness = yield* recordPassingVerification(harness);
      expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
        "verification.passed",
        "task.completed",
        "mission.completed",
      ]);
      expect(harness.events.map((event) => event.sequence)).toEqual(
        harness.events.map((_, index) => index + 1),
      );
      expect(harness.model.missions?.[0]?.status).toBe("completed");
      expect(harness.model.missionTasks?.[0]?.status).toBe("completed");
      expect(harness.model.agentRuns?.[0]?.status).toBe("completed");
      expect(harness.model.agentRuns?.[0]?.providerSessionId).toBe("provider-session-run-1");

      const linkedThreadDeletion = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: harness.model,
          command: {
            type: "thread.delete",
            commandId: commandId("command-delete-mission-thread"),
            threadId: ThreadId.make("mission-thread-first"),
          },
        }),
      );
      expect(linkedThreadDeletion.message).toContain("retained as mission run");

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

  it.effect("preserves Phase 2 completion when verification is not configured", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-phase-two-compatible-complete"),
        missionId,
        agentRunId: firstRunId,
        completedAt: "2026-08-03T00:00:06.500Z",
      });

      expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
        "agent_run.completed",
        "task.completed",
        "mission.completed",
      ]);
      expect(harness.model.missions?.[0]?.status).toBe("completed");
      expect(harness.model.missionTasks?.[0]?.status).toBe("completed");
    }),
  );

  it.effect("records an explicit configuration failure for an unresolvable request", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* dispatchCommand(harness, {
        type: "verification.request.reject",
        commandId: commandId("command-verification-request-rejected"),
        projectId,
        missionId,
        taskId,
        failureCategory: "configuration_error",
        summary: "The accepted verification profile no longer exists.",
        occurredAt: "2026-08-03T00:00:06.750Z",
      });

      expect(harness.events.at(-1)?.type).toBe("verification.request_failed");
      expect(harness.events.at(-1)?.payload).toMatchObject({
        taskId,
        failureCategory: "configuration_error",
        summary: "The accepted verification profile no longer exists.",
      });
    }),
  );

  it.effect("records an explicit failed-gate rerun scope without broadening it", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      const sourceVerificationRunId = VerificationRunId.make("verification-run-failed-source");
      const gateId = VerificationGateId.make("verification-gate-typecheck");
      harness = yield* dispatchCommand(harness, {
        type: "verification.request",
        commandId: commandId("command-verification-rerun-gate"),
        projectId,
        missionId,
        taskId,
        worktreeId: null,
        profileId: null,
        requestedBy: "test",
        trigger: "retry_failed_gate",
        scope: { kind: "failed_gate", sourceVerificationRunId, gateId },
        requestedAt: "2026-08-03T00:00:06.800Z",
      });

      expect(harness.events.at(-1)?.type).toBe("verification.requested");
      expect(harness.events.at(-1)?.payload).toMatchObject({
        trigger: "retry_failed_gate",
        scope: { kind: "failed_gate", sourceVerificationRunId, gateId },
      });
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
        providerSessionId: "provider-session-cancel-1",
        startedAt: "2026-08-03T00:01:00.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.cancel",
        commandId: commandId("command-cancel-request"),
        missionId,
        createdAt: "2026-08-03T00:01:01.000Z",
      });

      expect(harness.events.slice(-3).map((event) => event.type)).toEqual([
        "mission.cancellation-requested",
        "agent_run.cancellation-requested",
        "mission.cancelled",
      ]);
      expect(harness.model.missions?.[0]?.status).toBe("cancelled");
      expect(harness.model.agentRuns?.[0]?.status).toBe("cancelling");

      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.cancel",
        commandId: commandId("command-cancel-confirm"),
        missionId,
        agentRunId: firstRunId,
        cancelledAt: "2026-08-03T00:01:02.000Z",
      });
      expect(harness.events.slice(-2).map((event) => event.type)).toEqual([
        "agent_run.cancelled",
        "task.cancelled",
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

  it.effect("invalidates stale evidence and refuses a skipped required check", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-invalidation-implementation-complete"),
        missionId,
        agentRunId: firstRunId,
        requiresVerification: true,
        completedAt: "2026-08-03T00:00:10.000Z",
      });
      harness = yield* recordPassingVerification(harness, {
        suffix: "invalidation",
        completedAt: "2026-08-03T00:00:11.000Z",
      });
      const passed = harness.events.find(
        (event): event is Extract<OrchestrationEvent, { type: "verification.passed" }> =>
          event.type === "verification.passed",
      );
      expect(passed).toBeDefined();
      if (passed === undefined) return;

      harness = yield* dispatchCommand(harness, {
        type: "verification.run.record",
        commandId: commandId("command-verification-invalidated"),
        action: "invalidated",
        occurredAt: "2026-08-03T00:00:12.000Z",
        run: {
          ...passed.payload.run,
          status: "invalidated",
          invalidatedAt: "2026-08-03T00:00:12.000Z",
          invalidationReason: "The assigned worktree source fingerprint changed.",
        },
      });
      expect(harness.model.missions?.[0]?.status).toBe("verification");
      expect(harness.model.missionTasks?.[0]?.status).toBe("verification");

      const skippedRequired = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: harness.model,
          command: {
            type: "verification.run.record",
            commandId: commandId("command-skipped-required-false-pass"),
            action: "passed",
            occurredAt: "2026-08-03T00:00:13.000Z",
            run: {
              ...passed.payload.run,
              id: VerificationRunId.make("verification-run-skipped-required"),
              executionPlan: {
                ...passed.payload.run.executionPlan,
                skippedChecks: [
                  {
                    checkDefinitionId:
                      passed.payload.run.executionPlan.gates[0]?.checks[0]?.checkDefinitionId ??
                      VerificationCheckDefinitionId.make("required-check"),
                    gateId:
                      passed.payload.run.executionPlan.gates[0]?.gateId ??
                      VerificationGateId.make("required-gate"),
                    name: "Required check",
                    reason: "Heuristic claimed it was irrelevant.",
                    required: true,
                    explicitlyNotApplicable: false,
                    selectionSource: "explicit_configuration",
                  },
                ],
              },
              status: "passed",
              invalidatedAt: null,
              invalidationReason: null,
            },
          },
        }),
      );
      expect(skippedRequired.message).toContain("cannot authorize");
    }),
  );

  it.effect("records provider failure during cancellation without reopening the mission", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      harness = yield* startMission(harness);
      harness = yield* dispatchCommand(harness, {
        type: "mission.cancel",
        commandId: commandId("command-cancel-before-failure"),
        missionId,
        createdAt: "2026-08-03T00:01:10.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.fail",
        commandId: commandId("command-cancel-provider-failure"),
        missionId,
        agentRunId: firstRunId,
        errorSummary: "Provider failed while stopping.",
        failedAt: "2026-08-03T00:01:11.000Z",
      });

      expect(harness.model.missions?.[0]?.status).toBe("cancelled");
      expect(harness.model.agentRuns?.[0]?.status).toBe("failed");
      expect(harness.model.missionTasks?.[0]?.status).toBe("failed");
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
        requiresVerification: true,
        completedAt: "2026-08-03T00:04:00.000Z",
      });
      harness = yield* recordPassingVerification(harness, {
        suffix: "terminal",
        completedAt: "2026-08-03T00:04:01.000Z",
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

  it.effect("runs isolated Phase 2 tasks concurrently and cancels only the targeted task", () =>
    Effect.gen(function* () {
      let harness = yield* seedMission();
      const secondTaskId = MissionTaskId.make("mission-task-integration-second");
      const firstAgentId = MissionAgentId.make("mission-agent-first");
      const secondAgentId = MissionAgentId.make("mission-agent-second");
      const firstWorktreeId = ManagedWorktreeId.make("mission-worktree-first");
      const secondWorktreeId = ManagedWorktreeId.make("mission-worktree-second");
      const secondRunId = AgentRunId.make("mission-run-second");
      const agentRoleId = AgentRoleId.make("built-in:implementer");

      harness = yield* dispatchCommand(harness, {
        type: "mission.team.configure",
        commandId: commandId("command-team-automatic-integration"),
        missionId,
        settings: {
          maximumConcurrentAgents: 3,
          maximumConcurrentWriteAgents: 2,
          defaultMaximumTaskAttempts: 3,
          autoStartReadyTasks: false,
          integrationMode: "automatic_when_clean",
        },
        updatedAt: "2026-08-03T00:06:59.000Z",
      });

      harness = yield* dispatchCommand(harness, {
        type: "mission.task.create",
        commandId: commandId("command-task-create-second"),
        missionId,
        taskId: secondTaskId,
        title: "Run the other agent",
        description: "Prove independent tasks can overlap safely.",
        position: 1,
        createdAt: "2026-08-03T00:07:00.000Z",
      });
      for (const [agentId, displayName] of [
        [firstAgentId, "Implementer one"],
        [secondAgentId, "Implementer two"],
      ] as const) {
        harness = yield* dispatchCommand(harness, {
          type: "mission.agent.upsert",
          commandId: commandId(`command-agent-${agentId}`),
          missionId,
          agent: {
            id: agentId,
            missionId,
            roleId: agentRoleId,
            roleKind: "implementer",
            displayName,
            providerInstanceId,
            model: "gpt-5.4",
            reasoningLevel: null,
            permissions: ["read_files", "search_repository", "run_tests", "write_files"],
            maximumConcurrentRuns: 1,
            status: "idle",
            createdAt: "2026-08-03T00:07:01.000Z",
            updatedAt: "2026-08-03T00:07:01.000Z",
          },
        });
      }
      for (const [worktreeId, ownedTaskId, suffix] of [
        [firstWorktreeId, taskId, "first"],
        [secondWorktreeId, secondTaskId, "second"],
      ] as const) {
        harness = yield* dispatchCommand(harness, {
          type: "mission.worktree.record",
          commandId: commandId(`command-worktree-${suffix}`),
          missionId,
          worktree: {
            id: worktreeId,
            projectId,
            missionId,
            taskId: ownedTaskId,
            purpose: "task",
            repositoryPath: "/tmp/mission-integration",
            worktreePath: `/tmp/mission-integration-worktrees/${suffix}`,
            branchName: `agent/mission/${suffix}`,
            baseBranch: "main",
            baseCommit: "1111111111111111111111111111111111111111",
            headCommit: "1111111111111111111111111111111111111111",
            status: "ready",
            changedFileCount: 0,
            hasUncommittedChanges: false,
            conflictingFiles: [],
            createdAt: "2026-08-03T00:07:02.000Z",
            updatedAt: "2026-08-03T00:07:02.000Z",
            removedAt: null,
            errorSummary: null,
          },
        });
      }

      const startTask = (
        selectedTaskId: MissionTaskId,
        agentId: MissionAgentId,
        worktreeId: ManagedWorktreeId,
        selectedRunId: AgentRunId,
      ) =>
        dispatchCommand(harness, {
          type: "mission.start",
          commandId: commandId(`command-start-${selectedRunId}`),
          missionId,
          taskId: selectedTaskId,
          agentRunId: selectedRunId,
          threadId: ThreadId.make(`thread-${selectedRunId}`),
          providerInstanceId,
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
          runtimeMode: "auto-accept-edits",
          missionAgentId: agentId,
          worktreeId,
          permissions: ["read_files", "search_repository", "run_tests", "write_files"],
          writeCapable: true,
          createdAt: "2026-08-03T00:07:03.000Z",
        });
      harness = yield* startTask(taskId, firstAgentId, firstWorktreeId, firstRunId);
      harness = yield* startTask(secondTaskId, secondAgentId, secondWorktreeId, secondRunId);

      expect(harness.model.agentRuns?.filter((run) => run.status === "starting")).toHaveLength(2);
      expect(new Set(harness.model.agentRuns?.map((run) => run.worktreeId)).size).toBe(2);
      expect(harness.model.missionAgents?.every((agent) => agent.status === "running")).toBe(true);

      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-phase-two-first-complete"),
        missionId,
        agentRunId: firstRunId,
        requiresVerification: true,
        completedAt: "2026-08-03T00:07:04.000Z",
      });
      expect(harness.model.missions?.[0]?.status).toBe("running");
      expect(harness.model.missionTasks?.find((task) => task.id === taskId)?.status).toBe(
        "verification",
      );
      const repairRunId = AgentRunId.make("mission-run-phase-two-repair");
      harness = yield* dispatchCommand(harness, {
        type: "mission.start",
        commandId: commandId("command-phase-two-repair-start"),
        missionId,
        taskId,
        agentRunId: repairRunId,
        threadId: ThreadId.make("thread-phase-two-repair"),
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
        runtimeMode: "auto-accept-edits",
        missionAgentId: firstAgentId,
        worktreeId: firstWorktreeId,
        permissions: ["read_files", "search_repository", "run_tests", "write_files"],
        writeCapable: true,
        purpose: "verification_repair",
        repairAttemptId: VerificationRepairAttemptId.make("repair-attempt-phase-two"),
        createdAt: "2026-08-03T00:07:04.100Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.complete",
        commandId: commandId("command-phase-two-repair-complete"),
        missionId,
        agentRunId: repairRunId,
        completedAt: "2026-08-03T00:07:04.200Z",
      });
      expect(harness.model.missionTasks?.find((task) => task.id === taskId)?.status).toBe(
        "verification",
      );
      expect(harness.events.at(-2)?.type).toBe("agent_run.completed");
      harness = yield* recordPassingVerification(harness, {
        worktreeId: firstWorktreeId,
        suffix: "phase-two-first",
        completedAt: "2026-08-03T00:07:04.250Z",
      });
      expect(
        harness.model.managedWorktrees?.find((worktree) => worktree.id === firstWorktreeId)?.status,
      ).toBe("integration_ready");
      expect(harness.model.missionAgents?.find((agent) => agent.id === firstAgentId)?.status).toBe(
        "idle",
      );

      harness = yield* dispatchCommand(harness, {
        type: "mission.integration.request",
        commandId: commandId("command-phase-two-first-integration-request"),
        missionId,
        taskId,
        worktreeId: firstWorktreeId,
        requestedAt: "2026-08-03T00:07:04.500Z",
      });
      expect(harness.events.at(-1)?.type).toBe("integration.approved");
      expect(
        harness.model.missionTasks?.find((task) => task.id === taskId)?.integrationStatus,
      ).toBe("ready");

      harness = yield* dispatchCommand(harness, {
        type: "mission.task.cancel",
        commandId: commandId("command-phase-two-second-cancel-request"),
        missionId,
        taskId: secondTaskId,
        requestedAt: "2026-08-03T00:07:05.000Z",
      });
      harness = yield* dispatchCommand(harness, {
        type: "mission.agent-run.cancel",
        commandId: commandId("command-phase-two-second-cancelled"),
        missionId,
        agentRunId: secondRunId,
        cancelledAt: "2026-08-03T00:07:06.000Z",
      });

      expect(harness.model.missions?.[0]?.status).toBe("running");
      expect(harness.model.missionTasks?.find((task) => task.id === taskId)?.status).toBe(
        "completed",
      );
      expect(harness.model.missionTasks?.find((task) => task.id === secondTaskId)?.status).toBe(
        "cancelled",
      );
      expect(harness.model.missionAgents?.find((agent) => agent.id === secondAgentId)?.status).toBe(
        "idle",
      );
    }),
  );
});
