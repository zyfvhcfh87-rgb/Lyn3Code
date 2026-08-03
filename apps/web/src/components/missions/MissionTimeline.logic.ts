import type { OrchestrationEvent } from "@t3tools/contracts";

import type { MissionTimelineItem } from "./MissionTimeline";

function eventLabel(type: string): string {
  return type
    .replace("agent_run", "agent run")
    .replaceAll(/[._-]+/gu, " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

export function missionEventTimelineItem(event: OrchestrationEvent): MissionTimelineItem | null {
  switch (event.type) {
    case "mission.created":
      return {
        sequence: event.sequence,
        type: "Mission created",
        summary: `Created “${event.payload.mission.title}”.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "mission.updated":
      return {
        sequence: event.sequence,
        type: "Mission updated",
        summary:
          event.payload.status === undefined
            ? "Mission details changed."
            : `Status changed to ${event.payload.status}.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "mission.started":
      return {
        sequence: event.sequence,
        type: "Mission started",
        summary: event.payload.taskId === null ? "Agent run started." : "Agent started a task.",
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "mission.cancellation-requested":
      return {
        sequence: event.sequence,
        type: "Cancellation requested",
        summary: "Waiting for the active provider run to stop.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "mission.cancelled":
      return {
        sequence: event.sequence,
        type: "Mission cancelled",
        summary: "The active run stopped without reporting completion.",
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "mission.completed":
      return {
        sequence: event.sequence,
        type: "Mission completed",
        summary: "The single-agent run completed successfully.",
        createdAt: event.occurredAt,
        tone: "success",
      };
    case "mission.failed":
      return {
        sequence: event.sequence,
        type: "Mission failed",
        summary: event.payload.errorSummary,
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "mission.recovery-blocked":
      return {
        sequence: event.sequence,
        type: "Mission recovery blocked",
        summary: event.payload.reason,
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "task.created":
      return {
        sequence: event.sequence,
        type: "Task created",
        summary: event.payload.task.title,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "task.updated":
      return {
        sequence: event.sequence,
        type: "Task updated",
        summary:
          event.payload.status === undefined
            ? "Task details changed."
            : `Task status changed to ${event.payload.status}.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "task.started":
      return {
        sequence: event.sequence,
        type: "Task started",
        summary: "The active agent began this task.",
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "task.completed":
      return {
        sequence: event.sequence,
        type: "Task completed",
        summary: "The task completed successfully.",
        createdAt: event.occurredAt,
        tone: "success",
      };
    case "task.cancelled":
      return {
        sequence: event.sequence,
        type: "Task cancelled",
        summary: "The task stopped without reporting completion.",
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "task.failed":
      return {
        sequence: event.sequence,
        type: "Task failed",
        summary: event.payload.errorSummary ?? "The provider run failed.",
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "agent_run.started":
      return {
        sequence: event.sequence,
        type: "Agent run created",
        summary: `Started with ${event.payload.run.provider}.`,
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "agent_run.running":
      return {
        sequence: event.sequence,
        type: "Agent run connected",
        summary: "The provider accepted the run and began working.",
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "agent_run.cancellation-requested":
      return {
        sequence: event.sequence,
        type: "Agent run stopping",
        summary: "A cancellation request was sent to the provider.",
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "agent_run.completed":
    case "agent_run.cancelled":
    case "agent_run.failed":
    case "agent_run.interrupted":
      return {
        sequence: event.sequence,
        type: eventLabel(event.type),
        summary:
          event.payload.errorSummary ??
          (event.type === "agent_run.completed"
            ? "The provider run completed."
            : event.type === "agent_run.cancelled"
              ? "The provider run was cancelled."
              : event.type === "agent_run.interrupted"
                ? "The server restarted while this run was active."
                : "The provider run failed."),
        createdAt: event.occurredAt,
        tone: event.type === "agent_run.completed" ? "success" : "error",
      };
    default:
      return null;
  }
}

export function missionEventTimelineItems(
  events: ReadonlyArray<OrchestrationEvent>,
): ReadonlyArray<MissionTimelineItem> {
  return events.flatMap((event) => {
    const item = missionEventTimelineItem(event);
    return item === null ? [] : [item];
  });
}
