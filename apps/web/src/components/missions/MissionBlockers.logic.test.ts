import type {
  ManagedWorktree,
  Mission,
  MissionAgent,
  MissionTask,
  TaskDependency,
  VerificationTaskSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  missionBlockers,
  taskStartBlockedReason,
  type MissionBlockersInput,
} from "./MissionBlockers.logic";

const AT = "2026-08-05T10:00:00.000Z";

function mission(overrides: Record<string, unknown> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "project-1",
    title: "Ship onboarding",
    description: "",
    status: "running",
    schedulerStatus: "running",
    teamSettings: {
      maximumConcurrentAgents: 3,
      maximumConcurrentWriteAgents: 2,
      defaultMaximumTaskAttempts: 3,
      autoStartReadyTasks: true,
      integrationMode: "manual",
    },
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as unknown as Mission;
}

function task(overrides: Record<string, unknown> = {}): MissionTask {
  return {
    id: "task-1",
    missionId: "mission-1",
    title: "Implement the parser",
    description: "",
    status: "ready",
    position: 0,
    createdAt: AT,
    updatedAt: AT,
    startedAt: null,
    completedAt: null,
    assignedMissionAgentId: "agent-1",
    worktreeId: "worktree-1",
    attemptCount: 0,
    maximumAttempts: 3,
    readyAt: null,
    blockedReason: null,
    integrationStatus: "not_requested",
    requiresDependencyHandoffs: true,
    ...overrides,
  } as unknown as MissionTask;
}

