import {
  ALL_AGENT_PERMISSIONS,
  type AgentPermission,
  type AgentRole,
  type AgentRoleKind,
  type AgentRun,
  type ManagedWorktree,
  type Mission,
  type MissionAgent,
  type MissionAgentId,
  type MissionTask,
  type MissionTeamSettings,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { BotIcon, PauseIcon, PlayIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import type { FormEvent } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { Input } from "../ui/input";

export interface MissionProviderChoice {
  readonly id: ProviderInstanceId;
  readonly label: string;
}

export interface CreateMissionAgentDraft {
  readonly displayName: string;
  readonly roleKind: AgentRoleKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly model: string | null;
}

export interface UpdateMissionAgentDraft extends CreateMissionAgentDraft {
  readonly missionAgentId: MissionAgentId;
  readonly maximumConcurrentRuns: number;
  readonly status: MissionAgent["status"];
}

function agentBadgeVariant(status: MissionAgent["status"]) {
  if (status === "running") return "info" as const;
  if (status === "unavailable") return "destructive" as const;
  if (status === "disabled") return "outline" as const;
  return "success" as const;
}

function positiveInteger(form: FormData, key: string, fallback: number): number {
  const parsed = Number(form.get(key));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function MissionTeamPanel({
  mission,
  roles,
  agents,
  tasks,
  runs,
  worktrees,
  providerChoices,
  canMutate,
  isPending,
  onConfigure,
  onAddAgent,
  onUpdateAgent,
  onRemoveAgent,
  onUpdatePermissions,
  onSchedulerAction,
}: {
  readonly mission: Mission;
  readonly roles: ReadonlyArray<AgentRole>;
  readonly agents: ReadonlyArray<MissionAgent>;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly runs: ReadonlyArray<AgentRun>;
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly providerChoices: ReadonlyArray<MissionProviderChoice>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onConfigure: (settings: MissionTeamSettings) => Promise<void>;
  readonly onAddAgent: (draft: CreateMissionAgentDraft) => Promise<void>;
  readonly onUpdateAgent: (draft: UpdateMissionAgentDraft) => Promise<void>;
  readonly onRemoveAgent: (missionAgentId: MissionAgentId) => Promise<void>;
  readonly onUpdatePermissions: (
    missionAgentId: MissionAgentId,
    permissions: ReadonlyArray<AgentPermission>,
  ) => Promise<void>;
  readonly onSchedulerAction: (action: "start" | "pause" | "resume") => Promise<void>;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree] as const));
  const activeRunByAgentId = new Map(
    runs
      .filter(
        (run) =>
          run.missionAgentId !== null &&
          (run.status === "starting" || run.status === "running" || run.status === "cancelling"),
      )
      .map((run) => [run.missionAgentId!, run] as const),
  );
  const roleNameByKind = new Map(roles.map((role) => [role.kind, role.name] as const));
  const settings = mission.teamSettings;

  const handleSettingsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const maximumConcurrentAgents = positiveInteger(
      form,
      "maximumConcurrentAgents",
      settings.maximumConcurrentAgents,
    );
    const maximumConcurrentWriteAgents = positiveInteger(
      form,
      "maximumConcurrentWriteAgents",
      settings.maximumConcurrentWriteAgents,
    );
    const writeInput = event.currentTarget.elements.namedItem("maximumConcurrentWriteAgents");
    if (writeInput instanceof HTMLInputElement) {
      writeInput.setCustomValidity(
        maximumConcurrentWriteAgents > maximumConcurrentAgents
          ? "Write-agent concurrency cannot exceed total agent concurrency."
          : "",
      );
      if (!writeInput.reportValidity()) return;
    }
    void onConfigure({
      maximumConcurrentAgents,
      maximumConcurrentWriteAgents,
      defaultMaximumTaskAttempts: positiveInteger(
        form,
        "defaultMaximumTaskAttempts",
        settings.defaultMaximumTaskAttempts,
      ),
      autoStartReadyTasks: form.get("autoStartReadyTasks") === "on",
      integrationMode:
        form.get("integrationMode") === "sequential" ||
        form.get("integrationMode") === "automatic_when_clean"
          ? (form.get("integrationMode") as MissionTeamSettings["integrationMode"])
          : "manual",
    });
  };

  const handleAddAgent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const providerInstanceId = form.get("providerInstanceId");
    const displayName = String(form.get("displayName") ?? "").trim();
    const roleKind = String(form.get("roleKind") ?? "implementer") as AgentRoleKind;
    const model = String(form.get("model") ?? "").trim();
    if (!displayName || typeof providerInstanceId !== "string" || !providerInstanceId) return;
    void onAddAgent({
      displayName,
      roleKind,
      providerInstanceId: providerInstanceId as ProviderInstanceId,
      model: model || null,
    });
  };

  const schedulerAction =
    mission.schedulerStatus === "running"
      ? "pause"
      : mission.schedulerStatus === "paused"
        ? "resume"
        : "start";

  return (
    <section aria-labelledby="mission-team-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <UsersIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-team-heading" className="text-sm font-semibold">
          Agent team
        </h2>
        <Badge variant={mission.schedulerStatus === "running" ? "info" : "outline"}>
          Scheduler {mission.schedulerStatus}
        </Badge>
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          disabled={!canMutate || isPending("scheduler")}
          onClick={() => void onSchedulerAction(schedulerAction)}
        >
          {schedulerAction === "pause" ? <PauseIcon /> : <PlayIcon />}
          {schedulerAction === "pause"
            ? "Pause scheduling"
            : schedulerAction === "resume"
              ? "Resume scheduling"
              : "Start scheduler"}
        </Button>
      </div>

      <form
        key={JSON.stringify(settings)}
        className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={handleSettingsSubmit}
      >
        <label className="grid gap-1 text-xs font-medium">
          Concurrent agents
          <Input
            nativeInput
            name="maximumConcurrentAgents"
            type="number"
            min={1}
            defaultValue={settings.maximumConcurrentAgents}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Write agents
          <Input
            nativeInput
            name="maximumConcurrentWriteAgents"
            type="number"
            min={1}
            defaultValue={settings.maximumConcurrentWriteAgents}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Task attempts
          <Input
            nativeInput
            name="defaultMaximumTaskAttempts"
            type="number"
            min={1}
            defaultValue={settings.defaultMaximumTaskAttempts}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Integration
          <select
            name="integrationMode"
            defaultValue={settings.integrationMode}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="manual">Manual approval</option>
            <option value="sequential">Sequential</option>
            <option value="automatic_when_clean">Automatic when clean</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-h-8 items-center gap-2 text-xs font-medium">
            <input
              name="autoStartReadyTasks"
              type="checkbox"
              defaultChecked={settings.autoStartReadyTasks}
            />
            Auto-start ready tasks
          </label>
          <Button size="sm" type="submit" disabled={!canMutate || isPending("team-settings")}>
            Save limits
          </Button>
        </div>
      </form>

      {agents.length === 0 ? (
        <Card>
          <CardPanel className="grid place-items-center gap-2 py-8 text-center">
            <BotIcon className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No mission agents configured</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Add a role slot before scheduling tasks. Read-only roles can inspect shared work
              safely; write roles receive an isolated task worktree.
            </p>
          </CardPanel>
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {agents.map((agent) => {
            const run = activeRunByAgentId.get(agent.id) ?? null;
            const task = run?.taskId ? taskById.get(run.taskId) : null;
            const worktree = run?.worktreeId ? worktreeById.get(run.worktreeId) : null;
            return (
              <Card
                key={agent.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_14rem]"
              >
                <CardPanel className="grid gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{agent.displayName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {roleNameByKind.get(agent.roleKind) ?? agent.roleKind} ·{" "}
                        {agent.providerInstanceId}
                        {agent.model ? ` / ${agent.model}` : ""}
                      </p>
                    </div>
                    <Badge variant={agentBadgeVariant(agent.status)}>{agent.status}</Badge>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${agent.displayName}`}
                      disabled={!canMutate || isPending(`agent:${agent.id}`) || run !== null}
                      onClick={() => void onRemoveAgent(agent.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Current task</dt>
                    <dd className="truncate text-right">{task?.title ?? "Idle"}</dd>
                    <dt className="text-muted-foreground">Worktree</dt>
                    <dd className="truncate text-right">{worktree?.branchName ?? "None"}</dd>
                    <dt className="text-muted-foreground">Attempt</dt>
                    <dd className="text-right tabular-nums">{run?.attemptNumber ?? "—"}</dd>
                    <dt className="text-muted-foreground">Run capacity</dt>
                    <dd className="text-right tabular-nums">{agent.maximumConcurrentRuns}</dd>
                    <dt className="text-muted-foreground">Last activity</dt>
                    <dd className="text-right">
                      {run
                        ? formatRelativeTimeLabel(run.updatedAt)
                        : formatRelativeTimeLabel(agent.updatedAt)}
                    </dd>
                  </dl>

                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Edit agent slot
                    </summary>
                    <form
                      key={agent.updatedAt}
                      className="mt-2 grid gap-2 sm:grid-cols-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const displayName = String(form.get("displayName") ?? "").trim();
                        const roleKind = String(form.get("roleKind") ?? "custom") as AgentRoleKind;
                        const providerInstanceId = String(form.get("providerInstanceId") ?? "");
                        const maximumConcurrentRuns = Number(form.get("maximumConcurrentRuns"));
                        const model = String(form.get("model") ?? "").trim();
                        const status = String(
                          form.get("status") ?? "idle",
                        ) as MissionAgent["status"];
                        if (
                          !displayName ||
                          !providerInstanceId ||
                          !Number.isInteger(maximumConcurrentRuns) ||
                          maximumConcurrentRuns < 1
                        ) {
                          return;
                        }
                        void onUpdateAgent({
                          missionAgentId: agent.id,
                          displayName,
                          roleKind,
                          providerInstanceId: providerInstanceId as ProviderInstanceId,
                          model: model || null,
                          maximumConcurrentRuns,
                          status,
                        });
                      }}
                    >
                      <label className="grid gap-1 text-xs font-medium">
                        Display name
                        <input
                          required
                          name="displayName"
                          defaultValue={agent.displayName}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium">
                        Role
                        <select
                          name="roleKind"
                          defaultValue={agent.roleKind}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        >
                          {(
                            [
                              "coordinator",
                              "implementer",
                              "researcher",
                              "reviewer",
                              "verifier",
                              "custom",
                            ] as const
                          ).map((kind) => (
                            <option key={kind} value={kind}>
                              {roleNameByKind.get(kind) ?? kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium">
                        Provider
                        <select
                          required
                          name="providerInstanceId"
                          defaultValue={agent.providerInstanceId}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        >
                          {!providerChoices.some(
                            (provider) => provider.id === agent.providerInstanceId,
                          ) ? (
                            <option value={agent.providerInstanceId}>
                              {agent.providerInstanceId} (unavailable)
                            </option>
                          ) : null}
                          {providerChoices.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium">
                        Model
                        <input
                          name="model"
                          defaultValue={agent.model ?? ""}
                          placeholder="Provider default"
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium">
                        Concurrent runs
                        <input
                          required
                          name="maximumConcurrentRuns"
                          type="number"
                          min={1}
                          defaultValue={agent.maximumConcurrentRuns}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium">
                        Availability
                        <select
                          name="status"
                          defaultValue={agent.status}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        >
                          <option value="idle">Enabled</option>
                          <option value="disabled">Disabled</option>
                          <option value="unavailable">Unavailable</option>
                          {agent.status === "running" ? (
                            <option value="running">Running</option>
                          ) : null}
                        </select>
                      </label>
                      <Button
                        className="sm:col-span-2"
                        size="sm"
                        variant="outline"
                        type="submit"
                        disabled={!canMutate || isPending(`agent:${agent.id}`)}
                      >
                        Save agent
                      </Button>
                    </form>
                  </details>

                  <form
                    key={agent.permissions.join(":")}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const selected = new FormData(event.currentTarget)
                        .getAll("permission")
                        .filter((permission): permission is AgentPermission =>
                          ALL_AGENT_PERMISSIONS.includes(permission as AgentPermission),
                        );
                      void onUpdatePermissions(agent.id, selected);
                    }}
                  >
                    <fieldset disabled={!canMutate || isPending(`permissions:${agent.id}`)}>
                      <legend className="mb-1 text-xs font-medium">Permissions</legend>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {ALL_AGENT_PERMISSIONS.map((permission) => (
                          <label key={permission} className="flex items-center gap-1.5 text-xs">
                            <input
                              name="permission"
                              value={permission}
                              type="checkbox"
                              defaultChecked={agent.permissions.includes(permission)}
                            />
                            {permission.replaceAll("_", " ")}
                          </label>
                        ))}
                      </div>
                      <Button className="mt-2" size="sm" variant="outline" type="submit">
                        Save permissions
                      </Button>
                    </fieldset>
                  </form>
                </CardPanel>
              </Card>
            );
          })}
        </div>
      )}

      <form
        className="grid gap-2 rounded-xl border border-dashed border-border p-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={handleAddAgent}
      >
        <label className="grid gap-1 text-xs font-medium">
          Display name
          <Input nativeInput required name="displayName" placeholder="Implementer 1" />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Role
          <select
            name="roleKind"
            defaultValue="implementer"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            {(
              [
                "coordinator",
                "implementer",
                "researcher",
                "reviewer",
                "verifier",
                "custom",
              ] as const
            ).map((kind) => (
              <option key={kind} value={kind}>
                {roleNameByKind.get(kind) ?? kind}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Provider
          <select
            required
            name="providerInstanceId"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Choose provider</option>
            {providerChoices.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Model (optional)
          <Input nativeInput name="model" placeholder="Provider default" />
        </label>
        <div className="flex items-end">
          <Button
            size="sm"
            type="submit"
            disabled={!canMutate || providerChoices.length === 0 || isPending("agent:add")}
          >
            <PlusIcon /> Add agent
          </Button>
        </div>
      </form>
    </section>
  );
}
