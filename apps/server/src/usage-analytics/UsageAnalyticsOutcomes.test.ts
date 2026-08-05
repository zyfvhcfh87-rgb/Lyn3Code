import {
  AgentRunId,
  MissionId,
  MissionTaskId,
  ProviderInstanceId,
  ThreadId,
  type AgentRun,
  type Mission,
  type MissionTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { deriveMissionOutcome, deriveTaskOutcome } from "./UsageAnalyticsOutcomes.ts";

const taskId = MissionTaskId.make("task-1");
const missionId = MissionId.make("mission-1");
const task = (overrides: Partial<MissionTask> = {}): MissionTask => ({
  id: taskId,
  missionId,
  title: "Implement analytics",
  description: "",
  status: "completed",
  position: 0,
  createdAt: "2026-08-04T10:00:00.000Z",
  updatedAt: "2026-08-04T10:05:00.000Z",
  startedAt: "2026-08-04T10:01:00.000Z",
  completedAt: "2026-08-04T10:05:00.000Z",
  assignedMissionAgentId: null,
  worktreeId: null,
  attemptCount: 1,
  maximumAttempts: 3,
  readyAt: "2026-08-04T10:00:30.000Z",
  blockedReason: null,
  integrationStatus: "integrated",
  requiresDependencyHandoffs: true,
  ...overrides,
});

const agentRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: AgentRunId.make("run-1"),
  missionId,
  taskId,
  threadId: ThreadId.make("thread-1"),
  provider: "codex",
  providerInstanceId: ProviderInstanceId.make("codex-default"),
  providerSessionId: null,
  status: "completed",
  createdAt: "2026-08-04T10:00:00.000Z",
  startedAt: "2026-08-04T10:01:00.000Z",
  updatedAt: "2026-08-04T10:04:00.000Z",
  completedAt: "2026-08-04T10:04:00.000Z",
  errorSummary: null,
  missionAgentId: null,
  worktreeId: null,
  attemptNumber: 1,
  permissions: ["read_files", "write_files"],
  writeCapable: true,
  ...overrides,
});

describe("usage analytics outcomes", () => {
  it("does not invent verification or human acceptance", () => {
    const outcome = deriveTaskOutcome({
      task: task(),
      agentRuns: [agentRun()],
      verificationRuns: [],
      verificationOverrides: [],
      performance: [],
      previous: null,
      reverted: false,
      observedAt: "2026-08-04T10:05:00.000Z",
    });

    expect(outcome.verificationResult).toBe("not_run");
    expect(outcome.firstPassVerification).toBeNull();
    expect(outcome.humanDisposition).toBe("not_reviewed");
    expect(outcome.totalWallClockDurationMilliseconds).toBeNull();
  });

  it("preserves explicit human disposition and revert evidence", () => {
    const first = deriveTaskOutcome({
      task: task(),
      agentRuns: [agentRun()],
      verificationRuns: [],
      verificationOverrides: [],
      performance: [],
      previous: null,
      reverted: false,
      observedAt: "2026-08-04T10:05:00.000Z",
    });
    const outcome = deriveTaskOutcome({
      task: task(),
      agentRuns: [agentRun()],
      verificationRuns: [],
      verificationOverrides: [],
      performance: [],
      previous: { ...first, humanDisposition: "accepted_with_edits" },
      reverted: true,
      observedAt: "2026-08-04T10:06:00.000Z",
    });

    expect(outcome.humanDisposition).toBe("accepted_with_edits");
    expect(outcome.reverted).toBe(true);
  });

  it("rolls task evidence into a mission without inferring review", () => {
    const taskOutcome = deriveTaskOutcome({
      task: task(),
      agentRuns: [agentRun()],
      verificationRuns: [],
      verificationOverrides: [],
      performance: [],
      previous: null,
      reverted: false,
      observedAt: "2026-08-04T10:05:00.000Z",
    });
    const mission: Mission = {
      id: missionId,
      projectId: "project-1" as Mission["projectId"],
      title: "Phase 7",
      description: "",
      status: "completed",
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T10:05:00.000Z",
      startedAt: "2026-08-04T09:05:00.000Z",
      completedAt: "2026-08-04T10:05:00.000Z",
      cancelledAt: null,
      teamSettings: {
        maximumConcurrentAgents: 2,
        maximumConcurrentWriteAgents: 1,
        defaultMaximumTaskAttempts: 3,
        autoStartReadyTasks: true,
        integrationMode: "automatic_when_clean",
      },
      schedulerStatus: "idle",
    };
    const outcome = deriveMissionOutcome({
      mission,
      taskOutcomes: [taskOutcome],
      previous: null,
      pullRequestCreated: false,
      pullRequestMerged: true,
      observedAt: mission.updatedAt,
    });

    expect(outcome.completedTaskCount).toBe(1);
    expect(outcome.integratedTaskCount).toBe(1);
    expect(outcome.pullRequestCreated).toBe(true);
    expect(outcome.pullRequestMerged).toBe(true);
    expect(outcome.humanDisposition).toBe("not_reviewed");
  });
});
