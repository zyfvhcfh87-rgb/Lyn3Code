import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  AgentRunId,
  MessageId,
  MissionId,
  type OrchestrationCommand,
  type OrchestrationEvent,
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
import { ProjectionAgentRunRepositoryLive } from "../../persistence/Layers/ProjectionAgentRuns.ts";
import { ProjectionMissionRepositoryLive } from "../../persistence/Layers/ProjectionMissions.ts";
import { ProjectionMissionTaskRepositoryLive } from "../../persistence/Layers/ProjectionMissionTasks.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { MissionRunReactor, type MissionRunReactorShape } from "../Services/MissionRunReactor.ts";

type MissionRunDomainEvent = Extract<
  OrchestrationEvent,
  {
    type: "agent_run.started" | "mission.cancellation-requested" | "thread.session-set";
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

Work only on this mission and selected task. Preserve existing project behavior, report failures honestly, and finish with a concise summary of the work and verification performed.`;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const missionRepository = yield* ProjectionMissionRepository;
  const taskRepository = yield* ProjectionMissionTaskRepository;
  const runRepository = yield* ProjectionAgentRunRepository;

  const dispatch = (command: OrchestrationCommand) => engine.dispatch(command).pipe(Effect.asVoid);

  const failRun = Effect.fn("MissionRunReactor.failRun")(function* (
    runId: AgentRunId,
    missionId: MissionId,
    detail: string,
    failedAt?: string,
  ) {
    yield* dispatch({
      type: "mission.agent-run.fail",
      commandId: commandId(runId, "failed"),
      missionId,
      agentRunId: runId,
      errorSummary: detail,
      failedAt: failedAt ?? (yield* nowIso),
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
    const prompt = formatMissionPrompt({
      projectId: mission.value.projectId,
      missionId: mission.value.id,
      missionTitle: mission.value.title,
      missionDescription: mission.value.description,
      taskId: run.taskId,
      taskTitle: Option.isSome(task) ? task.value.title : null,
      taskDescription: Option.isSome(task) ? task.value.description : null,
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
      branch: null,
      worktreePath: null,
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
    event: Extract<OrchestrationEvent, { type: "mission.cancellation-requested" }>,
  ) {
    const run = yield* runRepository.getById({ agentRunId: event.payload.agentRunId });
    if (Option.isNone(run) || run.value.status !== "cancelling") {
      return;
    }
    yield* dispatch({
      type: "thread.turn.interrupt",
      commandId: commandId(run.value.id, "cancel-interrupt"),
      threadId: run.value.threadId,
      createdAt: event.payload.requestedAt,
    });
    yield* dispatch({
      type: "thread.session.stop",
      commandId: commandId(run.value.id, "cancel-stop"),
      threadId: run.value.threadId,
      createdAt: event.payload.requestedAt,
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
        yield* dispatch({
          type: "mission.agent-run.cancel",
          commandId: commandId(current.id, "cancelled"),
          missionId: current.missionId,
          agentRunId: current.id,
          cancelledAt: event.payload.session.updatedAt,
        });
        return;
      }
      yield* dispatch({
        type: "mission.agent-run.interrupt",
        commandId: commandId(current.id, "interrupted"),
        missionId: current.missionId,
        agentRunId: current.id,
        reason: `Provider session became ${status}.`,
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
        yield* dispatch({
          type: "mission.agent-run.interrupt",
          commandId: commandId(current.id, "interrupted"),
          missionId: current.missionId,
          agentRunId: current.id,
          reason:
            event.payload.errorMessage ??
            event.payload.stopReason ??
            `Provider turn ${event.payload.state}.`,
          interruptedAt: event.createdAt,
        });
        return;
    }
  });

  const process = Effect.fn("MissionRunReactor.process")(function* (event: MissionRunEvent) {
    switch (event.type) {
      case "agent_run.started":
        yield* launchRun(event);
        return;
      case "mission.cancellation-requested":
        yield* cancelRun(event);
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
            : event.type === "mission.cancellation-requested"
              ? failRun(
                  event.payload.agentRunId,
                  event.payload.missionId,
                  `Mission cancellation failed: ${String(Cause.squash(cause))}`,
                ).pipe(
                  Effect.catchCause((recordCause) =>
                    Effect.logError("mission cancellation failure could not be recorded", {
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
        dispatch({
          type: "mission.agent-run.interrupt",
          commandId: commandId(run.id, "restart-interrupted"),
          missionId: run.missionId,
          agentRunId: run.id,
          reason: "The server restarted before the provider run reached a terminal state.",
          interruptedAt: recoveredAt,
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
);
