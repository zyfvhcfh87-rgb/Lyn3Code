import {
  MissionOutcomeRecordId,
  TaskOutcomeRecordId,
  type AgentRun,
  type Mission,
  type MissionOutcomeRecord,
  type MissionTask,
  type MissionTaskId,
  type OrchestrationEvent,
  type OutcomeIntegrationResult,
  type OutcomeStatus,
  type OutcomeVerificationResult,
  type RunPerformanceRecord,
  type TaskOutcomeRecord,
  type VerificationOverride,
  type VerificationRun,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionAgentRunRepository } from "../persistence/Services/ProjectionAgentRuns.ts";
import { ProjectionMissionRepository } from "../persistence/Services/ProjectionMissions.ts";
import { ProjectionMissionTaskRepository } from "../persistence/Services/ProjectionMissionTasks.ts";
import { ProjectionUsageAnalyticsRepository } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { ProjectionVerificationRunRepository } from "../persistence/Services/ProjectionVerificationRuns.ts";
import { forkParked } from "../serverActivation.ts";
import { UsageAnalyticsEventRecorder } from "./UsageAnalyticsEventRecorder.ts";

const terminalTaskStatuses = new Set(["completed", "cancelled", "failed"] as const);

const taskOutcomeStatus = (status: MissionTask["status"]): OutcomeStatus => {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "backlog":
    case "ready":
    case "running":
    case "verification":
    case "blocked":
      return "pending";
  }
};

const missionOutcomeStatus = (status: Mission["status"]): OutcomeStatus => {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "backlog":
    case "planning":
    case "ready":
    case "running":
    case "verification":
    case "review":
    case "blocked":
      return "pending";
  }
};

const integrationResult = (
  status: MissionTask["integrationStatus"],
): OutcomeIntegrationResult | null => {
  switch (status) {
    case "integrated":
      return "integrated";
    case "conflicted":
      return "conflicted";
    case "failed":
      return "failed";
    case "not_requested":
      return "not_requested";
    case "pending":
    case "ready":
    case "integrating":
      return null;
  }
};

const resolvedVerificationResult = (
  runs: ReadonlyArray<VerificationRun>,
  overrides: ReadonlyArray<VerificationOverride>,
  taskTerminal: boolean,
): OutcomeVerificationResult | null => {
  if (overrides.some(({ revokedAt }) => revokedAt === null)) return "overridden";
  const latest = runs.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latest === undefined) return taskTerminal ? "not_run" : null;
  if (latest.invalidatedAt !== null) return "invalidated";
  switch (latest.result) {
    case "passed":
      return "passed";
    case "passed_with_warnings":
      return "passed_with_warnings";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "unknown";
    case null:
      return taskTerminal ? "not_run" : null;
  }
};

const sumComplete = (values: ReadonlyArray<number | null>): number | null =>
  values.length === 0 || values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

