import type {
  AgentPermission,
  AgentRole,
  AgentRoleKind,
  MissionAgent,
  MissionAgentId,
  ProviderInstanceId,
} from "@t3tools/contracts";

/** Sentinel for "no explicit model", which the contract represents as null. */
export const PROVIDER_DEFAULT_MODEL = "__provider_default__";

export interface MissionAgentDraft {
  /** Null when adding a slot. */
  readonly missionAgentId: MissionAgentId | null;
  readonly displayName: string;
  readonly roleKind: AgentRoleKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly model: string | null;
  readonly maximumConcurrentRuns: number;
  readonly status: MissionAgent["status"];
  readonly permissions: ReadonlyArray<AgentPermission>;
}

export interface MissionAgentProviderChoice {
  readonly id: ProviderInstanceId;
  readonly label: string;
}

/** A model this provider offers. `id` is the provider's own slug, which is what an agent stores. */
export interface MissionAgentModelChoice {
  readonly id: string;
  readonly label: string;
  readonly providerInstanceId: string;
  readonly unavailable: boolean;
}

export function defaultPermissionsFor(
  roleKind: AgentRoleKind,
  roles: ReadonlyArray<AgentRole>,
): ReadonlyArray<AgentPermission> {
  return roles.find((role) => role.kind === roleKind)?.defaultPermissions ?? ["read_files"];
}

export interface MissionAgentEditorInitialState {
  readonly displayName: string;
  readonly roleKind: AgentRoleKind;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly maximumConcurrentRuns: number;
  readonly status: MissionAgent["status"];
  readonly permissions: ReadonlyArray<AgentPermission>;
  /** The record as it stood when the editor opened, or null for a new slot. */
  readonly baselineUpdatedAt: string | null;
}

/**
 * The values the form opens with, captured once.
 *
 * An existing slot is reproduced exactly, including an empty permission set: role defaults stand
 * in only when there is no record to read, because substituting them for a set someone cleared
 * would re-grant capabilities the form never showed.
 */
export function missionAgentEditorInitialState({
  agent,
  roles,
  providerChoices,
}: {
  readonly agent: MissionAgent | null;
  readonly roles: ReadonlyArray<AgentRole>;
  readonly providerChoices: ReadonlyArray<MissionAgentProviderChoice>;
}): MissionAgentEditorInitialState {
  return {
    displayName: agent?.displayName ?? "",
    roleKind: agent?.roleKind ?? "implementer",
    providerInstanceId: agent?.providerInstanceId ?? providerChoices[0]?.id ?? "",
    model: agent?.model ?? "",
    maximumConcurrentRuns: agent?.maximumConcurrentRuns ?? 1,
    status: agent?.status ?? "idle",
    permissions: agent?.permissions ?? defaultPermissionsFor("implementer", roles),
    baselineUpdatedAt: agent?.updatedAt ?? null,
  };
}

export type MissionAgentEditConflict = "slot-removed" | "slot-changed";

export const MISSION_AGENT_EDIT_CONFLICT_MESSAGES: Record<MissionAgentEditConflict, string> = {
  "slot-removed":
    "This slot was removed elsewhere. Close the editor and add a new one if you need it.",
  "slot-changed":
    "This slot changed elsewhere while you were editing. Close and reopen to start from the current values.",
};

/**
 * Whether the slot moved under the editor while it was open.
 *
 * The form holds the values it opened with, so saving without this check would write every field
 * back over a newer record - including permissions another client may have just revoked.
 */
export function missionAgentEditConflict({
  agentId,
  agent,
  baselineUpdatedAt,
}: {
  readonly agentId: MissionAgentId | null;
  /** The live record for `agentId`, or null once it no longer exists. */
  readonly agent: MissionAgent | null;
  readonly baselineUpdatedAt: string | null;
}): MissionAgentEditConflict | null {
  if (agentId === null) return null;
  if (agent === null) return "slot-removed";
  if (agent.updatedAt !== baselineUpdatedAt) return "slot-changed";
  return null;
}

export function canSubmitMissionAgentDraft({
  displayName,
  providerInstanceId,
  maximumConcurrentRuns,
  submitting,
}: {
  readonly displayName: string;
  readonly providerInstanceId: string;
  readonly maximumConcurrentRuns: number;
  readonly submitting: boolean;
}): boolean {
  return (
    displayName.trim().length > 0 &&
    providerInstanceId.length > 0 &&
    Number.isInteger(maximumConcurrentRuns) &&
    maximumConcurrentRuns >= 1 &&
    !submitting
  );
}

