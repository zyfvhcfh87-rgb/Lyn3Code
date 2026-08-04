import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { forkParked } from "../serverActivation.ts";
import { isRoutingCancellationNotice } from "./RoutingCancellationGuard.ts";
import { RoutingCoordinator } from "./RoutingCoordinator.ts";

type RoutingLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "agent_run.completed"
      | "agent_run.cancelled"
      | "agent_run.failed"
      | "agent_run.interrupted";
  }
>;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const routing = yield* RoutingCoordinator;
    yield* routing.recover;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        isRoutingCancellationNotice(event) ? routing.noteCancellation(event) : Effect.void,
      ),
    );
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        if (
          event.type !== "agent_run.completed" &&
          event.type !== "agent_run.cancelled" &&
          event.type !== "agent_run.failed" &&
          event.type !== "agent_run.interrupted"
        ) {
          return Effect.void;
        }
        const lifecycleEvent: RoutingLifecycleEvent = event;
        return routing.recordRunOutcome(lifecycleEvent).pipe(
          Effect.andThen(
            lifecycleEvent.type === "agent_run.failed" &&
              lifecycleEvent.payload.runtimeErrorClass === "transport_error"
              ? routing.fallbackAfterTransportFailure(
                  lifecycleEvent.payload.agentRunId,
                  lifecycleEvent.payload.occurredAt,
                )
              : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logError("routing lifecycle processing failed", {
                  agentRunId: lifecycleEvent.payload.agentRunId,
                  eventType: lifecycleEvent.type,
                  cause: Cause.pretty(cause),
                }),
          ),
        );
      }),
    );
  }),
);
