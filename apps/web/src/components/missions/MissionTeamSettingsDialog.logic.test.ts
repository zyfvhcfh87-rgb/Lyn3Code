import type { MissionTeamSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  missionTeamSettingsChangedElsewhere,
  writersExceedTotalAgents,
} from "./MissionTeamSettingsDialog.logic";

function settings(overrides: Partial<MissionTeamSettings> = {}): MissionTeamSettings {
  return {
    maximumConcurrentAgents: 3,
    maximumConcurrentWriteAgents: 2,
    defaultMaximumTaskAttempts: 3,
    autoStartReadyTasks: true,
    integrationMode: "manual",
    ...overrides,
  } as unknown as MissionTeamSettings;
}

describe("missionTeamSettingsChangedElsewhere", () => {
  it("allows a save when nothing moved while the dialog was open", () => {
    expect(missionTeamSettingsChangedElsewhere(settings(), settings())).toBe(false);
  });

  it("sees a change to any field the dialog would submit back", () => {
    const baseline = settings();

    expect(
      missionTeamSettingsChangedElsewhere(baseline, settings({ maximumConcurrentAgents: 5 })),
    ).toBe(true);
    expect(
      missionTeamSettingsChangedElsewhere(baseline, settings({ maximumConcurrentWriteAgents: 1 })),
    ).toBe(true);
    expect(
      missionTeamSettingsChangedElsewhere(baseline, settings({ defaultMaximumTaskAttempts: 1 })),
    ).toBe(true);
    expect(
      missionTeamSettingsChangedElsewhere(baseline, settings({ autoStartReadyTasks: false })),
    ).toBe(true);
    expect(
      missionTeamSettingsChangedElsewhere(baseline, settings({ integrationMode: "sequential" })),
    ).toBe(true);
  });

  it("compares by value, so an equal record from a later snapshot still saves", () => {
    expect(missionTeamSettingsChangedElsewhere(settings(), { ...settings() })).toBe(false);
  });
});

describe("writersExceedTotalAgents", () => {
  it("reports writers above the total the server will accept", () => {
    expect(
      writersExceedTotalAgents({ maximumConcurrentAgents: 2, maximumConcurrentWriteAgents: 3 }),
    ).toBe(true);
  });

  it("accepts writers up to the total", () => {
    expect(
      writersExceedTotalAgents({ maximumConcurrentAgents: 2, maximumConcurrentWriteAgents: 2 }),
    ).toBe(false);
  });
});
