import type {
  AgentRole,
  EnvironmentId,
  AgentRun,
  ManagedWorktree,
  Mission,
  MissionAgent,
  MissionAgentId,
  MissionTask,
  MissionTeamSettings,
} from "@t3tools/contracts";
import {
  BotIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { DefinitionLabel } from "./DefinitionLabel";
import {
  MissionAgentEditor,
  type MissionAgentDraft,
  type MissionAgentProviderChoice,
} from "./MissionAgentEditor";
import { MissionTeamSettingsDialog } from "./MissionTeamSettingsDialog";
import {
  AGENT_ROLE_KIND_LABELS,
  MISSION_AGENT_STATUS_LABELS,
  MISSION_SCHEDULER_STATUS_LABELS,
} from "./missionLabels";

export type MissionProviderChoice = MissionAgentProviderChoice;
export type { MissionAgentDraft } from "./MissionAgentEditor";

function agentBadgeVariant(status: MissionAgent["status"]) {
  if (status === "running") return "info" as const;
  if (status === "unavailable") return "destructive" as const;
  if (status === "disabled") return "outline" as const;
  return "success" as const;
}

export function MissionTeamPanel({
  environmentId,
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
  onSaveAgent,
  onRemoveAgent,
  onSchedulerAction,
}: {
  readonly environmentId: EnvironmentId;
  readonly mission: Mission;
  readonly roles: ReadonlyArray<AgentRole>;
  readonly agents: ReadonlyArray<MissionAgent>;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly runs: ReadonlyArray<AgentRun>;
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly providerChoices: ReadonlyArray<MissionProviderChoice>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onConfigure: (settings: MissionTeamSettings) => Promise<boolean>;
  readonly onSaveAgent: (draft: MissionAgentDraft) => Promise<boolean>;
  readonly onRemoveAgent: (missionAgentId: MissionAgentId) => Promise<void>;
  readonly onSchedulerAction: (action: "start" | "pause" | "resume") => Promise<void>;
}) {
  const [editorAgentId, setEditorAgentId] = useState<MissionAgentId | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Resolved on every render rather than captured when the editor opened, so the dialog can see a
  // slot that another client changed or removed while it was open. Holding the object frozen made
  // that invisible and let a stale save overwrite the newer one.
  const editorAgent = editorAgentId
    ? (agents.find((candidate) => candidate.id === editorAgentId) ?? null)
    : null;
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const schedulerAction =
    mission.schedulerStatus === "running"
      ? "pause"
      : mission.schedulerStatus === "paused"
        ? "resume"
        : "start";

  const openEditor = (agent: MissionAgent | null) => {
    setEditorAgentId(agent?.id ?? null);
    setEditorOpen(true);
  };

  return (
    <section aria-labelledby="mission-team-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <UsersIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-team-heading" className="text-sm font-semibold">
          Agent team
        </h2>
        <Badge variant={mission.schedulerStatus === "running" ? "info" : "outline"}>
          <DefinitionLabel term="scheduler">
            {MISSION_SCHEDULER_STATUS_LABELS[mission.schedulerStatus]}
          </DefinitionLabel>
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMutate || isPending("team-settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <SlidersHorizontalIcon /> Team settings
          </Button>
          <Button
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
          <Button
            size="sm"
            disabled={!canMutate || providerChoices.length === 0}
            title={
              providerChoices.length === 0 ? "No provider is ready to run an agent." : undefined
            }
            onClick={() => openEditor(null)}
          >
            <PlusIcon /> Add agent
          </Button>
        </div>
      </div>

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
                className="[content-visibility:auto] [contain-intrinsic-size:auto_12rem]"
              >
                <CardPanel className="grid gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{agent.displayName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {roleNameByKind.get(agent.roleKind) ??
                          AGENT_ROLE_KIND_LABELS[agent.roleKind]}{" "}
                        · {agent.providerInstanceId}
                        {agent.model ? ` / ${agent.model}` : ""}
                      </p>
                    </div>
                    <Badge variant={agentBadgeVariant(agent.status)}>
                      {MISSION_AGENT_STATUS_LABELS[agent.status]}
                    </Badge>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${agent.displayName}`}
                      disabled={!canMutate || isPending(`agent:${agent.id}`)}
                      onClick={() => openEditor(agent)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${agent.displayName}`}
                      disabled={!canMutate || isPending(`agent:${agent.id}`) || run !== null}
                      title={run !== null ? "This agent has a run in progress." : undefined}
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

                  <div className="flex flex-wrap gap-1">
                    {agent.permissions.map((permission) => (
                      <Badge key={permission} variant="outline">
                        {permission.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </CardPanel>
              </Card>
            );
          })}
        </div>
      )}

      <MissionAgentEditor
        environmentId={environmentId}
        open={editorOpen}
        agentId={editorAgentId}
        agent={editorAgent}
        roles={roles}
        providerChoices={providerChoices}
        // A permission change runs under its own key after the upsert, so both belong to one save.
        isSubmitting={
          editorAgentId
            ? isPending(`agent:${editorAgentId}`) || isPending(`permissions:${editorAgentId}`)
            : isPending("agent:add")
        }
        onOpenChange={setEditorOpen}
        onSave={onSaveAgent}
      />

      <MissionTeamSettingsDialog
        open={settingsOpen}
        settings={mission.teamSettings}
        isSubmitting={isPending("team-settings")}
        onOpenChange={setSettingsOpen}
        onSave={onConfigure}
      />
    </section>
  );
}
