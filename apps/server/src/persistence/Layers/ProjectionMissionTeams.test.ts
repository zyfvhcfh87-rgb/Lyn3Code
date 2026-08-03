// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentHandoffId,
  AgentRoleId,
  AgentRunId,
  ManagedWorktreeId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  TaskDependencyId,
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
import { ProjectionMissionTeamRepository } from "../Services/ProjectionMissionTeams.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionAgentRunRepositoryLive } from "./ProjectionAgentRuns.ts";
import { ProjectionMissionTaskRepositoryLive } from "./ProjectionMissionTasks.ts";
import { ProjectionMissionRepositoryLive } from "./ProjectionMissions.ts";
import { ProjectionMissionTeamRepositoryLive } from "./ProjectionMissionTeams.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";

const now = "2026-08-03T00:00:00.000Z";
const projectId = ProjectId.make("project-phase2-repository");
const missionId = MissionId.make("mission-phase2-repository");
const taskAId = MissionTaskId.make("task-phase2-a");
const taskBId = MissionTaskId.make("task-phase2-b");
const taskCId = MissionTaskId.make("task-phase2-c");
const roleId = AgentRoleId.make("role-phase2-implementer");
const missionAgentId = MissionAgentId.make("mission-agent-phase2-implementer");
const worktreeId = ManagedWorktreeId.make("worktree-phase2-a");

function makeLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  return Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionMissionRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionMissionTaskRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionAgentRunRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionMissionTeamRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
    NodeServices.layer,
  );
}

const mission = {
  id: missionId,
  projectId,
  title: "Parallel implementation",
  description: "Persist the Phase 2 team.",
  status: "running" as const,
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: null,
  cancelledAt: null,
  teamSettings: {
    maximumConcurrentAgents: 3,
    maximumConcurrentWriteAgents: 2,
    defaultMaximumTaskAttempts: 3,
    autoStartReadyTasks: false,
    integrationMode: "manual" as const,
  },
  schedulerStatus: "running" as const,
};

const taskDefaults = {
  description: "",
  status: "ready" as const,
  createdAt: now,
  updatedAt: now,
  startedAt: null,
  completedAt: null,
  assignedMissionAgentId: null,
  worktreeId: null,
  attemptCount: 0,
  maximumAttempts: 3,
  readyAt: now,
  blockedReason: null,
  integrationStatus: "not_requested" as const,
  requiresDependencyHandoffs: true,
};

const role = {
  id: roleId,
  name: "Implementer",
  kind: "implementer" as const,
  defaultPermissions: [
    "read_files",
    "search_repository",
    "run_safe_commands",
    "run_tests",
    "write_files",
    "create_commits",
  ] as const,
  description: "Writes inside an assigned task worktree.",
  createdAt: now,
  updatedAt: now,
};

const missionAgent = {
  id: missionAgentId,
  missionId,
  roleId,
  roleKind: "implementer" as const,
  displayName: "Implementer 1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: null,
  reasoningLevel: "high",
  permissions: role.defaultPermissions,
  maximumConcurrentRuns: 1,
  status: "idle" as const,
  createdAt: now,
  updatedAt: now,
};

const worktree = {
  id: worktreeId,
  projectId,
  missionId,
  taskId: taskAId,
  purpose: "task" as const,
  repositoryPath: "C:/repo",
  worktreePath: "C:/repo-worktrees/task-a",
  branchName: "agent/phase2/task-a",
  baseBranch: "agent/phase2/integration",
  baseCommit: "abc123",
  headCommit: null,
  status: "ready" as const,
  changedFileCount: 0,
  hasUncommittedChanges: false,
  conflictingFiles: [] as const,
  createdAt: now,
  updatedAt: now,
  removedAt: null,
  errorSummary: null,
};