export function missionAgentDraftFrom({
  agentId,
  displayName,
  roleKind,
  providerInstanceId,
  model,
  maximumConcurrentRuns,
  status,
  permissions,
}: {
  readonly agentId: MissionAgentId | null;
  readonly displayName: string;
  readonly roleKind: AgentRoleKind;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly maximumConcurrentRuns: number;
  readonly status: MissionAgent["status"];
  readonly permissions: ReadonlyArray<AgentPermission>;
}): MissionAgentDraft {
  return {
    missionAgentId: agentId,
    displayName: displayName.trim(),
    roleKind,
    providerInstanceId: providerInstanceId as ProviderInstanceId,
    model: model.trim() || null,
    maximumConcurrentRuns,
    status,
    permissions,
  };
}

export function modelChoicesForProvider(
  choices: ReadonlyArray<MissionAgentModelChoice>,
  providerInstanceId: string,
): ReadonlyArray<MissionAgentModelChoice> {
  return choices.filter((choice) => choice.providerInstanceId === providerInstanceId);
}

/**
 * A model slug belongs to one provider, so carrying it across would pin a model the new provider
 * does not offer and routing would reject the run.
 */
export function modelAfterProviderChange(
  choices: ReadonlyArray<MissionAgentModelChoice>,
  nextProviderInstanceId: string,
  model: string,
): string {
  const offered = choices.some(
    (choice) => choice.providerInstanceId === nextProviderInstanceId && choice.id === model,
  );
  return offered ? model : "";
}

/** Adopting a role's defaults is the point of picking one; an existing slot keeps its own. */
export function permissionsAfterRoleChange({
  agentId,
  roleKind,
  roles,
  current,
}: {
  readonly agentId: MissionAgentId | null;
  readonly roleKind: AgentRoleKind;
  readonly roles: ReadonlyArray<AgentRole>;
  readonly current: ReadonlyArray<AgentPermission>;
}): ReadonlyArray<AgentPermission> {
  return agentId === null ? defaultPermissionsFor(roleKind, roles) : current;
}

export function togglePermission(
  current: ReadonlyArray<AgentPermission>,
  permission: AgentPermission,
  checked: boolean,
): ReadonlyArray<AgentPermission> {
  if (!checked) return current.filter((value) => value !== permission);
  return current.includes(permission) ? current : [...current, permission];
}

function samePermissionSet(
  a: ReadonlyArray<AgentPermission>,
  b: ReadonlyArray<AgentPermission>,
): boolean {
  return a.every((permission) => b.includes(permission)) && b.every((p) => a.includes(p));
}

export type MissionAgentSavePlan =
  | { readonly kind: "conflict" }
  | { readonly kind: "create"; readonly permissions: ReadonlyArray<AgentPermission> }
  | {
      readonly kind: "update";
      readonly missionAgentId: MissionAgentId;
      readonly permissions: ReadonlyArray<AgentPermission>;
      readonly permissionsChanged: boolean;
    };

/**
 * What a submitted draft means for the two commands behind one save.
 *
 * `permissions` is what the upsert writes. A new slot carries the chosen set exactly, empty
 * included. An existing slot carries its current set, leaving `mission.agent.permissions.update`
 * as the sole authority for a change: sending the new set on both would apply it even when that
 * command fails, and the next open would find nothing left to record, so the audit entry could
 * never be recovered.
 */
export function missionAgentSavePlan({
  draft,
  existing,
}: {
  readonly draft: MissionAgentDraft;
  /** The record named by `draft.missionAgentId` as the current snapshot holds it. */
  readonly existing: MissionAgent | null;
}): MissionAgentSavePlan {
  if (draft.missionAgentId === null) return { kind: "create", permissions: draft.permissions };
  // The draft names a slot that is no longer in the snapshot, so it was removed elsewhere while
  // this editor was open. Minting a new id would silently resurrect it under a different identity,
  // detaching it from its own history.
  if (existing === null) return { kind: "conflict" };
  return {
    kind: "update",
    missionAgentId: existing.id,
    permissions: existing.permissions,
    permissionsChanged: !samePermissionSet(existing.permissions, draft.permissions),
  };
}
