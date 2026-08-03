import {
  isActiveAgentRunStatus,
  type AgentRun,
  type ManagedWorktree,
  type ManagedWorktreeId,
  type MissionTask,
} from "@t3tools/contracts";
import {
  ClipboardIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitMergeIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";

function worktreeBadgeVariant(status: ManagedWorktree["status"]) {
  if (status === "integrated" || status === "ready") return "success" as const;
  if (status === "active" || status === "integration_ready") return "info" as const;
  if (status === "conflicted" || status === "failed" || status === "orphaned") {
    return "destructive" as const;
  }
  if (status === "dirty") return "warning" as const;
  return "outline" as const;
}

export function worktreeCleanupBlockers(
  worktree: ManagedWorktree,
  runs: ReadonlyArray<AgentRun>,
): ReadonlyArray<string> {
  const blockers: string[] = [];
  if (runs.some((run) => run.worktreeId === worktree.id && isActiveAgentRunStatus(run.status))) {
    blockers.push("an agent is active");
  }
  if (worktree.hasUncommittedChanges) blockers.push("uncommitted changes remain");
  if (worktree.status === "conflicted") blockers.push("conflicts are unresolved");
  if (
    worktree.purpose === "task" &&
    worktree.status !== "integrated" &&
    worktree.status !== "removed" &&
    worktree.status !== "failed" &&
    worktree.status !== "orphaned"
  ) {
    blockers.push("the task branch is not integrated");
  }
  return blockers;
}

export function MissionWorktreePanel({
  worktrees,
  tasks,
  runs,
  canMutate,
  isPending,
  onOpen,
  onCopyPath,
  onInspectChanges,
  onRequestIntegration,
  onRemove,
}: {
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly runs: ReadonlyArray<AgentRun>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onOpen: (worktree: ManagedWorktree) => void;
  readonly onCopyPath: (worktree: ManagedWorktree) => Promise<void>;
  readonly onInspectChanges: (worktree: ManagedWorktree) => void;
  readonly onRequestIntegration: (worktreeId: ManagedWorktreeId) => Promise<void>;
  readonly onRemove: (worktreeId: ManagedWorktreeId) => Promise<void>;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const activeRunByWorktreeId = new Map(
    runs
      .filter((run) => run.worktreeId !== null && isActiveAgentRunStatus(run.status))
      .map((run) => [run.worktreeId!, run] as const),
  );
  const orderedWorktrees = worktrees.toSorted(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );

  return (
    <section aria-labelledby="mission-worktrees-heading" className="grid gap-3">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-worktrees-heading" className="text-sm font-semibold">
          Managed worktrees
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{worktrees.length}</span>
      </div>

      {orderedWorktrees.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No managed worktrees yet. Write-capable tasks receive an isolated worktree when the
          scheduler prepares them.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {orderedWorktrees.map((worktree) => {
            const task = worktree.taskId ? taskById.get(worktree.taskId) : null;
            const activeRun = activeRunByWorktreeId.get(worktree.id) ?? null;
            const cleanupBlockers = worktreeCleanupBlockers(worktree, runs);
            const integrationAllowed =
              worktree.purpose === "task" &&
              (worktree.status === "integration_ready" || worktree.status === "dirty");
            return (
              <Card
                key={worktree.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_17rem]"
              >
                <CardPanel className="grid gap-3 p-4">
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">
                        {task?.title ??
                          (worktree.purpose === "integration" ? "Integration" : "Task")}
                      </h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {worktree.branchName}
                      </p>
                    </div>
                    <Badge variant={worktreeBadgeVariant(worktree.status)}>{worktree.status}</Badge>
                  </div>

                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Path</dt>
                    <dd className="truncate text-right" title={worktree.worktreePath}>
                      {worktree.worktreePath}
                    </dd>
                    <dt className="text-muted-foreground">Base</dt>
                    <dd className="truncate text-right">
                      {worktree.baseBranch} @ {worktree.baseCommit.slice(0, 8)}
                    </dd>
                    <dt className="text-muted-foreground">Changes</dt>
                    <dd className="text-right tabular-nums">
                      {worktree.changedFileCount} file{worktree.changedFileCount === 1 ? "" : "s"}
                      {worktree.hasUncommittedChanges ? " · uncommitted" : ""}
                    </dd>
                    <dt className="text-muted-foreground">Active agent</dt>
                    <dd className="truncate text-right">{activeRun?.provider ?? "None"}</dd>
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd className="text-right">{formatRelativeTimeLabel(worktree.updatedAt)}</dd>
                  </dl>

                  {worktree.errorSummary ? (
                    <p className="rounded-lg bg-destructive/8 p-2 text-sm text-destructive-foreground">
                      {worktree.errorSummary}
                    </p>
                  ) : null}

                  {worktree.conflictingFiles.length > 0 ? (
                    <details className="rounded-lg border border-destructive/24 bg-destructive/6 p-2">
                      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-destructive-foreground">
                        <TriangleAlertIcon className="size-4" />
                        {worktree.conflictingFiles.length} conflicting file
                        {worktree.conflictingFiles.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 list-disc pl-5 text-xs text-destructive-foreground">
                        {worktree.conflictingFiles.map((path) => (
                          <li key={path} className="break-all">
                            {path}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {cleanupBlockers.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Cleanup blocked: {cleanupBlockers.join(", ")}.
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onOpen(worktree)}>
                      <ExternalLinkIcon /> Open
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void onCopyPath(worktree)}>
                      <ClipboardIcon /> Copy path
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onInspectChanges(worktree)}>
                      <FileDiffIcon /> Inspect changes
                    </Button>
                    {integrationAllowed ? (
                      <Button
                        size="sm"
                        disabled={!canMutate || isPending(`integrate:${worktree.id}`)}
                        onClick={() => void onRequestIntegration(worktree.id)}
                      >
                        <GitMergeIcon /> Request integration
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={
                        !canMutate ||
                        cleanupBlockers.length > 0 ||
                        isPending(`worktree:${worktree.id}`)
                      }
                      onClick={() => void onRemove(worktree.id)}
                    >
                      <Trash2Icon /> Remove safely
                    </Button>
                  </div>
                </CardPanel>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
