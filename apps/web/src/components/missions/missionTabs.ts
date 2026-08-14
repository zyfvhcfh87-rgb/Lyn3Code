import { MISSION_SECTION_ANCHORS, type MissionSectionAnchor } from "./MissionBlockers.logic";

/**
 * The mission lifecycle, used as the workspace's top-level grouping.
 *
 * Not an invented taxonomy: this is the progression the server already models, from planning work
 * through running it, proving it, and shipping it. Ten always-open sections in one scroll gave a
 * task graph and a rollback history the same weight; grouping them lets the page open on the part
 * that is actually in play.
 */
export const MISSION_TABS = ["plan", "work", "verify", "ship", "history"] as const;

export type MissionTab = (typeof MISSION_TABS)[number];

export const MISSION_TAB_LABELS: Readonly<Record<MissionTab, string>> = {
  plan: "Plan",
  work: "Work",
  verify: "Verify",
  ship: "Ship",
  history: "History",
};

export const DEFAULT_MISSION_TAB: MissionTab = "plan";

/** Which tab holds each section, so a blocker can route to the panel that resolves it. */
const TAB_BY_ANCHOR: Readonly<Record<MissionSectionAnchor, MissionTab>> = {
  [MISSION_SECTION_ANCHORS.team]: "plan",
  [MISSION_SECTION_ANCHORS.tasks]: "plan",
  [MISSION_SECTION_ANCHORS.runs]: "work",
  [MISSION_SECTION_ANCHORS.worktrees]: "work",
  [MISSION_SECTION_ANCHORS.verification]: "verify",
  [MISSION_SECTION_ANCHORS.integration]: "verify",
};

export function missionTabForAnchor(anchor: MissionSectionAnchor): MissionTab {
  return TAB_BY_ANCHOR[anchor];
}

export function isMissionTab(value: unknown): value is MissionTab {
  return typeof value === "string" && (MISSION_TABS as ReadonlyArray<string>).includes(value);
}
