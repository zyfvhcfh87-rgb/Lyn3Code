import {
  AgentHandoffId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  AgentRunId,
  MessageId,
  MissionId,
  missionCancellationAgentRunIds,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type AgentRun,
  type ManagedWorktree,
  type MissionAgent,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ProjectionAgentRunRepository } from "../../persistence/Services/ProjectionAgentRuns.ts";
import { ProjectionMissionRepository } from "../../persistence/Services/ProjectionMissions.ts";
import { ProjectionMissionTaskRepository } from "../../persistence/Services/ProjectionMissionTasks.ts";
import { ProjectionMissionTeamRepository } from "../../persistence/Services/ProjectionMissionTeams.ts";
import { ProjectionAgentRunRepositoryLive } from "../../persistence/Layers/ProjectionAgentRuns.ts";
import { ProjectionMissionRepositoryLive } from "../../persistence/Layers/ProjectionMissions.ts";
import { ProjectionMissionTaskRepositoryLive } from "../../persistence/Layers/ProjectionMissionTasks.ts";
import { ProjectionMissionTeamRepositoryLive } from "../../persistence/Layers/ProjectionMissionTeams.ts";
import { MissionGitService } from "../../mission-git/MissionGitService.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { MissionRunReactor, type MissionRunReactorShape } from "../Services/MissionRunReactor.ts";

type MissionRunDomainEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "agent_run.started"
      | "mission.cancellation-requested"
      | "task.cancellation-requested"
      | "thread.session-set";
  }
>;

type MissionRunRuntimeEvent = Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
type MissionRunEvent = MissionRunDomainEvent | MissionRunRuntimeEvent;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const commandId = (runId: string, action: string) =>
  CommandId.make(`server:mission:${runId}:${action}`);

