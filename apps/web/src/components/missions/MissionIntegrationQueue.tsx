import type {
  ManagedWorktree,
  Mission,
  MissionTask,
  MissionTaskId,
  TaskDependency,
} from "@t3tools/contracts";
import { CheckIcon, GitMergeIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { missionDependencyLayers } from "./MissionTaskGraph.logic";

const QUEUED_INTEGRATION_STATUSES = new Set<MissionTask["integrationStatus"]>([
  "pending",
  "ready",
  "integrating",
  "conflicted",
  "failed",
]);

function integrationBadgeVariant(status: MissionTask["integrationStatus"]) {
  if (status === "integrated") return "success" as const;
  if (status === "integrating" || status === "ready") return "info" as const;
  if (status === "conflicted" || status === "failed") return "destructive" as const;
  return "outline" as const;
}

export function MissionIntegrationQueue({
  mission,
  tasks,
  dependencies,
  worktrees,
  canMutate,
  isPending,
  onApprove,
  onAbort,
}: {
  readonly mission: Mission;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly dependencies: ReadonlyArray<TaskDependency>;
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onApprove: (taskId: MissionTaskId) => Promise<void>;
  readonly onAbort: (taskId: MissionTaskId) => Promise<void>;
}) {
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree] as const));
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const dependencyOrder = missionDependencyLayers(
    tasks.map((task) => task.id),
    dependencies,
  ).flat();
  const orderIndex = new Map(dependencyOrder.map((taskId, index) => [taskId, index] as const));
  const queuedTasks = tasks
    .filter((task) => QUEUED_INTEGRATION_STATUSES.has(task.integrationStatus))
    .toSorted(
      (left, right) =>
        (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
    );

  return (
    <section aria-labelledby="mission-integration-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitMergeIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-integration-heading" className="text-sm font-semibold">
          Integration queue
        </h2>
        <Badge variant="outline">{mission.teamSettings.integrationMode}</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {queuedTasks.length} waiting
        </span>
      </div>

      {queuedTasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No task branches are waiting for integration.
        </p>
      ) : (
        <ol className="grid gap-2">
          {queuedTasks.map((task, index) => {
            const worktree = task.worktreeId ? (worktreeById.get(task.worktreeId) ?? null) : null;
            const prerequisiteTasks = dependencies
              .filter((dependency) => dependency.taskId === task.id)
              .map((dependency) => taskById.get(dependency.dependsOnTaskId))
              .filter((candidate): candidate is MissionTask => candidate !== undefined);
            const dependenciesIntegrated = prerequisiteTasks.every(
              (dependency) => dependency.integrationStatus === "integrated",
            );
            const conflicted =
              task.integrationStatus === "conflicted" || worktree?.status === "conflicted";
            const canApprove =
              task.integrationStatus === "ready" && dependenciesIntegrated && !conflicted;
            return (
              <li key={task.id}>
                <Card className="[content-visibility:auto] [contain-intrinsic-size:auto_10rem]">
                  <CardPanel className="grid gap-3 p-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                        {index + 1}
                      </span>
                      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {task.title}
                      </h3>
                      <Badge variant={integrationBadgeVariant(task.integrationStatus)}>
                        {task.integrationStatus}
                      </Badge>
                    </div>

                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pl-9 text-xs">
                      <dt className="text-muted-foreground">Branch</dt>
                      <dd className="truncate text-right">
                        {worktree?.branchName ?? "Unavailable"}
                      </dd>
                      <dt className="text-muted-foreground">Changed files</dt>
                      <dd className="text-right tabular-nums">{worktree?.changedFileCount ?? 0}</dd>
                      <dt className="text-muted-foreground">Base</dt>
                      <dd className="truncate text-right">
                        {worktree
                          ? `${worktree.baseBranch} @ ${worktree.baseCommit.slice(0, 8)}`
                          : "Unavailable"}
                      </dd>
                      <dt className="text-muted-foreground">Base divergence</dt>
                      <dd className="text-right">
                        {worktree?.headCommit === null || worktree === null
                          ? "Unknown"
                          : worktree.headCommit === worktree.baseCommit
                            ? "No committed divergence"
                            : "Head differs from recorded base"}
                      </dd>
                      <dt className="text-muted-foreground">Approval</dt>
                      <dd className="text-right">
                        {mission.teamSettings.integrationMode === "manual"
                          ? "Required"
                          : "Policy controlled"}
                      </dd>
                    </dl>

                    {!dependenciesIntegrated ? (
                      <p className="flex items-center gap-2 text-xs text-warning-foreground">
                        <TriangleAlertIcon className="size-4" /> Waiting for prerequisite branches
                        to integrate.
                      </p>
                    ) : null}
                    {conflicted ? (
                      <p className="flex items-center gap-2 text-xs text-destructive-foreground">
                        <TriangleAlertIcon className="size-4" /> Conflicts require recovery before
                        integration can continue.
                      </p>
                    ) : null}

                    {mission.teamSettings.integrationMode === "manual" ||
                    conflicted ||
                    task.integrationStatus === "failed" ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {conflicted || task.integrationStatus === "failed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canMutate || isPending(`abort:${task.id}`)}
                            onClick={() => void onAbort(task.id)}
                          >
                            <TriangleAlertIcon /> Abort and preserve branch
                          </Button>
                        ) : null}
                        {mission.teamSettings.integrationMode === "manual" ? (
                          <Button
                            size="sm"
                            disabled={!canMutate || !canApprove || isPending(`approve:${task.id}`)}
                            onClick={() => void onApprove(task.id)}
                          >
                            <CheckIcon /> Approve clean integration
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardPanel>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