export const deriveTaskOutcome = (input: {
  readonly task: MissionTask;
  readonly agentRuns: ReadonlyArray<AgentRun>;
  readonly verificationRuns: ReadonlyArray<VerificationRun>;
  readonly verificationOverrides: ReadonlyArray<VerificationOverride>;
  readonly performance: ReadonlyArray<RunPerformanceRecord | null>;
  readonly previous: TaskOutcomeRecord | null;
  readonly reverted: boolean;
  readonly observedAt: string;
}): TaskOutcomeRecord => {
  const repairAttemptIds = new Set(
    input.agentRuns.flatMap((run) =>
      run.purpose === "verification_repair" || run.repairAttemptId != null
        ? [run.repairAttemptId ?? run.id]
        : [],
    ),
  );
  const orderedVerificationRuns = input.verificationRuns.toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const firstVerification = orderedVerificationRuns.find(
    ({ result, invalidatedAt }) => result !== null || invalidatedAt !== null,
  );
  const firstPassVerification =
    firstVerification === undefined
      ? null
      : firstVerification.invalidatedAt === null &&
        (firstVerification.result === "passed" ||
          firstVerification.result === "passed_with_warnings") &&
        repairAttemptIds.size === 0;
  const taskTerminal = terminalTaskStatuses.has(
    input.task.status as "completed" | "cancelled" | "failed",
  );
  const outcomeStatus = taskOutcomeStatus(input.task.status);
  const implementationCompleted =
    input.task.status === "verification" ||
    input.task.status === "completed" ||
    input.agentRuns.some(
      ({ purpose, status }) =>
        (purpose === undefined || purpose === "implementation") && status === "completed",
    );

  return {
    id: TaskOutcomeRecordId.make(`task-outcome:${input.task.id}`),
    taskId: input.task.id,
    missionId: input.task.missionId,
    status: outcomeStatus,
    implementationCompleted,
    verificationResult: resolvedVerificationResult(
      input.verificationRuns,
      input.verificationOverrides,
      taskTerminal,
    ),
    integrationResult: integrationResult(input.task.integrationStatus),
    humanDisposition: input.previous?.humanDisposition ?? "not_reviewed",
    reverted: input.reverted || input.previous?.reverted === true,
    firstPassVerification,
    repairAttemptCount: repairAttemptIds.size,
    agentRunCount: input.agentRuns.length,
    totalWallClockDurationMilliseconds: sumComplete(
      input.performance.map((record) => record?.wallClockDurationMilliseconds ?? null),
    ),
    totalActiveAgentDurationMilliseconds: sumComplete(
      input.performance.map((record) => record?.activeDurationMilliseconds ?? null),
    ),
    createdAt: input.previous?.createdAt ?? input.task.createdAt,
    updatedAt: input.observedAt,
    finalizedAt: outcomeStatus === "pending" ? null : input.observedAt,
  };
};

export const deriveMissionOutcome = (input: {
  readonly mission: Mission;
  readonly taskOutcomes: ReadonlyArray<TaskOutcomeRecord>;
  readonly previous: MissionOutcomeRecord | null;
  readonly pullRequestCreated: boolean;
  readonly pullRequestMerged: boolean;
  readonly observedAt: string;
}): MissionOutcomeRecord => ({
  id: MissionOutcomeRecordId.make(`mission-outcome:${input.mission.id}`),
  missionId: input.mission.id,
  status: missionOutcomeStatus(input.mission.status),
  taskCount: input.taskOutcomes.length,
  completedTaskCount: input.taskOutcomes.filter(({ status }) => status === "completed").length,
  failedTaskCount: input.taskOutcomes.filter(({ status }) => status === "failed").length,
  verifiedTaskCount: input.taskOutcomes.filter(
    ({ verificationResult }) =>
      verificationResult === "passed" ||
      verificationResult === "passed_with_warnings" ||
      verificationResult === "overridden",
  ).length,
  integratedTaskCount: input.taskOutcomes.filter(
    ({ integrationResult: result }) => result === "integrated",
  ).length,
  pullRequestCreated:
    input.pullRequestCreated ||
    input.pullRequestMerged ||
    input.previous?.pullRequestCreated === true,
  pullRequestMerged: input.pullRequestMerged || input.previous?.pullRequestMerged === true,
  humanDisposition: input.previous?.humanDisposition ?? "not_reviewed",
  startedAt: input.mission.startedAt,
  completedAt: input.mission.completedAt,
  createdAt: input.previous?.createdAt ?? input.mission.createdAt,
  updatedAt: input.observedAt,
});

const affectedTaskId = (event: OrchestrationEvent): MissionTaskId | null => {
  switch (event.type) {
    case "task.created":
      return event.payload.task.id;
    case "task.updated":
    case "task.started":
    case "task.implementation-completed":
    case "task.completed":
    case "task.cancelled":
    case "task.failed":
    case "task.ready":
    case "task.blocked":
    case "integration.requested":
    case "integration.approved":
    case "integration.started":
    case "integration.completed":
    case "integration.conflicted":
    case "integration.aborted":
    case "integration.failed":
      return event.payload.taskId;
    case "agent_run.started":
      return event.payload.run.taskId;
    case "agent_run.running":
    case "agent_run.completed":
    case "agent_run.cancelled":
    case "agent_run.failed":
    case "agent_run.interrupted":
      return event.payload.taskId;
    case "verification.passed":
    case "verification.passed_with_warnings":
    case "verification.failed":
    case "verification.cancelled":
    case "verification.interrupted":
    case "verification.invalidated":
      return event.payload.run.taskId;
    case "verification.repair_requested":
      return event.payload.taskId;
    case "verification.repair_started":
    case "verification.repair_completed":
    case "verification.repair_failed":
    case "verification.repair_limit_reached":
      return event.payload.attempt.taskId;
    case "verification.override_requested":
      return event.payload.taskId;
    case "verification.override_applied":
      return event.payload.override.taskId;
    default:
      return null;
  }
};

