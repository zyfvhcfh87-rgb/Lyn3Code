import { describe, expect, it } from "vite-plus/test";

import { AgentRunId, EventId, MissionId, type OrchestrationEvent } from "@t3tools/contracts";

import { missionEventTimelineItem } from "./MissionTimeline.logic";

const missionId = MissionId.make("mission-1");

function event(input: Pick<OrchestrationEvent, "type" | "payload">): OrchestrationEvent {
  return {
    sequence: 12,
    eventId: EventId.make("event-12"),
    aggregateKind: "mission",
    aggregateId: missionId,
    occurredAt: "2026-08-03T12:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: input.type,
    payload: input.payload,
  } as OrchestrationEvent;
}

describe("mission timeline projection", () => {
  it("keeps provider failure payloads neutral and useful", () => {
    const item = missionEventTimelineItem(
      event({
        type: "agent_run.failed",
        payload: {
          missionId,
          taskId: null,
          agentRunId: AgentRunId.make("run-1"),
          occurredAt: "2026-08-03T12:00:00.000Z",
          errorSummary: "Provider exited before completion.",
        },
      }),
    );

    expect(item).toMatchObject({
      sequence: 12,
      type: "Agent run failed",
      summary: "Provider exited before completion.",
      tone: "error",
    });
  });

  it("describes restart interruption honestly", () => {
    const item = missionEventTimelineItem(
      event({
        type: "agent_run.interrupted",
        payload: {
          missionId,
          taskId: null,
          agentRunId: AgentRunId.make("run-1"),
          occurredAt: "2026-08-03T12:00:00.000Z",
        },
      }),
    );

    expect(item?.summary).toContain("server restarted");
    expect(item?.tone).toBe("error");
  });
});