const seedMission = Effect.gen(function* () {
  const projects = yield* ProjectionProjectRepository;
  const missions = yield* ProjectionMissionRepository;
  const tasks = yield* ProjectionMissionTaskRepository;

  yield* projects.upsert({
    projectId,
    title: "Phase 2 repository",
    workspaceRoot: "C:/repo",
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  yield* missions.upsert(mission);
  yield* Effect.forEach(
    [
      { id: taskAId, title: "A", position: 0 },
      { id: taskBId, title: "B", position: 1 },
      { id: taskCId, title: "C", position: 2 },
    ],
    (task) => tasks.upsert({ ...taskDefaults, ...task, missionId }),
  );
});

it.layer(makeLayer(SqlitePersistenceMemory))("Projection mission team repository", (it) => {
  it.effect("round-trips roles, agents, worktrees, and structured handoffs", () =>
    Effect.gen(function* () {
      yield* seedMission;
      const teams = yield* ProjectionMissionTeamRepository;
      const runs = yield* ProjectionAgentRunRepository;

      yield* teams.upsertAgentRole(role);
      yield* teams.upsertMissionAgent(missionAgent);
      yield* teams.upsertManagedWorktree(worktree);

      const run = {
        id: AgentRunId.make("run-phase2-a"),
        missionId,
        taskId: taskAId,
        threadId: ThreadId.make("thread-phase2-a"),
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerSessionId: "session-phase2-a",
        status: "completed" as const,
        createdAt: now,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        errorSummary: null,
        missionAgentId,
        worktreeId,
        attemptNumber: 1,
        permissions: role.defaultPermissions,
        writeCapable: true,
      };
      yield* runs.upsert(run);

      const handoff = {
        id: AgentHandoffId.make("handoff-phase2-a"),
        missionId,
        taskId: taskAId,
        agentRunId: run.id,
        fromMissionAgentId: missionAgentId,
        toMissionAgentId: null,
        summary: "Implemented task A.",
        decisions: [{ decision: "Use one table", reason: "Small model", impact: "Persistence" }],
        changedFiles: [{ path: "src/a.ts", change: "modified" as const, summary: "Implemented A" }],
        commandsRun: [{ command: "vp test run", exitCode: 0, summary: "Passed" }],
        unresolvedProblems: [],
        recommendedNextAction: "Integrate task A.",
        artifacts: [],
        reconciliationStatus: "matched" as const,
        reconciledAt: now,
        createdAt: now,
      };
      yield* teams.upsertAgentHandoff(handoff);

      assert.deepStrictEqual(
        (yield* teams.listAgentRoles()).find((candidate) => candidate.id === role.id),
        role,
      );
      assert.deepStrictEqual(
        Option.getOrNull(yield* teams.getMissionAgentById({ missionAgentId })),
        missionAgent,
      );
      assert.deepStrictEqual(
        Option.getOrNull(yield* teams.getManagedWorktreeById({ worktreeId })),
        worktree,
      );
      assert.deepStrictEqual(
        Option.getOrNull(yield* teams.getAgentHandoffById({ handoffId: handoff.id })),
        handoff,
      );
    }),
  );

  it.effect("rejects dependency cycles transactionally", () =>
    Effect.gen(function* () {
      yield* seedMission;
      const teams = yield* ProjectionMissionTeamRepository;

      yield* teams.addTaskDependency({
        id: TaskDependencyId.make("dependency-b-a"),
        missionId,
        taskId: taskBId,
        dependsOnTaskId: taskAId,
        createdAt: now,
      });
      yield* teams.addTaskDependency({
        id: TaskDependencyId.make("dependency-c-b"),
        missionId,
        taskId: taskCId,
        dependsOnTaskId: taskBId,
        createdAt: now,
      });
      const error = yield* Effect.flip(
        teams.addTaskDependency({
          id: TaskDependencyId.make("dependency-a-c"),
          missionId,
          taskId: taskAId,
          dependsOnTaskId: taskCId,
          createdAt: now,
        }),
      );
      assert.strictEqual(error._tag, "MissionProjectionValidationError");
      assert.strictEqual((yield* teams.listTaskDependenciesByMissionId({ missionId })).length, 2);
    }),
  );

  it.effect("allows readers but rejects a second active writer in one worktree", () =>
    Effect.gen(function* () {
      yield* seedMission;
      const teams = yield* ProjectionMissionTeamRepository;
      const runs = yield* ProjectionAgentRunRepository;
      yield* teams.upsertAgentRole(role);
      yield* teams.upsertMissionAgent(missionAgent);
      yield* teams.upsertManagedWorktree(worktree);

      const baseRun = {
        missionId,
        taskId: taskAId,
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerSessionId: null,
        status: "running" as const,
        createdAt: now,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        errorSummary: null,
        missionAgentId,
        worktreeId,
        attemptNumber: 1,
        permissions: role.defaultPermissions,
      };
      yield* runs.upsert({
        ...baseRun,
        id: AgentRunId.make("run-writer-one"),
        threadId: ThreadId.make("thread-writer-one"),
        writeCapable: true,
      });
      yield* runs.upsert({
        ...baseRun,
        id: AgentRunId.make("run-reader"),
        threadId: ThreadId.make("thread-reader"),
        writeCapable: false,
      });
      const error = yield* Effect.flip(
        runs.upsert({
          ...baseRun,
          id: AgentRunId.make("run-writer-two"),
          threadId: ThreadId.make("thread-writer-two"),
          writeCapable: true,
        }),
      );
      assert.strictEqual(error._tag, "PersistenceSqlError");
    }),
  );
});

it.effect("reloads Phase 2 team and worktree state after repository restart", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-mission-team-"))),
    (tempDir) =>
      Effect.gen(function* () {
        const dbPath = NodePath.join(tempDir, "state.sqlite");
        const firstLayer = makeLayer(makeSqlitePersistenceLive(dbPath));
        const secondLayer = makeLayer(makeSqlitePersistenceLive(dbPath));

        yield* Effect.gen(function* () {
          yield* seedMission;
          const teams = yield* ProjectionMissionTeamRepository;
          yield* teams.upsertAgentRole(role);
          yield* teams.upsertMissionAgent(missionAgent);
          yield* teams.upsertManagedWorktree(worktree);
        }).pipe(Effect.provide(firstLayer));

        yield* Effect.gen(function* () {
          const teams = yield* ProjectionMissionTeamRepository;
          assert.deepStrictEqual(
            (yield* teams.listMissionAgentsByMissionId({ missionId })).map((agent) => agent.id),
            [missionAgentId],
          );
          assert.deepStrictEqual(
            (yield* teams.listManagedWorktreesByMissionId({ missionId })).map(
              (managedWorktree) => managedWorktree.id,
            ),
            [worktreeId],
          );
        }).pipe(Effect.provide(secondLayer));
      }),
    (tempDir) =>
      Effect.sync(() => {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
