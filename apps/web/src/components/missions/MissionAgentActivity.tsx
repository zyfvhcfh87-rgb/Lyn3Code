import { Link } from "@tanstack/react-router";
import {
  isActiveAgentRunStatus,
  type AgentHandoff,
  type AgentRun,
  type AgentRunId,
  type ManagedWorktree,
  type MissionAgent,
  type MissionTask,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { BotIcon, ExternalLinkIcon, OctagonXIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { MissionHandoffViewer } from "./MissionHandoffViewer";
import { MissionTimeline } from "./MissionTimeline";
import { missionEventTimelineItems } from "./MissionTimeline.logic";
import { missionEventsForAgentRun } from "./MissionAgentActivity.logic";

function runBadgeVariant(status: AgentRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "cancelled" || status === "interrupted") {
    return "destructive" as const;
  }
  if (status === "running" || status === "starting") return "info" as const;
  return "warning" as const;
}

export function MissionAgentActivity({
  environmentId,
  runs,
  agents,
  tasks,
  worktrees,
  handoffs,
  events,
  canMutate,
  isPending,
  onCancel,
}: {
  readonly environmentId: string;
  readonly runs: ReadonlyArray<AgentRun>;
  readonly agents: ReadonlyArray<MissionAgent>;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
  readonly handoffs: ReadonlyArray<AgentHandoff>;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly canMutate: boolean;
  readonly isPending: (key: string) => boolean;
  readonly onCancel: (agentRunId: AgentRunId, taskId: MissionTask["id"] | null) => Promise<void>;
}) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent] as const));
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree] as const));
  const handoffsByRunId = new Map<AgentRun["id"], AgentHandoff[]>();
  for (const handoff of handoffs) {
    const current = handoffsByRunId.get(handoff.agentRunId);
    if (current) current.push(handoff);
    else handoffsByRunId.set(handoff.agentRunId, [handoff]);
  }
  const orderedRuns = runs.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );

  return (
    <section aria-labelledby="mission-runs-heading" className="grid gap-3">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-runs-heading" className="text-sm font-semibold">
          Agent activity
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{orderedRuns.length}</span>
      </div>

      {orderedRuns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No agent runs yet.
        </p>
      ) : (
        <div className="grid gap-3">
          {orderedRuns.map((run) => {
            const agent = run.missionAgentId ? agentById.get(run.missionAgentId) : null;
            const task = run.taskId ? taskById.get(run.taskId) : null;
            const worktree = run.worktreeId ? worktreeById.get(run.worktreeId) : null;
            const runHandoffs = handoffsByRunId.get(run.id) ?? [];
            const timelineItems = missionEventTimelineItems(
              missionEventsForAgentRun(events, run.id),
            );
            return (
              <Card
                key={run.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_18rem]"
              >
                <CardPanel className="grid gap-4 p-4">
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">
                        {agent?.displayName ?? run.provider}
                      </h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {agent?.roleKind ?? "legacy agent"} · {task?.title ?? "Mission-wide run"}
                      </p>
                    </div>
                    <Badge variant={run.writeCapable ? "warning" : "outline"}>
                      {run.writeCapable ? "write" : "read-only"}
                    </Badge>
                    <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Provider / session</dt>
                      <dd className="truncate">
                        {run.provider}
                        {run.providerSessionId ? ` / ${run.providerSessionId}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Started</dt>
                      <dd>{formatRelativeTimeLabel(run.startedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Attempt</dt>
                      <dd className="tabular-nums">{run.attemptNumber}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Worktree</dt>
                      <dd className="truncate" title={worktree?.worktreePath}>
                        {worktree?.branchName ?? "None"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: run.threadId }}
                        />
                      }
                    >
                      Open conversation <ExternalLinkIcon />
                    </Button>
                    {isActiveAgentRunStatus(run.status) ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!canMutate || isPending(`run:${run.id}`)}
                        onClick={() => void onCancel(run.id, run.taskId)}
                      >
                        <OctagonXIcon />
                        {run.status === "cancelling" ? "Cancelling" : "Cancel run"}
                      </Button>
                    ) : null}
                  </div>

                  {run.errorSummary ? (
                    <p className="rounded-lg bg-destructive/8 p-2 text-sm text-destructive-foreground">
                      {run.errorSummary}
                    </p>
                  ) : null}

                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Run timeline ({timelineItems.length})
                    </summary>
                    <div className="mt-3 border-l border-border pl-3">
                      <MissionTimeline items={timelineItems} />
                    </div>
                  </details>

                  {runHandoffs.map((handoff) => (
                    <MissionHandoffViewer key={handoff.id} handoff={handoff} />
                  ))}
                </CardPanel>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
