// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ALL_AGENT_PERMISSIONS,
  AgentRunId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionAgentRunRepository } from "../Services/ProjectionAgentRuns.ts";
import { ProjectionMissionTaskRepository } from "../Services/ProjectionMissionTasks.ts";
import { ProjectionMissionRepository } from "../Services/ProjectionMissions.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionAgentRunRepositoryLive } from "./ProjectionAgentRuns.ts";
import { ProjectionMissionTaskRepositoryLive } from "./ProjectionMissionTasks.ts";
import { ProjectionMissionRepositoryLive } from "./ProjectionMissions.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";

function makeMissionRepositoriesLayer<E, R>(
  persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>,
) {
  return Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionMissionRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionMissionTaskRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionAgentRunRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
    NodeServices.layer,
  );
}

const projectId = ProjectId.make("project-mission-foundation");
const missionId = MissionId.make("mission-foundation");
const taskId = MissionTaskId.make("mission-task-foundation");
const now = "2026-08-03T00:00:00.000Z";
const missionPhase2Defaults = {
  teamSettings: {
    maximumConcurrentAgents: 3,
    maximumConcurrentWriteAgents: 2,
    defaultMaximumTaskAttempts: 3,
    autoStartReadyTasks: false,
    integrationMode: "manual" as const,
  },
  schedulerStatus: "idle" as const,
};
const taskPhase2Defaults = {
  assignedMissionAgentId: null,
  worktreeId: null,
  attemptCount: 0,
  maximumAttempts: 3,
  readyAt: null,
  blockedReason: null,
  integrationStatus: "not_requested" as const,
  requiresDependencyHandoffs: true,
};
const runPhase2Defaults = {
  missionAgentId: null,
  worktreeId: null,
  attemptNumber: 1,
  permissions: ALL_AGENT_PERMISSIONS,
  writeCapable: true,
};

