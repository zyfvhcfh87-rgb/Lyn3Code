import { MISSION_STATUS_LABELS } from "./missionLabels";

// Re-exported so existing board call sites and tests keep importing labels from one place.
export { MISSION_STATUS_LABELS };

export const MISSION_BOARD_STATUSES = [
  "backlog",
  "planning",
  "ready",
  "running",
  "verification",
  "review",
  "blocked",
  "completed",
] as const;

export const MISSION_TERMINAL_FILTER_STATUSES = ["failed", "cancelled"] as const;

export type MissionBoardStatus = (typeof MISSION_BOARD_STATUSES)[number];
export type MissionTerminalFilterStatus = (typeof MISSION_TERMINAL_FILTER_STATUSES)[number];
export type MissionPresentationStatus = MissionBoardStatus | MissionTerminalFilterStatus;

export interface MissionBoardItem {
  readonly missionId: string;
  readonly status: MissionPresentationStatus;
  readonly updatedAt: string;
}

export interface MissionBoardGroups<TMission extends MissionBoardItem> {
  readonly columns: Readonly<Record<MissionBoardStatus, ReadonlyArray<TMission>>>;
  readonly terminal: ReadonlyArray<TMission>;
}

function compareMostRecentlyUpdated(
  left: Pick<MissionBoardItem, "missionId" | "updatedAt">,
  right: Pick<MissionBoardItem, "missionId" | "updatedAt">,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) || left.missionId.localeCompare(right.missionId)
  );
}

export function groupMissionsForBoard<TMission extends MissionBoardItem>(
  missions: ReadonlyArray<TMission>,
): MissionBoardGroups<TMission> {
  const mutableColumns = Object.fromEntries(
    MISSION_BOARD_STATUSES.map((status) => [status, [] as TMission[]]),
  ) as Record<MissionBoardStatus, TMission[]>;
  const terminal: TMission[] = [];

  for (const mission of missions) {
    if (mission.status === "failed" || mission.status === "cancelled") {
      terminal.push(mission);
      continue;
    }
    mutableColumns[mission.status].push(mission);
  }

  for (const status of MISSION_BOARD_STATUSES) {
    mutableColumns[status].sort(compareMostRecentlyUpdated);
  }
  terminal.sort(compareMostRecentlyUpdated);

  return { columns: mutableColumns, terminal };
}

export function filterMissionsByProject<TMission extends { readonly projectId: string }>(
  missions: ReadonlyArray<TMission>,
  projectId: string | null,
): ReadonlyArray<TMission> {
  return projectId === null
    ? missions
    : missions.filter((mission) => mission.projectId === projectId);
}

export interface MissionBoardColumn<TMission extends MissionBoardItem> {
  readonly status: MissionBoardStatus;
  readonly missions: ReadonlyArray<TMission>;
  /** Rendered as a narrow rail rather than a full column. */
  readonly collapsed: boolean;
}

/**
 * The board's columns, with empty ones collapsed to a rail.
 *
 * Eight full-width columns run to roughly 2,400px, so on an ordinary window half the pipeline —
 * including Blocked — sits off-screen. Empty columns hold no information beyond their own
 * existence, so they give up their width until asked for. Every status is still present and still
 * in lifecycle order; nothing is hidden.
 */
export function missionBoardColumns<TMission extends MissionBoardItem>(
  grouped: MissionBoardGroups<TMission>,
  expandedStatuses: ReadonlySet<MissionBoardStatus> = new Set(),
): ReadonlyArray<MissionBoardColumn<TMission>> {
  return MISSION_BOARD_STATUSES.map((status) => {
    const missions = grouped.columns[status];
    return {
      status,
      missions,
      collapsed: missions.length === 0 && !expandedStatuses.has(status),
    };
  });
}

export interface MissionAttentionSummary {
  readonly blocked: number;
  readonly failed: number;
  readonly cancelled: number;
}

/**
 * Counts worth reading before any scrolling happens. Surfaced in the board header because the
 * columns and the terminal group they come from can both be out of view.
 */
export function missionAttentionSummary<TMission extends MissionBoardItem>(
  grouped: MissionBoardGroups<TMission>,
): MissionAttentionSummary {
  return {
    blocked: grouped.columns.blocked.length,
    failed: grouped.terminal.filter((mission) => mission.status === "failed").length,
    cancelled: grouped.terminal.filter((mission) => mission.status === "cancelled").length,
  };
}
