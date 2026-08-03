import { Link } from "@tanstack/react-router";
import {
  isActiveAgentRunStatus,
  type AgentRun,
  type Mission,
  type MissionTask,
  type MissionTaskId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  BotIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  ListChecksIcon,
  OctagonXIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { CreateTaskDialog, type CreateMissionTaskInput } from "./CreateTaskDialog";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { MissionTimeline } from "./MissionTimeline";
import { missionEventTimelineItems } from "./MissionTimeline.logic";

const STARTABLE_MISSION_STATUSES = new Set<Mission["status"]>(["backlog", "planning", "ready"]);
const RETRYABLE_MISSION_STATUSES = new Set<Mission["status"]>(["blocked", "failed"]);
const ACTIONABLE_TASK_STATUSES = new Set<MissionTask["status"]>([
  "backlog",
  "ready",
  "blocked",
  "failed",
]);

function taskBadgeVariant(status: MissionTask["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "cancelled") return "destructive" as const;
  if (status === "running") return "info" as const;
  if (status === "blocked") return "warning" as const;
  return "outline" as const;
}

function runBadgeVariant(status: AgentRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "cancelled" || status === "interrupted") {
    return "destructive" as const;
  }
  if (status === "running" || status === "starting") return "info" as const;
  return "warning" as const;
}

export function MissionWorkspace({
  environmentId,
  projectTitle,
  mission,
  tasks,
  agentRuns,
  events,
  canMutate,
  providerReady,
  actionPending,
  onAddTask,
  onStart,
  onRetry,
  onCancel,
}: {
  readonly environmentId: string;
  readonly projectTitle: string;
  readonly mission: Mission;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly agentRuns: ReadonlyArray<AgentRun>;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly canMutate: boolean;
  readonly providerReady: boolean;
  readonly actionPending: boolean;
  readonly onAddTask: (input: CreateMissionTaskInput) => Promise<boolean>;
  readonly onStart: (taskId?: MissionTaskId) => Promise<void>;
  readonly onRetry: (taskId?: MissionTaskId) => Promise<void>;
  readonly onCancel: () => Promise<void>;
}) {
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const orderedTasks = tasks.toSorted(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
  const orderedRuns = agentRuns.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
  const activeRun = orderedRuns.find((run) => isActiveAgentRunStatus(run.status)) ?? null;
  const canStart = STARTABLE_MISSION_STATUSES.has(mission.status);
  const canRetry = RETRYABLE_MISSION_STATUSES.has(mission.status);
  const canCancel = activeRun?.status === "starting" || activeRun?.status === "running";
  const mutationsAvailable = canMutate && !actionPending;

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
          disabled={!mutationsAvailable}
          onClick={() => setTaskDialogOpen(true)}
        >
          <PlusIcon />
          Add task
        </Button>
        {canStart ? (
          <Button disabled={!mutationsAvailable || !providerReady} onClick={() => void onStart()}>
            <PlayIcon />
            Start mission
          </Button>
        ) : null}
        {canRetry ? (
          <Button disabled={!mutationsAvailable || !providerReady} onClick={() => void onRetry()}>
            <RotateCcwIcon />
            Retry mission
          </Button>
        ) : null}
        {activeRun ? (
          <Button
            variant="destructive"
            disabled={!mutationsAvailable || !canCancel}
            onClick={() => void onCancel()}
          >
            <OctagonXIcon />
            {activeRun.status === "cancelling" ? "Cancelling..." : "Cancel"}
          </Button>
        ) : null}
      </header>

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <main className="mx-auto grid w-full max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]">
          <div className="grid min-w-0 content-start gap-5">
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

            {!providerReady && (canStart || canRetry) ? (
              <Alert variant="warning">
                <CircleAlertIcon />
                <AlertTitle>No provider is ready</AlertTitle>
                <AlertDescription>
                  Configure an available provider before starting this mission.
                </AlertDescription>
              </Alert>
            ) : null}

            <section aria-labelledby="mission-tasks-heading">
              <div className="mb-3 flex items-center gap-2">
                <ListChecksIcon className="size-4 text-muted-foreground" />
                <h2 id="mission-tasks-heading" className="text-sm font-semibold">
                  Tasks
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {orderedTasks.filter((task) => task.status === "completed").length}/
                  {orderedTasks.length}
                </span>
              </div>
              {orderedTasks.length === 0 ? (
                <Card>
                  <CardPanel className="grid place-items-center gap-2 py-10 text-center">
                    <p className="text-sm font-medium">No tasks yet</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Add a concrete task, or start the mission and let the agent work from the
                      mission outcome.
                    </p>
                  </CardPanel>
                </Card>
              ) : (
                <div className="grid gap-2">
                  {orderedTasks.map((task, index) => {
                    const taskActionable = ACTIONABLE_TASK_STATUSES.has(task.status);
                    return (
                      <Card
                        key={task.id}
                        className="[content-visibility:auto] [contain-intrinsic-size:auto_8rem]"
                      >
                        <CardPanel className="grid gap-2.5 p-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <h3 className="min-w-0 flex-1 text-sm font-semibold">
                                  {task.title}
                                </h3>
                                <Badge variant={taskBadgeVariant(task.status)}>{task.status}</Badge>
                              </div>
                              {task.description ? (
                                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                  {task.description}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3 pl-9">
                            <time
                              className="text-xs text-muted-foreground"
                              dateTime={task.updatedAt}
                            >
                              Updated {formatRelativeTimeLabel(task.updatedAt)}
                            </time>
                            {(canStart || canRetry) && taskActionable ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!mutationsAvailable || !providerReady}
                                onClick={() =>
                                  void (canRetry ? onRetry(task.id) : onStart(task.id))
                                }
                              >
                                {canRetry ? <RotateCcwIcon /> : <PlayIcon />}
                                {canRetry ? "Retry task" : "Run task"}
                              </Button>
                            ) : null}
                          </div>
                        </CardPanel>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            <section aria-labelledby="mission-runs-heading">
              <div className="mb-3 flex items-center gap-2">
                <BotIcon className="size-4 text-muted-foreground" />
                <h2 id="mission-runs-heading" className="text-sm font-semibold">
                  Agent runs
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {orderedRuns.length}
                </span>
              </div>
              {orderedRuns.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No agent runs yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {orderedRuns.map((run) => (
                    <Card
                      key={run.id}
                      className="[content-visibility:auto] [contain-intrinsic-size:auto_7rem]"
                    >
                      <CardPanel className="grid gap-2 p-4">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {run.provider}
                          </p>
                          <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <time dateTime={run.updatedAt}>
                            Updated {formatRelativeTimeLabel(run.updatedAt)}
                          </time>
                          {run.providerSessionId ? <span>Session linked</span> : null}
                          <Link
                            to="/$environmentId/$threadId"
                            params={{ environmentId, threadId: run.threadId }}
                            className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                          >
                            Open conversation
                            <ExternalLinkIcon className="size-3" />
                          </Link>
                        </div>
                        {run.errorSummary ? (
                          <p className="text-sm text-destructive-foreground">{run.errorSummary}</p>
                        ) : null}
                      </CardPanel>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside
            className="min-w-0 lg:border-l lg:border-border lg:pl-5"
            aria-labelledby="mission-activity-heading"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="mission-activity-heading" className="text-sm font-semibold">
                Activity
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
