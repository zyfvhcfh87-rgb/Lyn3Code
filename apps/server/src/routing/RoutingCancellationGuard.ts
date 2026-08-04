import type { OrchestrationEvent } from "@t3tools/contracts";

export type RoutingCancellationNotice = Extract<
  OrchestrationEvent,
  {
    type:
      | "mission.cancellation-requested"
      | "task.cancellation-requested"
      | "agent_run.cancellation-requested";
  }
>;

export interface RoutingCancellationScope {
  readonly missionId: string;
  readonly taskId?: string;
  readonly agentRunId?: string;
}

/** Live race guard; durable terminal recovery remains owned by orchestration projections. */
export const makeRoutingCancellationGuard = () => {
  const missionIds = new Set<string>();
  const taskIds = new Set<string>();
  const agentRunIds = new Set<string>();

  const note = (event: RoutingCancellationNotice) => {
    if (event.type === "mission.cancellation-requested") {
      missionIds.add(event.payload.missionId);
      for (const agentRunId of event.payload.agentRunIds) agentRunIds.add(agentRunId);
      return;
    }
    if (event.type === "task.cancellation-requested") {
      taskIds.add(event.payload.taskId);
      return;
    }
    agentRunIds.add(event.payload.agentRunId);
    if (event.payload.taskId !== null) taskIds.add(event.payload.taskId);
  };

  const includes = (scope: RoutingCancellationScope) =>
    missionIds.has(scope.missionId) ||
    (scope.taskId !== undefined && taskIds.has(scope.taskId)) ||
    (scope.agentRunId !== undefined && agentRunIds.has(scope.agentRunId));

  return { note, includes };
};

export const isRoutingCancellationNotice = (
  event: OrchestrationEvent,
): event is RoutingCancellationNotice =>
  event.type === "mission.cancellation-requested" ||
  event.type === "task.cancellation-requested" ||
  event.type === "agent_run.cancellation-requested";
