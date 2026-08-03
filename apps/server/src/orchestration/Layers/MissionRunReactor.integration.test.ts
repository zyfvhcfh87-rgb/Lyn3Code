import {
  AgentRunId,
  CommandId,
  EventId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type AgentRun,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ProjectionAgentRunRepository } from "../../persistence/Services/ProjectionAgentRuns.ts";
import { ProjectionMissionTaskRepository } from "../../persistence/Services/ProjectionMissionTasks.ts";
import { ProjectionMissionRepository } from "../../persistence/Services/ProjectionMissions.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { MissionRunReactor } from "../Services/MissionRunReactor.ts";
import { MissionRunReactorLive } from "./MissionRunReactor.ts";

const projectId = ProjectId.make("project-mission-reactor");
const missionId = MissionId.make("mission-reactor");
const taskId = MissionTaskId.make("task-mission-reactor");
const runId = AgentRunId.make("run-mission-reactor");
const threadId = ThreadId.make("thread-mission-reactor");
const providerInstanceId = ProviderInstanceId.make("codex");
const now = "2026-08-03T00:00:00.000Z";

type CommandType = OrchestrationCommand["type"];

interface MissionRunHarnessShape {
  readonly publish: (event: OrchestrationEvent) => Effect.Effect<void>;
  readonly publishRuntime: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly awaitCommand: <Type extends CommandType>(
    type: Type,
  ) => Effect.Effect<Extract<OrchestrationCommand, { type: Type }>>;
  readonly commands: () => ReadonlyArray<OrchestrationCommand>;
  readonly failNextDispatch: (type: CommandType) => void;
  readonly interruptedThreads: () => ReadonlyArray<ThreadId>;
  readonly stoppedThreads: () => ReadonlyArray<ThreadId>;
  readonly reset: () => void;
  readonly eventStream: Stream.Stream<OrchestrationEvent>;
  readonly runtimeEventStream: Stream.Stream<ProviderRuntimeEvent>;
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationCommandInvariantError>;
  readonly interruptTurn: ProviderServiceShape["interruptTurn"];
  readonly stopSession: ProviderServiceShape["stopSession"];
}

class MissionRunHarness extends Context.Service<MissionRunHarness, MissionRunHarnessShape>()(
  "t3/orchestration/Layers/MissionRunReactor.integration.test/MissionRunHarness",
) {}

const MissionRunHarnessLive = Layer.effect(
  MissionRunHarness,
  Effect.gen(function* () {
    const eventQueue = yield* Queue.unbounded<OrchestrationEvent>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const commandQueue = yield* Queue.unbounded<OrchestrationCommand>();
    const recordedCommands: OrchestrationCommand[] = [];
    const interruptedThreads: ThreadId[] = [];
    const stoppedThreads: ThreadId[] = [];
    const acceptedCommands = new Map<string, number>();
    let nextSequence = 1;
    let failingDispatchType: CommandType | null = null;

    const awaitCommand = <Type extends CommandType>(
      type: Type,
    ): Effect.Effect<Extract<OrchestrationCommand, { type: Type }>> =>
      Queue.take(commandQueue).pipe(
        Effect.flatMap((command) =>
          command.type === type
            ? Effect.succeed(command as Extract<OrchestrationCommand, { type: Type }>)
            : awaitCommand(type),
        ),
      );

    const dispatch: MissionRunHarnessShape["dispatch"] = (command) =>
      Effect.gen(function* () {
        const acceptedSequence = acceptedCommands.get(command.commandId);
        if (acceptedSequence !== undefined) {
          return { sequence: acceptedSequence };
        }

        recordedCommands.push(command);
        yield* Queue.offer(commandQueue, command);
        if (failingDispatchType === command.type) {
          failingDispatchType = null;
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Injected dispatch failure.",
          });
        }

        const sequence = nextSequence++;
        acceptedCommands.set(command.commandId, sequence);
        return { sequence };
      });

    const interruptTurn: ProviderServiceShape["interruptTurn"] = ({ threadId }) =>
      Effect.sync(() => {
        interruptedThreads.push(threadId);
      });

    const stopSession: ProviderServiceShape["stopSession"] = ({ threadId }) =>
      Effect.sync(() => {
        stoppedThreads.push(threadId);
      });

    return {
      publish: (event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid),
      publishRuntime: (event) => Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid),
      awaitCommand,
      commands: () => recordedCommands,
      failNextDispatch: (type) => {
        failingDispatchType = type;
      },
      interruptedThreads: () => interruptedThreads,
      stoppedThreads: () => stoppedThreads,
      reset: () => {
        recordedCommands.length = 0;
        interruptedThreads.length = 0;
        stoppedThreads.length = 0;
        acceptedCommands.clear();
        nextSequence = 1;
        failingDispatchType = null;
      },
      eventStream: Stream.fromQueue(eventQueue),
      runtimeEventStream: Stream.fromQueue(runtimeEventQueue),
      dispatch,
      interruptTurn,
      stopSession,
    } satisfies MissionRunHarnessShape;
  }),
);

const FakeOrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  Effect.gen(function* () {
    const harness = yield* MissionRunHarness;
    return {
      readEvents: () => Stream.empty,
      dispatch: harness.dispatch,
      streamDomainEvents: harness.eventStream,
      latestSequence: Effect.succeed(0),
    } satisfies OrchestrationEngineService["Service"];
  }),
);

const unsupportedProviderCall = () =>
  Effect.die(new Error("Unexpected provider call in MissionRunReactor test")) as never;

const FakeProviderServiceLive = Layer.effect(
  ProviderService,
  Effect.gen(function* () {
    const harness = yield* MissionRunHarness;
    return {
      startSession: unsupportedProviderCall,
      sendTurn: unsupportedProviderCall,
      interruptTurn: harness.interruptTurn,
      respondToRequest: unsupportedProviderCall,
      respondToUserInput: unsupportedProviderCall,
      stopSession: harness.stopSession,
      listSessions: () => Effect.succeed([]),
      getCapabilities: unsupportedProviderCall,
      getInstanceInfo: unsupportedProviderCall,
      rollbackConversation: unsupportedProviderCall,
      streamEvents: harness.runtimeEventStream,
    } satisfies ProviderServiceShape;
  }),
);

const FakeServicesLive = Layer.mergeAll(FakeOrchestrationEngineLive, FakeProviderServiceLive).pipe(
  Layer.provideMerge(MissionRunHarnessLive),
);

const TestLayer = MissionRunReactorLive.pipe(
  Layer.provideMerge(FakeServicesLive),
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(SqlitePersistenceMemory),
);

const makeRun = (status: AgentRun["status"]): AgentRun => ({
  id: runId,
  missionId,
  taskId,
  threadId,
  provider: "codex",
  providerInstanceId,
  providerSessionId: null,
  status,
  createdAt: now,
  startedAt: now,
  updatedAt: now,
  completedAt: null,
  errorSummary: null,
});

