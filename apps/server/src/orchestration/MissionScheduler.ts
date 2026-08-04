import type {
  AgentHandoff,
  AgentRun,
  ManagedWorktree,
  ManagedWorktreeId,
  Mission,
  MissionAgent,
  MissionAgentId,
  MissionTask,
  MissionTaskId,
  ProviderInstanceId,
  TaskDependency,
} from "@t3tools/contracts";
import {
  evaluateTaskReadiness,
  hasWritePermission,
  isActiveAgentRunStatus,
} from "@t3tools/contracts";

export type MissionSchedulingReason =
  | "selected"
  | "manual_start_required"
  | "unassigned_agent"
  | "agent_unavailable"
  | "agent_capacity"
  | "provider_capacity"
  | "write_capacity"
  | "worktree_busy"
  | "task_already_running"
  | Exclude<ReturnType<typeof evaluateTaskReadiness>["reason"], null>
  | "mission_capacity";

export interface MissionSchedulingDecision {
  readonly taskId: MissionTaskId;
  readonly missionAgentId: MissionAgentId | null;
  readonly worktreeId: ManagedWorktreeId | null;
  readonly selected: boolean;
  readonly reason: MissionSchedulingReason;
  readonly writeCapable: boolean;
}

export interface PlanMissionScheduleInput {
  readonly mission: Mission;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly dependencies: ReadonlyArray<TaskDependency>;
  readonly missionAgents: ReadonlyArray<MissionAgent>;
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly agentRuns: ReadonlyArray<AgentRun>;
  readonly handoffs: ReadonlyArray<AgentHandoff>;
  /** Provider limits are optional because not every provider exposes one. */
  readonly providerConcurrencyLimits?: ReadonlyMap<ProviderInstanceId, number>;
  /** Explicit task starts bypass the auto-start preference, never safety limits. */
  readonly mode: "automatic" | "explicit";
}

export interface MissionSchedulePlan {
  readonly decisions: ReadonlyArray<MissionSchedulingDecision>;
  readonly selectedTaskIds: ReadonlyArray<MissionTaskId>;
  readonly activeAgentCount: number;
  readonly activeWriteAgentCount: number;
}

const byTaskOrder = (left: MissionTask, right: MissionTask): number =>
  left.position - right.position ||
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

export const planMissionSchedule = (input: PlanMissionScheduleInput): MissionSchedulePlan => {
  const activeRuns = input.agentRuns.filter(
    (run) => run.missionId === input.mission.id && isActiveAgentRunStatus(run.status),
  );
  let activeAgentCount = activeRuns.length;
  let activeWriteAgentCount = activeRuns.filter((run) => run.writeCapable).length;

  const activeByAgent = new Map<MissionAgentId, number>();
  const activeByProvider = new Map<ProviderInstanceId, number>();
  const activeTaskIds = new Set<MissionTaskId>();
  const activeWriteWorktrees = new Set<string>();
  for (const run of activeRuns) {
    if (run.missionAgentId !== null) {
      activeByAgent.set(run.missionAgentId, (activeByAgent.get(run.missionAgentId) ?? 0) + 1);
    }
    activeByProvider.set(
      run.providerInstanceId,
      (activeByProvider.get(run.providerInstanceId) ?? 0) + 1,
    );
    if (run.taskId !== null) activeTaskIds.add(run.taskId);
    if (run.writeCapable && run.worktreeId !== null) activeWriteWorktrees.add(run.worktreeId);
  }

  const agents = new Map(input.missionAgents.map((agent) => [agent.id, agent] as const));
  const worktrees = new Map(input.worktrees.map((worktree) => [worktree.id, worktree] as const));
  const decisions: Array<MissionSchedulingDecision> = [];

  for (const task of [...input.tasks].sort(byTaskOrder)) {
    const agent =
      task.assignedMissionAgentId === null ? undefined : agents.get(task.assignedMissionAgentId);
    const writeCapable = agent === undefined ? false : hasWritePermission(agent.permissions);
    const dependencyWorktreeId = input.dependencies
      .filter((dependency) => dependency.taskId === task.id)
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .map(
        (dependency) =>
          input.tasks.find((candidate) => candidate.id === dependency.dependsOnTaskId)
            ?.worktreeId ?? null,
      )
      .find((worktreeId): worktreeId is ManagedWorktreeId => worktreeId !== null);
    const effectiveWorktreeId =
      task.worktreeId ?? (!writeCapable ? (dependencyWorktreeId ?? null) : null);
    const decision = (reason: MissionSchedulingReason, selected = false) => {
      decisions.push({
        taskId: task.id,
        missionAgentId: agent?.id ?? null,
        worktreeId: effectiveWorktreeId,
        selected,
        reason,
        writeCapable,
      });
    };

    const readiness = evaluateTaskReadiness({
      mission: input.mission,
      task,
      missionTasks: input.tasks,
      dependencies: input.dependencies,
      handoffs: input.handoffs,
      worktree: effectiveWorktreeId === null ? null : (worktrees.get(effectiveWorktreeId) ?? null),
      requiresWorktree: writeCapable,
      hasCapacity: true,
    });
    if (readiness.state !== "ready") {
      decision(readiness.reason ?? "mission_capacity");
      continue;
    }
    if (activeTaskIds.has(task.id)) {
      decision("task_already_running");
      continue;
    }
    if (agent === undefined) {
      decision("unassigned_agent");
      continue;
    }
    if (agent.status === "disabled" || agent.status === "unavailable") {
      decision("agent_unavailable");
      continue;
    }
    if (input.mode === "automatic" && !input.mission.teamSettings.autoStartReadyTasks) {
      decision("manual_start_required");
      continue;
    }
    if (activeAgentCount >= input.mission.teamSettings.maximumConcurrentAgents) {
      decision("mission_capacity");
      continue;
    }
    if ((activeByAgent.get(agent.id) ?? 0) >= agent.maximumConcurrentRuns) {
      decision("agent_capacity");
      continue;
    }
    const providerLimit = input.providerConcurrencyLimits?.get(agent.providerInstanceId);
    if (
      providerLimit !== undefined &&
      (activeByProvider.get(agent.providerInstanceId) ?? 0) >= providerLimit
    ) {
      decision("provider_capacity");
      continue;
    }
    if (writeCapable) {
      if (activeWriteAgentCount >= input.mission.teamSettings.maximumConcurrentWriteAgents) {
        decision("write_capacity");
        continue;
      }
      if (effectiveWorktreeId !== null && activeWriteWorktrees.has(effectiveWorktreeId)) {
        decision("worktree_busy");
        continue;
      }
    }

    decision("selected", true);
    activeAgentCount += 1;
    activeByAgent.set(agent.id, (activeByAgent.get(agent.id) ?? 0) + 1);
    activeByProvider.set(
      agent.providerInstanceId,
      (activeByProvider.get(agent.providerInstanceId) ?? 0) + 1,
    );
    activeTaskIds.add(task.id);
    if (writeCapable) {
      activeWriteAgentCount += 1;
      if (effectiveWorktreeId !== null) activeWriteWorktrees.add(effectiveWorktreeId);
    }
  }

  return {
    decisions,
    selectedTaskIds: decisions.filter((item) => item.selected).map((item) => item.taskId),
    activeAgentCount,
    activeWriteAgentCount,
  };
};
