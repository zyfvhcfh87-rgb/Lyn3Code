import { describe, expect, it } from "vite-plus/test";

import { MISSION_SECTION_ANCHORS } from "./MissionBlockers.logic";
import {
  DEFAULT_MISSION_TAB,
  isMissionTab,
  missionTabForAnchor,
  MISSION_TABS,
  MISSION_TAB_LABELS,
} from "./missionTabs";

describe("mission tabs", () => {
  it("follows the mission lifecycle order", () => {
    expect(MISSION_TABS).toEqual(["plan", "work", "verify", "ship", "history"]);
  });

  it("labels every tab", () => {
    for (const tab of MISSION_TABS) {
      expect(MISSION_TAB_LABELS[tab], tab).toBeTruthy();
    }
  });

  it("opens on the planning tab", () => {
    expect(MISSION_TABS).toContain(DEFAULT_MISSION_TAB);
    expect(DEFAULT_MISSION_TAB).toBe("plan");
  });

  // Every blocker carries an anchor, so an unmapped one would leave its row unable to route.
  it("routes every mission section anchor to a tab", () => {
    for (const anchor of Object.values(MISSION_SECTION_ANCHORS)) {
      expect(MISSION_TABS, anchor).toContain(missionTabForAnchor(anchor));
    }
  });

  it("keeps blocker-bearing sections out of ship and history", () => {
    const routed = Object.values(MISSION_SECTION_ANCHORS).map(missionTabForAnchor);

    expect(routed).not.toContain("ship");
    expect(routed).not.toContain("history");
  });

  it("accepts only known tab values from the URL", () => {
    expect(isMissionTab("verify")).toBe(true);
    expect(isMissionTab("plan")).toBe(true);
    expect(isMissionTab("nonsense")).toBe(false);
    expect(isMissionTab(undefined)).toBe(false);
    expect(isMissionTab(3)).toBe(false);
  });
});
