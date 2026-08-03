import {
  CommandId,
  ManagedWorktreeId,
  MissionId,
  canTransitionManagedWorktree,
  hasWritePermission,
  isActiveAgentRunStatus,
  type ManagedWorktree,
  type ManagedWorktreeStatus,
  type MissionTask,
  type OrchestrationEvent,
  type OrchestrationMissionDetailSnapshot,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import {
  MissionGitService,
  makeManagedWorktreeNames,
  sanitizeManagedGitSegment,
  type ManagedGitError,
  type ManagedWorktreeCreation,
  type WorktreeStatus,
} from "../../mission-git/MissionGitService.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  MissionWorktreeReactor,
  type MissionWorktreeReactorShape,
} from "../Services/MissionWorktreeReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

type WorktreeTrigger = Extract<
  OrchestrationEvent,
  {
    type:
      | "scheduler.started"
      | "scheduler.resumed"
      | "mission.team-configured"
      | "mission.agent-upserted"
      | "mission.agent-permissions-updated"
      | "task.created"
      | "task.updated"
      | "task.completed"
      | "task.failed"
      | "task.retry-requested"
      | "task.cancellation-requested"
      | "agent_run.started"
      | "agent_run.running"
      | "agent_run.completed"
      | "agent_run.failed"
      | "agent_run.interrupted"
      | "managed_worktree.recorded"
      | "managed_worktree.status-updated"
      | "managed_worktree.removal-requested"
      | "integration.approved"
      | "integration.aborted";
  }
>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const activeProvisioningStatuses = new Set(["backlog", "ready", "blocked", "running", "failed"]);
const inspectableStatuses = new Set<ManagedWorktreeStatus>([
  "planned",
  "creating",
  "ready",
  "active",
  "dirty",
  "conflicted",
  "integration_ready",
  "integrated",
  "removing",
  "failed",
  "orphaned",
]);

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
};

const commandId = (missionId: MissionId, action: string) =>
  CommandId.make(
    `server:mission-worktree:${stableHash(`${missionId}:${action}`)}:${action.slice(0, 80)}`,
  );

const worktreeId = (missionId: MissionId, taskId?: string) =>
  ManagedWorktreeId.make(
    taskId === undefined
      ? `mission:${missionId}:integration-worktree`
      : `mission:${missionId}:task:${taskId}:worktree`,
  );

export const makeMissionWorktreesRoot = (
  path: Path.Path,
  workspaceRoot: string,
  projectId: string,
): string => {
  const repositoryName = sanitizeManagedGitSegment(path.basename(workspaceRoot), "repository");
  return path.join(
    path.dirname(path.resolve(workspaceRoot)),
    ".lyn-code-worktrees",
    `${repositoryName}-${stableHash(projectId)}`,
  );
};

const sameStrings = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const nextTransition = (
  current: ManagedWorktreeStatus,
  desired: ManagedWorktreeStatus,
): ManagedWorktreeStatus | null => {
  if (canTransitionManagedWorktree(current, desired)) return desired;
  if (current === "failed" || current === "orphaned") return "planned";
  if (current === "planned") return "creating";
  if (current === "creating") return "ready";
  if (current === "ready" && desired === "conflicted") return "dirty";
  if (current === "ready" && desired === "integrated") return "integration_ready";
  if (current === "active" && desired === "integrated") return "integration_ready";
  if (current === "dirty" && desired === "integrated") return "integration_ready";
  if (current === "conflicted" && desired === "ready") return "dirty";
  if (current === "conflicted" && desired === "active") return "dirty";
  if (current === "conflicted" && desired === "integrated") return "integration_ready";
  return null;
};

