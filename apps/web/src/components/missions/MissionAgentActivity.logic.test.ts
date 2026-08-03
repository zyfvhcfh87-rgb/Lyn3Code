import { AgentRunId, EventId, MissionId, type OrchestrationEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { missionEventsForAgentRun } from "./MissionAgentActivity.logic";

const missionId = MissionId.make("mission-1");
const runOneId = AgentRunId.make("run-1");
const runTwoId = AgentRunId.make("run-2");

function event(sequence: number, type: string, payload: unknown): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "mission",
    aggregateId: missionId,
    occurredAt: "2026-08-03T12:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as OrchestrationEvent;
}

describe("mission per-run activity", () => {
  it("keeps concurrent agent timelines isolated", () => {
    const events = [
      event(1, "agent_run.running", {
        missionId,
        taskId: null,
        agentRunId: runOneId,
        providerSessionId: "session-1",
        occurredAt: "2026-08-03T12:00:00.000Z",
      }),
      event(2, "agent_run.running", {
        missionId,
        taskId: null,
        agentRunId: runTwoId,
        providerSessionId: "session-2",
        occurredAt: "2026-08-03T12:00:00.000Z",
      }),
      event(3, "agent_run.completed", {
        missionId,
        taskId: null,
        agentRunId: runOneId,
        occurredAt: "2026-08-03T12:00:00.000Z",
      }),
    ];

    expect(missionEventsForAgentRun(events, runOneId).map((item) => item.sequence)).toEqual([1, 3]);
  });
});
