import type { AgentRole, MissionAgent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canSubmitMissionAgentDraft,
  missionAgentDraftFrom,
  missionAgentEditConflict,
  missionAgentEditorInitialState,
  missionAgentSavePlan,
  modelAfterProviderChange,
  modelChoicesForProvider,
  permissionsAfterRoleChange,
  togglePermission,
  type MissionAgentDraft,
  type MissionAgentModelChoice,
  type MissionAgentProviderChoice,
} from "./MissionAgentEditor.logic";

const OPENED_AT = "2026-08-05T10:00:00.000Z";
const SAVED_ELSEWHERE_AT = "2026-08-05T10:04:00.000Z";

function agent(overrides: Record<string, unknown> = {}): MissionAgent {
  return {
    id: "agent-1",
    missionId: "mission-1",
    roleId: null,
    roleKind: "implementer",
    displayName: "Implementer 1",
    providerInstanceId: "provider-1",
    model: "gpt-test",
    reasoningLevel: null,
    permissions: ["read_files", "write_files"],
    maximumConcurrentRuns: 2,
    status: "idle",
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
    ...overrides,
  } as unknown as MissionAgent;
}

function role(overrides: Record<string, unknown> = {}): AgentRole {
  return {
    id: "role-1",
    kind: "implementer",
    name: "Implementer",
    defaultPermissions: ["read_files", "write_files"],
    ...overrides,
  } as unknown as AgentRole;
}

const ROLES: ReadonlyArray<AgentRole> = [
  role(),
  role({ id: "role-2", kind: "reviewer", name: "Reviewer", defaultPermissions: ["read_files"] }),
];

const PROVIDERS = [
  { id: "provider-1", label: "Provider One" },
  { id: "provider-2", label: "Provider Two" },
] as unknown as ReadonlyArray<MissionAgentProviderChoice>;

const MODELS: ReadonlyArray<MissionAgentModelChoice> = [
  { id: "gpt-test", label: "GPT Test", providerInstanceId: "provider-1", unavailable: false },
  { id: "gpt-other", label: "GPT Other", providerInstanceId: "provider-2", unavailable: false },
];

function draft(overrides: Partial<MissionAgentDraft> = {}): MissionAgentDraft {
  return {
    missionAgentId: null,
    displayName: "Implementer 1",
    roleKind: "implementer",
    providerInstanceId: "provider-1",
    model: null,
    maximumConcurrentRuns: 1,
    status: "idle",
    permissions: ["read_files"],
    ...overrides,
  } as unknown as MissionAgentDraft;
}

describe("missionAgentEditorInitialState", () => {
  it("keeps a permission set someone cleared instead of restoring role defaults", () => {
    const state = missionAgentEditorInitialState({
      agent: agent({ permissions: [] }),
      roles: ROLES,
      providerChoices: PROVIDERS,
    });

    expect(state.permissions).toEqual([]);
  });

  it("reproduces the slot it opened with, and records the baseline it must not overwrite", () => {
    const state = missionAgentEditorInitialState({
      agent: agent({ status: "disabled" }),
      roles: ROLES,
      providerChoices: PROVIDERS,
    });

    expect(state).toEqual({
      displayName: "Implementer 1",
      roleKind: "implementer",
      providerInstanceId: "provider-1",
      model: "gpt-test",
      maximumConcurrentRuns: 2,
      status: "disabled",
      permissions: ["read_files", "write_files"],
      baselineUpdatedAt: OPENED_AT,
    });
  });

  it("pre-fills a new slot from the implementer role and the first provider", () => {
    const state = missionAgentEditorInitialState({
      agent: null,
      roles: ROLES,
      providerChoices: PROVIDERS,
    });

    expect(state).toEqual({
      displayName: "",
      roleKind: "implementer",
      providerInstanceId: "provider-1",
      model: "",
      maximumConcurrentRuns: 1,
      status: "idle",
      permissions: ["read_files", "write_files"],
      baselineUpdatedAt: null,
    });
  });

  it("falls back to read-only when no role describes its defaults", () => {
    const state = missionAgentEditorInitialState({
      agent: null,
      roles: [],
      providerChoices: [],
    });

    expect(state.permissions).toEqual(["read_files"]);
    expect(state.providerInstanceId).toBe("");
  });
});

