import {
  hasWritePermission,
  MissionTaskId,
  type MissionAgent,
  type MissionAgentId,
  type MissionTask,
  type TaskDependency,
} from "@t3tools/contracts";
import { Link2Icon, OctagonXIcon, PlayIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import type { FormEvent } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { missionDependencyLayers, preflightMissionDependency } from "./MissionTaskGraph.logic";

function taskBadgeVariant(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "integrated") return "success" as const;
  if (status === "failed" || status === "cancelled" || status === "conflicted") {
    return "destructive" as const;
  }
  if (status === "running") return "info" as const;
  if (status === "blocked" || status === "waiting for dependency") return "warning" as const;
  return "outline" as const;
}

const EMPTY_MISSION_AGENTS: ReadonlyArray<MissionAgent> = [];
const DEPENDENCY_NOT_PENDING = () => false;
const TASK_NOT_PENDING = () => false;

export function MissionTaskGraph({
  tasks,
  dependencies,
  agents = EMPTY_MISSION_AGENTS,
  canMutate,
  isDependencyPending = DEPENDENCY_NOT_PENDING,
  isTaskPending = TASK_NOT_PENDING,
  onAddDependency,
  onRemoveDependency,
  onAssignTask,
  onUpdateTask,
  onStartTask,
  onRetryTask,
  onCancelTask,
}: {
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly dependencies: ReadonlyArray<TaskDependency>;
  readonly agents?: ReadonlyArray<MissionAgent>;
  readonly canMutate: boolean;
  readonly isDependencyPending?: (taskId: MissionTaskId, dependsOnTaskId: MissionTaskId) => boolean;
  readonly isTaskPending?: (taskId: MissionTaskId) => boolean;
  readonly onAddDependency?: (
    taskId: MissionTaskId,
    dependsOnTaskId: MissionTaskId,
  ) => Promise<void>;
  readonly onRemoveDependency?: (
    taskId: MissionTaskId,
    dependsOnTaskId: MissionTaskId,
  ) => Promise<void>;
  readonly onAssignTask?: (
    taskId: MissionTaskId,
    missionAgentId: MissionAgentId | null,
  ) => Promise<void>;
  readonly onUpdateTask?: (
    taskId: MissionTaskId,
    patch: {
      readonly title: string;
      readonly description: string;
      readonly maximumAttempts: number;
      readonly requiresDependencyHandoffs: boolean;
    },
  ) => Promise<void>;
  readonly onStartTask?: (taskId: MissionTaskId) => Promise<void>;
  readonly onRetryTask?: (taskId: MissionTaskId) => Promise<void>;
  readonly onCancelTask?: (taskId: MissionTaskId) => Promise<void>;
}) {
  const orderedTasks = tasks.toSorted(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
  const taskById = new Map<MissionTaskId, MissionTask>(
    orderedTasks.map((task) => [task.id, task] as const),
  );
  const layers = missionDependencyLayers(
    orderedTasks.map((task) => task.id),
    dependencies,
  );
  const dependenciesByTask = new Map<MissionTaskId, TaskDependency[]>();
  for (const dependency of dependencies) {
    const current = dependenciesByTask.get(dependency.taskId);
    if (current) current.push(dependency);
    else dependenciesByTask.set(dependency.taskId, [dependency]);
  }

  if (orderedTasks.length === 0) {
    return (
      <Card>
        <CardPanel className="grid place-items-center gap-2 py-10 text-center">
          <p className="text-sm font-medium">No tasks yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add a concrete task to begin building the mission dependency graph.
          </p>
        </CardPanel>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto pb-2" role="region" aria-label="Task dependency graph">
      <div className="flex min-w-max items-start gap-3">
        {layers.map((layer, layerIndex) => (
          <section
            key={layer.join(":")}
            className="w-80 shrink-0 rounded-xl border border-border/70 bg-muted/20 p-2.5"
            aria-labelledby={`mission-task-stage-${layerIndex}`}
          >
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <h3 id={`mission-task-stage-${layerIndex}`} className="text-xs font-semibold">
                Stage {layerIndex + 1}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">{layer.length}</span>
            </header>
            <ol className="grid gap-2">
              {layer.map((taskId) => {
                const task = taskById.get(taskId);
                if (!task) return null;
                const taskDependencies = dependenciesByTask.get(task.id) ?? [];
                const waitingForDependency = taskDependencies.some(
                  (dependency) => taskById.get(dependency.dependsOnTaskId)?.status !== "completed",
                );
                const assignedAgent = task.assignedMissionAgentId
                  ? (agents.find((agent) => agent.id === task.assignedMissionAgentId) ?? null)
                  : null;
                const startUnavailable =
                  waitingForDependency ||
                  (agents.length > 0 && assignedAgent === null) ||
                  assignedAgent?.status === "disabled" ||
                  assignedAgent?.status === "unavailable" ||
                  (assignedAgent !== null &&
                    hasWritePermission(assignedAgent.permissions) &&
                    task.worktreeId === null);
                const displayStatus =
                  task.integrationStatus === "integrated"
                    ? "integrated"
                    : task.integrationStatus === "conflicted"
                      ? "conflicted"
                      : task.integrationStatus !== "not_requested"
                        ? "integration pending"
                        : waitingForDependency &&
                            (task.status === "backlog" || task.status === "ready")
                          ? "waiting for dependency"
                          : task.status;
                const addableTasks = orderedTasks.filter(
                  (candidate) =>
                    preflightMissionDependency(dependencies, task.id, candidate.id).allowed,
                );

                return (
                  <li
                    key={task.id}
                    className="[content-visibility:auto] [contain-intrinsic-size:auto_11rem]"
                  >
                    <Card>
                      <CardPanel className="grid gap-3 p-3.5">
                        <div className="flex min-w-0 items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-semibold">{task.title}</h4>
                            {task.description ? (
                              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                {task.description}
                              </p>
                            ) : null}
                          </div>
                          <Badge variant={taskBadgeVariant(displayStatus)}>{displayStatus}</Badge>
                        </div>

                        {task.blockedReason ? (
                          <p className="rounded-md bg-warning/8 px-2 py-1.5 text-xs text-warning-foreground">
                            {task.blockedReason}
                          </p>
                        ) : null}

                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Attempt</dt>
                          <dd className="text-right tabular-nums">
                            {task.attemptCount}/{task.maximumAttempts}
                          </dd>
                          <dt className="text-muted-foreground">Worktree</dt>
                          <dd className="truncate text-right">
                            {task.worktreeId === null ? "Not assigned" : "Assigned"}
                          </dd>
                        </dl>

                        {onAssignTask ? (
                          <label className="grid gap-1 text-xs font-medium">
                            Agent slot
                            <select
                              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                              value={task.assignedMissionAgentId ?? ""}
                              disabled={!canMutate || startUnavailable || isTaskPending(task.id)}
                              onChange={(event) =>
                                void onAssignTask(
                                  task.id,
                                  event.currentTarget.value
                                    ? (event.currentTarget.value as MissionAgentId)
                                    : null,
                                )
                              }
                            >
                              <option value="">Unassigned</option>
                              {agents.map((agent) => (
                                <option
                                  key={agent.id}
                                  value={agent.id}
                                  disabled={agent.status === "disabled"}
                                >
                                  {agent.displayName} · {agent.roleKind}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        {onUpdateTask ? (
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                              Edit task details
                            </summary>
                            <form
                              key={task.updatedAt}
                              className="mt-2 grid gap-2"
                              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                const title = String(form.get("title") ?? "").trim();
                                const maximumAttempts = Number(form.get("maximumAttempts"));
                                if (
                                  !title ||
                                  !Number.isInteger(maximumAttempts) ||
                                  maximumAttempts < 1
                                ) {
                                  return;
                                }
                                void onUpdateTask(task.id, {
                                  title,
                                  description: String(form.get("description") ?? "").trim(),
                                  maximumAttempts,
                                  requiresDependencyHandoffs:
                                    form.get("requiresDependencyHandoffs") === "on",
                                });
                              }}
                            >
                              <label className="grid gap-1 text-xs font-medium">
                                Title
                                <input
                                  required
                                  name="title"
                                  defaultValue={task.title}
                                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                                />
                              </label>
                              <label className="grid gap-1 text-xs font-medium">
                                Description
                                <textarea
                                  name="description"
                                  defaultValue={task.description}
                                  rows={3}
                                  className="resize-y rounded-lg border border-input bg-background p-2 text-sm"
                                />
                              </label>
                              <label className="grid gap-1 text-xs font-medium">
                                Maximum attempts
                                <input
                                  required
                                  name="maximumAttempts"
                                  type="number"
                                  min={1}
                                  defaultValue={task.maximumAttempts}
                                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                                />
                              </label>
                              <label className="flex items-center gap-2 text-xs font-medium">
                                <input
                                  name="requiresDependencyHandoffs"
                                  type="checkbox"
                                  defaultChecked={task.requiresDependencyHandoffs}
                                />
                                Require dependency handoffs
                              </label>
                              <Button
                                size="sm"
                                variant="outline"
                                type="submit"
                                disabled={!canMutate || isTaskPending(task.id)}
                              >
                                Save task
                              </Button>
                            </form>
                          </details>
                        ) : null}

                        <div className="grid gap-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Prerequisites</p>
                          {taskDependencies.length === 0 ? (
                            <p className="text-xs text-muted-foreground">None</p>
                          ) : (
                            <ul className="grid gap-1">
                              {taskDependencies.map((dependency) => {
                                const prerequisite = taskById.get(dependency.dependsOnTaskId);
                                if (!prerequisite) return null;
                                const pending = isDependencyPending(task.id, prerequisite.id);
                                return (
                                  <li
                                    key={dependency.dependsOnTaskId}
                                    className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/45 px-2 py-1"
                                  >
                                    <Link2Icon className="size-3 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate text-xs">
                                      {prerequisite.title}
                                    </span>
                                    {onRemoveDependency ? (
                                      <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={`Remove prerequisite ${prerequisite.title} from ${task.title}`}
                                        disabled={!canMutate || pending}
                                        onClick={() =>
                                          void onRemoveDependency(task.id, prerequisite.id)
                                        }
                                      >
                                        <Trash2Icon />
                                      </Button>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>

                        {onAddDependency && addableTasks.length > 0 ? (
                          <Select
                            value={null}
                            disabled={!canMutate}
                            onValueChange={(value) => {
                              if (!value) return;
                              void onAddDependency(task.id, MissionTaskId.make(value));
                            }}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Add prerequisite for ${task.title}`}
                            >
                              <SelectValue placeholder="Add prerequisite" />
                            </SelectTrigger>
                            <SelectPopup>
                              {addableTasks.map((candidate) => (
                                <SelectItem key={candidate.id} value={candidate.id}>
                                  {candidate.title}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        ) : null}

                        <time className="text-xs text-muted-foreground" dateTime={task.updatedAt}>
                          Updated {formatRelativeTimeLabel(task.updatedAt)}
                        </time>

                        <div className="flex flex-wrap justify-end gap-1.5">
                          {(task.status === "ready" || task.status === "backlog") && onStartTask ? (
                            <Button
                              size="sm"
                              disabled={!canMutate || isTaskPending(task.id)}
                              onClick={() => void onStartTask(task.id)}
                            >
                              <PlayIcon /> Start task
                            </Button>
                          ) : null}
                          {(task.status === "failed" ||
                            task.status === "blocked" ||
                            task.status === "cancelled") &&
                          onRetryTask ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !canMutate ||
                                task.attemptCount >= task.maximumAttempts ||
                                isTaskPending(task.id)
                              }
                              onClick={() => void onRetryTask(task.id)}
                            >
                              <RotateCcwIcon /> Retry task
                            </Button>
                          ) : null}
                          {task.status === "running" && onCancelTask ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!canMutate || isTaskPending(task.id)}
                              onClick={() => void onCancelTask(task.id)}
                            >
                              <OctagonXIcon /> Cancel task
                            </Button>
                          ) : null}
                        </div>
                      </CardPanel>
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
