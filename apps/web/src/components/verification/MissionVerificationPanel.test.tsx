import type { MissionAgent, MissionTask, VerificationTaskSummary } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MissionVerificationPanel } from "./MissionVerificationPanel";

function task(overrides: Record<string, unknown> = {}): MissionTask {
  return {
    id: "task-1",
    missionId: "mission-1",
    title: "Implement the parser",
    description: "",
    status: "pending",
    position: 0,
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
    assignedMissionAgentId: null,
    worktreeId: null,
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
    roleId: null,
    roleKind: "implementer",
    displayName: "Implementer 1",
    providerInstanceId: "provider-1",
    model: null,
    reasoningLevel: null,
    permissions: ["read_files", "write_files"],
    maximumConcurrentRuns: 1,
    status: "idle",
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
    ...overrides,
  } as unknown as MissionAgent;
}

function summary(overrides: Record<string, unknown> = {}): VerificationTaskSummary {
  return {
    taskId: "task-1",
    latestRun: null,
    authorization: { status: "missing", allowed: false, blockingReason: null },
    repairRunning: false,
    ...overrides,
  } as unknown as VerificationTaskSummary;
}

const NOOP = async () => {};
const NOT_PENDING = () => false;

function render(props: {
  tasks: ReadonlyArray<MissionTask>;
  agents?: ReadonlyArray<MissionAgent>;
  summaries?: ReadonlyArray<VerificationTaskSummary>;
}) {
  return renderToStaticMarkup(
    <MissionVerificationPanel
      tasks={props.tasks}
      agents={props.agents ?? []}
      summaries={props.summaries ?? []}
      canMutate
      isPending={NOT_PENDING}
      onRequest={NOOP}
      onOpenRun={() => {}}
    />,
  );
}

describe("MissionVerificationPanel", () => {
  it("hides tasks assigned to a read-only agent that hold no evidence", () => {
    const html = render({
      tasks: [
        task({ id: "task-write", title: "Write the parser", assignedMissionAgentId: "agent-1" }),
        task({ id: "task-read", title: "Survey the options", assignedMissionAgentId: "agent-2" }),
      ],
      agents: [
        agent(),
        agent({
          id: "agent-2",
          roleKind: "researcher",
          displayName: "Researcher 1",
          permissions: ["read_files", "search_repository"],
        }),
      ],
    });

    expect(html).toContain("Write the parser");
    expect(html).not.toContain("Survey the options");
  });

  it("keeps a read-only task that already recorded evidence", () => {
    const html = render({
      tasks: [
        task({ id: "task-read", title: "Survey the options", assignedMissionAgentId: "a-2" }),
      ],
      agents: [agent({ id: "a-2", permissions: ["read_files"] })],
      summaries: [summary({ taskId: "task-read" })],
    });

    expect(html).toContain("Survey the options");
  });

  it("keeps an unassigned task, which may still be given to a writer", () => {
    const html = render({ tasks: [task({ title: "Not yet assigned" })] });

    expect(html).toContain("Not yet assigned");
  });

  // `disabled` also appears inside Tailwind class names, so assert on the rendered attribute.
  it("disables the run button and states why when the task has no worktree", () => {
    const html = render({
      tasks: [task({ assignedMissionAgentId: "agent-1" })],
      agents: [agent()],
    });

    expect(html).toContain("Needs a worktree");
    expect(html).toContain('disabled=""');
  });

  it("enables the run button once a worktree exists", () => {
    const html = render({
      tasks: [task({ assignedMissionAgentId: "agent-1", worktreeId: "worktree-1" })],
      agents: [agent()],
    });

    expect(html).not.toContain("Needs a worktree");
    expect(html).not.toContain('disabled=""');
  });

  it("explains itself when no task can hold evidence", () => {
    const html = render({
      tasks: [task({ assignedMissionAgentId: "agent-2" })],
      agents: [agent({ id: "agent-2", permissions: ["read_files"] })],
    });

    expect(html).toContain("No task can hold verification evidence yet");
  });

  it("renders the empty state rather than a bare heading for a mission with no tasks", () => {
    const html = render({ tasks: [] });

    expect(html).toContain("Verification");
    expect(html).toContain("No task can hold verification evidence yet");
  });
});
