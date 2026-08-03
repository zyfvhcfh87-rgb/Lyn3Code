import type {
  MissionTask,
  MissionTaskId,
  VerificationRunId,
  VerificationTaskSummary,
} from "@t3tools/contracts";
import { ClipboardCheckIcon, EyeIcon, PlayIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { VerificationStatusBadge } from "./VerificationStatusBadge";

export function MissionVerificationPanel({
  tasks,
  summaries,
  canMutate,
  isPending,
  onRequest,
  onOpenRun,
}: {
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly summaries: ReadonlyArray<VerificationTaskSummary>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onRequest: (taskId: MissionTaskId) => Promise<void>;
  readonly onOpenRun: (runId: VerificationRunId) => void;
}) {
  const byTask = new Map(summaries.map((summary) => [summary.taskId, summary] as const));
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
      <div className="grid gap-2">
        {tasks.map((task) => {
          const summary = byTask.get(task.id);
          const status = summary?.repairRunning
            ? "running"
            : (summary?.authorization.status ?? "missing");
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
                  disabled={!canMutate || isPending(`verify:${task.id}`)}
                  onClick={() => void onRequest(task.id)}
                >
                  <PlayIcon /> {summary?.latestRun ? "Rerun profile" : "Run verification"}
                </Button>
              </CardPanel>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
