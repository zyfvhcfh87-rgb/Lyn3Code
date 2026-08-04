import {
  AgentRunId,
  CommandId,
  MissionId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationMissionDetailSnapshot,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  MissionSchedulerReactor,
  type MissionSchedulerReactorShape,
} from "../Services/MissionSchedulerReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { planMissionSchedule } from "../MissionScheduler.ts";
import { RoutingCoordinator } from "../../routing/RoutingCoordinator.ts";

type SchedulerTrigger = Extract<
  OrchestrationEvent,
  {
    type:
      | "scheduler.started"
      | "scheduler.resumed"
      | "mission.team-configured"
      | "mission.agent-upserted"
      | "mission.agent-permissions-updated"
      | "task.dependency-added"
      | "task.dependency-removed"
      | "task.retry-requested"
      | "task.cancellation-requested"
      | "task.implementation-completed"
      | "task.completed"
      | "task.failed"
      | "agent_handoff.created"
      | "managed_worktree.recorded"
      | "managed_worktree.status-updated";
  }
>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const commandId = (missionId: MissionId, taskId: string, action: string) =>
  CommandId.make(`server:scheduler:${missionId}:${taskId}:${action}`);

const blockedReasons = new Set(["dependency_missing", "dependency_failed", "agent_unavailable"]);

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const routing = yield* RoutingCoordinator;
  const query = yield* ProjectionSnapshotQuery;
  if (query.getMissionDetailSnapshot === undefined) {
    return {
      start: Effect.fn("MissionSchedulerReactor.start")(function* () {}),
      drain: Effect.void,
    } satisfies MissionSchedulerReactorShape;
  }
  const getMissionDetailSnapshot = query.getMissionDetailSnapshot;

  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command).pipe(Effect.asVoid);

  const reconcile = Effect.fn("MissionSchedulerReactor.reconcile")(function* (
    detail: OrchestrationMissionDetailSnapshot,
    allowStarts: boolean,
  ) {
    const plan = planMissionSchedule({
      mission: detail.mission,
      tasks: detail.tasks,
      dependencies: detail.taskDependencies,
      missionAgents: detail.missionAgents,
      worktrees: detail.managedWorktrees,
      agentRuns: detail.agentRuns,
      handoffs: detail.agentHandoffs,
      mode: "automatic",
    });
    const observedAt = yield* nowIso;

    for (const decision of plan.decisions) {
      const task = detail.tasks.find((entry) => entry.id === decision.taskId);
      if (task === undefined) continue;
      if (blockedReasons.has(decision.reason)) {
        if (task.status !== "blocked" || task.blockedReason !== decision.reason) {
          yield* dispatch({
            type: "mission.task.mark-blocked",
            commandId: commandId(detail.mission.id, task.id, `blocked:${decision.reason}`),
            missionId: detail.mission.id,
            taskId: task.id,
            reason: decision.reason,
            blockedAt: observedAt,
          });
        }
        continue;
      }
      if (
        task.status !== "ready" &&
        (decision.selected ||
          decision.reason === "manual_start_required" ||
          decision.reason === "mission_capacity" ||
          decision.reason === "write_capacity" ||
          decision.reason === "agent_capacity" ||
          decision.reason === "provider_capacity" ||
          decision.reason === "worktree_busy")
      ) {
        yield* dispatch({
          type: "mission.task.mark-ready",
          commandId: commandId(detail.mission.id, task.id, "ready"),
          missionId: detail.mission.id,
          taskId: task.id,
          readyAt: observedAt,
        });
      }
    }

    const concurrencyLimited = plan.decisions.some(
      (decision) =>
        decision.reason === "mission_capacity" ||
        decision.reason === "write_capacity" ||
        decision.reason === "agent_capacity" ||
        decision.reason === "provider_capacity" ||
        decision.reason === "worktree_busy",
    );
    if (concurrencyLimited) {
      yield* dispatch({
        type: "mission.scheduler.concurrency-limit",
        commandId: commandId(detail.mission.id, "all", `limited:${detail.snapshotSequence}`),
        missionId: detail.mission.id,
        maximumConcurrentAgents: detail.mission.teamSettings.maximumConcurrentAgents,
        maximumConcurrentWriteAgents: detail.mission.teamSettings.maximumConcurrentWriteAgents,
        observedAt,
      });
    }
    if (!allowStarts) return;

    for (const taskId of plan.selectedTaskIds) {
      const task = detail.tasks.find((entry) => entry.id === taskId);
      const decision = plan.decisions.find((entry) => entry.taskId === taskId);
      const agent = detail.missionAgents.find((entry) => entry.id === task?.assignedMissionAgentId);
      if (task === undefined || decision === undefined || agent === undefined) continue;
      const attemptNumber = task.attemptCount + 1;
      const runId = AgentRunId.make(
        `mission:${detail.mission.id}:task:${task.id}:attempt:${attemptNumber}`,
      );
      yield* routing
        .routeAndStart({
          missionId: detail.mission.id,
          taskId: task.id,
          agentRunId: runId,
          threadId: ThreadId.make(`${runId}:thread`),
          runtimeMode: decisionRuntimeMode(agent.permissions),
          missionAgentId: agent.id,
          ...(decision.worktreeId !== null ? { worktreeId: decision.worktreeId } : {}),
          attemptNumber,
          permissions: agent.permissions,
          writeCapable:
            agent.permissions.includes("write_files") ||
            agent.permissions.includes("create_commits"),
          requestedAt: observedAt,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("mission task routing did not start a run", {
              missionId: detail.mission.id,
              taskId: task.id,
              reason: error.reason,
              detail: error.message,
            }),
          ),
        );
    }
  });

  const process = Effect.fn("MissionSchedulerReactor.process")(function* (event: SchedulerTrigger) {
    const detail = yield* getMissionDetailSnapshot(MissionId.make(event.aggregateId));
    if (Option.isNone(detail)) return;
    yield* reconcile(detail.value, true);
  });
  const processSafely = (event: SchedulerTrigger) =>
    process(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logError("mission scheduler reconciliation failed", {
              missionId: event.aggregateId,
              eventType: event.type,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  const worker = yield* makeDrainableWorker(processSafely);

  const recoverReadiness = Effect.gen(function* () {
    const snapshot = yield* query.getSnapshot();
    yield* Effect.forEach(
      snapshot.missions ?? [],
      (mission) =>
        getMissionDetailSnapshot(mission.id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (detail) => reconcile(detail, false),
            }),
          ),
        ),
      { concurrency: 1, discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("mission scheduler restart reconciliation failed", {
        cause: Cause.pretty(cause),
      }),
    ),
  );

  const start: MissionSchedulerReactorShape["start"] = Effect.fn("MissionSchedulerReactor.start")(
    function* () {
      yield* recoverReadiness;
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) => {
          if (
            event.aggregateKind === "mission" &&
            (event.type === "scheduler.started" ||
              event.type === "scheduler.resumed" ||
              event.type === "mission.team-configured" ||
              event.type === "mission.agent-upserted" ||
              event.type === "mission.agent-permissions-updated" ||
              event.type === "task.dependency-added" ||
              event.type === "task.dependency-removed" ||
              event.type === "task.retry-requested" ||
              event.type === "task.cancellation-requested" ||
              event.type === "task.implementation-completed" ||
              event.type === "task.completed" ||
              event.type === "task.failed" ||
              event.type === "agent_handoff.created" ||
              event.type === "managed_worktree.recorded" ||
              event.type === "managed_worktree.status-updated")
          ) {
            return worker.enqueue(event);
          }
          return Effect.void;
        }),
      );
    },
  );

  return { start, drain: worker.drain } satisfies MissionSchedulerReactorShape;
});

const decisionRuntimeMode = (
  permissions: ReadonlyArray<string>,
): "approval-required" | "auto-accept-edits" =>
  permissions.includes("write_files") || permissions.includes("create_commits")
    ? "auto-accept-edits"
    : "approval-required";

export const MissionSchedulerReactorLive = Layer.effect(MissionSchedulerReactor, make);