describe("missionAgentEditConflict", () => {
  it("reports a slot that was removed while the editor was open", () => {
    expect(
      missionAgentEditConflict({
        agentId: agent().id,
        agent: null,
        baselineUpdatedAt: OPENED_AT,
      }),
    ).toBe("slot-removed");
  });

  it("reports a slot another client saved while the editor was open", () => {
    expect(
      missionAgentEditConflict({
        agentId: agent().id,
        agent: agent({ updatedAt: SAVED_ELSEWHERE_AT }),
        baselineUpdatedAt: OPENED_AT,
      }),
    ).toBe("slot-changed");
  });

  it("allows a save when the slot still stands as it did when the editor opened", () => {
    expect(
      missionAgentEditConflict({
        agentId: agent().id,
        agent: agent(),
        baselineUpdatedAt: OPENED_AT,
      }),
    ).toBeNull();
  });

  it("never reports a conflict for a slot that does not exist yet", () => {
    expect(
      missionAgentEditConflict({ agentId: null, agent: null, baselineUpdatedAt: null }),
    ).toBeNull();
  });
});

describe("canSubmitMissionAgentDraft", () => {
  const base = {
    displayName: "Implementer 1",
    providerInstanceId: "provider-1",
    maximumConcurrentRuns: 1,
    submitting: false,
  };

  it("accepts a complete draft", () => {
    expect(canSubmitMissionAgentDraft(base)).toBe(true);
  });

  it("holds the form closed for the whole save, so a second submit cannot land mid-flight", () => {
    expect(canSubmitMissionAgentDraft({ ...base, submitting: true })).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    expect(canSubmitMissionAgentDraft({ ...base, displayName: "   " })).toBe(false);
  });

  it("rejects a slot with no provider to run it", () => {
    expect(canSubmitMissionAgentDraft({ ...base, providerInstanceId: "" })).toBe(false);
  });

  it("rejects run capacity the contract cannot hold", () => {
    expect(canSubmitMissionAgentDraft({ ...base, maximumConcurrentRuns: 0 })).toBe(false);
    expect(canSubmitMissionAgentDraft({ ...base, maximumConcurrentRuns: 1.5 })).toBe(false);
    expect(canSubmitMissionAgentDraft({ ...base, maximumConcurrentRuns: Number.NaN })).toBe(false);
  });
});

describe("missionAgentDraftFrom", () => {
  it("trims the name and reads a blank model as the provider default", () => {
    expect(
      missionAgentDraftFrom({
        agentId: null,
        displayName: "  Implementer 1  ",
        roleKind: "implementer",
        providerInstanceId: "provider-1",
        model: "  ",
        maximumConcurrentRuns: 1,
        status: "idle",
        permissions: ["read_files"],
      }),
    ).toEqual({
      missionAgentId: null,
      displayName: "Implementer 1",
      roleKind: "implementer",
      providerInstanceId: "provider-1",
      model: null,
      maximumConcurrentRuns: 1,
      status: "idle",
      permissions: ["read_files"],
    });
  });

  it("carries the slot's own id, so an edit is never submitted as a new slot", () => {
    expect(
      missionAgentDraftFrom({
        agentId: agent().id,
        displayName: "Implementer 1",
        roleKind: "implementer",
        providerInstanceId: "provider-1",
        model: "gpt-test",
        maximumConcurrentRuns: 1,
        status: "idle",
        permissions: [],
      }).missionAgentId,
    ).toBe("agent-1");
  });
});

