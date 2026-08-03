import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AgentHandoffId,
  AgentRoleId,
  AgentRunId,
  IsoDateTime,
  ManagedWorktreeId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TaskDependencyId,
  ThreadId,
  TrimmedNonEmptyString,
  VerificationRepairAttemptId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const BoundedSummary = Schema.String.check(Schema.isMaxLength(8_000));
const BoundedDetail = Schema.String.check(Schema.isMaxLength(4_000));
const BoundedCommand = Schema.String.check(Schema.isMaxLength(4_096));
const BoundedPath = TrimmedNonEmptyString.check(Schema.isMaxLength(1_024));
const BoundedUri = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));

export const DEFAULT_MAXIMUM_CONCURRENT_AGENTS = 3;
export const DEFAULT_MAXIMUM_CONCURRENT_WRITE_AGENTS = 2;
export const DEFAULT_MAXIMUM_TASK_ATTEMPTS = 3;

export const AgentPermission = Schema.Literals([
  "read_files",
  "search_repository",
  "run_safe_commands",
  "run_tests",
  "write_files",
  "create_commits",
  "manage_tasks",
  "manage_worktrees",
  "integrate_branches",
]);
export type AgentPermission = typeof AgentPermission.Type;

export const AgentPermissions = Schema.Array(AgentPermission);
export type AgentPermissions = typeof AgentPermissions.Type;

export const ALL_AGENT_PERMISSIONS: AgentPermissions = [
  "read_files",
  "search_repository",
  "run_safe_commands",
  "run_tests",
  "write_files",
  "create_commits",
  "manage_tasks",
  "manage_worktrees",
  "integrate_branches",
];

export const AgentRoleKind = Schema.Literals([
  "coordinator",
  "implementer",
  "researcher",
  "reviewer",
  "verifier",
  "custom",
]);
export type AgentRoleKind = typeof AgentRoleKind.Type;

