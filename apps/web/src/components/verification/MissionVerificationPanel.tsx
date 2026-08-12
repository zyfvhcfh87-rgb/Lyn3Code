import {
  hasWritePermission,
  type MissionAgent,
  type MissionAgentId,
  type MissionTask,
  type MissionTaskId,
  type VerificationRunId,
  type VerificationTaskSummary,
} from "@t3tools/contracts";
import { ClipboardCheckIcon, EyeIcon, PlayIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { VerificationStatusBadge } from "./VerificationStatusBadge";

const EMPTY_MISSION_AGENTS: ReadonlyArray<MissionAgent> = [];

/**
 * Verification binds evidence to a worktree's exact source state, so a task that will never hold a
 * worktree can never hold evidence. Only exclude what is provably read-only: a task assigned to an
 * agent without write permission, with no worktree and no evidence of its own. An unassigned task
 * stays listed because it may still be given to a writer.
 */
function canHoldVerificationEvidence(
  task: MissionTask,
  agentsById: ReadonlyMap<MissionAgentId, MissionAgent>,
  summary: VerificationTaskSummary | undefined,
): boolean {
  if (summary !== undefined || task.worktreeId !== null) return true;
  const agent = task.assignedMissionAgentId
    ? (agentsById.get(task.assignedMissionAgentId) ?? null)
    : null;
  return agent === null || hasWritePermission(agent.permissions);
}

export function MissionVerificationPanel({
  tasks,
  agents = EMPTY_MISSION_AGENTS,
  summaries,
  canMutate,
  isPending,
  onRequest,
  onOpenRun,
}: {
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly agents?: ReadonlyArray<MissionAgent>;
  readonly summaries: ReadonlyArray<VerificationTaskSummary>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onRequest: (taskId: MissionTaskId) => Promise<void>;
  readonly onOpenRun: (runId: VerificationRunId) => void;
}) {
  const byTask = new Map(summaries.map((summary) => [summary.taskId, summary] as const));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent] as const));
  const verifiableTasks = tasks.filter((task) =>
    canHoldVerificationEvidence(task, agentsById, byTask.get(task.id)),
  );

  return (
    <section aria-labelledby="mission-verification-heading" className="grid gap-3">
      <div className="flex items-center gap-2">
        <ClipboardCheckIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-verification-heading" className="text-sm font-semibold">
          Verification
        </h2>
        <span className="text-xs text-muted-foreground">
          Evidence attached to exact source states
        </span>
      </div>

      {verifiableTasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No task can hold verification evidence yet. Verification runs against a task&rsquo;s
          worktree, so add a task that edits the repository first.
        </p>
      ) : (
        <div className="grid gap-2">
          {verifiableTasks.map((task) => {
            const summary = byTask.get(task.id);
            const status = summary?.repairRunning
              ? "running"
              : (summary?.authorization.status ?? "missing");
            const awaitingWorktree = task.worktreeId === null;
            return (
              <Card
                key={task.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_7rem]"
              >
                <CardPanel className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{task.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {summary?.latestRun
                        ? `${summary.latestRun.profileName} - ${summary.latestRun.branchName} - ${summary.latestRun.sourceFingerprint.slice(0, 12)}`
                        : awaitingWorktree
                          ? "Needs a worktree. Start this task before requesting verification."
                          : "No verification evidence recorded"}
                    </p>
                  </div>
                  <VerificationStatusBadge status={status} />
                  {summary?.latestRun ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenRun(summary.latestRun!.id)}
                    >
                      <EyeIcon /> Evidence
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={!canMutate || awaitingWorktree || isPending(`verify:${task.id}`)}
                    onClick={() => void onRequest(task.id)}
                  >
                    <PlayIcon /> {summary?.latestRun ? "Rerun profile" : "Run verification"}
                  </Button>
                </CardPanel>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
