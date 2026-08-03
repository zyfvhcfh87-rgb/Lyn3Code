import { describe, expect, it } from "vite-plus/test";

import { missionDependencyLayers, preflightMissionDependency } from "./MissionTaskGraph.logic";

describe("mission task dependency presentation", () => {
  it("rejects self, duplicate, and transitive cyclic dependencies", () => {
    const edges = [
      { taskId: "task-b", dependsOnTaskId: "task-a" },
      { taskId: "task-c", dependsOnTaskId: "task-b" },
    ];

    expect(preflightMissionDependency(edges, "task-a", "task-a")).toEqual({
      allowed: false,
      reason: "self",
    });
    expect(preflightMissionDependency(edges, "task-b", "task-a")).toEqual({
      allowed: false,
      reason: "duplicate",
    });
    expect(preflightMissionDependency(edges, "task-a", "task-c")).toEqual({
      allowed: false,
      reason: "cycle",
    });
    expect(preflightMissionDependency(edges, "task-c", "task-a")).toEqual({ allowed: true });
  });

  it("builds stable dependency layers in task display order", () => {
    expect(
      missionDependencyLayers(
        ["task-b", "task-a", "task-d", "task-c"],
        [
          { taskId: "task-b", dependsOnTaskId: "task-a" },
          { taskId: "task-c", dependsOnTaskId: "task-b" },
        ],
      ),
    ).toEqual([["task-a", "task-d"], ["task-b"], ["task-c"]]);
  });

  it("keeps malformed cyclic tasks visible in a final recovery layer", () => {
    expect(
      missionDependencyLayers(
        ["task-a", "task-b"],
        [
          { taskId: "task-a", dependsOnTaskId: "task-b" },
          { taskId: "task-b", dependsOnTaskId: "task-a" },
        ],
      ),
    ).toEqual([["task-a", "task-b"]]);
  });
});
