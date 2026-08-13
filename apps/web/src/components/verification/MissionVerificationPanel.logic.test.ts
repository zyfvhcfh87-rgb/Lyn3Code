import type { MissionAgent, MissionTask, VerificationTaskSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { verifiableTasks, verificationRunBlockedReason } from "./MissionVerificationPanel.logic";

const AT = "2026-08-05T10:00:00.000Z";

function task(overrides: Record<string, unknown> = {}): MissionTask {
  return {
    id: "task-1",
    missionId: "mission-1",
    title: "Implement the parser",
    status: "ready",
    position: 0,
    createdAt: AT,
    updatedAt: AT,
    assignedMissionAgentId: null,
    worktreeId: null,
    attemptCount: 0,
    maximumAttempts: 3,
    integrationStatus: "not_requested",
    ...overrides,
  } as unknown as MissionTask;
}

function agent(overrides: Record<string, unknown> = {}): MissionAgent {
  return {
    id: "agent-1",
    missionId: "mission-1",
    roleKind: "implementer",
    displayName: "Implementer 1",
    permissions: ["read_files", "write_files"],
    status: "idle",
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as unknown as MissionAgent;
}

function summary(taskId: string): VerificationTaskSummary {
  return {
    taskId,
    latestRun: null,
    authorization: { status: "missing", allowed: false, blockingReason: null },
    repairRunning: false,
  } as unknown as VerificationTaskSummary;
}

const titles = (tasks: ReadonlyArray<MissionTask>) => tasks.map((item) => item.title);

describe("verifiableTasks", () => {
  it("hides a task assigned to a read-only agent that holds no evidence", () => {
    const result = verifiableTasks(
      [
        task({ id: "write", title: "Write the parser", assignedMissionAgentId: "agent-1" }),
        task({ id: "read", title: "Survey the options", assignedMissionAgentId: "agent-2" }),
      ],
      [agent(), agent({ id: "agent-2", permissions: ["read_files", "search_repository"] })],
      [],
    );

    expect(titles(result)).toEqual(["Write the parser"]);
  });

  it("keeps a read-only task that already recorded evidence", () => {
    const result = verifiableTasks(
      [task({ id: "read", title: "Survey the options", assignedMissionAgentId: "agent-2" })],
      [agent({ id: "agent-2", permissions: ["read_files"] })],
      [summary("read")],
    );

    expect(titles(result)).toEqual(["Survey the options"]);
  });

  it("keeps a read-only task that already has a worktree", () => {
    const result = verifiableTasks(
      [
        task({
          id: "read",
          title: "Survey the options",
          assignedMissionAgentId: "agent-2",
          worktreeId: "worktree-1",
        }),
      ],
      [agent({ id: "agent-2", permissions: ["read_files"] })],
      [],
    );

    expect(titles(result)).toEqual(["Survey the options"]);
  });

  it("keeps an unassigned task, which may still be given to a writer", () => {
    expect(titles(verifiableTasks([task({ title: "Not yet assigned" })], [agent()], []))).toEqual([
      "Not yet assigned",
    ]);
  });

  it("keeps every task on a mission with no team configured", () => {
    expect(titles(verifiableTasks([task({ title: "Only task" })], [], []))).toEqual(["Only task"]);
  });
});

describe("verificationRunBlockedReason", () => {
  it("blocks a task with no worktree and says why", () => {
    expect(verificationRunBlockedReason(task())).toBe(
      "Needs a worktree. Start this task before requesting verification.",
    );
  });

  it("allows a task once its worktree exists", () => {
    expect(verificationRunBlockedReason(task({ worktreeId: "worktree-1" }))).toBeNull();
  });
});
