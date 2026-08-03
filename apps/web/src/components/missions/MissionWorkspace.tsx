import { Link } from "@tanstack/react-router";
import {
  isActiveAgentRunStatus,
  type AgentHandoff,
  type AgentPermission,
  type AgentRole,
  type AgentRun,
  type AgentRunId,
  type ManagedWorktree,
  type ManagedWorktreeId,
  type Mission,
  type MissionAgent,
  type MissionAgentId,
  type MissionTask,
  type MissionTaskId,
  type MissionTeamSettings,
  type OrchestrationEvent,
  type TaskDependency,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  ListChecksIcon,
  OctagonXIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { CreateTaskDialog, type CreateMissionTaskInput } from "./CreateTaskDialog";
import { MissionAgentActivity } from "./MissionAgentActivity";
import { MissionIntegrationQueue } from "./MissionIntegrationQueue";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { MissionTaskGraph } from "./MissionTaskGraph";
import {
  MissionTeamPanel,
  type CreateMissionAgentDraft,
  type MissionProviderChoice,
  type UpdateMissionAgentDraft,
} from "./MissionTeamPanel";
import { MissionTimeline } from "./MissionTimeline";
import { missionEventTimelineItems } from "./MissionTimeline.logic";
import { MissionWorktreePanel } from "./MissionWorktreePanel";

const STARTABLE_MISSION_STATUSES = new Set<Mission["status"]>(["backlog", "planning", "ready"]);

export function MissionWorkspace({
  environmentId,
  projectTitle,
  mission,
  tasks,
  agentRuns,
  agentRoles,
  missionAgents,
  taskDependencies,
  managedWorktrees,
  agentHandoffs,
  events,
  providerChoices,
  canMutate,
  providerReady,
  isPending,
  onAddTask,
  onStartMission,
  onCancelMission,
  onConfigureTeam,
  onAddAgent,
  onUpdateAgent,
  onRemoveAgent,
  onUpdateAgentPermissions,
  onSchedulerAction,
  onAddDependency,
  onRemoveDependency,
  onAssignTask,
  onUpdateTask,
  onStartTask,
  onRetryTask,
  onCancelTask,
  onCancelRun,
  onOpenWorktree,
  onCopyWorktreePath,
  onInspectWorktreeChanges,
  onRequestIntegration,
  onApproveIntegration,
  onAbortIntegration,
  onRemoveWorktree,
}: {
  readonly environmentId: string;
  readonly projectTitle: string;
  readonly mission: Mission;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly agentRuns: ReadonlyArray<AgentRun>;
  readonly agentRoles: ReadonlyArray<AgentRole>;
  readonly missionAgents: ReadonlyArray<MissionAgent>;
  readonly taskDependencies: ReadonlyArray<TaskDependency>;
  readonly managedWorktrees: ReadonlyArray<ManagedWorktree>;
  readonly agentHandoffs: ReadonlyArray<AgentHandoff>;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly providerChoices: ReadonlyArray<MissionProviderChoice>;
  readonly canMutate: boolean;
  readonly providerReady: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onAddTask: (input: CreateMissionTaskInput) => Promise<boolean>;
  readonly onStartMission: () => Promise<void>;
  readonly onCancelMission: () => Promise<void>;
  readonly onConfigureTeam: (settings: MissionTeamSettings) => Promise<void>;
  readonly onAddAgent: (draft: CreateMissionAgentDraft) => Promise<void>;
  readonly onUpdateAgent: (draft: UpdateMissionAgentDraft) => Promise<void>;
  readonly onRemoveAgent: (missionAgentId: MissionAgentId) => Promise<void>;
  readonly onUpdateAgentPermissions: (
    missionAgentId: MissionAgentId,
    permissions: ReadonlyArray<AgentPermission>,
  ) => Promise<void>;
  readonly onSchedulerAction: (action: "start" | "pause" | "resume") => Promise<void>;
  readonly onAddDependency: (
    taskId: MissionTaskId,
    dependsOnTaskId: MissionTaskId,
  ) => Promise<void>;
  readonly onRemoveDependency: (
    taskId: MissionTaskId,
    dependsOnTaskId: MissionTaskId,
  ) => Promise<void>;
  readonly onAssignTask: (
    taskId: MissionTaskId,
    missionAgentId: MissionAgentId | null,
  ) => Promise<void>;
  readonly onUpdateTask: (
    taskId: MissionTaskId,
    patch: {
      readonly title: string;
      readonly description: string;
      readonly maximumAttempts: number;
      readonly requiresDependencyHandoffs: boolean;
    },
  ) => Promise<void>;
  readonly onStartTask: (taskId: MissionTaskId) => Promise<void>;
  readonly onRetryTask: (taskId: MissionTaskId) => Promise<void>;
  readonly onCancelTask: (taskId: MissionTaskId) => Promise<void>;
  readonly onCancelRun: (agentRunId: AgentRunId, taskId: MissionTaskId | null) => Promise<void>;
  readonly onOpenWorktree: (worktree: ManagedWorktree) => void;
  readonly onCopyWorktreePath: (worktree: ManagedWorktree) => Promise<void>;
  readonly onInspectWorktreeChanges: (worktree: ManagedWorktree) => void;
  readonly onRequestIntegration: (worktreeId: ManagedWorktreeId) => Promise<void>;
  readonly onApproveIntegration: (taskId: MissionTaskId) => Promise<void>;
  readonly onAbortIntegration: (taskId: MissionTaskId) => Promise<void>;
  readonly onRemoveWorktree: (worktreeId: ManagedWorktreeId) => Promise<void>;
}) {
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const activeRuns = agentRuns.filter((run) => isActiveAgentRunStatus(run.status));
  const canStart = STARTABLE_MISSION_STATUSES.has(mission.status);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to missions"
          render={<Link to="/missions/$environmentId" params={{ environmentId }} />}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="mr-auto min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{mission.title}</h1>
            <MissionStatusBadge status={mission.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">{projectTitle}</p>
        </div>
        <Button
          variant="outline"
          disabled={!canMutate || isPending("task:add")}
          onClick={() => setTaskDialogOpen(true)}
        >
          <PlusIcon /> Add task
        </Button>
        {canStart && missionAgents.length === 0 ? (
          <Button
            disabled={!canMutate || !providerReady || isPending("mission:start")}
            onClick={() => void onStartMission()}
          >
            <PlayIcon /> Start legacy run
          </Button>
        ) : null}
        {activeRuns.length > 0 ? (
          <Button
            variant="destructive"
            disabled={!canMutate || isPending("mission:cancel")}
            onClick={() => void onCancelMission()}
          >
            <OctagonXIcon /> Cancel mission ({activeRuns.length})
          </Button>
        ) : null}
      </header>

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <main className="mx-auto grid w-full max-w-[96rem] gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 content-start gap-6">
            {mission.description ? (
              <section aria-labelledby="mission-description-heading">
                <h2 id="mission-description-heading" className="text-sm font-semibold">
                  Outcome
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {mission.description}
                </p>
              </section>
            ) : null}

            {!providerReady && (canStart || missionAgents.length > 0) ? (
              <Alert variant="warning">
                <CircleAlertIcon />
                <AlertTitle>No provider is ready</AlertTitle>
                <AlertDescription>
                  Configure an available provider before starting mission work.
                </AlertDescription>
              </Alert>
            ) : null}

            <MissionTeamPanel
              mission={mission}
              roles={agentRoles}
              agents={missionAgents}
              tasks={tasks}
              runs={agentRuns}
              worktrees={managedWorktrees}
              providerChoices={providerChoices}
              canMutate={canMutate}
              isPending={isPending}
              onConfigure={onConfigureTeam}
              onAddAgent={onAddAgent}
              onUpdateAgent={onUpdateAgent}
              onRemoveAgent={onRemoveAgent}
              onUpdatePermissions={onUpdateAgentPermissions}
              onSchedulerAction={onSchedulerAction}
            />

            <section aria-labelledby="mission-tasks-heading" className="grid gap-3">
              <div className="flex items-center gap-2">
                <ListChecksIcon className="size-4 text-muted-foreground" />
                <h2 id="mission-tasks-heading" className="text-sm font-semibold">
                  Task dependency graph
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tasks.filter((task) => task.status === "completed").length}/{tasks.length}
                </span>
              </div>
              <MissionTaskGraph
                tasks={tasks}
                dependencies={taskDependencies}
                agents={missionAgents}
                canMutate={canMutate}
                isDependencyPending={(taskId, dependsOnTaskId) =>
                  isPending(`dependency:${taskId}:${dependsOnTaskId}`)
                }
                isTaskPending={(taskId) => isPending(`task:${taskId}`)}
                onAddDependency={onAddDependency}
                onRemoveDependency={onRemoveDependency}
                onAssignTask={onAssignTask}
                onUpdateTask={onUpdateTask}
                onStartTask={onStartTask}
                onRetryTask={onRetryTask}
                onCancelTask={onCancelTask}
              />
            </section>

            <MissionAgentActivity
              environmentId={environmentId}
              runs={agentRuns}
              agents={missionAgents}
              tasks={tasks}
              worktrees={managedWorktrees}
              handoffs={agentHandoffs}
              events={events}
              canMutate={canMutate}
              isPending={isPending}
              onCancel={onCancelRun}
            />

            <MissionWorktreePanel
              worktrees={managedWorktrees}
              tasks={tasks}
              runs={agentRuns}
              canMutate={canMutate}
              isPending={isPending}
              onOpen={onOpenWorktree}
              onCopyPath={onCopyWorktreePath}
              onInspectChanges={onInspectWorktreeChanges}
              onRequestIntegration={onRequestIntegration}
              onRemove={onRemoveWorktree}
            />

            <MissionIntegrationQueue
              mission={mission}
              tasks={tasks}
              dependencies={taskDependencies}
              worktrees={managedWorktrees}
              canMutate={canMutate}
              isPending={isPending}
              onApprove={onApproveIntegration}
              onAbort={onAbortIntegration}
            />
          </div>

          <aside
            className="min-w-0 xl:border-l xl:border-border xl:pl-5"
            aria-labelledby="mission-activity-heading"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="mission-activity-heading" className="text-sm font-semibold">
                Mission activity
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {events.length} events
              </span>
            </div>
            <Separator className="mb-4" />
            <MissionTimeline items={missionEventTimelineItems(events)} />
          </aside>
        </main>
      </ScrollArea>

      <CreateTaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        onCreate={onAddTask}
      />
    </div>
  );
}