export const AgentRole = Schema.Struct({
  id: AgentRoleId,
  name: TrimmedNonEmptyString,
  kind: AgentRoleKind,
  defaultPermissions: AgentPermissions,
  description: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentRole = typeof AgentRole.Type;

export const MissionAgentStatus = Schema.Literals(["idle", "running", "disabled", "unavailable"]);
export type MissionAgentStatus = typeof MissionAgentStatus.Type;

export const MissionAgent = Schema.Struct({
  id: MissionAgentId,
  missionId: MissionId,
  roleId: Schema.NullOr(AgentRoleId),
  roleKind: AgentRoleKind,
  displayName: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  model: Schema.NullOr(TrimmedNonEmptyString),
  reasoningLevel: Schema.NullOr(TrimmedNonEmptyString),
  permissions: AgentPermissions,
  maximumConcurrentRuns: PositiveInt,
  status: MissionAgentStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MissionAgent = typeof MissionAgent.Type;

export const TaskDependency = Schema.Struct({
  id: TaskDependencyId,
  missionId: MissionId,
  taskId: MissionTaskId,
  dependsOnTaskId: MissionTaskId,
  createdAt: IsoDateTime,
});
export type TaskDependency = typeof TaskDependency.Type;

export const ManagedWorktreePurpose = Schema.Literals(["integration", "task"]);
export type ManagedWorktreePurpose = typeof ManagedWorktreePurpose.Type;

export const ManagedWorktreeStatus = Schema.Literals([
  "planned",
  "creating",
  "ready",
  "active",
  "dirty",
  "conflicted",
  "integration_ready",
  "integrated",
  "removing",
  "removed",
  "failed",
  "orphaned",
]);
export type ManagedWorktreeStatus = typeof ManagedWorktreeStatus.Type;

export const ManagedWorktree = Schema.Struct({
  id: ManagedWorktreeId,
  projectId: ProjectId,
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  purpose: ManagedWorktreePurpose,
  repositoryPath: BoundedPath,
  worktreePath: BoundedPath,
  branchName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  baseBranch: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  baseCommit: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  headCommit: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  status: ManagedWorktreeStatus,
  changedFileCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  hasUncommittedChanges: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  conflictingFiles: Schema.Array(BoundedPath)
    .check(Schema.isMaxLength(1_000))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  removedAt: Schema.NullOr(IsoDateTime),
  errorSummary: Schema.NullOr(BoundedDetail),
});
export type ManagedWorktree = typeof ManagedWorktree.Type;

export const AgentHandoffDecision = Schema.Struct({
  decision: BoundedDetail,
  reason: BoundedDetail,
  impact: BoundedDetail,
});
export type AgentHandoffDecision = typeof AgentHandoffDecision.Type;

export const AgentHandoffChangedFile = Schema.Struct({
  path: BoundedPath,
  change: Schema.Literals(["created", "modified", "deleted"]),
  summary: BoundedDetail,
});
export type AgentHandoffChangedFile = typeof AgentHandoffChangedFile.Type;

export const AgentHandoffCommand = Schema.Struct({
  command: BoundedCommand,
  exitCode: Schema.Int,
  summary: BoundedDetail,
});
export type AgentHandoffCommand = typeof AgentHandoffCommand.Type;

export const AgentHandoffArtifact = Schema.Struct({
  kind: Schema.Literals(["file", "diff", "log", "url", "other"]),
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  uri: BoundedUri,
  summary: BoundedDetail,
});
export type AgentHandoffArtifact = typeof AgentHandoffArtifact.Type;

export const AgentHandoffReconciliationStatus = Schema.Literals([
  "pending",
  "matched",
  "corrected",
]);
export type AgentHandoffReconciliationStatus = typeof AgentHandoffReconciliationStatus.Type;

export const AgentHandoff = Schema.Struct({
  id: AgentHandoffId,
  missionId: MissionId,
  taskId: MissionTaskId,
  agentRunId: AgentRunId,
  fromMissionAgentId: MissionAgentId,
  toMissionAgentId: Schema.NullOr(MissionAgentId),
  summary: BoundedSummary,
  decisions: Schema.Array(AgentHandoffDecision).check(Schema.isMaxLength(100)),
  changedFiles: Schema.Array(AgentHandoffChangedFile).check(Schema.isMaxLength(2_000)),
  commandsRun: Schema.Array(AgentHandoffCommand).check(Schema.isMaxLength(500)),
  unresolvedProblems: Schema.Array(BoundedDetail).check(Schema.isMaxLength(100)),
  recommendedNextAction: BoundedSummary,
  artifacts: Schema.Array(AgentHandoffArtifact).check(Schema.isMaxLength(200)),
  reconciliationStatus: AgentHandoffReconciliationStatus.pipe(
    Schema.withDecodingDefault(Effect.succeed("pending")),
  ),
  reconciledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
});
export type AgentHandoff = typeof AgentHandoff.Type;

export const MissionIntegrationMode = Schema.Literals([
  "manual",
  "sequential",
  "automatic_when_clean",
]);
export type MissionIntegrationMode = typeof MissionIntegrationMode.Type;

export const MissionTeamSettings = Schema.Struct({
  maximumConcurrentAgents: PositiveInt,
  maximumConcurrentWriteAgents: PositiveInt,
  defaultMaximumTaskAttempts: PositiveInt,
  autoStartReadyTasks: Schema.Boolean,
  integrationMode: MissionIntegrationMode,
}).check(
  Schema.makeFilter((settings) =>
    settings.maximumConcurrentWriteAgents <= settings.maximumConcurrentAgents
      ? true
      : "maximumConcurrentWriteAgents must not exceed maximumConcurrentAgents",
  ),
);
export type MissionTeamSettings = typeof MissionTeamSettings.Type;

export const DEFAULT_MISSION_TEAM_SETTINGS: MissionTeamSettings = {
  maximumConcurrentAgents: DEFAULT_MAXIMUM_CONCURRENT_AGENTS,
  maximumConcurrentWriteAgents: DEFAULT_MAXIMUM_CONCURRENT_WRITE_AGENTS,
  defaultMaximumTaskAttempts: DEFAULT_MAXIMUM_TASK_ATTEMPTS,
  autoStartReadyTasks: false,
  integrationMode: "manual",
};

export const MissionSchedulerStatus = Schema.Literals(["idle", "running", "paused"]);
export type MissionSchedulerStatus = typeof MissionSchedulerStatus.Type;

export const TaskIntegrationStatus = Schema.Literals([
  "not_requested",
  "pending",
  "ready",
  "integrating",
  "integrated",
  "conflicted",
  "failed",
]);
export type TaskIntegrationStatus = typeof TaskIntegrationStatus.Type;

export const MissionStatus = Schema.Literals([
  "backlog",
  "planning",
  "ready",
  "running",
  "verification",
  "review",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
export type MissionStatus = typeof MissionStatus.Type;

export const MissionTaskStatus = Schema.Literals([
  "backlog",
  "ready",
  "running",
  "verification",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
export type MissionTaskStatus = typeof MissionTaskStatus.Type;

export const AgentRunPurpose = Schema.Literals(["implementation", "verification_repair"]);
export type AgentRunPurpose = typeof AgentRunPurpose.Type;

export const AgentRunStatus = Schema.Literals([
  "starting",
  "running",
  "cancelling",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export type AgentRunStatus = typeof AgentRunStatus.Type;

export const Mission = Schema.Struct({
  id: MissionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: MissionStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  teamSettings: MissionTeamSettings.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MISSION_TEAM_SETTINGS)),
  ),
  schedulerStatus: MissionSchedulerStatus.pipe(Schema.withDecodingDefault(Effect.succeed("idle"))),
});
export type Mission = typeof Mission.Type;

export const MissionTask = Schema.Struct({
  id: MissionTaskId,
  missionId: MissionId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: MissionTaskStatus,
  position: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assignedMissionAgentId: Schema.NullOr(MissionAgentId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  worktreeId: Schema.NullOr(ManagedWorktreeId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  attemptCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  maximumAttempts: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAXIMUM_TASK_ATTEMPTS)),
  ),
  readyAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  blockedReason: Schema.NullOr(BoundedDetail).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  integrationStatus: TaskIntegrationStatus.pipe(
    Schema.withDecodingDefault(Effect.succeed("not_requested")),
  ),
  requiresDependencyHandoffs: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type MissionTask = typeof MissionTask.Type;

export const AgentRun = Schema.Struct({
  id: AgentRunId,
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  threadId: ThreadId,
  provider: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
  status: AgentRunStatus,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  errorSummary: Schema.NullOr(TrimmedNonEmptyString),
  missionAgentId: Schema.NullOr(MissionAgentId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  worktreeId: Schema.NullOr(ManagedWorktreeId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  attemptNumber: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  permissions: AgentPermissions.pipe(
    Schema.withDecodingDefault(Effect.succeed(ALL_AGENT_PERMISSIONS)),
  ),
  writeCapable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  purpose: Schema.optional(AgentRunPurpose),
  repairAttemptId: Schema.optional(Schema.NullOr(VerificationRepairAttemptId)),
});
export type AgentRun = typeof AgentRun.Type;

export const MissionTaskProgress = Schema.Struct({
  total: NonNegativeInt,
  completed: NonNegativeInt,
});
export type MissionTaskProgress = typeof MissionTaskProgress.Type;

export const MissionSummary = Schema.Struct({
  mission: Mission,
  taskProgress: MissionTaskProgress,
  activeAgentRun: Schema.NullOr(AgentRun),
  activeAgentRuns: Schema.Array(AgentRun).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  latestAgentRun: Schema.NullOr(AgentRun),
});
export type MissionSummary = typeof MissionSummary.Type;

export const MissionBoardSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projectId: Schema.NullOr(ProjectId),
  missions: Schema.Array(MissionSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  updatedAt: IsoDateTime,
});
export type MissionBoardSnapshot = typeof MissionBoardSnapshot.Type;

const missionTransitions: Readonly<Record<MissionStatus, ReadonlySet<MissionStatus>>> = {
  backlog: new Set(["planning", "ready", "running", "cancelled"]),
  planning: new Set(["backlog", "ready", "running", "blocked", "cancelled", "failed"]),
  ready: new Set(["backlog", "planning", "running", "blocked", "cancelled", "failed"]),
  running: new Set([
    "ready",
    "verification",
    "review",
    "blocked",
    "completed",
    "cancelled",
    "failed",
  ]),
  verification: new Set(["running", "review", "blocked", "completed", "cancelled", "failed"]),
  review: new Set(["running", "verification", "blocked", "completed", "cancelled", "failed"]),
  blocked: new Set(["planning", "ready", "running", "cancelled", "failed"]),
  completed: new Set(["verification"]),
  cancelled: new Set(),
  failed: new Set(["planning", "ready", "running", "cancelled"]),
};

const taskTransitions: Readonly<Record<MissionTaskStatus, ReadonlySet<MissionTaskStatus>>> = {
  backlog: new Set(["ready", "running", "blocked", "cancelled"]),
  ready: new Set(["backlog", "running", "blocked", "cancelled", "failed"]),
  running: new Set(["ready", "verification", "blocked", "completed", "cancelled", "failed"]),
  verification: new Set(["running", "blocked", "completed", "cancelled", "failed"]),
  blocked: new Set(["ready", "running", "verification", "cancelled", "failed"]),
  completed: new Set(["verification"]),
  cancelled: new Set(),
  failed: new Set(["ready", "running", "cancelled"]),
};

const agentRunTransitions: Readonly<Record<AgentRunStatus, ReadonlySet<AgentRunStatus>>> = {
  starting: new Set(["running", "cancelling", "completed", "cancelled", "failed", "interrupted"]),
  running: new Set(["cancelling", "completed", "cancelled", "failed", "interrupted"]),
  cancelling: new Set(["cancelled", "failed", "interrupted"]),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  interrupted: new Set(),
};

export const canTransitionMission = (from: MissionStatus, to: MissionStatus): boolean =>
  from === to || missionTransitions[from].has(to);

export const canTransitionMissionTask = (from: MissionTaskStatus, to: MissionTaskStatus): boolean =>
  from === to || taskTransitions[from].has(to);

export const canTransitionAgentRun = (from: AgentRunStatus, to: AgentRunStatus): boolean =>
  from === to || agentRunTransitions[from].has(to);

export const isActiveAgentRunStatus = (status: AgentRunStatus): boolean =>
  status === "starting" || status === "running" || status === "cancelling";

export const isTerminalAgentRunStatus = (status: AgentRunStatus): boolean =>
  status === "completed" ||
  status === "cancelled" ||
  status === "failed" ||
  status === "interrupted";

const worktreeTransitions: Readonly<
  Record<ManagedWorktreeStatus, ReadonlySet<ManagedWorktreeStatus>>
> = {
  planned: new Set(["creating", "failed", "removing"]),
  creating: new Set(["ready", "failed", "orphaned", "removing"]),
  ready: new Set(["active", "dirty", "integration_ready", "orphaned", "removing", "failed"]),
  active: new Set(["ready", "dirty", "conflicted", "integration_ready", "orphaned", "failed"]),
  dirty: new Set(["active", "ready", "conflicted", "integration_ready", "orphaned", "failed"]),
  conflicted: new Set(["dirty", "integration_ready", "orphaned", "failed"]),
  integration_ready: new Set(["active", "dirty", "conflicted", "integrated", "failed"]),
  integrated: new Set(["removing", "removed", "orphaned"]),
  removing: new Set(["removed", "failed", "orphaned"]),
  removed: new Set(),
  failed: new Set(["planned", "creating", "removing"]),
  orphaned: new Set(["planned", "creating", "removing", "removed"]),
};

export const canTransitionManagedWorktree = (
  from: ManagedWorktreeStatus,
  to: ManagedWorktreeStatus,
): boolean => from === to || worktreeTransitions[from].has(to);

export const normalizeAgentPermissions = (
  permissions: ReadonlyArray<AgentPermission>,
): ReadonlyArray<AgentPermission> => [...new Set(permissions)];

export const hasWritePermission = (permissions: ReadonlyArray<AgentPermission>): boolean =>
  permissions.includes("write_files") || permissions.includes("create_commits");

export const hasTaskDependencyCycle = (
  dependencies: ReadonlyArray<Pick<TaskDependency, "missionId" | "taskId" | "dependsOnTaskId">>,
): boolean => {
  const byMission = new Map<MissionId, Map<MissionTaskId, Array<MissionTaskId>>>();
  for (const dependency of dependencies) {
    const graph = byMission.get(dependency.missionId) ?? new Map();
    const adjacent = graph.get(dependency.taskId) ?? [];
    adjacent.push(dependency.dependsOnTaskId);
    graph.set(dependency.taskId, adjacent);
    byMission.set(dependency.missionId, graph);
  }

  for (const graph of byMission.values()) {
    const visiting = new Set<MissionTaskId>();
    const visited = new Set<MissionTaskId>();
    const visit = (taskId: MissionTaskId): boolean => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      for (const dependencyId of graph.get(taskId) ?? []) {
        if (visit(dependencyId)) return true;
      }
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };
    for (const taskId of graph.keys()) {
      if (visit(taskId)) return true;
    }
  }
  return false;
};

export const wouldCreateTaskDependencyCycle = (
  dependencies: ReadonlyArray<Pick<TaskDependency, "missionId" | "taskId" | "dependsOnTaskId">>,
  candidate: Pick<TaskDependency, "missionId" | "taskId" | "dependsOnTaskId">,
): boolean => hasTaskDependencyCycle([...dependencies, candidate]);

export const TaskReadinessState = Schema.Literals(["ready", "waiting", "blocked"]);
export type TaskReadinessState = typeof TaskReadinessState.Type;

export const TaskReadinessReason = Schema.Literals([
  "task_not_startable",
  "mission_not_schedulable",
  "scheduler_paused",
  "dependency_missing",
  "dependency_failed",
  "dependency_incomplete",
  "handoff_missing",
  "worktree_not_ready",
  "concurrency_limited",
]);
export type TaskReadinessReason = typeof TaskReadinessReason.Type;

export interface EvaluateTaskReadinessInput {
  readonly mission: Mission;
  readonly task: MissionTask;
  readonly missionTasks: ReadonlyArray<MissionTask>;
  readonly dependencies: ReadonlyArray<TaskDependency>;
  readonly handoffs: ReadonlyArray<AgentHandoff>;
  readonly worktree: ManagedWorktree | null;
  readonly requiresWorktree: boolean;
  readonly hasCapacity: boolean;
}

export interface TaskReadinessResult {
  readonly state: TaskReadinessState;
  readonly reason: TaskReadinessReason | null;
}

export const evaluateTaskReadiness = (input: EvaluateTaskReadinessInput): TaskReadinessResult => {
  if (
    input.task.status !== "backlog" &&
    input.task.status !== "ready" &&
    input.task.status !== "blocked"
  ) {
    return { state: "blocked", reason: "task_not_startable" };
  }
  if (input.mission.status !== "ready" && input.mission.status !== "running") {
    return { state: "blocked", reason: "mission_not_schedulable" };
  }
  if (input.mission.schedulerStatus === "paused") {
    return { state: "waiting", reason: "scheduler_paused" };
  }

  const taskById = new Map(input.missionTasks.map((task) => [task.id, task] as const));
  const requiredDependencies = input.dependencies.filter(
    (dependency) =>
      dependency.missionId === input.mission.id && dependency.taskId === input.task.id,
  );
  for (const dependency of requiredDependencies) {
    const requiredTask = taskById.get(dependency.dependsOnTaskId);
    if (requiredTask === undefined) {
      return { state: "blocked", reason: "dependency_missing" };
    }
    if (
      requiredTask.status === "failed" ||
      requiredTask.status === "cancelled" ||
      requiredTask.status === "blocked"
    ) {
      return { state: "blocked", reason: "dependency_failed" };
    }
    if (requiredTask.status !== "completed") {
      return { state: "waiting", reason: "dependency_incomplete" };
    }
    if (
      input.task.requiresDependencyHandoffs &&
      !input.handoffs.some((handoff) => handoff.taskId === requiredTask.id)
    ) {
      return { state: "waiting", reason: "handoff_missing" };
    }
  }

  if (
    input.requiresWorktree &&
    (input.worktree === null ||
      (input.worktree.status !== "ready" && input.worktree.status !== "active"))
  ) {
    return { state: "waiting", reason: "worktree_not_ready" };
  }
  if (!input.hasCapacity) {
    return { state: "waiting", reason: "concurrency_limited" };
  }
  return { state: "ready", reason: null };
};