const statusError = (error: ManagedGitError) => `${error.code}: ${error.detail}`;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const projects = yield* ProjectionProjectRepository;
  const git = yield* MissionGitService;
  const path = yield* Path.Path;

  if (query.getMissionDetailSnapshot === undefined) {
    return {
      start: Effect.fn("MissionWorktreeReactor.start")(function* () {}),
      reconcileMission: () => Effect.void,
      drain: Effect.void,
    } satisfies MissionWorktreeReactorShape;
  }
  const getMissionDetailSnapshot = query.getMissionDetailSnapshot;
  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command).pipe(Effect.asVoid);

  const getProject = Effect.fn("MissionWorktreeReactor.getProject")(function* (
    detail: OrchestrationMissionDetailSnapshot,
  ) {
    const project = yield* projects.getById({ projectId: detail.mission.projectId });
    return yield* Option.match(project, {
      onNone: () =>
        Effect.die(
          new Error(`Project '${detail.mission.projectId}' has no projected workspace root.`),
        ),
      onSome: Effect.succeed,
    });
  });

  const dispatchStatus = Effect.fn("MissionWorktreeReactor.dispatchStatus")(function* (input: {
    readonly worktree: ManagedWorktree;
    readonly status: ManagedWorktreeStatus;
    readonly headCommit?: string | null;
    readonly changedFileCount?: number;
    readonly hasUncommittedChanges?: boolean;
    readonly conflictingFiles?: ReadonlyArray<string>;
    readonly errorSummary?: string | null;
    readonly removedAt?: string | null;
  }) {
    const finalFieldsUnchanged =
      input.worktree.status === input.status &&
      (input.headCommit === undefined || input.worktree.headCommit === input.headCommit) &&
      (input.changedFileCount === undefined ||
        input.worktree.changedFileCount === input.changedFileCount) &&
      (input.hasUncommittedChanges === undefined ||
        input.worktree.hasUncommittedChanges === input.hasUncommittedChanges) &&
      (input.conflictingFiles === undefined ||
        sameStrings(input.worktree.conflictingFiles, input.conflictingFiles)) &&
      (input.errorSummary === undefined || input.worktree.errorSummary === input.errorSummary) &&
      (input.removedAt === undefined || input.worktree.removedAt === input.removedAt);
    if (finalFieldsUnchanged) return;

    let current = input.worktree.status;
    for (let step = 0; current !== input.status && step < 5; step += 1) {
      const next = nextTransition(current, input.status);
      if (next === null) {
        yield* Effect.logWarning("managed worktree status transition was not representable", {
          worktreeId: input.worktree.id,
          current,
          desired: input.status,
        });
        return;
      }
      const updatedAt = yield* nowIso;
      yield* dispatch({
        type: "mission.worktree.status.update",
        commandId: commandId(
          input.worktree.missionId,
          `${input.worktree.id}:transition:${current}:${next}:${updatedAt}`,
        ),
        missionId: input.worktree.missionId,
        worktreeId: input.worktree.id,
        status: next,
        updatedAt,
      });
      current = next;
    }
    if (current !== input.status) return;

    const hasFinalFields =
      input.headCommit !== undefined ||
      input.changedFileCount !== undefined ||
      input.hasUncommittedChanges !== undefined ||
      input.conflictingFiles !== undefined ||
      input.errorSummary !== undefined ||
      input.removedAt !== undefined;
    if (!hasFinalFields && input.worktree.status !== input.status) return;
    const updatedAt = yield* nowIso;
    const fingerprint = stableHash(
      [
        input.status,
        input.headCommit ?? "",
        input.changedFileCount?.toString() ?? "",
        input.hasUncommittedChanges?.toString() ?? "",
        input.conflictingFiles?.join("\0") ?? "",
        input.errorSummary ?? "",
        input.removedAt ?? "",
      ].join("\u0001"),
    );
    yield* dispatch({
      type: "mission.worktree.status.update",
      commandId: commandId(
        input.worktree.missionId,
        `${input.worktree.id}:observe:${input.status}:${fingerprint}:${updatedAt}`,
      ),
      missionId: input.worktree.missionId,
      worktreeId: input.worktree.id,
      status: input.status,
      ...(input.headCommit === undefined ? {} : { headCommit: input.headCommit }),
      ...(input.changedFileCount === undefined ? {} : { changedFileCount: input.changedFileCount }),
      ...(input.hasUncommittedChanges === undefined
        ? {}
        : { hasUncommittedChanges: input.hasUncommittedChanges }),
      ...(input.conflictingFiles === undefined ? {} : { conflictingFiles: input.conflictingFiles }),
      ...(input.errorSummary === undefined ? {} : { errorSummary: input.errorSummary }),
      ...(input.removedAt === undefined ? {} : { removedAt: input.removedAt }),
      updatedAt,
    });
  });

  const desiredStatus = (input: {
    readonly detail: OrchestrationMissionDetailSnapshot;
    readonly worktree: ManagedWorktree;
    readonly status: WorktreeStatus;
    readonly recovery: boolean;
  }): ManagedWorktreeStatus => {
    const { detail, worktree, status, recovery } = input;
    if (status.hasConflicts || status.inProgressOperation !== null) return "conflicted";
    if (status.isDirty) return "dirty";
    if (worktree.purpose === "integration") return "ready";
    const task = detail.tasks.find((entry) => entry.id === worktree.taskId);
    if (task?.integrationStatus === "integrated") return "integrated";
    if (
      task?.status === "completed" ||
      task?.integrationStatus === "pending" ||
      task?.integrationStatus === "ready" ||
      task?.integrationStatus === "integrating" ||
      task?.integrationStatus === "conflicted"
    ) {
      return "integration_ready";
    }
    const hasActiveRun = detail.agentRuns.some(
      (run) => run.worktreeId === worktree.id && isActiveAgentRunStatus(run.status) && !recovery,
    );
    return hasActiveRun ? "active" : "ready";
  };

  const reconcileDetail = Effect.fn("MissionWorktreeReactor.reconcileDetail")(function* (
    detail: OrchestrationMissionDetailSnapshot,
    recovery: boolean,
  ) {
    const project = yield* getProject(detail);
    const root = makeMissionWorktreesRoot(path, project.workspaceRoot, project.projectId);
    const managed = detail.managedWorktrees.filter((worktree) =>
      inspectableStatuses.has(worktree.status),
    );
    if (managed.length === 0) return;
    const reconciliation = yield* git.reconcileManagedWorktrees({
      repositoryPath: managed[0]!.repositoryPath,
      worktreesRoot: root,
      managedWorktrees: managed.map((worktree) => ({
        id: worktree.id,
        path: worktree.worktreePath,
        branchName: worktree.branchName,
      })),
    });
    const integration = managed.find((worktree) => worktree.purpose === "integration");
    for (const worktree of managed) {
      const actual = reconciliation.managed.find((entry) => entry.id === worktree.id);
      if (actual === undefined) continue;
      if (actual.state !== "healthy") {
        const detailText =
          actual.state === "moved"
            ? `Git branch '${worktree.branchName}' is registered at '${actual.actualPath}'.`
            : actual.state === "branch-mismatch"
              ? `Expected branch '${worktree.branchName}', found '${actual.actualBranch ?? "detached HEAD"}'.`
              : actual.state === "prunable"
                ? "Git reports this managed worktree as prunable."
                : "Git no longer has this managed worktree registered.";
        yield* dispatchStatus({
          worktree,
          status: worktree.status === "integration_ready" ? "failed" : "orphaned",
          errorSummary: detailText,
        });
        continue;
      }
      if (worktree.status === "removing") {
        yield* dispatchStatus({
          worktree,
          status: "removing",
          errorSummary: "Removal was interrupted; request removal again to retry safely.",
        });
        continue;
      }
      const status = yield* git.inspectWorktreeStatus({
        repositoryPath: project.workspaceRoot,
        worktreePath: worktree.worktreePath,
        ...(worktree.purpose === "task" && integration !== undefined
          ? { integrationRef: integration.branchName }
          : {}),
      });
      if (worktree.status === "integrated" && (status.isDirty || status.hasConflicts)) {
        yield* dispatchStatus({
          worktree,
          status: "orphaned",
          headCommit: status.headCommit,
          changedFileCount: status.changedPaths.length,
          hasUncommittedChanges: status.isDirty,
          conflictingFiles: status.conflictingFiles,
          errorSummary: "An integrated managed worktree was mutated outside Lyn Code.",
        });
        continue;
      }
      const desired = desiredStatus({ detail, worktree, status, recovery });
      const committedChangedPaths =
        worktree.purpose === "task" && status.headCommit !== null
          ? yield* git.detectChangedFiles({
              repositoryPath: worktree.repositoryPath,
              baseRef: worktree.baseCommit,
              headRef: status.headCommit,
            })
          : [];
      const changedFileCount = new Set([...status.changedPaths, ...committedChangedPaths]).size;
      yield* dispatchStatus({
        worktree,
        status: desired,
        headCommit: status.headCommit,
        changedFileCount,
        hasUncommittedChanges: status.isDirty,
        conflictingFiles: status.conflictingFiles,
        errorSummary: null,
      });
    }
    if (reconciliation.unknownManagedWorktrees.length > 0) {
      yield* Effect.logWarning("unrecorded worktrees exist under the managed sibling root", {
        missionId: detail.mission.id,
        paths: reconciliation.unknownManagedWorktrees.map((entry) => entry.path),
      });
    }
  });

  const adoptExisting = Effect.fn("MissionWorktreeReactor.adoptExisting")(function* (input: {
    readonly repositoryPath: string;
    readonly worktreePath: string;
    readonly branchName: string;
    readonly baseRef: string;
  }): Effect.fn.Return<ManagedWorktreeCreation | null, ManagedGitError> {
    const repository = yield* git.inspectRepository({ repositoryPath: input.repositoryPath });
    const actual = repository.worktrees.find(
      (entry) =>
        path.normalize(path.resolve(entry.path)) ===
          path.normalize(path.resolve(input.worktreePath)) && entry.branch === input.branchName,
    );
    if (actual?.headCommit === null || actual === undefined) return null;
    const baseCommit = yield* git.calculateMergeBase({
      repositoryPath: repository.repositoryRoot,
      leftRef: input.baseRef,
      rightRef: input.branchName,
    });
    return {
      repositoryPath: repository.repositoryRoot,
      worktreePath: actual.path,
      branchName: input.branchName,
      baseRef: input.baseRef,
      baseCommit,
      headCommit: actual.headCommit,
      mainWorktreeDirty: repository.isDirty,
    };
  });

  const recordCreation = Effect.fn("MissionWorktreeReactor.recordCreation")(function* (input: {
    readonly detail: OrchestrationMissionDetailSnapshot;
    readonly task: MissionTask | null;
    readonly id: ManagedWorktreeId;
    readonly creation: ManagedWorktreeCreation;
    readonly purpose: "integration" | "task";
  }) {
    const recordedAt = yield* nowIso;
    yield* dispatch({
      type: "mission.worktree.record",
      commandId: commandId(
        input.detail.mission.id,
        `${input.id}:record:${input.creation.headCommit}`,
      ),
      missionId: input.detail.mission.id,
      worktree: {
        id: input.id,
        projectId: input.detail.mission.projectId,
        missionId: input.detail.mission.id,
        taskId: input.task?.id ?? null,
        purpose: input.purpose,
        repositoryPath: input.creation.repositoryPath,
        worktreePath: input.creation.worktreePath,
        branchName: input.creation.branchName,
        baseBranch: input.creation.baseRef,
        baseCommit: input.creation.baseCommit,
        headCommit: input.creation.headCommit,
        status: "ready",
        changedFileCount: 0,
        hasUncommittedChanges: false,
        conflictingFiles: [],
        createdAt: recordedAt,
        updatedAt: recordedAt,
        removedAt: null,
        errorSummary: null,
      },
    });
  });

  const createOrAdopt = Effect.fn("MissionWorktreeReactor.createOrAdopt")(function* (input: {
    readonly repositoryPath: string;
    readonly worktreesRoot: string;
    readonly missionName: string;
    readonly taskName: string;
    readonly shortId: string;
    readonly baseRef: string;
    readonly branchName: string;
    readonly worktreePath: string;
    readonly purpose: "integration" | "task";
  }) {
    const existing = yield* adoptExisting(input);
    if (existing !== null) return existing;
    return yield* input.purpose === "integration"
      ? git.createMissionIntegrationBranch(input)
      : git.createManagedWorktree({ ...input, kind: "task" });
  });

  const provisionDetail = Effect.fn("MissionWorktreeReactor.provisionDetail")(function* (
    initial: OrchestrationMissionDetailSnapshot,
  ) {
    if (initial.mission.status === "completed" || initial.mission.status === "cancelled") return;
    const writeTasks = initial.tasks.filter((task) => {
      if (task.assignedMissionAgentId === null || !activeProvisioningStatuses.has(task.status)) {
        return false;
      }
      const agent = initial.missionAgents.find((entry) => entry.id === task.assignedMissionAgentId);
      return agent !== undefined && hasWritePermission(agent.permissions);
    });
    if (writeTasks.length === 0) return;
    const project = yield* getProject(initial);
    const root = makeMissionWorktreesRoot(path, project.workspaceRoot, project.projectId);
    let detail = initial;
    let integration = detail.managedWorktrees.find(
      (worktree) => worktree.purpose === "integration" && worktree.status !== "removed",
    );
    if (integration === undefined) {
      const id = worktreeId(detail.mission.id);
      const shortId = stableHash(id);
      const names = makeManagedWorktreeNames({
        missionName: detail.mission.title,
        taskName: "integration",
        shortId,
        kind: "integration",
      });
      const defaultBranch = yield* git.resolveDefaultBranch(project.workspaceRoot);
      const worktreePath = path.join(root, names.directoryName);
      const creation = yield* createOrAdopt({
        repositoryPath: project.workspaceRoot,
        worktreesRoot: root,
        missionName: detail.mission.title,
        taskName: "integration",
        shortId,
        baseRef: defaultBranch.refName,
        branchName: names.branchName,
        worktreePath,
        purpose: "integration",
      });
      yield* recordCreation({ detail, task: null, id, creation, purpose: "integration" });
      const refreshed = yield* getMissionDetailSnapshot(detail.mission.id);
      if (Option.isNone(refreshed)) return;
      detail = refreshed.value;
      integration = detail.managedWorktrees.find(
        (worktree) => worktree.purpose === "integration" && worktree.status !== "removed",
      );
    }
    if (integration?.status !== "ready") return;

    for (const originalTask of writeTasks.sort((left, right) => left.position - right.position)) {
      const refreshed = yield* getMissionDetailSnapshot(detail.mission.id);
      if (Option.isNone(refreshed)) return;
      detail = refreshed.value;
      const task = detail.tasks.find((entry) => entry.id === originalTask.id);
      if (task === undefined) continue;
      const existing = detail.managedWorktrees.find(
        (worktree) => worktree.taskId === task.id && worktree.status !== "removed",
      );
      if (existing !== undefined) continue;
      const id = worktreeId(detail.mission.id, task.id);
      const shortId = stableHash(id);
      const names = makeManagedWorktreeNames({
        missionName: detail.mission.title,
        taskName: task.title,
        shortId,
        kind: "task",
      });
      const creation = yield* createOrAdopt({
        repositoryPath: project.workspaceRoot,
        worktreesRoot: root,
        missionName: detail.mission.title,
        taskName: task.title,
        shortId,
        baseRef: integration.branchName,
        branchName: names.branchName,
        worktreePath: path.join(root, names.directoryName),
        purpose: "task",
      });
      yield* recordCreation({ detail, task, id, creation, purpose: "task" });
    }
  });

  const recoverIntegrations = Effect.fn("MissionWorktreeReactor.recoverIntegrations")(function* (
    detail: OrchestrationMissionDetailSnapshot,
  ) {
    const integration = detail.managedWorktrees.find(
      (worktree) => worktree.purpose === "integration" && worktree.status !== "removed",
    );
    if (integration === undefined) return;
    for (const task of detail.tasks.filter((entry) => entry.integrationStatus === "integrating")) {
      const worktree = detail.managedWorktrees.find((entry) => entry.id === task.worktreeId);
      if (worktree === undefined) continue;
      const taskStatus = yield* git.inspectWorktreeStatus({
        repositoryPath: worktree.repositoryPath,
        worktreePath: worktree.worktreePath,
        integrationRef: integration.branchName,
      });
      const integrationStatus = yield* git.inspectWorktreeStatus({
        repositoryPath: integration.repositoryPath,
        worktreePath: integration.worktreePath,
      });
      const occurredAt = yield* nowIso;
      if (integrationStatus.hasConflicts || integrationStatus.inProgressOperation === "merge") {
        yield* dispatch({
          type: "mission.integration.conflict",
          commandId: commandId(detail.mission.id, `${task.id}:restart:conflict`),
          missionId: detail.mission.id,
          taskId: task.id,
          worktreeId: worktree.id,
          conflictingFiles: integrationStatus.conflictingFiles,
          occurredAt,
        });
      } else if (taskStatus.integrated === true && integrationStatus.headCommit !== null) {
        yield* dispatch({
          type: "mission.integration.complete",
          commandId: commandId(
            detail.mission.id,
            `${task.id}:restart:complete:${integrationStatus.headCommit}`,
          ),
          missionId: detail.mission.id,
          taskId: task.id,
          worktreeId: worktree.id,
          headCommit: integrationStatus.headCommit,
          occurredAt,
        });
      } else {
        yield* dispatch({
          type: "mission.integration.fail",
          commandId: commandId(detail.mission.id, `${task.id}:restart:interrupted`),
          missionId: detail.mission.id,
          taskId: task.id,
          worktreeId: worktree.id,
          errorSummary: "Server restarted before integration completed; Git merge was not resumed.",
          occurredAt,
        });
      }
    }
  });

  const reconcileMissionInternal = Effect.fn("MissionWorktreeReactor.reconcileMissionInternal")(
    function* (missionId: MissionId, recovery: boolean, provision: boolean) {
      const snapshot = yield* getMissionDetailSnapshot(missionId);
      if (Option.isNone(snapshot)) return;
      yield* reconcileDetail(snapshot.value, recovery);
      const refreshed = yield* getMissionDetailSnapshot(missionId);
      if (Option.isNone(refreshed)) return;
      if (recovery) yield* recoverIntegrations(refreshed.value);
      if (provision) {
        const latest = yield* getMissionDetailSnapshot(missionId);
        if (Option.isSome(latest)) yield* provisionDetail(latest.value);
      }
    },
  );

  const integrateApproved = Effect.fn("MissionWorktreeReactor.integrateApproved")(function* (
    event: Extract<OrchestrationEvent, { type: "integration.approved" }>,
  ) {
    yield* reconcileMissionInternal(event.payload.missionId, false, false);
    const snapshot = yield* getMissionDetailSnapshot(event.payload.missionId);
    if (Option.isNone(snapshot)) return;
    const detail = snapshot.value;
    const task = detail.tasks.find((entry) => entry.id === event.payload.taskId);
    const taskWorktree = detail.managedWorktrees.find(
      (entry) => entry.id === event.payload.worktreeId && entry.taskId === event.payload.taskId,
    );
    const integration = detail.managedWorktrees.find(
      (entry) => entry.purpose === "integration" && entry.status !== "removed",
    );
    if (task === undefined || taskWorktree === undefined || integration === undefined) return;
    const taskStatus = yield* git.inspectWorktreeStatus({
      repositoryPath: taskWorktree.repositoryPath,
      worktreePath: taskWorktree.worktreePath,
      integrationRef: integration.branchName,
    });
    const integrationStatus = yield* git.inspectWorktreeStatus({
      repositoryPath: integration.repositoryPath,
      worktreePath: integration.worktreePath,
    });
    const startedAt = yield* nowIso;
    yield* dispatch({
      type: "mission.integration.start",
      commandId: commandId(detail.mission.id, `${task.id}:integration:start:${event.sequence}`),
      missionId: detail.mission.id,
      taskId: task.id,
      worktreeId: taskWorktree.id,
      occurredAt: startedAt,
    });
    const result = yield* git
      .integrateTaskBranch({
        repositoryPath: integration.repositoryPath,
        integrationWorktreePath: integration.worktreePath,
        integrationBranch: integration.branchName,
        taskBranch: taskWorktree.branchName,
        approved: true,
        ...(integrationStatus.headCommit === null
          ? {}
          : { expectedIntegrationHeadCommit: integrationStatus.headCommit }),
        ...(taskStatus.headCommit === null
          ? {}
          : { expectedTaskHeadCommit: taskStatus.headCommit }),
      })
      .pipe(Effect.result);
    const occurredAt = yield* nowIso;
    if (result._tag === "Failure") {
      yield* dispatch({
        type: "mission.integration.fail",
        commandId: commandId(
          detail.mission.id,
          `${task.id}:integration:fail:${stableHash(statusError(result.failure))}`,
        ),
        missionId: detail.mission.id,
        taskId: task.id,
        worktreeId: taskWorktree.id,
        errorSummary: statusError(result.failure),
        occurredAt,
      });
      yield* dispatchStatus({
        worktree: taskWorktree,
        status: "failed",
        errorSummary: statusError(result.failure),
      });
      return;
    }
    if (result.success.status === "conflicted") {
      yield* dispatch({
        type: "mission.integration.conflict",
        commandId: commandId(
          detail.mission.id,
          `${task.id}:integration:conflict:${stableHash(result.success.conflictingFiles.join("\0"))}`,
        ),
        missionId: detail.mission.id,
        taskId: task.id,
        worktreeId: taskWorktree.id,
        conflictingFiles: result.success.conflictingFiles,
        occurredAt,
      });
      if (result.success.mergeStarted) {
        yield* dispatchStatus({
          worktree: integration,
          status: "conflicted",
          headCommit: result.success.integrationHeadCommit,
          changedFileCount: result.success.conflictingFiles.length,
          hasUncommittedChanges: true,
          conflictingFiles: result.success.conflictingFiles,
          errorSummary: "Integration stopped with unresolved merge conflicts.",
        });
      }
      return;
    }
    yield* dispatch({
      type: "mission.integration.complete",
      commandId: commandId(
        detail.mission.id,
        `${task.id}:integration:complete:${result.success.headCommit}`,
      ),
      missionId: detail.mission.id,
      taskId: task.id,
      worktreeId: taskWorktree.id,
      headCommit: result.success.headCommit,
      occurredAt,
    });
    yield* dispatchStatus({
      worktree: integration,
      status: "ready",
      headCommit: result.success.headCommit,
      changedFileCount: 0,
      hasUncommittedChanges: false,
      conflictingFiles: [],
      errorSummary: null,
    });
  });

  const abortIntegration = Effect.fn("MissionWorktreeReactor.abortIntegration")(function* (
    event: Extract<OrchestrationEvent, { type: "integration.aborted" }>,
  ) {
    const snapshot = yield* getMissionDetailSnapshot(event.payload.missionId);
    if (Option.isNone(snapshot)) return;
    const integration = snapshot.value.managedWorktrees.find(
      (entry) => entry.purpose === "integration" && entry.status !== "removed",
    );
    if (integration === undefined) return;
    yield* git.abortIntegration({
      repositoryPath: integration.repositoryPath,
      integrationWorktreePath: integration.worktreePath,
      integrationBranch: integration.branchName,
    });
    yield* reconcileMissionInternal(event.payload.missionId, false, false);
  });

  const removeWorktree = Effect.fn("MissionWorktreeReactor.removeWorktree")(function* (
    event: Extract<OrchestrationEvent, { type: "managed_worktree.removal-requested" }>,
  ) {
    yield* reconcileMissionInternal(event.payload.missionId, false, false);
    const snapshot = yield* getMissionDetailSnapshot(event.payload.missionId);
    if (Option.isNone(snapshot)) return;
    const detail = snapshot.value;
    const worktree = detail.managedWorktrees.find((entry) => entry.id === event.payload.worktreeId);
    if (worktree === undefined || worktree.status === "removed") return;
    const active = detail.agentRuns.some(
      (run) => run.worktreeId === worktree.id && isActiveAgentRunStatus(run.status),
    );
    if (active || !canTransitionManagedWorktree(worktree.status, "removing")) {
      yield* dispatchStatus({
        worktree,
        status: worktree.status,
        errorSummary: active
          ? "Removal refused because an active agent still owns this worktree."
          : `Removal refused while the worktree is '${worktree.status}'. Resolve or integrate it first.`,
      });
      return;
    }
    yield* dispatchStatus({ worktree, status: "removing", errorSummary: null });
    const project = yield* getProject(detail);
    const integration = detail.managedWorktrees.find(
      (entry) => entry.purpose === "integration" && entry.status !== "removed",
    );
    const integratedIntoRef =
      worktree.purpose === "integration" ? worktree.branchName : integration?.branchName;
    if (integratedIntoRef === undefined) {
      yield* dispatchStatus({
        worktree: { ...worktree, status: "removing" },
        status: "failed",
        errorSummary: "Removal refused because the mission integration branch is missing.",
      });
      return;
    }
    const removal = yield* git
      .removeManagedWorktree({
        repositoryPath: worktree.repositoryPath,
        worktreesRoot: makeMissionWorktreesRoot(path, project.workspaceRoot, project.projectId),
        worktreePath: worktree.worktreePath,
        integratedIntoRef,
        active: false,
        expectedBranch: worktree.branchName,
      })
      .pipe(Effect.result);
    if (removal._tag === "Failure") {
      yield* dispatchStatus({
        worktree: { ...worktree, status: "removing" },
        status: "failed",
        errorSummary: statusError(removal.failure),
      });
      return;
    }
    const removedAt = yield* nowIso;
    yield* dispatchStatus({
      worktree: { ...worktree, status: "removing" },
      status: "removed",
      headCommit: removal.success.headCommit,
      changedFileCount: 0,
      hasUncommittedChanges: false,
      conflictingFiles: [],
      errorSummary: null,
      removedAt,
    });
  });

  const process = Effect.fn("MissionWorktreeReactor.process")(function* (event: WorktreeTrigger) {
    if (event.type === "integration.approved") {
      yield* integrateApproved(event);
      return;
    }
    if (event.type === "integration.aborted") {
      yield* abortIntegration(event);
      return;
    }
    if (event.type === "managed_worktree.removal-requested") {
      yield* removeWorktree(event);
      return;
    }
    yield* reconcileMissionInternal(MissionId.make(event.aggregateId), false, true);
  });

  const recordProvisionFailure = Effect.fn("MissionWorktreeReactor.recordProvisionFailure")(
    function* (event: WorktreeTrigger, causeSummary: string) {
      if (
        event.type === "integration.approved" ||
        event.type === "integration.aborted" ||
        event.type === "managed_worktree.removal-requested"
      )
        return;
      const missionId = MissionId.make(event.aggregateId);
      const snapshot = yield* getMissionDetailSnapshot(missionId);
      if (Option.isNone(snapshot)) return;
      const reason = `worktree_creation_failed: ${causeSummary}`.slice(0, 32_000);
      const blockedAt = yield* nowIso;
      const writeTasks = snapshot.value.tasks.filter((task) => {
        if (
          task.assignedMissionAgentId === null ||
          (task.status !== "backlog" && task.status !== "ready" && task.status !== "blocked")
        )
          return false;
        const agent = snapshot.value.missionAgents.find(
          (candidate) => candidate.id === task.assignedMissionAgentId,
        );
        return agent !== undefined && hasWritePermission(agent.permissions);
      });
      yield* Effect.forEach(
        writeTasks,
        (task) =>
          dispatch({
            type: "mission.task.mark-blocked",
            commandId: commandId(
              missionId,
              `${task.id}:worktree-creation-failed:${event.sequence}`,
            ),
            missionId,
            taskId: task.id,
            reason,
            blockedAt,
          }),
        { concurrency: 1, discard: true },
      );
    },
  );

  const processSafely = (event: WorktreeTrigger) =>
    process(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : recordProvisionFailure(event, String(Cause.squash(cause))).pipe(
              Effect.catchCause((recordCause) =>
                Effect.logError("mission worktree failure could not be projected", {
                  missionId: event.aggregateId,
                  eventType: event.type,
                  cause: Cause.pretty(cause),
                  recordCause: Cause.pretty(recordCause),
                }),
              ),
              Effect.andThen(
                Effect.logError("mission worktree reconciliation failed", {
                  missionId: event.aggregateId,
                  eventType: event.type,
                  cause: Cause.pretty(cause),
                }),
              ),
            ),
      ),
    );
  const worker = yield* makeDrainableWorker(processSafely);

  const reconcileMission: MissionWorktreeReactorShape["reconcileMission"] = (missionId) =>
    reconcileMissionInternal(missionId, false, true).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("mission worktree reconciliation failed", {
          missionId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const recover = Effect.gen(function* () {
    const snapshot = yield* query.getSnapshot();
    yield* Effect.forEach(
      snapshot.missions ?? [],
      (mission) => reconcileMissionInternal(mission.id, true, true),
      { concurrency: 1, discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("mission worktree restart reconciliation failed", {
        cause: Cause.pretty(cause),
      }),
    ),
  );

  const start: MissionWorktreeReactorShape["start"] = Effect.fn("MissionWorktreeReactor.start")(
    function* () {
      yield* recover;
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) => {
          if (
            event.aggregateKind === "mission" &&
            (event.type === "scheduler.started" ||
              event.type === "scheduler.resumed" ||
              event.type === "mission.team-configured" ||
              event.type === "mission.agent-upserted" ||
              event.type === "mission.agent-permissions-updated" ||
              event.type === "task.created" ||
              event.type === "task.updated" ||
              event.type === "task.completed" ||
              event.type === "task.failed" ||
              event.type === "task.retry-requested" ||
              event.type === "task.cancellation-requested" ||
              event.type === "agent_run.started" ||
              event.type === "agent_run.running" ||
              event.type === "agent_run.completed" ||
              event.type === "agent_run.failed" ||
              event.type === "agent_run.interrupted" ||
              event.type === "managed_worktree.recorded" ||
              event.type === "managed_worktree.status-updated" ||
              event.type === "managed_worktree.removal-requested" ||
              event.type === "integration.approved" ||
              event.type === "integration.aborted")
          ) {
            return worker.enqueue(event);
          }
          return Effect.void;
        }),
      );
    },
  );

  return { start, reconcileMission, drain: worker.drain } satisfies MissionWorktreeReactorShape;
});

export const MissionWorktreeReactorLive = Layer.effect(MissionWorktreeReactor, make);
