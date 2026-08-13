import {
  hasWritePermission,
  type ManagedWorktree,
  type Mission,
  type MissionAgent,
  type MissionTask,
  type MissionTaskId,
  type TaskDependency,
  type VerificationTaskSummary,
} from "@t3tools/contracts";

/**
 * The conditions that stop a mission, derived once.
 *
 * These predicates were previously inlined in the task graph, the integration queue, and the
 * workspace header, so the page could disable a control for a reason it never stated and the
 * summary could disagree with the panel beneath it. Both the panels and the blockers strip read
 * them from here.
 */

/** Anchors are the existing `aria-labelledby` ids of the sections that resolve each blocker. */
export const MISSION_SECTION_ANCHORS = {
  team: "mission-team-heading",
  tasks: "mission-tasks-heading",
  runs: "mission-runs-heading",
  verification: "mission-verification-heading",
  worktrees: "mission-worktrees-heading",
  integration: "mission-integration-heading",
} as const;

export type MissionSectionAnchor =
  (typeof MISSION_SECTION_ANCHORS)[keyof typeof MISSION_SECTION_ANCHORS];

/** A blocker stops progress now. An advisory is progress waiting on something already in motion. */
export type MissionBlockerSeverity = "blocker" | "advisory";

export interface MissionBlocker {
  readonly id: string;
  readonly severity: MissionBlockerSeverity;
  readonly message: string;
  readonly anchor: MissionSectionAnchor;
}

const TERMINAL_TASK_STATUSES = new Set<MissionTask["status"]>(["completed", "cancelled", "failed"]);

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// --- shared predicates, consumed by the panels as well as the strip -------------------------

export function assignedAgentFor(
  task: MissionTask,
  agents: ReadonlyArray<MissionAgent>,
): MissionAgent | null {
  return task.assignedMissionAgentId
    ? (agents.find((agent) => agent.id === task.assignedMissionAgentId) ?? null)
    : null;
}

export function taskWaitingForDependency(
  task: MissionTask,
  dependencies: ReadonlyArray<TaskDependency>,
  taskById: ReadonlyMap<MissionTaskId, MissionTask>,
): boolean {
  return dependencies
    .filter((dependency) => dependency.taskId === task.id)
    .some((dependency) => taskById.get(dependency.dependsOnTaskId)?.status !== "completed");
}

/** Why the task graph's Start control is unavailable, or null when it can run. */
export function taskStartBlockedReason(input: {
  readonly task: MissionTask;
  readonly agents: ReadonlyArray<MissionAgent>;
  readonly assignedAgent: MissionAgent | null;
  readonly waitingForDependency: boolean;
}): string | null {
  const { task, agents, assignedAgent, waitingForDependency } = input;
  if (waitingForDependency) return "waiting for a prerequisite task to finish";
  if (agents.length > 0 && assignedAgent === null) return "not assigned to an agent";
  if (assignedAgent?.status === "disabled") return "assigned to a disabled agent";
  if (assignedAgent?.status === "unavailable") return "assigned to an unavailable agent";
  if (
    assignedAgent !== null &&
    hasWritePermission(assignedAgent.permissions) &&
    task.worktreeId === null
  ) {
    return "waiting for its worktree";
  }
  return null;
}

export function taskStartUnavailable(input: {
  readonly task: MissionTask;
  readonly agents: ReadonlyArray<MissionAgent>;
  readonly assignedAgent: MissionAgent | null;
  readonly waitingForDependency: boolean;
}): boolean {
  return taskStartBlockedReason(input) !== null;
}

export function integrationPrerequisitesIntegrated(
  task: MissionTask,
  dependencies: ReadonlyArray<TaskDependency>,
  taskById: ReadonlyMap<MissionTaskId, MissionTask>,
): boolean {
  return dependencies
    .filter((dependency) => dependency.taskId === task.id)
    .map((dependency) => taskById.get(dependency.dependsOnTaskId))
    .filter((candidate): candidate is MissionTask => candidate !== undefined)
    .every((dependency) => dependency.integrationStatus === "integrated");
}

export function integrationConflicted(
  task: MissionTask,
  worktree: ManagedWorktree | null,
): boolean {
  return task.integrationStatus === "conflicted" || worktree?.status === "conflicted";
}

export function verificationAuthorized(summary: VerificationTaskSummary | undefined): boolean {
  return summary?.authorization.allowed ?? false;
}

export function canApproveIntegration(input: {
  readonly task: MissionTask;
  readonly dependenciesIntegrated: boolean;
  readonly conflicted: boolean;
  readonly verificationAllowed: boolean;
}): boolean {
  return (
    input.task.integrationStatus === "ready" &&
    input.dependenciesIntegrated &&
    !input.conflicted &&
    input.verificationAllowed
  );
}

