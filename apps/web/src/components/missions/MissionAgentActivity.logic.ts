import type { AgentRunId, OrchestrationEvent } from "@t3tools/contracts";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export function missionEventAgentRunId(event: OrchestrationEvent): AgentRunId | null {
  const payload: unknown = event.payload;
  if (!isRecord(payload)) return null;
  if (typeof payload.agentRunId === "string") return payload.agentRunId as AgentRunId;
  if (isRecord(payload.run) && typeof payload.run.id === "string") {
    return payload.run.id as AgentRunId;
  }
  if (isRecord(payload.handoff) && typeof payload.handoff.agentRunId === "string") {
    return payload.handoff.agentRunId as AgentRunId;
  }
  return null;
}

export function missionEventsForAgentRun(
  events: ReadonlyArray<OrchestrationEvent>,
  agentRunId: AgentRunId,
): ReadonlyArray<OrchestrationEvent> {
  return events.filter((event) => missionEventAgentRunId(event) === agentRunId);
}
