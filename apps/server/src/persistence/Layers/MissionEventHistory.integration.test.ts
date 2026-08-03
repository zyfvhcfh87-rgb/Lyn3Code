import { CommandId, EventId, MissionId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const TestLayer = OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

it.layer(TestLayer)("Mission event history integration", (it) => {
  it.effect("reads complete ordered aggregate history across storage pages", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const missionId = MissionId.make("mission-cross-page-history");
      const eventCount = 501;
      const occurredAt = "2026-08-03T00:00:00.000Z";

      yield* Effect.forEach(
        Array.from({ length: eventCount }, (_, index) => index),
        (index) => {
          const commandId = CommandId.make(`command-mission-history-${index}`);
          return eventStore.append({
            type: "mission.updated",
            eventId: EventId.make(`event-mission-history-${index}`),
            aggregateKind: "mission",
            aggregateId: missionId,
            occurredAt,
            commandId,
            causationEventId: null,
            correlationId: commandId,
            metadata: {},
            payload: {
              missionId,
              description: `History entry ${index}`,
              updatedAt: occurredAt,
            },
          });
        },
        { concurrency: 1, discard: true },
      );

      const readForAggregate = eventStore.readForAggregate;
      assert.ok(readForAggregate !== undefined);
      if (readForAggregate === undefined) {
        return yield* Effect.die("Aggregate history reader is unavailable");
      }
      const history = yield* Stream.runCollect(
        readForAggregate("mission", missionId, 0, eventCount),
      ).pipe(Effect.map((chunk) => Array.from(chunk)));

      assert.equal(history.length, eventCount);
      assert.deepStrictEqual(
        history.map((event) => event.sequence),
        Array.from({ length: eventCount }, (_, index) => index + 1),
      );
      assert.equal(history[0]?.eventId, "event-mission-history-0");
      assert.equal(history.at(-1)?.eventId, "event-mission-history-500");

      const resumed = yield* Stream.runCollect(
        readForAggregate("mission", missionId, history[498]!.sequence, 10),
      ).pipe(Effect.map((chunk) => Array.from(chunk)));
      assert.deepStrictEqual(
        resumed.map((event) => event.eventId),
        ["event-mission-history-499", "event-mission-history-500"],
      );
    }),
  );
});