describe("provider and model coherence", () => {
  it("offers only the models the chosen provider serves", () => {
    expect(modelChoicesForProvider(MODELS, "provider-1").map((choice) => choice.id)).toEqual([
      "gpt-test",
    ]);
  });

  it("clears a model the new provider does not offer", () => {
    expect(modelAfterProviderChange(MODELS, "provider-2", "gpt-test")).toBe("");
  });

  it("keeps a model the new provider does offer", () => {
    expect(modelAfterProviderChange(MODELS, "provider-2", "gpt-other")).toBe("gpt-other");
  });
});

describe("permission editing", () => {
  it("adopts the role's defaults only while the slot is still being added", () => {
    expect(
      permissionsAfterRoleChange({
        agentId: null,
        roleKind: "reviewer",
        roles: ROLES,
        current: ["read_files", "write_files"],
      }),
    ).toEqual(["read_files"]);
  });

  it("leaves an existing slot's permissions alone when its role changes", () => {
    expect(
      permissionsAfterRoleChange({
        agentId: agent().id,
        roleKind: "reviewer",
        roles: ROLES,
        current: ["read_files", "write_files"],
      }),
    ).toEqual(["read_files", "write_files"]);
  });

  it("adds and removes one permission at a time without duplicating it", () => {
    expect(togglePermission(["read_files"], "write_files", true)).toEqual([
      "read_files",
      "write_files",
    ]);
    expect(togglePermission(["read_files", "write_files"], "write_files", false)).toEqual([
      "read_files",
    ]);
    expect(togglePermission(["read_files"], "read_files", true)).toEqual(["read_files"]);
  });
});

describe("missionAgentSavePlan", () => {
  it("refuses an edit whose slot is gone rather than resurrecting it under a new id", () => {
    expect(
      missionAgentSavePlan({ draft: draft({ missionAgentId: agent().id }), existing: null }),
    ).toEqual({ kind: "conflict" });
  });

  it("writes a new slot's permissions exactly as chosen, empty included", () => {
    expect(missionAgentSavePlan({ draft: draft({ permissions: [] }), existing: null })).toEqual({
      kind: "create",
      permissions: [],
    });
  });

  it("leaves the permission command as the sole authority for a change", () => {
    const existing = agent({ permissions: ["read_files", "write_files"] });

    const plan = missionAgentSavePlan({
      draft: draft({ missionAgentId: existing.id, permissions: ["read_files"] }),
      existing,
    });

    // The upsert carries the permissions as stored, not as chosen: applying them here too would
    // land the change even when the permission command that records it fails.
    expect(plan).toEqual({
      kind: "update",
      missionAgentId: "agent-1",
      permissions: ["read_files", "write_files"],
      permissionsChanged: true,
    });
  });

  it("sees a granted permission and a revoked one alike", () => {
    const existing = agent({ permissions: ["read_files"] });

    expect(
      missionAgentSavePlan({
        draft: draft({ missionAgentId: existing.id, permissions: ["read_files", "write_files"] }),
        existing,
      }),
    ).toMatchObject({ permissionsChanged: true });
    expect(
      missionAgentSavePlan({
        draft: draft({ missionAgentId: existing.id, permissions: [] }),
        existing,
      }),
    ).toMatchObject({ permissionsChanged: true });
  });

  it("does not record a permission change for the same set in another order", () => {
    const existing = agent({ permissions: ["read_files", "write_files"] });

    expect(
      missionAgentSavePlan({
        draft: draft({ missionAgentId: existing.id, permissions: ["write_files", "read_files"] }),
        existing,
      }),
    ).toMatchObject({ permissionsChanged: false });
  });

  it("keeps the slot's own id when the rest of the record changed elsewhere", () => {
    const existing = agent({ displayName: "Renamed elsewhere", updatedAt: SAVED_ELSEWHERE_AT });

    expect(
      missionAgentSavePlan({
        draft: draft({ missionAgentId: existing.id }),
        existing,
      }),
    ).toMatchObject({ kind: "update", missionAgentId: "agent-1" });
  });
});
