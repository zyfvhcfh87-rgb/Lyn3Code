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

export const MISSION_STATUS_LABELS: Readonly<Record<MissionPresentationStatus, string>> = {
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