const affectedMissionId = (event: OrchestrationEvent): Mission["id"] | null => {
  switch (event.type) {
    case "mission.created":
      return event.payload.mission.id;
    case "mission.updated":
    case "mission.started":
    case "mission.cancelled":
    case "mission.completed":
    case "mission.failed":
      return event.payload.missionId;
    case "github.pull_request_created":
    case "github.pull_request_merged":
      return event.payload.missionId;
    default:
      return null;
  }
};

export const UsageAnalyticsOutcomesLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const analytics = yield* ProjectionUsageAnalyticsRepository;
    const missions = yield* ProjectionMissionRepository;
    const tasks = yield* ProjectionMissionTaskRepository;
    const agentRuns = yield* ProjectionAgentRunRepository;
    const verification = yield* ProjectionVerificationRunRepository;
    const orchestration = yield* OrchestrationEngineService;
    const audit = yield* UsageAnalyticsEventRecorder;

    const collectionEnabled = analytics
      .getSettings()
      .pipe(Effect.map(Option.match({ onNone: () => true, onSome: ({ enabled }) => enabled })));

    const rebuildTask = (input: {
      readonly taskId: MissionTaskId;
      readonly observedAt: string;
      readonly reverted: boolean;
      readonly writeAudit: boolean;
    }) =>
      Effect.gen(function* () {
        const task = Option.getOrNull(yield* tasks.getById({ taskId: input.taskId }));
        if (task === null) return null;
        const runs = (yield* agentRuns.listByMissionId({ missionId: task.missionId })).filter(
          ({ taskId }) => taskId === task.id,
        );
        const [verificationRuns, overrides, previous, performance] = yield* Effect.all(
          [
            verification.listRunsByTaskId({ taskId: task.id }),
            verification.listOverridesByTaskId({ taskId: task.id }),
            analytics.getTaskOutcome({ taskId: task.id }),
            Effect.forEach(runs, (run) =>
              analytics
                .getRunPerformance({ agentRunId: run.id })
                .pipe(Effect.map(Option.getOrNull)),
            ),
          ],
          { concurrency: "unbounded" },
        );
        const record = deriveTaskOutcome({
          task,
          agentRuns: runs,
          verificationRuns,
          verificationOverrides: overrides,
          performance,
          previous: Option.getOrNull(previous),
          reverted: input.reverted,
          observedAt: input.observedAt,
        });
        yield* analytics.upsertTaskOutcome(record);
        if (input.writeAudit) {
          const mission = Option.getOrNull(yield* missions.getById({ missionId: task.missionId }));
          if (mission !== null) {
            yield* audit.record({
              eventType: "analytics.task_outcome_updated",
              aggregateId: `analytics:${mission.projectId}`,
              payload: {
                recordType: "task_outcome",
                recordId: record.id,
                projectId: mission.projectId,
                missionId: mission.id,
                taskId: task.id,
                agentRunId: null,
                usageRecordId: null,
                costRecordId: null,
                budgetPolicyId: null,
                exportId: null,
                retentionOperationId: null,
                humanDispositionRecordId: null,
                detail: null,
              },
            });
          }
        }
        return task.missionId;
      });

    const rebuildMission = (input: {
      readonly missionId: Mission["id"];
      readonly observedAt: string;
      readonly pullRequestCreated: boolean;
      readonly pullRequestMerged: boolean;
      readonly writeAudit: boolean;
    }) =>
      Effect.gen(function* () {
        const mission = Option.getOrNull(yield* missions.getById({ missionId: input.missionId }));
        if (mission === null) return;
        const missionTasks = yield* tasks.listByMissionId({ missionId: mission.id });
        const [previous, outcomes] = yield* Effect.all([
          analytics.getMissionOutcome({ missionId: mission.id }),
          Effect.forEach(missionTasks, (task) =>
            analytics.getTaskOutcome({ taskId: task.id }).pipe(Effect.map(Option.getOrNull)),
          ),
        ]);
        const record = deriveMissionOutcome({
          mission,
          taskOutcomes: outcomes.filter(
            (outcome): outcome is TaskOutcomeRecord => outcome !== null,
          ),
          previous: Option.getOrNull(previous),
          pullRequestCreated: input.pullRequestCreated,
          pullRequestMerged: input.pullRequestMerged,
          observedAt: input.observedAt,
        });
        yield* analytics.upsertMissionOutcome(record);
        if (input.writeAudit) {
          yield* audit.record({
            eventType: "analytics.mission_outcome_updated",
            aggregateId: `analytics:${mission.projectId}`,
            payload: {
              recordType: "mission_outcome",
              recordId: record.id,
              projectId: mission.projectId,
              missionId: mission.id,
              taskId: null,
              agentRunId: null,
              usageRecordId: null,
              costRecordId: null,
              budgetPolicyId: null,
              exportId: null,
              retentionOperationId: null,
              humanDispositionRecordId: null,
              detail: null,
            },
          });
        }
      });

    const handleEvent = (event: OrchestrationEvent) =>
      Effect.gen(function* () {
        if (!(yield* collectionEnabled)) return;
        if (event.type === "thread.reverted") {
          const run = Option.getOrNull(
            yield* agentRuns.getByThreadId({ threadId: event.payload.threadId }),
          );
          if (run?.taskId === null || run?.taskId === undefined) return;
          const missionId = yield* rebuildTask({
            taskId: run.taskId,
            observedAt: event.occurredAt,
            reverted: true,
            writeAudit: true,
          });
          if (missionId !== null) {
            yield* rebuildMission({
              missionId,
              observedAt: event.occurredAt,
              pullRequestCreated: false,
              pullRequestMerged: false,
              writeAudit: true,
            });
          }
          return;
        }

        const taskId = affectedTaskId(event);
        if (taskId !== null) {
          const missionId = yield* rebuildTask({
            taskId,
            observedAt: event.occurredAt,
            reverted: false,
            writeAudit: true,
          });
          if (missionId !== null) {
            yield* rebuildMission({
              missionId,
              observedAt: event.occurredAt,
              pullRequestCreated: false,
              pullRequestMerged: false,
              writeAudit: true,
            });
          }
          return;
        }

        const missionId = affectedMissionId(event);
        if (missionId !== null) {
          yield* rebuildMission({
            missionId,
            observedAt: event.occurredAt,
            pullRequestCreated: event.type === "github.pull_request_created",
            pullRequestMerged: event.type === "github.pull_request_merged",
            writeAudit: true,
          });
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning(
                "analytics outcome projection failed without affecting orchestration",
                {
                  eventType: event.type,
                  eventId: event.eventId,
                  cause: Cause.pretty(cause),
                },
              ),
        ),
      );

    yield* Effect.gen(function* () {
      if (!(yield* collectionEnabled)) return;
      const existingMissions = yield* missions.listAll();
      yield* Effect.forEach(
        existingMissions,
        (mission) =>
          Effect.gen(function* () {
            const missionTasks = yield* tasks.listByMissionId({ missionId: mission.id });
            yield* Effect.forEach(
              missionTasks,
              (task) =>
                rebuildTask({
                  taskId: task.id,
                  observedAt: task.updatedAt,
                  reverted: false,
                  writeAudit: false,
                }),
              { concurrency: 4, discard: true },
            );
            yield* rebuildMission({
              missionId: mission.id,
              observedAt: mission.updatedAt,
              pullRequestCreated: false,
              pullRequestMerged: false,
              writeAudit: false,
            });
          }),
        { concurrency: 2, discard: true },
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("analytics outcome backfill could not complete", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* forkParked(Stream.runForEach(orchestration.streamDomainEvents, handleEvent));
  }),
);