const seedRun = (status: AgentRun["status"]) =>
  Effect.gen(function* () {
    const projects = yield* ProjectionProjectRepository;
    const missions = yield* ProjectionMissionRepository;
    const tasks = yield* ProjectionMissionTaskRepository;
    const runs = yield* ProjectionAgentRunRepository;

    yield* projects.upsert({
      projectId,
      title: "Mission reactor project",
      workspaceRoot: "/tmp/mission-reactor",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    yield* missions.upsert({
      id: missionId,
      projectId,
      title: "Exercise the mission reactor",
      description: "Run one provider-neutral mission task.",
      status: "running",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      cancelledAt: null,
    });
    yield* tasks.upsert({
      id: taskId,
      missionId,
      title: "Execute one run",
      description: "Use the existing provider session flow.",
      status: "running",
      position: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
    });
    const run = makeRun(status);
    yield* runs.upsert(run);
    return run;
  });

const eventBase = {
  sequence: 1,
  eventId: EventId.make("event-mission-reactor"),
  aggregateKind: "mission" as const,
  aggregateId: missionId,
  occurredAt: now,
  commandId: CommandId.make("command-mission-reactor"),
  causationEventId: null,
  correlationId: CommandId.make("command-mission-reactor"),
  metadata: {},
};

const runStartedEvent = (run: AgentRun) =>
  ({
    ...eventBase,
    type: "agent_run.started",
    payload: {
      run,
      modelSelection: {
        instanceId: providerInstanceId,
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
    },
  }) satisfies Extract<OrchestrationEvent, { type: "agent_run.started" }>;

const cancellationRequestedEvent = () =>
  ({
    ...eventBase,
    type: "mission.cancellation-requested",
    payload: {
      missionId,
      agentRunId: runId,
      requestedAt: now,
    },
  }) satisfies Extract<OrchestrationEvent, { type: "mission.cancellation-requested" }>;

const providerFailedEvent = () =>
  ({
    ...eventBase,
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status: "error",
        providerName: "codex",
        providerInstanceId,
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: "Provider exploded safely.",
        updatedAt: now,
      },
    },
  }) satisfies Extract<OrchestrationEvent, { type: "thread.session-set" }>;

const providerRunningEvent = () =>
  ({
    ...eventBase,
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status: "running",
        providerName: "codex",
        providerInstanceId,
        providerSessionId: "provider-session-mission-reactor",
        runtimeMode: "full-access",
        activeTurnId: TurnId.make("turn-mission-reactor"),
        lastError: null,
        updatedAt: now,
      },
    },
  }) satisfies Extract<OrchestrationEvent, { type: "thread.session-set" }>;

const providerReadyEvent = () =>
  ({
    ...eventBase,
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status: "ready",
        providerName: "codex",
        providerInstanceId,
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
    },
  }) satisfies Extract<OrchestrationEvent, { type: "thread.session-set" }>;

const providerStoppedEvent = () =>
  ({
    ...eventBase,
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status: "stopped",
        providerName: "codex",
        providerInstanceId,
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
    },
  }) satisfies Extract<OrchestrationEvent, { type: "thread.session-set" }>;

const providerTurnCompletedEvent = (
  state: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>["payload"]["state"],
  options?: { readonly errorMessage?: string; readonly stopReason?: string },
) =>
  ({
    type: "turn.completed",
    eventId: EventId.make(`provider-turn-${state}`),
    provider: ProviderDriverKind.make("codex"),
    providerInstanceId,
    threadId,
    createdAt: now,
    turnId: TurnId.make("turn-mission-reactor"),
    payload: {
      state,
      ...(options?.errorMessage !== undefined ? { errorMessage: options.errorMessage } : {}),
      ...(options?.stopReason !== undefined ? { stopReason: options.stopReason } : {}),
    },
  }) satisfies Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;

