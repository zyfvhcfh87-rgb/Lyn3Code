import type {
  MissionAgent,
  MissionTask,
  MissionTaskId,
  VerificationRunId,
  VerificationTaskSummary,
} from "@t3tools/contracts";
import { ClipboardCheckIcon, EyeIcon, PlayIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { DefinitionLabel } from "../missions/DefinitionLabel";
import { MissionSectionLink } from "../missions/MissionSectionLink";
import { verifiableTasks, verificationRunBlockedReason } from "./MissionVerificationPanel.logic";
import { VerificationStatusBadge } from "./VerificationStatusBadge";

const EMPTY_MISSION_AGENTS: ReadonlyArray<MissionAgent> = [];

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
  const visibleTasks = verifiableTasks(tasks, agents, summaries);

  return (
    <section aria-labelledby="mission-verification-heading" className="grid gap-3">
      <div className="flex items-center gap-2">
        <ClipboardCheckIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-verification-heading" className="text-sm font-semibold">
          <DefinitionLabel term="verification">Verification</DefinitionLabel>
        </h2>
        <span className="text-xs text-muted-foreground">
          Evidence attached to exact source states
        </span>
        <MissionSectionLink render={<Link to="/settings/verification" />}>
          Profiles
        </MissionSectionLink>
      </div>

      {visibleTasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No task can hold verification evidence yet. Verification runs against a task&rsquo;s
          worktree, so add a task that edits the repository first.
        </p>
      ) : (
        <div className="grid gap-2">
          {visibleTasks.map((task) => {
            const summary = byTask.get(task.id);
            const status = summary?.repairRunning
              ? "running"
              : (summary?.authorization.status ?? "missing");
            const runBlockedReason = verificationRunBlockedReason(task);
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
                        : (runBlockedReason ?? "No verification evidence recorded")}
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
                    disabled={
                      !canMutate || runBlockedReason !== null || isPending(`verify:${task.id}`)
                    }
                    title={runBlockedReason ?? undefined}
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
