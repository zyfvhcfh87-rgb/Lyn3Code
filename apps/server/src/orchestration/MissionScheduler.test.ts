import {
  AgentRunId,
  ManagedWorktreeId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentRun,
  type ManagedWorktree,
  type Mission,
  type MissionAgent,
  type MissionTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { planMissionSchedule } from "./MissionScheduler.ts";

const now = "2026-08-03T00:00:00.000Z";
const missionId = MissionId.make("mission-scheduler");
const providerId = ProviderInstanceId.make("codex");
const mission: Mission = {
  id: missionId,
  projectId: ProjectId.make("project-scheduler"),
  title: "Schedule safely",
  description: "",
  status: "running",
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: null,
  cancelledAt: null,
  teamSettings: {
    maximumConcurrentAgents: 3,
    maximumConcurrentWriteAgents: 2,
    defaultMaximumTaskAttempts: 3,
    autoStartReadyTasks: true,
    integrationMode: "manual",
  },
  schedulerStatus: "running",
};

const agent = (id: string, writeCapable = true, maximumConcurrentRuns = 1): MissionAgent => ({
  id: MissionAgentId.make(id),
  missionId,
  roleId: null,
  roleKind: writeCapable ? "implementer" : "reviewer",
  displayName: id,
  providerInstanceId: providerId,
  model: "gpt-5",
  reasoningLevel: null,
  permissions: writeCapable ? ["read_files", "write_files"] : ["read_files"],
  maximumConcurrentRuns,
  status: "idle",
  createdAt: now,
  updatedAt: now,
});

const task = (id: string, position: number, assigned: MissionAgent): MissionTask => ({
  id: MissionTaskId.make(id),
  missionId,
  title: id,
  description: "",
  status: "ready",
  position,
  createdAt: now,
  updatedAt: now,
  startedAt: null,
  completedAt: null,
  assignedMissionAgentId: assigned.id,
  worktreeId: ManagedWorktreeId.make(`worktree-${id}`),
  attemptCount: 0,
  maximumAttempts: 3,
  readyAt: now,
  blockedReason: null,
  integrationStatus: "not_requested",
  requiresDependencyHandoffs: true,
});

const worktree = (forTask: MissionTask): ManagedWorktree => ({
  id: forTask.worktreeId!,
  projectId: mission.projectId,
  missionId,
  taskId: forTask.id,
  purpose: "task",
  repositoryPath: "C:\\repo",
  worktreePath: `C:\\repo-worktrees\\${forTask.id}`,
  branchName: `agent/mission/${forTask.id}`,
  baseBranch: "mission/integration",
  baseCommit: "abc123",
  headCommit: "abc123",
  status: "ready",
  changedFileCount: 0,
  hasUncommittedChanges: false,
  conflictingFiles: [],
  createdAt: now,
  updatedAt: now,
  removedAt: null,
  errorSummary: null,
});

const run = (id: string, forTask: MissionTask, assigned: MissionAgent): AgentRun => ({
  id: AgentRunId.make(id),
  missionId,
  taskId: forTask.id,
  threadId: ThreadId.make(`thread-${id}`),
  provider: "codex",
  providerInstanceId: providerId,
  providerSessionId: null,
  status: "running",
  createdAt: now,
  startedAt: now,
  updatedAt: now,
  completedAt: null,
  errorSummary: null,
  missionAgentId: assigned.id,
  worktreeId: forTask.worktreeId,
  attemptNumber: 1,
  permissions: assigned.permissions,
  writeCapable: assigned.permissions.includes("write_files"),
});

describe("planMissionSchedule", () => {
  it("selects independent tasks concurrently and respects the write limit", () => {
    const agents = [agent("agent-a"), agent("agent-b"), agent("agent-c")];
    const tasks = agents.map((item, index) => task(`task-${index}`, index, item));
    const plan = planMissionSchedule({
      mission,
      tasks,
      dependencies: [],
      missionAgents: agents,
      worktrees: tasks.map(worktree),
      agentRuns: [],
      handoffs: [],
      mode: "automatic",
    });

    expect(plan.selectedTaskIds).toEqual([tasks[0]!.id, tasks[1]!.id]);
    expect(plan.decisions[2]?.reason).toBe("write_capacity");
  });

  it("waits for dependencies and their handoffs", () => {
    const implementer = agent("agent-dependency");
    const predecessor = task("task-a", 0, implementer);
    const dependent = task("task-b", 1, implementer);
    const plan = planMissionSchedule({
      mission,
      tasks: [predecessor, dependent],
      dependencies: [
        {
          id: "dependency-a-b" as never,
          missionId,
          taskId: dependent.id,
          dependsOnTaskId: predecessor.id,
          createdAt: now,
        },
      ],
      missionAgents: [implementer],
      worktrees: [worktree(predecessor), worktree(dependent)],
      agentRuns: [],
      handoffs: [],
      mode: "automatic",
    });

    expect(plan.decisions.find((item) => item.taskId === dependent.id)?.reason).toBe(
      "dependency_incomplete",
    );
  });

  it("allows read-only review beside a writer but never reserves a write slot", () => {
    const implementer = agent("agent-writer");
    const reviewer = agent("agent-reviewer", false);
    const writeTask = task("task-write", 0, implementer);
    const reviewTask = { ...task("task-review", 1, reviewer), worktreeId: writeTask.worktreeId };
    const plan = planMissionSchedule({
      mission: {
        ...mission,
        teamSettings: { ...mission.teamSettings, maximumConcurrentWriteAgents: 1 },
      },
      tasks: [writeTask, reviewTask],
      dependencies: [],
      missionAgents: [implementer, reviewer],
      worktrees: [worktree(writeTask)],
      agentRuns: [],
      handoffs: [],
      mode: "automatic",
    });

    expect(plan.selectedTaskIds).toEqual([writeTask.id, reviewTask.id]);
    expect(plan.activeWriteAgentCount).toBe(1);
  });

  it("roots a dependent read-only review in its predecessor worktree", () => {
    const implementer = agent("agent-reviewed");
    const reviewer = agent("agent-reviewer-dependent", false);
    const implementation = {
      ...task("task-implemented", 0, implementer),
      status: "completed" as const,
      completedAt: now,
    };
    const review = {
      ...task("task-dependent-review", 1, reviewer),
      worktreeId: null,
      requiresDependencyHandoffs: false,
    };
    const plan = planMissionSchedule({
      mission,
      tasks: [implementation, review],
      dependencies: [
        {
          id: "dependency-review" as never,
          missionId,
          taskId: review.id,
          dependsOnTaskId: implementation.id,
          createdAt: now,
        },
      ],
      missionAgents: [implementer, reviewer],
      worktrees: [worktree(implementation)],
      agentRuns: [],
      handoffs: [],
      mode: "automatic",
    });

    expect(plan.selectedTaskIds).toEqual([review.id]);
    expect(plan.decisions.find((decision) => decision.taskId === review.id)?.worktreeId).toBe(
      implementation.worktreeId,
    );
    expect(plan.activeWriteAgentCount).toBe(0);
  });

  it("enforces one active writer per worktree and per-agent limits", () => {
    const implementer = agent("agent-one-writer", true, 2);
    const runningTask = task("task-running", 0, implementer);
    const nextTask = { ...task("task-next", 1, implementer), worktreeId: runningTask.worktreeId };
    const plan = planMissionSchedule({
      mission,
      tasks: [runningTask, nextTask],
      dependencies: [],
      missionAgents: [implementer],
      worktrees: [worktree(runningTask)],
      agentRuns: [run("run-active", runningTask, implementer)],
      handoffs: [],
      mode: "explicit",
    });

    expect(plan.decisions.find((item) => item.taskId === nextTask.id)?.reason).toBe(
      "worktree_busy",
    );
  });

  it("keeps automatic scheduling off when the user disabled it", () => {
    const implementer = agent("agent-manual");
    const pending = task("task-manual", 0, implementer);
    const plan = planMissionSchedule({
      mission: {
        ...mission,
        teamSettings: { ...mission.teamSettings, autoStartReadyTasks: false },
      },
      tasks: [pending],
      dependencies: [],
      missionAgents: [implementer],
      worktrees: [worktree(pending)],
      agentRuns: [],
      handoffs: [],
      mode: "automatic",
    });

    expect(plan.selectedTaskIds).toEqual([]);
    expect(plan.decisions[0]?.reason).toBe("manual_start_required");
  });
});