const formatMissionPrompt = (input: {
  readonly projectId: string;
  readonly missionId: string;
  readonly missionTitle: string;
  readonly missionDescription: string;
  readonly taskId: string | null;
  readonly taskTitle: string | null;
  readonly taskDescription: string | null;
  readonly role: string | null;
  readonly permissions: ReadonlyArray<string>;
  readonly worktreePath: string | null;
  readonly dependencyHandoffs: ReadonlyArray<string>;
}) => `# Mission execution

Project ID: ${input.projectId}
Mission ID: ${input.missionId}
Mission: ${input.missionTitle}

${input.missionDescription}

${
  input.taskId === null
    ? "Execute the mission as a single focused run."
    : `Task ID: ${input.taskId}\nTask: ${input.taskTitle ?? "Untitled task"}\n\n${input.taskDescription ?? ""}`
}

${input.role === null ? "" : `Role: ${input.role}\nPermissions: ${input.permissions.join(", ") || "none"}`}
${input.worktreePath === null ? "" : `Assigned worktree: ${input.worktreePath}`}
${
  input.dependencyHandoffs.length === 0
    ? "No predecessor handoffs are required for this task."
    : `Predecessor handoffs:\n${input.dependencyHandoffs.map((handoff) => `- ${handoff}`).join("\n")}`
}

Work only on this mission and selected task. Use the assigned worktree as the execution root. Do not write outside it, change another task's branch, integrate branches, or reassign/cancel unrelated work unless the listed permissions explicitly allow that action. Preserve existing project behavior and repository conventions. Report failures honestly. Finish with a concise summary, verification performed, changed files, unresolved problems, and the recommended next action.`;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const missionRepository = yield* ProjectionMissionRepository;
  const taskRepository = yield* ProjectionMissionTaskRepository;
  const runRepository = yield* ProjectionAgentRunRepository;
  const teamRepository = yield* ProjectionMissionTeamRepository;
  const gitService = yield* Effect.serviceOption(MissionGitService);

  const dispatch = (command: OrchestrationCommand) => engine.dispatch(command).pipe(Effect.asVoid);

  const recordHandoff = Effect.fn("MissionRunReactor.recordHandoff")(function* (
    run: AgentRun,
    occurredAt: string,
    outcome: "completed" | "failed" | "cancelled" | "interrupted",
    detail: string,
  ) {
    if (run.taskId === null || run.missionAgentId === null) return;
    const handoffId = AgentHandoffId.make(`handoff:${run.id}`);
    const worktree =
      run.worktreeId === null
        ? Option.none<ManagedWorktree>()
        : yield* teamRepository.getManagedWorktreeById({ worktreeId: run.worktreeId });
    const status =
      Option.isSome(worktree) && Option.isSome(gitService)
        ? yield* Effect.option(
            gitService.value.inspectWorktreeStatus({
              repositoryPath: worktree.value.repositoryPath,
              worktreePath: worktree.value.worktreePath,
            }),
          )
        : Option.none();
    const committedChangedPaths =
      Option.isSome(worktree) && Option.isSome(gitService)
        ? yield* Effect.option(
            gitService.value.detectChangedFiles({
              repositoryPath: worktree.value.repositoryPath,
              baseRef: worktree.value.baseCommit,
              headRef: worktree.value.branchName,
            }),
          )
        : Option.none();
    const authoritativePaths = [
      ...(Option.isSome(committedChangedPaths) ? committedChangedPaths.value : []),
      ...(Option.isSome(status) ? status.value.changedPaths : []),
    ].filter((path, index, paths) => paths.indexOf(path) === index);
    const authoritativeChangedFiles = authoritativePaths
      .toSorted((left, right) => left.localeCompare(right))
      .map((path) => ({
        path,
        change: "modified" as const,
        summary: "Detected from the assigned worktree's Git diff or status.",
      }));
    const unresolvedProblems = outcome === "completed" ? [] : [detail];

    yield* dispatch({
      type: "mission.handoff.create",
      commandId: commandId(run.id, "handoff-create"),
      missionId: run.missionId,
      handoff: {
        id: handoffId,
        missionId: run.missionId,
        taskId: run.taskId,
        agentRunId: run.id,
        fromMissionAgentId: run.missionAgentId,
        toMissionAgentId: null,
        summary: detail,
        decisions: [],
        changedFiles: [],
        commandsRun: [],
        unresolvedProblems,
        recommendedNextAction:
          outcome === "completed"
            ? "Review the Git-reconciled changes and continue with dependent work or integration."
            : "Inspect the preserved run and worktree state before retrying or unblocking dependents.",
        artifacts: [],
        reconciliationStatus: "pending",
        reconciledAt: null,
        createdAt: occurredAt,
      },
    });
    yield* dispatch({
      type: "mission.handoff.reconcile",
      commandId: commandId(run.id, "handoff-reconcile"),
      missionId: run.missionId,
      handoffId,
      reconciliationStatus: authoritativeChangedFiles.length === 0 ? "matched" : "corrected",
      changedFiles: authoritativeChangedFiles,
      reconciledAt: occurredAt,
    });
  });

  const recordHandoffSafely = (
    run: AgentRun,
    occurredAt: string,
    outcome: "completed" | "failed" | "cancelled" | "interrupted",
    detail: string,
  ) =>
    recordHandoff(run, occurredAt, outcome, detail).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("mission run handoff could not be recorded", {
          missionId: run.missionId,
          agentRunId: run.id,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const failRun = Effect.fn("MissionRunReactor.failRun")(function* (
    runId: AgentRunId,
    missionId: MissionId,
    detail: string,
    failedAt?: string,
  ) {
    const occurredAt = failedAt ?? (yield* nowIso);
    const run = yield* runRepository.getById({ agentRunId: runId });
    if (Option.isSome(run)) {
      yield* recordHandoffSafely(run.value, occurredAt, "failed", detail);
    }
    yield* dispatch({
      type: "mission.agent-run.fail",
      commandId: commandId(runId, "failed"),
      missionId,
      agentRunId: runId,
      errorSummary: detail,
      failedAt: occurredAt,
    });
  });

  const launchRun = Effect.fn("MissionRunReactor.launchRun")(function* (
    event: Extract<OrchestrationEvent, { type: "agent_run.started" }>,
  ) {
    const run = event.payload.run;
    const mission = yield* missionRepository.getById({ missionId: run.missionId });
    if (Option.isNone(mission)) {
      return yield* failRun(
        run.id,
        run.missionId,
        "Mission projection was unavailable at run start.",
      );
    }
    const task =
      run.taskId === null ? Option.none() : yield* taskRepository.getById({ taskId: run.taskId });
    const agent =
      run.missionAgentId === null
        ? Option.none<MissionAgent>()
        : yield* teamRepository.getMissionAgentById({ missionAgentId: run.missionAgentId });
    const worktree =
      run.worktreeId === null
        ? Option.none<ManagedWorktree>()
        : yield* teamRepository.getManagedWorktreeById({ worktreeId: run.worktreeId });
    if (run.writeCapable && Option.isNone(worktree) && run.missionAgentId !== null) {
      return yield* failRun(
        run.id,
        run.missionId,
        "The write-capable task has no available managed worktree.",
      );
    }
    const dependencies = yield* teamRepository.listTaskDependenciesByMissionId({
      missionId: run.missionId,
    });
    const predecessorIds = new Set(
      dependencies
        .filter((dependency) => dependency.taskId === run.taskId)
        .map((dependency) => dependency.dependsOnTaskId),
    );
    const dependencyHandoffs = (yield* teamRepository.listAgentHandoffsByMissionId({
      missionId: run.missionId,
    }))
      .filter((handoff) => predecessorIds.has(handoff.taskId))
      .map((handoff) => `${handoff.taskId}: ${handoff.summary}`);
    const prompt = formatMissionPrompt({
      projectId: mission.value.projectId,
      missionId: mission.value.id,
      missionTitle: mission.value.title,
      missionDescription: mission.value.description,
      taskId: run.taskId,
      taskTitle: Option.isSome(task) ? task.value.title : null,
      taskDescription: Option.isSome(task) ? task.value.description : null,
      role: Option.isSome(agent) ? `${agent.value.displayName} (${agent.value.roleKind})` : null,
      permissions: run.permissions,
      worktreePath: Option.isSome(worktree) ? worktree.value.worktreePath : null,
      dependencyHandoffs,
    });

    yield* dispatch({
      type: "thread.create",
      commandId: commandId(run.id, "thread-create"),
      threadId: run.threadId,
      projectId: mission.value.projectId,
      title: mission.value.title,
      modelSelection: event.payload.modelSelection,
      runtimeMode: event.payload.runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: Option.isSome(worktree) ? worktree.value.branchName : null,
      worktreePath: Option.isSome(worktree) ? worktree.value.worktreePath : null,
      createdAt: run.createdAt,
    });
    yield* dispatch({
      type: "thread.turn.start",
      commandId: commandId(run.id, "turn-start"),
      threadId: run.threadId,
      message: {
        messageId: MessageId.make(`mission:${run.id}:prompt`),
        role: "user",
        text: prompt,
        attachments: [],
      },
      modelSelection: event.payload.modelSelection,
      titleSeed: mission.value.title,
      runtimeMode: event.payload.runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt: run.createdAt,
    });
  });

  const cancelRun = Effect.fn("MissionRunReactor.cancelRun")(function* (
    runId: AgentRunId,
    requestedAt: string,
  ) {
    const run = yield* runRepository.getById({ agentRunId: runId });
    if (Option.isNone(run) || run.value.status !== "cancelling") {
      return;
    }
    yield* dispatch({
      type: "thread.turn.interrupt",
      commandId: commandId(run.value.id, "cancel-interrupt"),
      threadId: run.value.threadId,
      createdAt: requestedAt,
    });
    yield* dispatch({
      type: "thread.session.stop",
      commandId: commandId(run.value.id, "cancel-stop"),
      threadId: run.value.threadId,
      createdAt: requestedAt,
    });
  });

  const cancelRuns = Effect.fn("MissionRunReactor.cancelRuns")(function* (
    event: Extract<
      OrchestrationEvent,
      { type: "mission.cancellation-requested" | "task.cancellation-requested" }
    >,
  ) {
    const runIds =
      event.type === "mission.cancellation-requested"
        ? missionCancellationAgentRunIds(event.payload)
        : (yield* runRepository.listByMissionId({ missionId: event.payload.missionId }))
            .filter(
              (run) =>
                run.taskId === event.payload.taskId &&
                (run.status === "starting" ||
                  run.status === "running" ||
                  run.status === "cancelling"),
            )
            .map((run) => run.id);
    yield* Effect.forEach(runIds, (runId) => cancelRun(runId, event.payload.requestedAt), {
      concurrency: "unbounded",
      discard: true,
    });
  });

  const syncRunFromSession = Effect.fn("MissionRunReactor.syncRunFromSession")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.session-set" }>,
  ) {
    const run = yield* runRepository.getByThreadId({ threadId: event.payload.threadId });
    if (Option.isNone(run)) return;
    const current = run.value;
    const status = event.payload.session.status;
    if ((status === "starting" || status === "running") && current.status === "starting") {
      yield* dispatch({
        type: "mission.agent-run.mark-running",
        commandId: commandId(current.id, "running"),
        missionId: current.missionId,
        agentRunId: current.id,
        providerSessionId: event.payload.session.providerSessionId ?? null,
        startedAt: event.payload.session.updatedAt,
      });
      return;
    }
    // Ready only means the provider session can accept more work. The
    // provider-neutral turn.completed event carries the terminal outcome.
    if (status === "ready") return;
    if (
      status === "error" &&
      (current.status === "starting" ||
        current.status === "running" ||
        current.status === "cancelling")
    ) {
      yield* failRun(
        current.id,
        current.missionId,
        event.payload.session.lastError ?? "Provider session failed.",
      );
      return;
    }
    if (
      (status === "interrupted" || status === "stopped") &&
      (current.status === "starting" ||
        current.status === "running" ||
        current.status === "cancelling")
    ) {
      if (current.status === "cancelling") {
        yield* recordHandoffSafely(
          current,
          event.payload.session.updatedAt,
          "cancelled",
          "The task run was cancelled; its worktree and branch were preserved.",
        );
        yield* dispatch({
          type: "mission.agent-run.cancel",
          commandId: commandId(current.id, "cancelled"),
          missionId: current.missionId,
          agentRunId: current.id,
          cancelledAt: event.payload.session.updatedAt,
        });
        return;
      }
      const interruptionReason = `Provider session became ${status}.`;
      yield* recordHandoffSafely(
        current,
        event.payload.session.updatedAt,
        "interrupted",
        interruptionReason,
      );
      yield* dispatch({
        type: "mission.agent-run.interrupt",
        commandId: commandId(current.id, "interrupted"),
        missionId: current.missionId,
        agentRunId: current.id,
        reason: interruptionReason,
        interruptedAt: event.payload.session.updatedAt,
      });
    }
  });

  const syncRunFromRuntime = Effect.fn("MissionRunReactor.syncRunFromRuntime")(function* (
    event: MissionRunRuntimeEvent,
  ) {
    const run = yield* runRepository.getByThreadId({ threadId: event.threadId });
    if (Option.isNone(run)) return;
    const current = run.value;
    if (
      event.providerInstanceId !== undefined &&
      event.providerInstanceId !== current.providerInstanceId
    ) {
      return;
    }

    switch (event.payload.state) {
      case "completed":
        if (current.status !== "starting" && current.status !== "running") return;
        yield* recordHandoffSafely(
          current,
          event.createdAt,
          "completed",
          "The task run completed. Changed-file claims were reconciled against Git.",
        );
        yield* dispatch({
          type: "mission.agent-run.complete",
          commandId: commandId(current.id, "completed"),
          missionId: current.missionId,
          agentRunId: current.id,
          completedAt: event.createdAt,
        });
        return;
      case "failed":
        if (
          current.status !== "starting" &&
          current.status !== "running" &&
          current.status !== "cancelling"
        ) {
          return;
        }
        yield* failRun(
          current.id,
          current.missionId,
          event.payload.errorMessage ?? event.payload.stopReason ?? "Provider turn failed.",
          event.createdAt,
        );
        return;
      case "interrupted":
      case "cancelled":
        if (current.status !== "starting" && current.status !== "running") return;
        {
          const interruptionReason =
            event.payload.errorMessage ??
            event.payload.stopReason ??
            `Provider turn ${event.payload.state}.`;
          yield* recordHandoffSafely(current, event.createdAt, "interrupted", interruptionReason);
          yield* dispatch({
            type: "mission.agent-run.interrupt",
            commandId: commandId(current.id, "interrupted"),
            missionId: current.missionId,
            agentRunId: current.id,
            reason: interruptionReason,
            interruptedAt: event.createdAt,
          });
        }
        return;
    }
  });

  const process = Effect.fn("MissionRunReactor.process")(function* (event: MissionRunEvent) {
    switch (event.type) {
      case "agent_run.started":
        yield* launchRun(event);
        return;
      case "mission.cancellation-requested":
      case "task.cancellation-requested":
        yield* cancelRuns(event);
        return;
      case "thread.session-set":
        yield* syncRunFromSession(event);
        return;
      case "turn.completed":
        yield* syncRunFromRuntime(event);
        return;
    }
  });

  const processSafely = (event: MissionRunEvent) =>
    process(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : event.type === "agent_run.started"
            ? failRun(
                event.payload.run.id,
                event.payload.run.missionId,
                `Mission run could not start: ${String(Cause.squash(cause))}`,
              ).pipe(
                Effect.catchCause((recordCause) =>
                  Effect.logError("mission run launch failure could not be recorded", {
                    eventType: event.type,
                    cause: Cause.pretty(cause),
                    recordCause: Cause.pretty(recordCause),
                  }),
                ),
              )
            : Effect.logError("mission run reactor event failed", {
                eventType: event.type,
                cause: Cause.pretty(cause),
              }),
      ),
    );
  const worker = yield* makeDrainableWorker(processSafely);

  const recoverInterruptedRuns = Effect.gen(function* () {
    const activeRuns = yield* runRepository.listActive();
    const recoveredAt = yield* nowIso;
    yield* Effect.forEach(
      activeRuns,
      (run) =>
        Effect.gen(function* () {
          const reason = "The server restarted before the provider run reached a terminal state.";
          yield* recordHandoffSafely(run, recoveredAt, "interrupted", reason);
          yield* dispatch({
            type: "mission.agent-run.interrupt",
            commandId: commandId(run.id, "restart-interrupted"),
            missionId: run.missionId,
            agentRunId: run.id,
            reason,
            interruptedAt: recoveredAt,
          });
        }),
      { concurrency: 1, discard: true },
    );
  }).pipe(Effect.orDie);

  const start: MissionRunReactorShape["start"] = Effect.fn("MissionRunReactor.start")(function* () {
    yield* recoverInterruptedRuns;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        if (
          event.type === "agent_run.started" ||
          event.type === "mission.cancellation-requested" ||
          event.type === "task.cancellation-requested" ||
          event.type === "thread.session-set"
        ) {
          return worker.enqueue(event);
        }
        return Effect.void;
      }),
    );
    yield* forkParked(
      Stream.runForEach(providerService.streamEvents, (event) =>
        event.type === "turn.completed" ? worker.enqueue(event) : Effect.void,
      ),
    );
  });

  return { start, drain: worker.drain } satisfies MissionRunReactorShape;
});

export const MissionRunReactorLive = Layer.effect(MissionRunReactor, make).pipe(
  Layer.provideMerge(ProjectionMissionRepositoryLive),
  Layer.provideMerge(ProjectionMissionTaskRepositoryLive),
  Layer.provideMerge(ProjectionAgentRunRepositoryLive),
  Layer.provideMerge(ProjectionMissionTeamRepositoryLive),
);