// --- the strip -------------------------------------------------------------------------------

export interface MissionBlockersInput {
  readonly mission: Mission;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly agents: ReadonlyArray<MissionAgent>;
  readonly dependencies: ReadonlyArray<TaskDependency>;
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly verificationSummaries: ReadonlyArray<VerificationTaskSummary>;
  /**
   * Whether `verificationSummaries` reflects a settled request. While it does not, an absent
   * summary means "not known yet" rather than "no evidence", and reporting the difference as a
   * blocker would accuse every pending branch of missing verification on every page load.
   */
  readonly verificationEvidenceLoaded: boolean;
  readonly providerReady: boolean;
}

/**
 * Everything currently standing between this mission and progress, blockers before advisories.
 *
 * Returns nothing for a mission that is finished or cancelled: its state is history, not something
 * a reader can act on.
 */
export function missionBlockers(input: MissionBlockersInput): ReadonlyArray<MissionBlocker> {
  const {
    mission,
    tasks,
    agents,
    dependencies,
    worktrees,
    verificationSummaries,
    verificationEvidenceLoaded,
    providerReady,
  } = input;

  if (mission.status === "completed" || mission.status === "cancelled") return [];

  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree] as const));
  const verificationByTask = new Map(
    verificationSummaries.map((summary) => [summary.taskId, summary] as const),
  );
  const liveTasks = tasks.filter((task) => !TERMINAL_TASK_STATUSES.has(task.status));
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const retryableTasks = failedTasks.filter((task) => task.attemptCount < task.maximumAttempts);
  const exhaustedTasks = failedTasks.filter((task) => task.attemptCount >= task.maximumAttempts);
  // Work that still needs an agent run: anything unfinished, plus a failure that can be retried.
  // Verification, integration approval, and delivery do not start agents, so a mission whose tasks
  // are all done has no use for a provider and must not be called blocked for lacking one.
  const tasksNeedingProvider = [...liveTasks, ...retryableTasks];

  const blockers: MissionBlocker[] = [];
  const advisories: MissionBlocker[] = [];

  if (
    !providerReady &&
    (tasksNeedingProvider.length > 0 || (tasks.length === 0 && agents.length > 0))
  ) {
    blockers.push({
      id: "provider-unavailable",
      severity: "blocker",
      message:
        "No provider is ready. Configure an available provider before starting mission work.",
      anchor: MISSION_SECTION_ANCHORS.team,
    });
  }

  // Advisory, not a blocker: a mission with no team still runs as a single agent, and
  // `taskStartBlockedReason` agrees by not requiring an assignment when there are no agents. Adding
  // slots buys parallelism and isolation, so it is a recommendation rather than an obstacle.
  if (agents.length === 0 && tasks.length > 0) {
    advisories.push({
      id: "no-agents",
      severity: "advisory",
      message:
        "This mission has no agent team, so it runs as a single agent. Add agent slots to run tasks in parallel with their own worktrees.",
      anchor: MISSION_SECTION_ANCHORS.team,
    });
  }

  if (mission.schedulerStatus === "paused" && liveTasks.length > 0) {
    blockers.push({
      id: "scheduler-paused",
      severity: "blocker",
      message: "Scheduling is paused, so ready tasks will not start.",
      anchor: MISSION_SECTION_ANCHORS.team,
    });
  }

  // Group start-blocked tasks by reason so five unassigned tasks read as one line, not five.
  const startBlockedByReason = new Map<string, number>();
  for (const task of liveTasks) {
    if (task.status === "running") continue;
    const reason = taskStartBlockedReason({
      task,
      agents,
      assignedAgent: assignedAgentFor(task, agents),
      waitingForDependency: taskWaitingForDependency(task, dependencies, taskById),
    });
    // A missing worktree resolves itself when the scheduler prepares the task, and a waiting
    // dependency is ordinary sequencing; neither is something the reader can act on.
    if (reason === null || reason === "waiting for its worktree") continue;
    if (reason === "waiting for a prerequisite task to finish") continue;
    startBlockedByReason.set(reason, (startBlockedByReason.get(reason) ?? 0) + 1);
  }
  for (const [reason, count] of startBlockedByReason) {
    blockers.push({
      id: `task-start:${reason}`,
      severity: "blocker",
      message: `${pluralize(count, "task")} ${count === 1 ? "is" : "are"} ${reason}.`,
      anchor:
        reason === "not assigned to an agent"
          ? MISSION_SECTION_ANCHORS.tasks
          : MISSION_SECTION_ANCHORS.team,
    });
  }

  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  if (blockedTasks.length > 0) {
    const reason = blockedTasks.find((task) => task.blockedReason !== null)?.blockedReason ?? null;
    blockers.push({
      id: "task-blocked",
      severity: "blocker",
      message:
        blockedTasks.length === 1 && reason
          ? `Task "${blockedTasks[0]!.title}" is blocked: ${reason}`
          : `${pluralize(blockedTasks.length, "task")} ${blockedTasks.length === 1 ? "is" : "are"} blocked.`,
      anchor: MISSION_SECTION_ANCHORS.tasks,
    });
  }

  // A failed task leaves `liveTasks`, so without its own branch it disappears from the summary
  // entirely. Nothing retries it either - `task.retry-requested` only ever originates from the user
  // - so a mission with one sits stopped while reporting nothing.
  if (retryableTasks.length > 0) {
    blockers.push({
      id: "task-failed-retryable",
      severity: "blocker",
      message: `${pluralize(retryableTasks.length, "task")} failed and ${retryableTasks.length === 1 ? "is" : "are"} waiting to be retried. Nothing restarts them on its own.`,
      anchor: MISSION_SECTION_ANCHORS.tasks,
    });
  }

  if (exhaustedTasks.length > 0) {
    blockers.push({
      id: "task-attempts-exhausted",
      severity: "blocker",
      message: `${pluralize(exhaustedTasks.length, "task")} failed after every allowed attempt. Raise the attempt limit or change the approach.`,
      anchor: MISSION_SECTION_ANCHORS.tasks,
    });
  }

  let conflictedCount = 0;
  let failedCount = 0;
  let awaitingVerification = 0;
  let awaitingApproval = 0;
  let awaitingPrerequisites = 0;
  for (const task of tasks) {
    if (task.integrationStatus === "not_requested" || task.integrationStatus === "integrated") {
      continue;
    }
    const worktree = task.worktreeId ? (worktreeById.get(task.worktreeId) ?? null) : null;
    const conflicted = integrationConflicted(task, worktree);
    const dependenciesIntegrated = integrationPrerequisitesIntegrated(task, dependencies, taskById);
    const verificationAllowed = verificationAuthorized(verificationByTask.get(task.id));

    if (conflicted) conflictedCount += 1;
    // A failed integration needs recovery even when its evidence and prerequisites are in order,
    // and it can never reach the approvable `ready` state on its own, so it is counted before the
    // waiting states rather than falling through them unreported.
    else if (task.integrationStatus === "failed") failedCount += 1;
    // Conflicts and failures are readable from task and worktree state alone. Everything below
    // needs verification evidence, so it waits until that request has settled.
    else if (!verificationEvidenceLoaded) continue;
    else if (!verificationAllowed) awaitingVerification += 1;
    else if (!dependenciesIntegrated) awaitingPrerequisites += 1;
    else if (
      mission.teamSettings.integrationMode === "manual" &&
      canApproveIntegration({ task, dependenciesIntegrated, conflicted, verificationAllowed })
    ) {
      awaitingApproval += 1;
    }
  }

  if (conflictedCount > 0) {
    blockers.push({
      id: "integration-conflicted",
      severity: "blocker",
      message: `${pluralize(conflictedCount, "task branch", "task branches")} ${conflictedCount === 1 ? "has" : "have"} merge conflicts that need resolving.`,
      anchor: MISSION_SECTION_ANCHORS.integration,
    });
  }

  if (failedCount > 0) {
    blockers.push({
      id: "integration-failed",
      severity: "blocker",
      message: `${pluralize(failedCount, "task branch", "task branches")} failed to integrate and ${failedCount === 1 ? "needs" : "need"} recovery before continuing.`,
      anchor: MISSION_SECTION_ANCHORS.integration,
    });
  }

  if (awaitingVerification > 0) {
    blockers.push({
      id: "integration-verification",
      severity: "blocker",
      message: `${pluralize(awaitingVerification, "task branch", "task branches")} cannot integrate without current verification evidence.`,
      anchor: MISSION_SECTION_ANCHORS.verification,
    });
  }

  if (awaitingApproval > 0) {
    advisories.push({
      id: "integration-approval",
      severity: "advisory",
      message: `${pluralize(awaitingApproval, "task branch", "task branches")} ${awaitingApproval === 1 ? "is" : "are"} verified and waiting for your approval to integrate.`,
      anchor: MISSION_SECTION_ANCHORS.integration,
    });
  }

  if (awaitingPrerequisites > 0) {
    advisories.push({
      id: "integration-prerequisites",
      severity: "advisory",
      message: `${pluralize(awaitingPrerequisites, "task branch", "task branches")} ${awaitingPrerequisites === 1 ? "is" : "are"} waiting for earlier branches to integrate first.`,
      anchor: MISSION_SECTION_ANCHORS.integration,
    });
  }

  return [...blockers, ...advisories];
}
