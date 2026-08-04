import {
  CommandId,
  type MissionId,
  type MissionTaskId,
  type ModelProfileId,
  type ProjectId,
  type ProviderProfileId,
  RoutingAggregateId,
  type RoutingDecisionId,
  type RoutingOrchestrationEventType,
  type RoutingOverrideId,
  type TaskRoutingAssessmentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export interface RoutingEventReference {
  readonly eventType: RoutingOrchestrationEventType;
  readonly aggregateId: string;
  readonly projectId?: ProjectId | null;
  readonly missionId?: MissionId | null;
  readonly taskId?: MissionTaskId | null;
  readonly routingDecisionId?: RoutingDecisionId | null;
  readonly assessmentId?: TaskRoutingAssessmentId | null;
  readonly providerProfileId?: ProviderProfileId | null;
  readonly modelProfileId?: ModelProfileId | null;
  readonly overrideId?: RoutingOverrideId | null;
  readonly summary?: string | null;
}

/** Records bounded routing lifecycle references before dependent side effects. */
export class RoutingEventRecorder extends Context.Service<
  RoutingEventRecorder,
  {
    readonly record: (
      input: RoutingEventReference,
    ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  }
>()("t3/routing/RoutingEventRecorder") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const record = Effect.fn("RoutingEventRecorder.record")(function* (input: RoutingEventReference) {
    const [uuid, occurredAt] = yield* Effect.all([
      crypto.randomUUIDv4.pipe(Effect.orDie),
      DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    ]);
    return yield* engine.dispatch({
      type: "routing.event.record",
      commandId: CommandId.make(uuid),
      aggregateId: RoutingAggregateId.make(input.aggregateId),
      eventType: input.eventType,
      payload: {
        projectId: input.projectId ?? null,
        missionId: input.missionId ?? null,
        taskId: input.taskId ?? null,
        routingDecisionId: input.routingDecisionId ?? null,
        assessmentId: input.assessmentId ?? null,
        providerProfileId: input.providerProfileId ?? null,
        modelProfileId: input.modelProfileId ?? null,
        overrideId: input.overrideId ?? null,
        summary: input.summary?.slice(0, 2_000) ?? null,
        occurredAt,
      },
    });
  });

  return RoutingEventRecorder.of({ record });
});

export const layer = Layer.effect(RoutingEventRecorder, make);
