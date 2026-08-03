import {
  CommandId,
  type IndexedSourceId,
  type MemoryAggregateId,
  type MemoryEntryId,
  type MemoryIndexOperationId,
  type MemoryOrchestrationEventType,
  type MemoryProposalId,
  type MemoryRetrievalRecordId,
  type MemorySourceId,
  type MissionId,
  type MissionTaskId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export interface MemoryEventReference {
  readonly eventType: MemoryOrchestrationEventType;
  readonly aggregateId: MemoryAggregateId;
  readonly projectId?: ProjectId | null;
  readonly missionId?: MissionId | null;
  readonly taskId?: MissionTaskId | null;
  readonly memoryEntryId?: MemoryEntryId | null;
  readonly memorySourceId?: MemorySourceId | null;
  readonly proposalId?: MemoryProposalId | null;
  readonly indexedSourceId?: IndexedSourceId | null;
  readonly indexOperationId?: MemoryIndexOperationId | null;
  readonly retrievalRecordId?: MemoryRetrievalRecordId | null;
  readonly contradictionGroupId?: string | null;
  readonly embeddingProvider?: string | null;
  readonly embeddingModel?: string | null;
  readonly summary?: string | null;
}

/**
 * Records reference-sized memory lifecycle events in the orchestration log.
 * Memory content and repository excerpts remain in their bounded stores.
 */
export class MemoryEventRecorder extends Context.Service<
  MemoryEventRecorder,
  {
    readonly record: (
      input: MemoryEventReference,
    ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  }
>()("t3/memory/MemoryEventRecorder") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const record = Effect.fn("MemoryEventRecorder.record")(function* (input: MemoryEventReference) {
    const [uuid, occurredAt] = yield* Effect.all([
      crypto.randomUUIDv4.pipe(Effect.orDie),
      DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    ]);
    return yield* engine.dispatch({
      type: "memory.event.record",
      commandId: CommandId.make(uuid),
      eventType: input.eventType,
      payload: {
        aggregateId: input.aggregateId,
        projectId: input.projectId ?? null,
        missionId: input.missionId ?? null,
        taskId: input.taskId ?? null,
        memoryEntryId: input.memoryEntryId ?? null,
        memorySourceId: input.memorySourceId ?? null,
        proposalId: input.proposalId ?? null,
        indexedSourceId: input.indexedSourceId ?? null,
        indexOperationId: input.indexOperationId ?? null,
        retrievalRecordId: input.retrievalRecordId ?? null,
        contradictionGroupId: input.contradictionGroupId?.slice(0, 255) ?? null,
        embeddingProvider: input.embeddingProvider?.slice(0, 255) ?? null,
        embeddingModel: input.embeddingModel?.slice(0, 255) ?? null,
        summary: input.summary?.slice(0, 2_000) ?? null,
        occurredAt,
      },
    });
  });

  return MemoryEventRecorder.of({ record });
});

export const layer = Layer.effect(MemoryEventRecorder, make);
