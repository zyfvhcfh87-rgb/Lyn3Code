import { MissionId, MissionTaskId, TaskDependencyId, type MissionTask } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MissionTaskGraph } from "./MissionTaskGraph";

const missionId = MissionId.make("mission-1");

function task(id: string, title: string, position: number): MissionTask {
  return {
    id: MissionTaskId.make(id),
    missionId,
    title,
    description: "",
    status: "ready",
    position,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
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
  };
}

describe("MissionTaskGraph", () => {
  it("renders dependency stages and an accessible prerequisite relationship", () => {
    const markup = renderToStaticMarkup(
      <MissionTaskGraph
        tasks={[task("task-b", "Implement UI", 1), task("task-a", "Define contracts", 0)]}
        dependencies={[
          {
            id: TaskDependencyId.make("dependency-1"),
            missionId,
            taskId: MissionTaskId.make("task-b"),
            dependsOnTaskId: MissionTaskId.make("task-a"),
            createdAt: "2026-08-03T12:00:00.000Z",
          },
        ]}
        canMutate={false}
      />,
    );

    expect(markup).toContain('aria-label="Task dependency graph"');
    expect(markup.indexOf("Define contracts")).toBeLessThan(markup.indexOf("Implement UI"));
    expect(markup).toContain("Prerequisites");
  });

  it("renders an explicit empty state", () => {
    expect(
      renderToStaticMarkup(<MissionTaskGraph tasks={[]} dependencies={[]} canMutate={false} />),
    ).toContain("No tasks yet");
  });
});
