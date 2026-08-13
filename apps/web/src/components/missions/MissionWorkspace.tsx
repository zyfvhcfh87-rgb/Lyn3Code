import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  isActiveAgentRunStatus,
  type AgentHandoff,
  type AgentRole,
  type AgentRun,
  type AgentRunId,
  type EnvironmentId,
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
  type VerificationRunId,
  type VerificationTaskSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ArrowLeftIcon,
  BrainIcon,
  ChartLineIcon,
  EllipsisIcon,
  GithubIcon,
  ListChecksIcon,
  OctagonXIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { DefinitionLabel } from "./DefinitionLabel";
import { missionBlockers, type MissionBlocker } from "./MissionBlockers.logic";
import { MissionBlockersStrip } from "./MissionBlockersStrip";
import {
  missionTabForAnchor,
  MISSION_TABS,
  MISSION_TAB_LABELS,
  type MissionTab,
} from "./missionTabs";
import { MissionDeliverySection, type DeliveryWorkspaceProps } from "../delivery";
import { CreateTaskDialog, type CreateMissionTaskInput } from "./CreateTaskDialog";
import { MissionAgentActivity } from "./MissionAgentActivity";
import { MissionIntegrationQueue } from "./MissionIntegrationQueue";
import { MissionRoutingWorkspacePanel } from "./MissionRoutingPanel";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { MissionTaskGraph } from "./MissionTaskGraph";
import {
  MissionTeamPanel,
  type MissionAgentDraft,
  type MissionProviderChoice,
} from "./MissionTeamPanel";
import { MissionTimeline } from "./MissionTimeline";
import { missionEventTimelineItems } from "./MissionTimeline.logic";
import { MissionWorktreePanel } from "./MissionWorktreePanel";
import { MissionVerificationPanel } from "../verification/MissionVerificationPanel";
import { VerificationRunDialog } from "../verification/VerificationRunDialog";
import { verificationEnvironment } from "../../state/verification";

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
  onSaveAgent,
  onRemoveAgent,
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
  onRequestVerification,
  delivery,
  activeTab,
  onTabChange,
}: {
  readonly environmentId: EnvironmentId;
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
  readonly onConfigureTeam: (settings: MissionTeamSettings) => Promise<boolean>;
  readonly onSaveAgent: (draft: MissionAgentDraft) => Promise<boolean>;
  readonly onRemoveAgent: (missionAgentId: MissionAgentId) => Promise<void>;
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
  readonly onRequestVerification: (taskId: MissionTaskId) => Promise<void>;
  readonly delivery?: DeliveryWorkspaceProps | undefined;
  readonly activeTab: MissionTab;
  readonly onTabChange: (tab: MissionTab) => void;
}) {
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [openVerificationRunId, setOpenVerificationRunId] = useState<VerificationRunId | null>(
    null,
  );
  const verificationResult = useAtomValue(
    verificationEnvironment.taskSummariesAtom({
      environmentId,
      input: { projectId: mission.projectId, taskIds: tasks.map((task) => task.id) },
    }),
  );
  const verificationValue = Option.getOrNull(AsyncResult.value(verificationResult));
  const verificationSummaries: ReadonlyArray<VerificationTaskSummary> = verificationValue ?? [];
  // A settled request that returned nothing genuinely means no evidence; an unsettled or failed one
  // means not yet known, and the two must not read the same in the summary.
  const verificationEvidenceLoaded = verificationValue !== null;
  const activeRuns = agentRuns.filter((run) => isActiveAgentRunStatus(run.status));
  const canStart = STARTABLE_MISSION_STATUSES.has(mission.status);
  const tabCounts: Readonly<Record<MissionTab, string | null>> = {
    plan:
      tasks.length > 0
        ? `${tasks.filter((t) => t.status === "completed").length}/${tasks.length}`
        : null,
    work: activeRuns.length > 0 ? String(activeRuns.length) : null,
    verify: null,
    ship: null,
    history: events.length > 0 ? String(events.length) : null,
  };

  /**
   * Switch to the tab holding the blocker's section, then bring it into view. The panel is not
   * mounted until its tab is active, so the scroll has to wait for the next frame.
   */
  const handleBlockerSelect = (blocker: MissionBlocker) => {
    onTabChange(missionTabForAnchor(blocker.anchor));
    requestAnimationFrame(() => {
      document.getElementById(blocker.anchor)?.scrollIntoView({ block: "start" });
    });
  };

  const blockers = missionBlockers({
    mission,
    tasks,
    agents: missionAgents,
    dependencies: taskDependencies,
    worktrees: managedWorktrees,
    verificationSummaries,
    verificationEvidenceLoaded,
    providerReady,
  });

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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  disabled={!canMutate || !providerReady || isPending("mission:start")}
                  onClick={() => void onStartMission()}
                >
                  <PlayIcon /> Run without a team
                </Button>
              }
            />
            <TooltipPopup side="bottom">
              Runs the whole mission as a single agent. Add an agent to split the work across roles
              with their own worktrees.
            </TooltipPopup>
          </Tooltip>
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
        <Menu>
          <MenuTrigger
            render={<Button size="icon" variant="ghost" aria-label="More mission views" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              render={
                <Link
                  to="/memory/$environmentId/$projectId"
                  params={{ environmentId, projectId: mission.projectId }}
                />
              }
            >
              <BrainIcon /> Project memory
            </MenuItem>
            <MenuItem render={<Link to="/settings/analytics" />}>
              <ChartLineIcon /> Usage and cost
            </MenuItem>
            <MenuItem
              render={
                <Link
                  to="/github/$environmentId/$projectId"
                  params={{ environmentId, projectId: mission.projectId }}
                />
              }
            >
              <GithubIcon /> GitHub workspace
            </MenuItem>
          </MenuPopup>
        </Menu>
      </header>

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <main className="mx-auto grid w-full max-w-[96rem] content-start gap-5 p-4 sm:p-6">
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

          <MissionBlockersStrip blockers={blockers} onSelect={handleBlockerSelect} />

          <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as MissionTab)}>
            <TabsList>
              <TabsIndicator />
              {MISSION_TABS.map((tab) => (
                <TabsTab key={tab} value={tab}>
                  {MISSION_TAB_LABELS[tab]}
                  {tabCounts[tab] ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {tabCounts[tab]}
                    </span>
                  ) : null}
                </TabsTab>
              ))}
            </TabsList>

            <TabsPanel value="plan" className="grid gap-6">
              <MissionTeamPanel
                environmentId={environmentId}
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
                onSaveAgent={onSaveAgent}
                onRemoveAgent={onRemoveAgent}
                onSchedulerAction={onSchedulerAction}
              />

              <MissionRoutingWorkspacePanel
                environmentId={environmentId}
                mission={mission}
                tasks={tasks}
                canMutate={canMutate}
                onConfigureTeam={onConfigureTeam}
              />

              <section aria-labelledby="mission-tasks-heading" className="grid gap-3">
                <div className="flex items-center gap-2">
                  <ListChecksIcon className="size-4 text-muted-foreground" />
                  <h2 id="mission-tasks-heading" className="text-sm font-semibold">
                    <DefinitionLabel term="task">Task dependency graph</DefinitionLabel>
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
            </TabsPanel>

            <TabsPanel value="work" className="grid gap-6">
              <MissionAgentActivity
                environmentId={environmentId}
                projectId={mission.projectId}
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
            </TabsPanel>

            <TabsPanel value="verify" className="grid gap-6">
              <MissionVerificationPanel
                tasks={tasks}
                agents={missionAgents}
                summaries={verificationSummaries}
                canMutate={canMutate}
                isPending={isPending}
                onRequest={onRequestVerification}
                onOpenRun={setOpenVerificationRunId}
              />

              <MissionIntegrationQueue
                environmentId={environmentId}
                mission={mission}
                tasks={tasks}
                dependencies={taskDependencies}
                verificationSummaries={verificationSummaries}
                worktrees={managedWorktrees}
                canMutate={canMutate}
                isPending={isPending}
                onApprove={onApproveIntegration}
                onAbort={onAbortIntegration}
              />
            </TabsPanel>

            <TabsPanel value="ship">
              <MissionDeliverySection delivery={delivery} />
            </TabsPanel>

            <TabsPanel value="history">
              <section aria-labelledby="mission-activity-heading" className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="mission-activity-heading" className="text-sm font-semibold">
                    Mission activity
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {events.length} events
                  </span>
                </div>
                <Separator />
                <MissionTimeline items={missionEventTimelineItems(events)} />
              </section>
            </TabsPanel>
          </Tabs>
        </main>
      </ScrollArea>

      <VerificationRunDialog
        environmentId={environmentId}
        runId={openVerificationRunId}
        canMutate={canMutate}
        onOpenChange={(open) => {
          if (!open) setOpenVerificationRunId(null);
        }}
      />

      <CreateTaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        onCreate={onAddTask}
      />
    </div>
  );
}
