import {
  AgentRunId,
  ManagedWorktreeId,
  MissionId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentRun,
  type ManagedWorktree,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { worktreeCleanupBlockers } from "./MissionWorktreePanel";

const NOW = "2026-08-03T12:00:00.000Z";
const missionId = MissionId.make("mission-1");
const worktreeId = ManagedWorktreeId.make("worktree-1");

const worktree = {
  id: worktreeId,
  projectId: ProjectId.make("project-1"),
  missionId,
  taskId: null,
  purpose: "task",
  repositoryPath: "C:/repo",
  worktreePath: "C:/repo-worktree",
  branchName: "agent/mission/task",
  baseBranch: "main",
  baseCommit: "abc123",
  headCommit: null,
  status: "dirty",
  changedFileCount: 1,
  hasUncommittedChanges: true,
  conflictingFiles: [],
  createdAt: NOW,
  updatedAt: NOW,
  removedAt: null,
  errorSummary: null,
} satisfies ManagedWorktree;

const activeRun = {
  id: AgentRunId.make("run-1"),
  missionId,
  taskId: null,
  threadId: ThreadId.make("thread-1"),
  provider: "codex",
  providerInstanceId: ProviderInstanceId.make("codex-1"),
  providerSessionId: null,
  status: "running",
  createdAt: NOW,
  startedAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  errorSummary: null,
  missionAgentId: null,
  worktreeId,
  attemptNumber: 1,
  permissions: ["read_files", "write_files"],
  writeCapable: true,
} satisfies AgentRun;

describe("worktree cleanup eligibility", () => {
  it("reports every preservation blocker for an active dirty unintegrated worktree", () => {
    expect(worktreeCleanupBlockers(worktree, [activeRun])).toEqual([
      "an agent is active",
      "uncommitted changes remain",
      "the task branch is not integrated",
    ]);
  });

  it("allows a clean integrated worktree to be removed", () => {
    expect(
      worktreeCleanupBlockers(
        {
          ...worktree,
          status: "integrated",
          hasUncommittedChanges: false,
        },
        [],
      ),
    ).toEqual([]);
  });
});
