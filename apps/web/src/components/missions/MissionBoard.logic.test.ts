import { describe, expect, it } from "vite-plus/test";

import {
  filterMissionsByProject,
  groupMissionsForBoard,
  missionAttentionSummary,
  missionBoardColumns,
  MISSION_BOARD_STATUSES,
} from "./MissionBoard.logic";

describe("mission board presentation", () => {
  it("keeps the Phase 1 board to the eight required columns", () => {
    expect(MISSION_BOARD_STATUSES).toEqual([
      "backlog",
      "planning",
      "ready",
      "running",
      "verification",
      "review",
      "blocked",
      "completed",
    ]);
  });

  it("groups failed and cancelled missions outside the main columns", () => {
    const grouped = groupMissionsForBoard([
      { missionId: "ready-1", status: "ready", updatedAt: "2026-08-03T10:00:00.000Z" },
      { missionId: "failed-1", status: "failed", updatedAt: "2026-08-03T11:00:00.000Z" },
      { missionId: "cancelled-1", status: "cancelled", updatedAt: "2026-08-03T12:00:00.000Z" },
    ]);

    expect(grouped.columns.ready.map((mission) => mission.missionId)).toEqual(["ready-1"]);
    expect(grouped.terminal.map((mission) => mission.missionId)).toEqual([
      "cancelled-1",
      "failed-1",
    ]);
  });

  it("sorts each column by newest update with a stable id fallback", () => {
    const grouped = groupMissionsForBoard([
      { missionId: "b", status: "backlog", updatedAt: "2026-08-03T12:00:00.000Z" },
      { missionId: "c", status: "backlog", updatedAt: "2026-08-03T13:00:00.000Z" },
      { missionId: "a", status: "backlog", updatedAt: "2026-08-03T12:00:00.000Z" },
    ]);

    expect(grouped.columns.backlog.map((mission) => mission.missionId)).toEqual(["c", "a", "b"]);
  });

  it("filters missions without copying project selection into another store", () => {
    const missions = [
      { id: "mission-1", projectId: "project-1" },
      { id: "mission-2", projectId: "project-2" },
    ];

    expect(filterMissionsByProject(missions, null)).toBe(missions);
    expect(filterMissionsByProject(missions, "project-2")).toEqual([missions[1]]);
  });
});

describe("mission board columns", () => {
  const grouped = groupMissionsForBoard([
    { missionId: "running-1", status: "running", updatedAt: "2026-08-03T10:00:00.000Z" },
    { missionId: "blocked-1", status: "blocked", updatedAt: "2026-08-03T11:00:00.000Z" },
  ]);

  it("keeps every status present and in lifecycle order", () => {
    expect(missionBoardColumns(grouped).map((column) => column.status)).toEqual([
      ...MISSION_BOARD_STATUSES,
    ]);
  });

  it("collapses only the empty columns", () => {
    const collapsed = missionBoardColumns(grouped)
      .filter((column) => column.collapsed)
      .map((column) => column.status);

    expect(collapsed).not.toContain("running");
    expect(collapsed).not.toContain("blocked");
    expect(collapsed).toContain("backlog");
    expect(collapsed).toContain("completed");
  });

  it("keeps an explicitly expanded empty column open", () => {
    const columns = missionBoardColumns(grouped, new Set(["backlog"] as const));
    const backlog = columns.find((column) => column.status === "backlog");

    expect(backlog?.collapsed).toBe(false);
    expect(backlog?.missions).toEqual([]);
  });

  it("never collapses a populated column, even if asked to expand others", () => {
    const columns = missionBoardColumns(grouped, new Set(["backlog"] as const));

    expect(columns.find((column) => column.status === "running")?.collapsed).toBe(false);
  });
});

describe("mission attention summary", () => {
  it("counts blocked missions and separates failed from cancelled", () => {
    const grouped = groupMissionsForBoard([
      { missionId: "blocked-1", status: "blocked", updatedAt: "2026-08-03T10:00:00.000Z" },
      { missionId: "blocked-2", status: "blocked", updatedAt: "2026-08-03T11:00:00.000Z" },
      { missionId: "failed-1", status: "failed", updatedAt: "2026-08-03T12:00:00.000Z" },
      { missionId: "cancelled-1", status: "cancelled", updatedAt: "2026-08-03T13:00:00.000Z" },
      { missionId: "cancelled-2", status: "cancelled", updatedAt: "2026-08-03T14:00:00.000Z" },
    ]);

    expect(missionAttentionSummary(grouped)).toEqual({
      blocked: 2,
      failed: 1,
      cancelled: 2,
    });
  });

  it("reports zeroes for an empty board", () => {
    expect(missionAttentionSummary(groupMissionsForBoard([]))).toEqual({
      blocked: 0,
      failed: 0,
      cancelled: 0,
    });
  });
});
