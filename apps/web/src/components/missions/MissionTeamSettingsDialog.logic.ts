import type { MissionTeamSettings } from "@t3tools/contracts";

/**
 * Every field the dialog submits together.
 *
 * Listed as a total record rather than an array so a field added to `MissionTeamSettings` fails to
 * compile here. A hand-written comparison would keep passing while silently ignoring the new field,
 * and ignoring it is what lets a stale save revert it.
 */
const TEAM_SETTINGS_FIELDS: Record<keyof MissionTeamSettings, true> = {
  maximumConcurrentAgents: true,
  maximumConcurrentWriteAgents: true,
  defaultMaximumTaskAttempts: true,
  autoStartReadyTasks: true,
  integrationMode: true,
};

/**
 * Whether the saved settings moved while this dialog was open.
 *
 * The form submits all five fields at once, so changing one locally would write the other four back
 * from the baseline it opened with, reverting whatever was saved elsewhere in between.
 */
export function missionTeamSettingsChangedElsewhere(
  baseline: MissionTeamSettings,
  current: MissionTeamSettings,
): boolean {
  const fields = Object.keys(TEAM_SETTINGS_FIELDS) as ReadonlyArray<keyof MissionTeamSettings>;
  return fields.some((field) => baseline[field] !== current[field]);
}

/** The server rejects writers exceeding total concurrency, so the form says so before the request. */
export function writersExceedTotalAgents({
  maximumConcurrentAgents,
  maximumConcurrentWriteAgents,
}: {
  readonly maximumConcurrentAgents: number;
  readonly maximumConcurrentWriteAgents: number;
}): boolean {
  return maximumConcurrentWriteAgents > maximumConcurrentAgents;
}
