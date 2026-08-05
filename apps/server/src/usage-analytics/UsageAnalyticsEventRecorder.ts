import {
  AnalyticsAggregateId,
  type AnalyticsEventReferencePayload,
  type AnalyticsOrchestrationEventType,
  CommandId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export interface UsageAnalyticsEventReference {
  readonly eventType: AnalyticsOrchestrationEventType;
  readonly aggregateId: string;
  readonly payload: AnalyticsEventReferencePayload;
}

/** Appends compact analytics references without copying private source material. */
export class UsageAnalyticsEventRecorder extends Context.Service<
  UsageAnalyticsEventRecorder,
  {
    readonly record: (
      input: UsageAnalyticsEventReference,
    ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  }
>()("t3/usage-analytics/UsageAnalyticsEventRecorder") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const record = Effect.fn("UsageAnalyticsEventRecorder.record")(function* (
    input: UsageAnalyticsEventReference,
  ) {
    const [uuid, occurredAt] = yield* Effect.all([
      crypto.randomUUIDv4.pipe(Effect.orDie),
      DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    ]);
    return yield* engine.dispatch({
      type: "analytics.event.record",
      commandId: CommandId.make(uuid),
      aggregateId: AnalyticsAggregateId.make(input.aggregateId),
      eventType: input.eventType,
      payload: input.payload,
      occurredAt,
    });
  });

  return UsageAnalyticsEventRecorder.of({ record });
});

export const layer = Layer.effect(UsageAnalyticsEventRecorder, make);
