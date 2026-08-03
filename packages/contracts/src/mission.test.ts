import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AgentHandoffId,
  AgentRunId,
  ManagedWorktreeId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  ProjectId,
  TaskDependencyId,
  ThreadId,
} from "./baseSchemas.ts";
import {
  AgentRun,
  canTransitionManagedWorktree,
  canTransitionMissionTask,
  evaluateTaskReadiness,
  hasTaskDependencyCycle,
  Mission,
  MissionTeamSettings,
  MissionTask,
  wouldCreateTaskDependencyCycle,
} from "./mission.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const now = "2026-08-03T00:00:00.000Z";
const missionId = MissionId.make("mission-contract-test");
const taskAId = MissionTaskId.make("task-contract-a");
const taskBId = MissionTaskId.make("task-contract-b");
const decodeAgentRun = Schema.decodeUnknownSync(AgentRun);
const decodeMissionTeamSettings = Schema.decodeUnknownSync(MissionTeamSettings);

const mission = Schema.decodeUnknownSync(Mission)({
  id: missionId,
  projectId: ProjectId.make("project-contract-test"),
  title: "Contract test",
  description: "",
  status: "running",
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: null,
  cancelledAt: null,
});

const taskA = Schema.decodeUnknownSync(MissionTask)({
  id: taskAId,
  missionId,
  title: "A",
  description: "",
  status: "completed",
  position: 0,
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: now,
});

const taskB = Schema.decodeUnknownSync(MissionTask)({
  id: taskBId,
  missionId,
  title: "B",
  description: "",
  status: "blocked",
  position: 1,
  createdAt: now,
  updatedAt: now,
  startedAt: null,
  completedAt: null,
});

it("decodes Phase 1 mission, task, and run rows with conservative Phase 2 defaults", () => {
  assert.deepStrictEqual(mission.teamSettings, {
    maximumConcurrentAgents: 3,
    maximumConcurrentWriteAgents: 2,
    defaultMaximumTaskAttempts: 3,
    autoStartReadyTasks: false,
    integrationMode: "manual",
  });
  assert.strictEqual(mission.schedulerStatus, "idle");
  assert.strictEqual(taskB.maximumAttempts, 3);
  assert.strictEqual(taskB.requiresDependencyHandoffs, true);

  const run = decodeAgentRun({
    id: AgentRunId.make("run-contract-test"),
    missionId,
    taskId: taskBId,
    threadId: ThreadId.make("thread-contract-test"),
    provider: "codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: null,
    status: "running",
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    errorSummary: null,
  });
  assert.strictEqual(run.attemptNumber, 1);
  assert.strictEqual(run.writeCapable, true);
  assert.ok(run.permissions.includes("write_files"));
});

it("rejects a write-agent limit above the total-agent limit", () => {
  assert.throws(() =>
    decodeMissionTeamSettings({
      maximumConcurrentAgents: 2,
      maximumConcurrentWriteAgents: 3,
      defaultMaximumTaskAttempts: 3,
      autoStartReadyTasks: false,
      integrationMode: "manual",
    }),
  );
});

it("allows a backlog task to surface a worktree provisioning failure", () => {
  assert.strictEqual(canTransitionMissionTask("backlog", "blocked"), true);
});

it("detects dependency cycles, including a proposed closing edge", () => {
  const first = {
    id: TaskDependencyId.make("dependency-b-a"),
    missionId,
    taskId: taskBId,
    dependsOnTaskId: taskAId,
    createdAt: now,
  };
  assert.strictEqual(hasTaskDependencyCycle([first]), false);
  assert.strictEqual(
    wouldCreateTaskDependencyCycle([first], {
      missionId,
      taskId: taskAId,
      dependsOnTaskId: taskBId,
    }),
    true,
  );
});

it("requires completed dependency handoffs and reevaluates blocked tasks", () => {
  const dependency = {
    id: TaskDependencyId.make("dependency-readiness-b-a"),
    missionId,
    taskId: taskBId,
    dependsOnTaskId: taskAId,
    createdAt: now,
  };
  const worktree = {
    id: ManagedWorktreeId.make("worktree-readiness-b"),
    projectId: mission.projectId,
    missionId,
    taskId: taskBId,
    purpose: "task" as const,
    repositoryPath: "C:/repo",
    worktreePath: "C:/repo-worktrees/b",
    branchName: "agent/contracts/b",
    baseBranch: "agent/contracts/integration",
    baseCommit: "abc123",
    headCommit: null,
    status: "ready" as const,
    changedFileCount: 0,
    hasUncommittedChanges: false,
    conflictingFiles: [],
    createdAt: now,
    updatedAt: now,
    removedAt: null,
    errorSummary: null,
  };
  const baseInput = {
    mission,
    task: taskB,
    missionTasks: [taskA, taskB],
    dependencies: [dependency],
    worktree,
    requiresWorktree: true,
    hasCapacity: true,
  };

  assert.deepStrictEqual(evaluateTaskReadiness({ ...baseInput, handoffs: [] }), {
    state: "waiting",
    reason: "handoff_missing",
  });

  const handoff = {
    id: AgentHandoffId.make("handoff-readiness-a"),
    missionId,
    taskId: taskAId,
    agentRunId: AgentRunId.make("run-readiness-a"),
    fromMissionAgentId: MissionAgentId.make("agent-readiness-a"),
    toMissionAgentId: null,
    summary: "Done",
    decisions: [],
    changedFiles: [],
    commandsRun: [],
    unresolvedProblems: [],
    recommendedNextAction: "Start B",
    artifacts: [],
    reconciliationStatus: "matched" as const,
    reconciledAt: now,
    createdAt: now,
  };
  assert.deepStrictEqual(evaluateTaskReadiness({ ...baseInput, handoffs: [handoff] }), {
    state: "ready",
    reason: null,
  });
});

it("allows only explicit managed-worktree lifecycle transitions", () => {
  assert.strictEqual(canTransitionManagedWorktree("planned", "creating"), true);
  assert.strictEqual(canTransitionManagedWorktree("active", "conflicted"), true);
  assert.strictEqual(canTransitionManagedWorktree("removed", "ready"), false);
});