it.layer(TestLayer)("MissionRunReactor integration", (it) => {
  it.effect("records a launch dispatch failure instead of leaving the run starting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        const run = yield* seedRun("starting");

        harness.failNextDispatch("thread.create");
        yield* harness.publish(runStartedEvent(run));
        const failure = yield* harness.awaitCommand("mission.agent-run.fail");

        assert.equal(failure.agentRunId, runId);
        assert.match(failure.errorSummary, /Mission run could not start/);
        assert.match(failure.errorSummary, /Injected dispatch failure/);
      }),
    ),
  );

  it.effect("binds the provider session when the run starts running", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        yield* seedRun("starting");

        yield* harness.publish(providerRunningEvent());
        const running = yield* harness.awaitCommand("mission.agent-run.mark-running");

        assert.equal(running.agentRunId, runId);
        assert.equal(running.providerSessionId, "provider-session-mission-reactor");
      }),
    ),
  );

  it.effect("maps a provider session failure to an honest run failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        yield* seedRun("running");

        yield* harness.publish(providerFailedEvent());
        const failure = yield* harness.awaitCommand("mission.agent-run.fail");

        assert.equal(failure.agentRunId, runId);
        assert.equal(failure.errorSummary, "Provider exploded safely.");
      }),
    ),
  );

  it.effect("completes a run from the provider-neutral terminal outcome", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        yield* seedRun("running");

        yield* harness.publishRuntime(providerTurnCompletedEvent("completed"));
        const completion = yield* harness.awaitCommand("mission.agent-run.complete");

        assert.equal(completion.agentRunId, runId);
        assert.equal(completion.completedAt, now);
      }),
    ),
  );

  it.effect("fails a run from the provider-neutral terminal outcome", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        yield* seedRun("running");

        yield* harness.publishRuntime(
          providerTurnCompletedEvent("failed", { errorMessage: "Canonical provider failure." }),
        );
        const failure = yield* harness.awaitCommand("mission.agent-run.fail");

        assert.equal(failure.agentRunId, runId);
        assert.equal(failure.errorSummary, "Canonical provider failure.");
        assert.equal(failure.failedAt, now);
      }),
    ),
  );

  it.effect("interrupts a run from the provider-neutral terminal outcome", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        yield* seedRun("running");

        yield* harness.publishRuntime(
          providerTurnCompletedEvent("interrupted", { stopReason: "Provider process exited." }),
        );
        const firstInterruption = yield* harness.awaitCommand("mission.agent-run.interrupt");
        const interruption = firstInterruption.commandId.endsWith(":restart-interrupted")
          ? yield* harness.awaitCommand("mission.agent-run.interrupt")
          : firstInterruption;

        assert.equal(interruption.agentRunId, runId);
        assert.equal(interruption.reason, "Provider process exited.");
        assert.equal(interruption.interruptedAt, now);
      }),
    ),
  );

  it.effect("does not complete when ready is followed by a provider failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* reactor.start();
        yield* seedRun("running");

        yield* harness.publish(providerReadyEvent());
        yield* harness.publish(providerFailedEvent());
        const failure = yield* harness.awaitCommand("mission.agent-run.fail");

        assert.equal(failure.errorSummary, "Provider exploded safely.");
        assert.equal(
          harness.commands().some((command) => command.type === "mission.agent-run.complete"),
          false,
        );
      }),
    ),
  );

  it.effect("queues cancellation behind provider startup and waits for the stopped state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        const runs = yield* ProjectionAgentRunRepository;
        harness.reset();
        yield* seedRun("completed");
        yield* reactor.start();
        const run = yield* seedRun("starting");

        yield* harness.publish(runStartedEvent(run));
        yield* harness.awaitCommand("thread.turn.start");
        yield* runs.upsert({ ...run, status: "cancelling" });

        yield* harness.publish(cancellationRequestedEvent());
        const interrupt = yield* harness.awaitCommand("thread.turn.interrupt");
        const stop = yield* harness.awaitCommand("thread.session.stop");

        assert.equal(interrupt.threadId, threadId);
        assert.equal(stop.threadId, threadId);
        assert.deepStrictEqual(harness.interruptedThreads(), []);
        assert.deepStrictEqual(harness.stoppedThreads(), []);
        assert.equal(
          harness
            .commands()
            .some(
              (command) =>
                command.type === "mission.agent-run.cancel" ||
                command.type === "mission.agent-run.fail" ||
                command.type === "mission.agent-run.complete",
            ),
          false,
        );

        yield* harness.publishRuntime(providerTurnCompletedEvent("completed"));
        yield* harness.publish(providerStoppedEvent());
        const cancellation = yield* harness.awaitCommand("mission.agent-run.cancel");

        assert.equal(cancellation.agentRunId, runId);
        assert.equal(cancellation.cancelledAt, now);
        assert.equal(
          harness.commands().some((command) => command.type === "mission.agent-run.complete"),
          false,
        );
        const commands = harness.commands();
        assert.isBelow(commands.indexOf(interrupt), commands.indexOf(stop));
      }),
    ),
  );

  it.effect("uses one deterministic recovery command across repeated startup recovery", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MissionRunReactor;
        const harness = yield* MissionRunHarness;
        harness.reset();
        yield* seedRun("running");

        yield* reactor.start();
        const recovery = yield* harness.awaitCommand("mission.agent-run.interrupt");
        yield* reactor.start();

        assert.equal(recovery.commandId, `server:mission:${runId}:restart-interrupted`);
        assert.equal(
          harness.commands().filter((command) => command.type === "mission.agent-run.interrupt")
            .length,
          1,
        );
      }),
    ),
  );
});
