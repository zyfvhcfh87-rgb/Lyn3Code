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
        summary: "Waiting for active provider runs to stop; worktrees remain preserved.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "mission.cancelled":
      return {
        sequence: event.sequence,
        type: "Mission cancelled",
        summary: "Active work stopped without reporting mission completion.",
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "mission.completed":
      return {
        sequence: event.sequence,
        type: "Mission completed",
        summary: "All mission work completed successfully.",
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
    case "mission.team-configured":
      return {
        sequence: event.sequence,
        type: "Team settings updated",
        summary: `Concurrency is ${event.payload.settings.maximumConcurrentAgents} agents, including ${event.payload.settings.maximumConcurrentWriteAgents} writers.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "mission.agent-upserted":
      return {
        sequence: event.sequence,
        type: "Mission agent configured",
        summary: `${event.payload.agent.displayName} is assigned as ${event.payload.agent.roleKind}.`,
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "mission.agent-removed":
      return {
        sequence: event.sequence,
        type: "Mission agent removed",
        summary: "The agent slot was removed from the team.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "mission.agent-permissions-updated":
      return {
        sequence: event.sequence,
        type: "Agent permissions updated",
        summary: `${event.payload.permissions.length} capabilities are enabled.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "task.dependency-added":
      return {
        sequence: event.sequence,
        type: "Task dependency added",
        summary: "A prerequisite was added to the task graph.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "task.dependency-removed":
      return {
        sequence: event.sequence,
        type: "Task dependency removed",
        summary: "A prerequisite was removed from the task graph.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "task.ready":
      return {
        sequence: event.sequence,
        type: "Task ready",
        summary: "Dependencies, handoffs, worktree, and concurrency checks passed.",
        createdAt: event.occurredAt,
        tone: "success",
      };
    case "task.blocked":
      return {
        sequence: event.sequence,
        type: "Task blocked",
        summary: event.payload.reason,
        createdAt: event.occurredAt,
        tone: "error",
      };
    case "task.retry-requested":
      return {
        sequence: event.sequence,
        type: "Task retry requested",
        summary: `Attempt ${event.payload.attemptNumber}: ${event.payload.reason}`,
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "task.cancellation-requested":
      return {
        sequence: event.sequence,
        type: "Task cancellation requested",
        summary: "The active task run was asked to stop; its worktree is preserved.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "managed_worktree.recorded":
      return {
        sequence: event.sequence,
        type: "Worktree recorded",
        summary: `${event.payload.worktree.branchName} is ${event.payload.worktree.status}.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "managed_worktree.status-updated":
      return {
        sequence: event.sequence,
        type: "Worktree status updated",
        summary: `The managed worktree is ${event.payload.status}.`,
        createdAt: event.occurredAt,
        tone:
          event.payload.status === "failed" ||
          event.payload.status === "conflicted" ||
          event.payload.status === "orphaned"
            ? "error"
            : "neutral",
      };
    case "managed_worktree.removal-requested":
      return {
        sequence: event.sequence,
        type: "Worktree removal requested",
        summary: "Safe cleanup checks are running before removal.",
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "agent_handoff.created":
      return {
        sequence: event.sequence,
        type: "Structured handoff created",
        summary: event.payload.handoff.summary,
        createdAt: event.occurredAt,
        tone: "agent",
      };
    case "agent_handoff.reconciled":
      return {
        sequence: event.sequence,
        type: "Handoff reconciled with Git",
        summary: `${event.payload.changedFiles.length} changed files are ${event.payload.reconciliationStatus}.`,
        createdAt: event.occurredAt,
        tone: "success",
      };
    case "scheduler.started":
    case "scheduler.paused":
    case "scheduler.resumed":
      return {
        sequence: event.sequence,
        type: eventLabel(event.type),
        summary: `The mission scheduler is ${event.payload.status}.`,
        createdAt: event.occurredAt,
        tone: event.payload.status === "running" ? "agent" : "neutral",
      };
    case "scheduler.concurrency-limited":
      return {
        sequence: event.sequence,
        type: "Scheduler waiting for capacity",
        summary: `Limit: ${event.payload.maximumConcurrentAgents} agents and ${event.payload.maximumConcurrentWriteAgents} writers.`,
        createdAt: event.occurredAt,
        tone: "neutral",
      };
    case "integration.requested":
    case "integration.approved":
    case "integration.started":
    case "integration.completed":
    case "integration.conflicted":
    case "integration.aborted":
    case "integration.failed":
      return {
        sequence: event.sequence,
        type: eventLabel(event.type),
        summary:
          event.payload.errorSummary ??
          (event.payload.conflictingFiles?.length
            ? `${event.payload.conflictingFiles.length} conflicting files require recovery.`
            : `Integration is ${event.payload.integrationStatus}.`),
        createdAt: event.occurredAt,
        tone:
          event.type === "integration.completed"
            ? "success"
            : event.type === "integration.conflicted" || event.type === "integration.failed"
              ? "error"
              : "neutral",
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
