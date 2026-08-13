import {
  ALL_AGENT_PERMISSIONS,
  type AgentPermission,
  type AgentRole,
  type AgentRoleKind,
  type EnvironmentId,
  type MissionAgent,
  type MissionAgentId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState, type FormEvent } from "react";

import { routingEnvironment } from "../../state/routing";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { AGENT_ROLE_KIND_LABELS, MISSION_AGENT_STATUS_LABELS } from "./missionLabels";

const ROLE_KINDS = [
  "coordinator",
  "implementer",
  "researcher",
  "reviewer",
  "verifier",
  "custom",
] as const satisfies ReadonlyArray<AgentRoleKind>;

/** Availability a person can choose. `running` is owned by the scheduler, not the editor. */
const SELECTABLE_STATUSES = ["idle", "disabled", "unavailable"] as const;

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

/** Sentinel for "no explicit model", which the contract represents as null. */
const PROVIDER_DEFAULT_MODEL = "__provider_default__";

function defaultPermissionsFor(
  roleKind: AgentRoleKind,
  roles: ReadonlyArray<AgentRole>,
): ReadonlyArray<AgentPermission> {
  return roles.find((role) => role.kind === roleKind)?.defaultPermissions ?? ["read_files"];
}

/**
 * One dialog for an agent slot, replacing three independent forms with three save buttons.
 *
 * Everything about a slot - identity, provider, capacity, availability, and permissions - is one
 * decision, so it is one form and one save. `mission.agent.upsert` carries the whole record
 * including permissions, so a single command can express it.
 */