function agent(overrides: Record<string, unknown> = {}): MissionAgent {
  return {
    id: "agent-1",
    missionId: "mission-1",
    roleKind: "implementer",
    displayName: "Implementer 1",
    providerInstanceId: "provider-1",
    model: null,
    reasoningLevel: null,
    permissions: ["read_files", "write_files"],
    maximumConcurrentRuns: 1,
    status: "idle",
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as unknown as MissionAgent;
}

function worktree(overrides: Record<string, unknown> = {}): ManagedWorktree {
  return { id: "worktree-1", status: "ready", ...overrides } as unknown as ManagedWorktree;
}

function verification(overrides: Record<string, unknown> = {}): VerificationTaskSummary {
  return {
    taskId: "task-1",
    latestRun: null,
    authorization: { status: "passed", allowed: true, blockingReason: null },
    repairRunning: false,
    ...overrides,
  } as unknown as VerificationTaskSummary;
}

function input(overrides: Partial<MissionBlockersInput> = {}): MissionBlockersInput {
  return {
    mission: mission(),
    tasks: [task()],
    agents: [agent()],
    dependencies: [] as ReadonlyArray<TaskDependency>,
    worktrees: [worktree()],
    verificationSummaries: [],
    providerReady: true,
    ...overrides,
  };
}

const ids = (result: ReadonlyArray<{ id: string }>) => result.map((item) => item.id);

describe("taskStartBlockedReason", () => {
  it("reports the first reason a task cannot start", () => {
    expect(
      taskStartBlockedReason({
        task: task(),
        agents: [agent()],
        assignedAgent: agent(),
        waitingForDependency: true,
      }),
    ).toBe("waiting for a prerequisite task to finish");

    expect(
      taskStartBlockedReason({
        task: task({ assignedMissionAgentId: null }),
        agents: [agent()],
        assignedAgent: null,
        waitingForDependency: false,
      }),
    ).toBe("not assigned to an agent");

    expect(
      taskStartBlockedReason({
        task: task(),
        agents: [agent()],
        assignedAgent: agent({ status: "disabled" }),
        waitingForDependency: false,
      }),
    ).toBe("assigned to a disabled agent");

    expect(
      taskStartBlockedReason({
        task: task({ worktreeId: null }),
        agents: [agent()],
        assignedAgent: agent(),
        waitingForDependency: false,
      }),
    ).toBe("waiting for its worktree");
  });

  it("returns null for a task that can start", () => {
    expect(
      taskStartBlockedReason({
        task: task(),
        agents: [agent()],
        assignedAgent: agent(),
        waitingForDependency: false,
      }),
    ).toBeNull();
  });

  it("does not require an assignment when the mission has no agents", () => {
    expect(
      taskStartBlockedReason({
        task: task({ assignedMissionAgentId: null }),
        agents: [],
        assignedAgent: null,
        waitingForDependency: false,
      }),
    ).toBeNull();
  });
});

describe("missionBlockers", () => {
  it("reports nothing when the mission can proceed", () => {
    expect(missionBlockers(input())).toEqual([]);
  });

  it("reports nothing for a finished or cancelled mission", () => {
    expect(
      missionBlockers(
        input({ mission: mission({ status: "completed" }), providerReady: false, agents: [] }),
      ),
    ).toEqual([]);
    expect(
      missionBlockers(
        input({ mission: mission({ status: "cancelled" }), providerReady: false, agents: [] }),
      ),
    ).toEqual([]);
  });

  it("reports an unavailable provider", () => {
    expect(ids(missionBlockers(input({ providerReady: false })))).toContain("provider-unavailable");
  });

  it("reports a mission with tasks but no agents", () => {
    expect(ids(missionBlockers(input({ agents: [] })))).toContain("no-agents");
  });

  it("stays quiet about agents on a mission that has no tasks yet", () => {
    expect(ids(missionBlockers(input({ agents: [], tasks: [] })))).not.toContain("no-agents");
  });

  it("reports paused scheduling only while live tasks remain", () => {
    const paused = mission({ schedulerStatus: "paused" });
    expect(ids(missionBlockers(input({ mission: paused })))).toContain("scheduler-paused");
    expect(
      ids(missionBlockers(input({ mission: paused, tasks: [task({ status: "completed" })] }))),
    ).not.toContain("scheduler-paused");
  });

  it("groups start-blocked tasks by reason instead of listing each task", () => {
    const result = missionBlockers(
      input({
        tasks: [
          task({ id: "task-1", assignedMissionAgentId: null }),
          task({ id: "task-2", assignedMissionAgentId: null }),
          task({ id: "task-3", assignedMissionAgentId: null }),
        ],
      }),
    );
    const unassigned = result.filter((blocker) => blocker.id.startsWith("task-start:"));

    expect(unassigned).toHaveLength(1);
    expect(unassigned[0]!.message).toBe("3 tasks are not assigned to an agent.");
  });

  it("stays silent about transient waits the reader cannot act on", () => {
    const result = missionBlockers(input({ tasks: [task({ worktreeId: null })] }));

    expect(ids(result).some((id) => id.startsWith("task-start:"))).toBe(false);
  });

  it("names the blocked task when there is exactly one with a reason", () => {
    const result = missionBlockers(
      input({
        tasks: [task({ status: "blocked", blockedReason: "Dependency failed." })],
      }),
    );

    expect(result[0]!.message).toBe('Task "Implement the parser" is blocked: Dependency failed.');
  });

  it("reports tasks that exhausted every attempt", () => {
    expect(
      ids(
        missionBlockers(
          input({ tasks: [task({ status: "failed", attemptCount: 3, maximumAttempts: 3 })] }),
        ),
      ),
    ).toContain("task-attempts-exhausted");
  });

  it("reports integration conflicts ahead of verification", () => {
    const result = missionBlockers(
      input({
        tasks: [task({ integrationStatus: "conflicted" })],
        verificationSummaries: [verification({ authorization: { allowed: false } })],
      }),
    );

    expect(ids(result)).toContain("integration-conflicted");
    expect(ids(result)).not.toContain("integration-verification");
  });

  it("reports branches held back by missing verification evidence", () => {
    const result = missionBlockers(
      input({
        tasks: [task({ integrationStatus: "ready" })],
        verificationSummaries: [],
      }),
    );

    expect(ids(result)).toContain("integration-verification");
  });

  it("treats a verified branch awaiting approval as an advisory", () => {
    const result = missionBlockers(
      input({
        tasks: [task({ integrationStatus: "ready" })],
        verificationSummaries: [verification()],
      }),
    );

    expect(ids(result)).toEqual(["integration-approval"]);
    expect(result[0]!.severity).toBe("advisory");
  });

  it("orders every blocker ahead of every advisory", () => {
    const result = missionBlockers(
      input({
        providerReady: false,
        tasks: [task({ integrationStatus: "ready" })],
        verificationSummaries: [verification()],
      }),
    );

    const firstAdvisory = result.findIndex((blocker) => blocker.severity === "advisory");
    const lastBlocker = result.map((blocker) => blocker.severity).lastIndexOf("blocker");

    expect(firstAdvisory).toBeGreaterThan(lastBlocker);
  });

  it("points each blocker at the section that resolves it", () => {
    const result = missionBlockers(input({ providerReady: false, agents: [] }));

    expect(result.every((blocker) => blocker.anchor.startsWith("mission-"))).toBe(true);
  });
});
