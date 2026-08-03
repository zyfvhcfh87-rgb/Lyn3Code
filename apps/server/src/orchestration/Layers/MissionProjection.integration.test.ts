import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, MissionId, MissionTaskId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const TestLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-mission-projection-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("Mission projection integration", (it) => {
  it.effect("reconstructs board and detail state and resumes from a stable sequence", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const query = yield* ProjectionSnapshotQuery;
      const projectId = ProjectId.make("project-mission-projection");
      const missionId = MissionId.make("mission-projection");
      const taskId = MissionTaskId.make("mission-task-projection");
      const createdAt = "2026-08-03T00:00:00.000Z";

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("command-projection-project-create"),
        projectId,
        title: "Mission projection project",
        workspaceRoot: "/tmp/mission-projection",
        defaultModelSelection: null,
        createdAt,
      });
      const missionCreated = yield* engine.dispatch({
        type: "mission.create",
        commandId: CommandId.make("command-projection-mission-create"),
        missionId,
        projectId,
        title: "Project one mission",
        description: "Exercise snapshots and resumable events.",
        createdAt: "2026-08-03T00:00:01.000Z",
      });

      const liveMissionEvent = yield* Stream.runHead(
        engine.streamDomainEvents.pipe(
          Stream.filter((event) => event.aggregateId === missionId),
          Stream.take(1),
        ),
      ).pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;

      yield* engine.dispatch({
        type: "mission.task.create",
        commandId: CommandId.make("command-projection-task-create"),
        missionId,
        taskId,
        title: "Observe mission events",
        description: "Prove live and resumable sequencing.",
        position: 0,
        createdAt: "2026-08-03T00:00:02.000Z",
      });

      const liveEvent = Option.getOrThrow(yield* Fiber.join(liveMissionEvent));
      assert.equal(liveEvent.type, "task.created");
      assert.ok(liveEvent.sequence > missionCreated.sequence);

      assert.ok(query.getMissionBoardSnapshot !== undefined);
      assert.ok(query.getMissionDetailSnapshot !== undefined);
      const board = yield* query.getMissionBoardSnapshot(projectId);
      const detail = Option.getOrThrow(yield* query.getMissionDetailSnapshot(missionId));

      assert.equal(board.projectId, projectId);
      assert.equal(board.missions.length, 1);
      assert.equal(board.missions[0]?.mission.id, missionId);
      assert.deepStrictEqual(board.missions[0]?.taskProgress, { total: 1, completed: 0 });
      assert.equal(detail.mission.id, missionId);
      assert.deepStrictEqual(
        detail.tasks.map((task) => task.id),
        [taskId],
      );
      assert.deepStrictEqual(
        detail.events.map((event) => event.type),
        ["mission.created", "task.created"],
      );
      assert.equal(detail.snapshotSequence, board.snapshotSequence);

      const resumed = yield* Stream.runCollect(engine.readEvents(missionCreated.sequence, 20)).pipe(
        Effect.map((chunk) => Array.from(chunk).filter((event) => event.aggregateId === missionId)),
      );
      assert.deepStrictEqual(
        resumed.map((event) => [event.sequence, event.type]),
        [[liveEvent.sequence, "task.created"]],
      );
    }),
  );
});