function seedProjectMissionAndTask({
  seedMissionId = missionId,
  seedTaskId = taskId,
}: {
  readonly seedMissionId?: MissionId;
  readonly seedTaskId?: MissionTaskId;
} = {}) {
  return Effect.gen(function* () {
    const projects = yield* ProjectionProjectRepository;
    const missions = yield* ProjectionMissionRepository;
    const tasks = yield* ProjectionMissionTaskRepository;

    yield* projects.upsert({
      projectId,
      title: "Mission foundation",
      workspaceRoot: "/tmp/mission-foundation",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    yield* missions.upsert({
      ...missionPhase2Defaults,
      id: seedMissionId,
      projectId,
      title: "Ship mission foundation",
      description: "Persist the mission model.",
      status: "running",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      cancelledAt: null,
    });
    yield* tasks.upsert({
      ...taskPhase2Defaults,
      id: seedTaskId,
      missionId: seedMissionId,
      title: "Persist projections",
      description: "Store the mission, task, and run.",
      status: "running",
      position: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
    });
  });
}

it.layer(makeMissionRepositoriesLayer(SqlitePersistenceMemory))(
  "Mission projection repositories",
  (it) => {
    it.effect("persists a new backlog mission before it has started", () =>
      Effect.gen(function* () {
        const projects = yield* ProjectionProjectRepository;
        const missions = yield* ProjectionMissionRepository;
        const backlogMissionId = MissionId.make("mission-backlog-not-started");

        yield* projects.upsert({
          projectId,
          title: "Mission foundation",
          workspaceRoot: "/tmp/mission-foundation",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        yield* missions.upsert({
          ...missionPhase2Defaults,
          id: backlogMissionId,
          projectId,
          title: "Not started yet",
          description: "A newly created mission has no start timestamp.",
          status: "backlog",
          createdAt: now,
          updatedAt: now,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
        });

        assert.deepStrictEqual(
          Option.getOrNull(yield* missions.getById({ missionId: backlogMissionId })),
          {
            ...missionPhase2Defaults,
            id: backlogMissionId,
            projectId,
            title: "Not started yet",
            description: "A newly created mission has no start timestamp.",
            status: "backlog",
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
          },
        );
      }),
    );

    it.effect("round-trips mission state in deterministic order", () =>
      Effect.gen(function* () {
        yield* seedProjectMissionAndTask();
        const missions = yield* ProjectionMissionRepository;
        const tasks = yield* ProjectionMissionTaskRepository;
        const runs = yield* ProjectionAgentRunRepository;

        const secondTaskId = MissionTaskId.make("mission-task-foundation-second");
        yield* tasks.upsert({
          ...taskPhase2Defaults,
          id: secondTaskId,
          missionId,
          title: "Verify projections",
          description: "Read the persisted rows back.",
          status: "ready",
          position: 1,
          createdAt: "2026-08-03T00:01:00.000Z",
          updatedAt: "2026-08-03T00:01:00.000Z",
          startedAt: null,
          completedAt: null,
        });

        const run = {
          ...runPhase2Defaults,
          id: AgentRunId.make("agent-run-foundation"),
          missionId,
          taskId,
          threadId: ThreadId.make("thread-agent-run-foundation"),
          provider: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: null,
          status: "running" as const,
          createdAt: now,
          startedAt: now,
          updatedAt: now,
          completedAt: null,
          errorSummary: null,
        };
        yield* runs.upsert(run);

        assert.deepStrictEqual(Option.getOrNull(yield* missions.getById({ missionId })), {
          ...missionPhase2Defaults,
          id: missionId,
          projectId,
          title: "Ship mission foundation",
          description: "Persist the mission model.",
          status: "running",
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          completedAt: null,
          cancelledAt: null,
        });
        assert.deepStrictEqual(
          (yield* tasks.listByMissionId({ missionId })).map((task) => task.id),
          [taskId, secondTaskId],
        );
        assert.deepStrictEqual(
          Option.getOrNull(yield* runs.getActiveByMissionId({ missionId })),
          run,
        );
        assert.deepStrictEqual(
          Option.getOrNull(yield* runs.getByThreadId({ threadId: run.threadId })),
          run,
        );
        assert.deepStrictEqual(yield* runs.listActive(), [run]);
      }),
    );

    it.effect("allows independent active runs for the same mission", () =>
      Effect.gen(function* () {
        const activeMissionId = MissionId.make("mission-active-run-constraint");
        const activeTaskId = MissionTaskId.make("mission-task-active-run-constraint");
        yield* seedProjectMissionAndTask({
          seedMissionId: activeMissionId,
          seedTaskId: activeTaskId,
        });
        const runs = yield* ProjectionAgentRunRepository;

        yield* runs.upsert({
          ...runPhase2Defaults,
          id: AgentRunId.make("agent-run-active-first"),
          missionId: activeMissionId,
          taskId: activeTaskId,
          threadId: ThreadId.make("thread-agent-run-active-first"),
          provider: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: null,
          status: "starting",
          createdAt: now,
          startedAt: now,
          updatedAt: now,
          completedAt: null,
          errorSummary: null,
        });

        yield* runs.upsert({
          ...runPhase2Defaults,
          id: AgentRunId.make("agent-run-active-second"),
          missionId: activeMissionId,
          taskId: null,
          threadId: ThreadId.make("thread-agent-run-active-second"),
          provider: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: null,
          status: "running",
          createdAt: "2026-08-03T00:01:00.000Z",
          startedAt: "2026-08-03T00:01:00.000Z",
          updatedAt: "2026-08-03T00:01:00.000Z",
          completedAt: null,
          errorSummary: null,
        });
        assert.strictEqual(
          (yield* runs.listActiveByMissionId({ missionId: activeMissionId })).length,
          2,
        );
      }),
    );
  },
);

it.effect("persists mission projections across a repository restart", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-missions-"))),
    (tempDir) =>
      Effect.gen(function* () {
        const dbPath = NodePath.join(tempDir, "state.sqlite");
        const firstLayer = makeMissionRepositoriesLayer(makeSqlitePersistenceLive(dbPath));
        const secondLayer = makeMissionRepositoriesLayer(makeSqlitePersistenceLive(dbPath));
        const runId = AgentRunId.make("agent-run-restart");

        yield* Effect.gen(function* () {
          yield* seedProjectMissionAndTask();
          const runs = yield* ProjectionAgentRunRepository;
          yield* runs.upsert({
            ...runPhase2Defaults,
            id: runId,
            missionId,
            taskId,
            threadId: ThreadId.make("thread-agent-run-restart"),
            provider: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerSessionId: "provider-session-restart",
            status: "running",
            createdAt: now,
            startedAt: now,
            updatedAt: now,
            completedAt: null,
            errorSummary: null,
          });
        }).pipe(Effect.provide(firstLayer));

        yield* Effect.gen(function* () {
          const missions = yield* ProjectionMissionRepository;
          const tasks = yield* ProjectionMissionTaskRepository;
          const runs = yield* ProjectionAgentRunRepository;

          assert.strictEqual(
            Option.getOrNull(yield* missions.getById({ missionId }))?.status,
            "running",
          );
          assert.deepStrictEqual(
            (yield* tasks.listByMissionId({ missionId })).map((task) => task.id),
            [taskId],
          );
          assert.deepStrictEqual(
            (yield* runs.listActive()).map((run) => run.id),
            [runId],
          );
        }).pipe(Effect.provide(secondLayer));
      }),
    (tempDir) =>
      Effect.sync(() => {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
