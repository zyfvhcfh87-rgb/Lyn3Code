import {
  CommandId,
  DeliveryAggregateId,
  type DeliveryEventReferencePayload,
  type DeliveryOrchestrationEventType,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export interface DeliveryEventReference {
  readonly eventType: DeliveryOrchestrationEventType;
  readonly aggregateId: string;
  readonly payload: DeliveryEventReferencePayload;
}

/** Appends bounded, secret-free delivery references to the orchestration event store. */
export class DeliveryEventRecorder extends Context.Service<
  DeliveryEventRecorder,
  {
    readonly record: (
      input: DeliveryEventReference,
    ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  }
>()("t3/delivery/DeliveryEventRecorder") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const record = Effect.fn("DeliveryEventRecorder.record")(function* (
    input: DeliveryEventReference,
  ) {
    const [uuid, occurredAt] = yield* Effect.all([
      crypto.randomUUIDv4.pipe(Effect.orDie),
      DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    ]);
    return yield* engine.dispatch({
      type: "delivery.event.record",
      commandId: CommandId.make(uuid),
      aggregateId: DeliveryAggregateId.make(input.aggregateId),
      eventType: input.eventType,
      payload: input.payload,
      occurredAt,
    });
  });

  return DeliveryEventRecorder.of({ record });
});

export const layer = Layer.effect(DeliveryEventRecorder, make);
