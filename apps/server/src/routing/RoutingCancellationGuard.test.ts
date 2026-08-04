import { describe, expect, it } from "@effect/vitest";
import { AgentRunId, MissionId, MissionTaskId } from "@t3tools/contracts";

import type { RoutingCancellationNotice } from "./RoutingCancellationGuard.ts";
import { makeRoutingCancellationGuard } from "./RoutingCancellationGuard.ts";

const notice = (
  type: RoutingCancellationNotice["type"],
  payload: RoutingCancellationNotice["payload"],
) => ({ type, payload }) as RoutingCancellationNotice;

describe("RoutingCancellationGuard", () => {
  it("blocks the whole mission after a mission cancellation request", () => {
    const guard = makeRoutingCancellationGuard();
    guard.note(
      notice("mission.cancellation-requested", {
        missionId: MissionId.make("mission-1"),
        agentRunId: AgentRunId.make("run-1"),
        agentRunIds: [AgentRunId.make("run-1")],
        requestedAt: "2026-08-03T00:00:00.000Z",
      }),
    );

    expect(guard.includes({ missionId: "mission-1", taskId: "task-2" })).toBe(true);
    expect(guard.includes({ missionId: "mission-2", agentRunId: "run-1" })).toBe(true);
  });

  it("blocks task and run fallback scopes without affecting an unrelated mission", () => {
    const guard = makeRoutingCancellationGuard();
    guard.note(
      notice("task.cancellation-requested", {
        missionId: MissionId.make("mission-1"),
        taskId: MissionTaskId.make("task-1"),
        requestedAt: "2026-08-03T00:00:00.000Z",
      }),
    );
    guard.note(
      notice("agent_run.cancellation-requested", {
        missionId: MissionId.make("mission-2"),
        taskId: MissionTaskId.make("task-2"),
        agentRunId: AgentRunId.make("run-2"),
        occurredAt: "2026-08-03T00:00:01.000Z",
      }),
    );

    expect(guard.includes({ missionId: "mission-1", taskId: "task-1" })).toBe(true);
    expect(guard.includes({ missionId: "mission-1", taskId: "task-other" })).toBe(false);
    expect(guard.includes({ missionId: "mission-2", agentRunId: "run-2" })).toBe(true);
    expect(guard.includes({ missionId: "mission-2", taskId: "task-other" })).toBe(false);
    expect(guard.includes({ missionId: "mission-3", taskId: "task-3" })).toBe(false);
  });
});