export function MissionAgentEditor({
  environmentId,
  open,
  agent,
  roles,
  providerChoices,
  isSubmitting,
  onOpenChange,
  onSave,
}: MissionAgentEditorProps) {
  // The routing registry is the same source the routing panel reads, so the models offered here are
  // exactly the ones routing can select. Read in the outer component to keep hook order stable
  // while the inner form mounts and unmounts with the dialog.
  const registryResult = useAtomValue(
    routingEnvironment.registryAtom({ environmentId, input: {} }),
  );
  const registry = Option.getOrNull(AsyncResult.value(registryResult));
  const modelChoices: ReadonlyArray<MissionAgentModelChoice> = (registry?.models ?? []).map(
    (model) => ({
      id: model.providerModelId,
      label: model.displayName,
      providerInstanceId: model.providerProfileId,
      unavailable: !model.isEnabled || model.status !== "available",
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        {/*
          Mounted only while open and keyed by subject, so each opening starts from fresh state.
          An effect syncing props into state would re-run whenever the parent re-rendered - the
          provider list is rebuilt on every render - and wipe what the user had typed.
        */}
        {open ? (
          <MissionAgentEditorForm
            key={agent?.id ?? "new-agent"}
            agent={agent}
            roles={roles}
            providerChoices={providerChoices}
            modelChoices={modelChoices}
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onSave={onSave}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

interface MissionAgentEditorProps {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  /** Null opens the editor for a new slot. */
  readonly agent: MissionAgent | null;
  readonly roles: ReadonlyArray<AgentRole>;
  readonly providerChoices: ReadonlyArray<MissionAgentProviderChoice>;
  readonly isSubmitting: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (draft: MissionAgentDraft) => Promise<boolean>;
}

function MissionAgentEditorForm({
  agent,
  roles,
  providerChoices,
  modelChoices,
  isSubmitting,
  onOpenChange,
  onSave,
}: Omit<MissionAgentEditorProps, "open" | "environmentId"> & {
  readonly modelChoices: ReadonlyArray<MissionAgentModelChoice>;
}) {
  const [displayName, setDisplayName] = useState(agent?.displayName ?? "");
  const [roleKind, setRoleKind] = useState<AgentRoleKind>(agent?.roleKind ?? "implementer");
  const [providerInstanceId, setProviderInstanceId] = useState<string>(
    agent?.providerInstanceId ?? providerChoices[0]?.id ?? "",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [maximumConcurrentRuns, setMaximumConcurrentRuns] = useState(
    agent?.maximumConcurrentRuns ?? 1,
  );
  const [status, setStatus] = useState<MissionAgent["status"]>(agent?.status ?? "idle");
  const [permissions, setPermissions] = useState<ReadonlyArray<AgentPermission>>(
    agent?.permissions ?? defaultPermissionsFor("implementer", roles),
  );

  const providerModels = modelChoices.filter(
    (choice) => choice.providerInstanceId === providerInstanceId,
  );

  const handleProviderChange = (next: string) => {
    setProviderInstanceId(next);
    // A model slug belongs to one provider, so carrying it across would pin a model the new
    // provider does not offer and routing would reject the run.
    if (!modelChoices.some((choice) => choice.providerInstanceId === next && choice.id === model)) {
      setModel("");
    }
  };

  const trimmedName = displayName.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    providerInstanceId.length > 0 &&
    Number.isInteger(maximumConcurrentRuns) &&
    maximumConcurrentRuns >= 1 &&
    !isSubmitting;

  const handleRoleChange = (next: AgentRoleKind) => {
    setRoleKind(next);
    // Adopting a role's defaults is the point of picking one; an existing slot keeps its own.
    if (agent === null) setPermissions(defaultPermissionsFor(next, roles));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const saved = await onSave({
      missionAgentId: agent?.id ?? null,
      displayName: trimmedName,
      roleKind,
      providerInstanceId: providerInstanceId as ProviderInstanceId,
      model: model.trim() || null,
      maximumConcurrentRuns,
      status,
      permissions,
    });
    if (saved) onOpenChange(false);
  };

  const roleLabel = (kind: AgentRoleKind) =>
    roles.find((role) => role.kind === kind)?.name ?? AGENT_ROLE_KIND_LABELS[kind];

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <DialogHeader>
        <DialogTitle>{agent ? "Edit agent slot" : "Add agent slot"}</DialogTitle>
        <DialogDescription>
          A slot decides which provider runs a task, what the agent may do, and how much work it
          takes at once.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Display name</span>
            <Input
              autoFocus
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              placeholder="Implementer 1"
              maxLength={200}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Role</span>
            <Select
              value={roleKind}
              onValueChange={(value) => value && handleRoleChange(value as AgentRoleKind)}
            >
              <SelectTrigger aria-label="Agent role">
                <SelectValue>{roleLabel(roleKind)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {ROLE_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {roleLabel(kind)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Provider</span>
            <Select
              value={providerInstanceId || null}
              onValueChange={(value) => handleProviderChange(value ?? "")}
            >
              <SelectTrigger aria-label="Agent provider">
                <SelectValue placeholder="Choose provider">
                  {providerChoices.find((choice) => choice.id === providerInstanceId)?.label ??
                    (providerInstanceId ? `${providerInstanceId} (unavailable)` : undefined)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {providerInstanceId &&
                !providerChoices.some((choice) => choice.id === providerInstanceId) ? (
                  <SelectItem value={providerInstanceId}>
                    {providerInstanceId} (unavailable)
                  </SelectItem>
                ) : null}
                {providerChoices.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Model</span>
            <Select
              value={model === "" ? PROVIDER_DEFAULT_MODEL : model}
              onValueChange={(value) =>
                setModel(!value || value === PROVIDER_DEFAULT_MODEL ? "" : value)
              }
            >
              <SelectTrigger aria-label="Agent model">
                <SelectValue>
                  {model === ""
                    ? "Provider default"
                    : (providerModels.find((choice) => choice.id === model)?.label ??
                      `${model} (unavailable)`)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value={PROVIDER_DEFAULT_MODEL}>Provider default</SelectItem>
                {/* Keep a model the slot already holds selectable even if the provider stopped
                    offering it, so opening the editor cannot silently reset it. */}
                {model !== "" && !providerModels.some((choice) => choice.id === model) ? (
                  <SelectItem value={model}>{model} (unavailable)</SelectItem>
                ) : null}
                {providerModels.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.label}
                    {choice.unavailable ? " (unavailable)" : ""}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Concurrent runs</span>
            <Input
              nativeInput
              type="number"
              min={1}
              value={maximumConcurrentRuns}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 1) setMaximumConcurrentRuns(value);
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Availability</span>
            <Select
              value={status}
              onValueChange={(value) => value && setStatus(value as MissionAgent["status"])}
            >
              <SelectTrigger aria-label="Agent availability">
                <SelectValue>{MISSION_AGENT_STATUS_LABELS[status]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {status === "running" ? (
                  <SelectItem value="running">{MISSION_AGENT_STATUS_LABELS.running}</SelectItem>
                ) : null}
                {SELECTABLE_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MISSION_AGENT_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Permissions</legend>
          <p className="text-xs text-muted-foreground">
            A slot without write permission never receives its own worktree.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ALL_AGENT_PERMISSIONS.map((permission) => (
              <label key={permission} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={permissions.includes(permission)}
                  onCheckedChange={(checked) =>
                    setPermissions((current) =>
                      checked
                        ? [...current, permission]
                        : current.filter((value) => value !== permission),
                    )
                  }
                />
                {permission.replaceAll("_", " ")}
              </label>
            ))}
          </div>
        </fieldset>
      </DialogPanel>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting ? "Saving..." : agent ? "Save agent" : "Add agent"}
        </Button>
      </DialogFooter>
    </form>
  );
}
