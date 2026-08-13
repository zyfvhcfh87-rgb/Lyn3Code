import {
  hasWritePermission,
  type MissionAgent,
  type MissionAgentId,
  type MissionTask,
  type VerificationTaskSummary,
} from "@t3tools/contracts";

/**
 * Verification binds evidence to a worktree's exact source state, so a task that will never hold a
 * worktree can never hold evidence. Only exclude what is provably read-only: a task assigned to an
 * agent without write permission, holding no worktree and no evidence of its own. An unassigned
 * task stays listed because it may still be given to a writer, which keeps the panel from emptying
 * itself on a mission whose team is not configured yet.
 */
export function canHoldVerificationEvidence(
  task: MissionTask,
  agentsById: ReadonlyMap<MissionAgentId, MissionAgent>,
  summary: VerificationTaskSummary | undefined,
): boolean {
  if (summary !== undefined || task.worktreeId !== null) return true;
  const agent = task.assignedMissionAgentId
    ? (agentsById.get(task.assignedMissionAgentId) ?? null)
    : null;
  return agent === null || hasWritePermission(agent.permissions);
}

export function verifiableTasks(
  tasks: ReadonlyArray<MissionTask>,
  agents: ReadonlyArray<MissionAgent>,
  summaries: ReadonlyArray<VerificationTaskSummary>,
): ReadonlyArray<MissionTask> {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent] as const));
  const summaryByTask = new Map(summaries.map((summary) => [summary.taskId, summary] as const));
  return tasks.filter((task) =>
    canHoldVerificationEvidence(task, agentsById, summaryByTask.get(task.id)),
  );
}

/** Why a verification run cannot be requested for this task yet, or null when it can. */
export function verificationRunBlockedReason(task: MissionTask): string | null {
  return task.worktreeId === null
    ? "Needs a worktree. Start this task before requesting verification."
    : null;
}
