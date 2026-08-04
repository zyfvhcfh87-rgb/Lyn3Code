import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  isActiveAgentRunStatus,
  type AgentHandoff,
  type AgentRun,
  type AgentRunId,
  type EnvironmentId,
  type ManagedWorktree,
  type MissionAgent,
  type MissionTask,
  type OrchestrationEvent,
  type ProjectId,
  type RoutingDecisionId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { BotIcon, ExternalLinkIcon, OctagonXIcon, RouteIcon } from "lucide-react";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { routingEnvironment } from "../../state/routing";
import { RoutingDecisionSheet } from "../routing/RoutingDecisionSheet";
import type { RoutingDecisionDetailView, RoutingDecisionSummaryView } from "../routing/routingView";
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

const noopRequestDetail = () => undefined;

function RoutingDecisionLoader({
  environmentId,
  projectId,
  run,
  routingDecisionId,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly run: AgentRun;
  readonly routingDecisionId: RoutingDecisionId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const decisionResult = useAtomValue(
    routingEnvironment.decisionAtom({
      environmentId,
      input: { routingDecisionId },
    }),
  );
  const registryResult = useAtomValue(
    routingEnvironment.registryAtom({ environmentId, input: {} }),
  );
  const workspaceResult = useAtomValue(
    routingEnvironment.workspaceAtom({ environmentId, input: { projectId } }),
  );
  const decisionDetail = Option.getOrNull(AsyncResult.value(decisionResult));
  const registry = Option.getOrNull(AsyncResult.value(registryResult));
  const workspace = Option.getOrNull(AsyncResult.value(workspaceResult));
  const decision = decisionDetail?.decision;
  const providers = new Map(
    (registry?.providers ?? []).map((provider) => [provider.id, provider] as const),
  );
  const models = new Map((registry?.models ?? []).map((model) => [model.id, model] as const));
  const capabilities = new Map(
    (registry?.capabilitySnapshots ?? []).map((snapshot) => [snapshot.id, snapshot] as const),
  );
  const assessment = workspace?.assessments.find(
    (candidate) => candidate.id === decision?.assessmentId,
  );
  const summary: RoutingDecisionSummaryView = {
    id: routingDecisionId,
    providerName:
      (decision && providers.get(decision.selectedProviderProfileId)?.displayName) ??
      run.modelSelection?.instanceId ??
      run.provider,
    modelName:
      (decision && models.get(decision.selectedModelProfileId)?.displayName) ??
      run.modelSelection?.model ??
      "Unknown model",
    reasoningLevel: decision?.selectedReasoningLevel ?? run.reasoningLevel ?? null,
    decisionType: decision?.decisionType ?? "automatic",
  };
  let detail: RoutingDecisionDetailView | null = null;
  if (decision && decisionDetail && registry && workspace) {
    const capability = capabilities.get(decision.selectedCapabilitySnapshotId);
    const health = registry.health
      .filter((record) => record.providerProfileId === decision.selectedProviderProfileId)
      .toSorted((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
    const related = workspace.decisions
      .filter(
        (candidate) =>
          candidate.id !== decision.id &&
          candidate.taskId === decision.taskId &&
          candidate.missionAgentId === decision.missionAgentId,
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    detail = {
      ...summary,
      role: assessment?.agentRole ?? "Unknown",
      taskType: assessment?.taskType ?? "Unknown",
      complexity: assessment?.complexity ?? "Unknown",
      requiredCapabilities: decision.constraintsSnapshot.requiredCapabilities,
      policySources: decision.policySnapshot.policyIds.map(
        (policyId) => workspace.policies.find((policy) => policy.id === policyId)?.name ?? policyId,
      ),
      manualOverrides: [
        ...(decision.manualProviderPin ? ["Provider manually pinned"] : []),
        ...(decision.manualModelPin ? ["Model manually pinned"] : []),
        ...(decision.manualReasoningPin ? ["Reasoning manually pinned"] : []),
      ],
      selectionReasons: [decision.selectionExplanation],
      fallbackPlan: decision.fallbackPlan.map((step) => {
        const provider =
          providers.get(step.providerProfileId)?.displayName ?? step.providerProfileId;
        const model = models.get(step.modelProfileId)?.displayName ?? step.modelProfileId;
        return `${provider} · ${model}${step.reason ? ` — ${step.reason}` : ""}`;
      }),
      candidates: decisionDetail.candidates.map((candidate) => ({
        id: candidate.id,
        providerName:
          providers.get(candidate.providerProfileId)?.displayName ?? candidate.providerProfileId,
        modelName: models.get(candidate.modelProfileId)?.displayName ?? candidate.modelProfileId,
        eligible: candidate.eligible,
        score: candidate.score,
        reasons: candidate.eligible ? candidate.preferenceReasons : candidate.rejectionReasons,
      })),
      capabilitySnapshot: capability
        ? [
            `Source: ${capability.source.replaceAll("_", " ")}`,
            ...Object.entries(capability.capabilities).map(([name, value]) => `${name}: ${value}`),
          ]
        : ["Capability snapshot unavailable"],
      providerHealthSnapshot: health
        ? [
            `Status: ${health.status}`,
            `Rate limit: ${health.rateLimitState}`,
            `Observed: ${health.observedAt}`,
          ]
        : ["Provider health snapshot unavailable"],
      reroutingHistory: related.map(
        (candidate) =>
          `${candidate.createdAt} · ${candidate.decisionType.replaceAll("_", " ")} · ${models.get(candidate.selectedModelProfileId)?.displayName ?? candidate.selectedModelProfileId}`,
      ),
    };
  }

  const error =
    decisionResult._tag === "Failure" ||
    registryResult._tag === "Failure" ||
    workspaceResult._tag === "Failure"
      ? "Routing evidence could not be loaded."
      : null;
  return (
    <RoutingDecisionSheet
      open={open}
      summary={summary}
      detail={detail}
      isLoading={!detail && !error}
      error={error}
      onOpenChange={onOpenChange}
      onRequestDetail={noopRequestDetail}
    />
  );
}

function RunRoutingDecisionButton({
  environmentId,
  projectId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly run: AgentRun;
}) {
  const [open, setOpen] = useState(false);
  if (!run.routingDecisionId) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RouteIcon /> Routing decision
      </Button>
      {open ? (
        <RoutingDecisionLoader
          environmentId={environmentId}
          projectId={projectId}
          run={run}
          routingDecisionId={run.routingDecisionId}
          open
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}

export function MissionAgentActivity({
  environmentId,
  projectId,
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
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
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

                  {run.modelSelection || run.reasoningLevel || run.routingDecisionId ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                      <RouteIcon className="size-3.5 text-muted-foreground" />
                      <span>
                        {run.modelSelection?.instanceId ?? run.provider} ·{" "}
                        {run.modelSelection?.model ?? "Model not recorded"}
                      </span>
                      <Badge variant="outline">{run.reasoningLevel ?? "model default"}</Badge>
                      <Badge variant={run.routingDecisionId ? "info" : "warning"}>
                        {run.routingDecisionId ? "Routed" : "Legacy selection"}
                      </Badge>
                    </div>
                  ) : null}

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
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          to="/memory/$environmentId/$projectId"
                          params={{ environmentId, projectId }}
                          search={{ agentRunId: run.id }}
                        />
                      }
                    >
                      Memory audit <ExternalLinkIcon />
                    </Button>
                    <RunRoutingDecisionButton
                      environmentId={environmentId}
                      projectId={projectId}
                      run={run}
                    />
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
