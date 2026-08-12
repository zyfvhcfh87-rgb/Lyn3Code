import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_RUN_STATUS_LABELS,
  MANAGED_WORKTREE_STATUS_LABELS,
  MISSION_AGENT_STATUS_LABELS,
  MISSION_INTEGRATION_MODE_LABELS,
  MISSION_SCHEDULER_STATUS_LABELS,
  MISSION_STATUS_LABELS,
  MISSION_TASK_DISPLAY_STATUS_LABELS,
  MISSION_TASK_STATUS_LABELS,
  TASK_INTEGRATION_STATUS_LABELS,
} from "./missionLabels";
import { MISSION_GLOSSARY } from "./missionGlossary";

const LABEL_MAPS = {
  MISSION_STATUS_LABELS,
  MISSION_TASK_STATUS_LABELS,
  MISSION_TASK_DISPLAY_STATUS_LABELS,
  TASK_INTEGRATION_STATUS_LABELS,
  AGENT_RUN_STATUS_LABELS,
  MISSION_AGENT_STATUS_LABELS,
  MISSION_SCHEDULER_STATUS_LABELS,
  MISSION_INTEGRATION_MODE_LABELS,
  MANAGED_WORKTREE_STATUS_LABELS,
} as const;

describe("mission labels", () => {
  // Completeness is enforced by the Record types; this guards the part types cannot: that a label
  // is actually written English rather than the persisted identifier passed through.
  it("never renders a persisted identifier as a label", () => {
    for (const [mapName, labels] of Object.entries(LABEL_MAPS)) {
      for (const [value, label] of Object.entries(labels)) {
        expect(label, `${mapName}.${value}`).not.toContain("_");
        expect(label, `${mapName}.${value}`).not.toBe(value);
      }
    }
  });

  it("starts every label with a capital so badges read consistently", () => {
    for (const [mapName, labels] of Object.entries(LABEL_MAPS)) {
      for (const [value, label] of Object.entries(labels)) {
        expect(label.slice(0, 1), `${mapName}.${value}`).toBe(label.slice(0, 1).toUpperCase());
      }
    }
  });

  it("keeps the task display statuses a superset of the task statuses", () => {
    for (const [status, label] of Object.entries(MISSION_TASK_STATUS_LABELS)) {
      expect(MISSION_TASK_DISPLAY_STATUS_LABELS[status as never]).toBe(label);
    }
  });
});

describe("mission glossary", () => {
  it("defines every term as a complete sentence", () => {
    for (const [term, definition] of Object.entries(MISSION_GLOSSARY)) {
      expect(definition.length, term).toBeGreaterThan(20);
      expect(definition.endsWith("."), term).toBe(true);
    }
  });
});
