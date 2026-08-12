import type {
  AgentRoleKind,
  AgentRunStatus,
  ManagedWorktreeStatus,
  MissionAgentStatus,
  MissionIntegrationMode,
  MissionSchedulerStatus,
  MissionStatus,
  MissionTaskStatus,
  TaskIntegrationStatus,
} from "@t3tools/contracts";

/**
 * Written labels for every mission enum the interface shows.
 *
 * Persisted values are snake_case identifiers meant for the event store, not for reading. Each map
 * is typed as a total record so adding a value to a contract enum fails to compile until it has a
 * label, rather than leaking the raw identifier into the page.
 */

export const MISSION_STATUS_LABELS: Readonly<Record<MissionStatus, string>> = {
  backlog: "Backlog",
  planning: "Planning",
  ready: "Ready",
  running: "Running",
  verification: "Verification",
  review: "Review",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const MISSION_TASK_STATUS_LABELS: Readonly<Record<MissionTaskStatus, string>> = {
  backlog: "Backlog",
  ready: "Ready",
  running: "Running",
  verification: "Verifying",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const TASK_INTEGRATION_STATUS_LABELS: Readonly<Record<TaskIntegrationStatus, string>> = {
  not_requested: "Not requested",
  pending: "Awaiting approval",
  ready: "Ready to integrate",
  integrating: "Integrating",
  integrated: "Integrated",
  conflicted: "Conflicted",
  failed: "Integration failed",
};

export const AGENT_RUN_STATUS_LABELS: Readonly<Record<AgentRunStatus, string>> = {
  starting: "Starting",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  interrupted: "Interrupted",
};

/** Fallback names for role kinds. A project's configured `AgentRole.name` wins where one exists. */
export const AGENT_ROLE_KIND_LABELS: Readonly<Record<AgentRoleKind, string>> = {
  coordinator: "Coordinator",
  implementer: "Implementer",
  researcher: "Researcher",
  reviewer: "Reviewer",
  verifier: "Verifier",
  custom: "Custom",
};

export const MISSION_AGENT_STATUS_LABELS: Readonly<Record<MissionAgentStatus, string>> = {
  idle: "Idle",
  running: "Running",
  disabled: "Disabled",
  unavailable: "Unavailable",
};

export const MISSION_SCHEDULER_STATUS_LABELS: Readonly<Record<MissionSchedulerStatus, string>> = {
  idle: "Scheduler idle",
  running: "Scheduler running",
  paused: "Scheduler paused",
};

export const MISSION_INTEGRATION_MODE_LABELS: Readonly<Record<MissionIntegrationMode, string>> = {
  manual: "Manual approval",
  sequential: "Sequential",
  automatic_when_clean: "Automatic when clean",
};

export const MANAGED_WORKTREE_STATUS_LABELS: Readonly<Record<ManagedWorktreeStatus, string>> = {
  planned: "Planned",
  creating: "Creating",
  ready: "Ready",
  active: "In use",
  dirty: "Uncommitted changes",
  conflicted: "Conflicted",
  integration_ready: "Ready to integrate",
  integrated: "Integrated",
  removing: "Removing",
  removed: "Removed",
  failed: "Failed",
  orphaned: "Orphaned",
};

/**
 * What the task graph shows on a card, which is not a single contract enum: an integration state
 * outranks the task's own status once integration starts, and a task held back by an unfinished
 * dependency reads more usefully than the `backlog` or `ready` underneath it.
 */
export type MissionTaskDisplayStatus =
  | MissionTaskStatus
  | "integrated"
  | "conflicted"
  | "integration_pending"
  | "waiting_for_dependency";

export const MISSION_TASK_DISPLAY_STATUS_LABELS: Readonly<
  Record<MissionTaskDisplayStatus, string>
> = {
  ...MISSION_TASK_STATUS_LABELS,
  integrated: "Integrated",
  conflicted: "Conflicted",
  integration_pending: "Integration pending",
  waiting_for_dependency: "Waiting for dependency",
};
