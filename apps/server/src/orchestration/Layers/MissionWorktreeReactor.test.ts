import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_MISSION_TEAM_SETTINGS,
  EventId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderInstanceId,
  type ManagedWorktree,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationMissionDetailSnapshot,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import {
  MissionGitService,
  layer as MissionGitServiceLayer,
} from "../../mission-git/MissionGitService.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { MissionWorktreeReactor } from "../Services/MissionWorktreeReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { MissionWorktreeReactorLive } from "./MissionWorktreeReactor.ts";

const projectId = ProjectId.make("project-worktree-reactor");
const missionId = MissionId.make("mission-worktree-reactor");
const taskId = MissionTaskId.make("task-worktree-reactor");
const missionAgentId = MissionAgentId.make("agent-worktree-reactor");
const providerInstanceId = ProviderInstanceId.make("codex");
const now = "2026-08-03T00:00:00.000Z";

type CommandType = OrchestrationCommand["type"];

interface WorktreeHarnessShape {
  readonly seed: (detail: OrchestrationMissionDetailSnapshot, workspaceRoot: string) => void;
  readonly detail: () => OrchestrationMissionDetailSnapshot;
  readonly updateTask: (
    patch: Partial<OrchestrationMissionDetailSnapshot["tasks"][number]>,
  ) => void;
  readonly commands: () => ReadonlyArray<OrchestrationCommand>;
  readonly publish: (event: OrchestrationEvent) => Effect.Effect<void>;
  readonly awaitCommand: <Type extends CommandType>(
    type: Type,
    predicate?: (command: Extract<OrchestrationCommand, { type: Type }>) => boolean,
  ) => Effect.Effect<Extract<OrchestrationCommand, { type: Type }>>;
  readonly eventStream: Stream.Stream<OrchestrationEvent>;
  readonly dispatch: OrchestrationEngineService["Service"]["dispatch"];
  readonly getWorkspaceRoot: () => string;
}

class WorktreeHarness extends Context.Service<WorktreeHarness, WorktreeHarnessShape>()(
  "t3/orchestration/Layers/MissionWorktreeReactor.test/WorktreeHarness",
) {}

const WorktreeHarnessLive = Layer.effect(
  WorktreeHarness,
  Effect.gen(function* () {
    const eventQueue = yield* Queue.unbounded<OrchestrationEvent>();
    const commandQueue = yield* Queue.unbounded<OrchestrationCommand>();
    const recordedCommands: OrchestrationCommand[] = [];
    let currentDetail: OrchestrationMissionDetailSnapshot | undefined;
    let workspaceRoot = "";
    let nextSequence = 1;

    const requireDetail = () => {
      if (currentDetail === undefined) throw new Error("Worktree harness was not seeded.");
      return currentDetail;
    };

    const patchWorktree = (id: string, patch: Partial<ManagedWorktree>) => {
      const detail = requireDetail();
      currentDetail = {
        ...detail,
        managedWorktrees: detail.managedWorktrees.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry,
        ),
      };
    };

    const patchTask = (
      id: string,
      patch: Partial<OrchestrationMissionDetailSnapshot["tasks"][number]>,
    ) => {
      const detail = requireDetail();
      currentDetail = {
        ...detail,
        tasks: detail.tasks.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      };
    };

    const dispatch: WorktreeHarnessShape["dispatch"] = (command) =>
      Effect.gen(function* () {
        recordedCommands.push(command);
        if (command.type === "mission.worktree.record") {
          const detail = requireDetail();
          const existing = detail.managedWorktrees.some(
            (entry) => entry.id === command.worktree.id,
          );
          currentDetail = {
            ...detail,
            managedWorktrees: existing
              ? detail.managedWorktrees.map((entry) =>
                  entry.id === command.worktree.id ? command.worktree : entry,
                )
              : [...detail.managedWorktrees, command.worktree],
          };
          if (command.worktree.taskId !== null) {
            patchTask(command.worktree.taskId, { worktreeId: command.worktree.id });
          }
        } else if (command.type === "mission.worktree.status.update") {
          patchWorktree(command.worktreeId, {
            status: command.status,
            ...(command.headCommit === undefined ? {} : { headCommit: command.headCommit }),
            ...(command.changedFileCount === undefined
              ? {}
              : { changedFileCount: command.changedFileCount }),
            ...(command.hasUncommittedChanges === undefined
              ? {}
              : { hasUncommittedChanges: command.hasUncommittedChanges }),
            ...(command.conflictingFiles === undefined
              ? {}
              : { conflictingFiles: command.conflictingFiles }),
            ...(command.errorSummary === undefined ? {} : { errorSummary: command.errorSummary }),
            ...(command.removedAt === undefined ? {} : { removedAt: command.removedAt }),
            updatedAt: command.updatedAt,
          });
        } else if (command.type === "mission.integration.start") {
          patchTask(command.taskId, { integrationStatus: "integrating" });
        } else if (command.type === "mission.integration.complete") {
          patchTask(command.taskId, { integrationStatus: "integrated" });
          patchWorktree(command.worktreeId, {
            status: "integrated",
            headCommit: command.headCommit,
          });
        } else if (command.type === "mission.integration.conflict") {
          patchTask(command.taskId, { integrationStatus: "conflicted" });
          patchWorktree(command.worktreeId, {
            status: "conflicted",
            conflictingFiles: command.conflictingFiles,
          });
        } else if (command.type === "mission.integration.fail") {
          patchTask(command.taskId, { integrationStatus: "failed" });
        }
        yield* Queue.offer(commandQueue, command);
        return { sequence: nextSequence++ };
      });

    const awaitCommand: WorktreeHarnessShape["awaitCommand"] = (type, predicate) =>
      Queue.take(commandQueue).pipe(
        Effect.flatMap((command) => {
          if (command.type !== type) return awaitCommand(type, predicate);
          const typed = command as Extract<OrchestrationCommand, { type: typeof type }>;
          return predicate === undefined || predicate(typed)
            ? Effect.succeed(typed)
            : awaitCommand(type, predicate);
        }),
      ) as never;

    return {
      seed: (detail, root) => {
        currentDetail = detail;
        workspaceRoot = root;
        recordedCommands.length = 0;
        nextSequence = 1;
      },
      detail: requireDetail,
      updateTask: (patch) => patchTask(taskId, patch),
      commands: () => recordedCommands,
      publish: (event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid),
      awaitCommand,
      eventStream: Stream.fromQueue(eventQueue),
      dispatch,
      getWorkspaceRoot: () => workspaceRoot,
    } satisfies WorktreeHarnessShape;
  }),
);

const FakeEngineLive = Layer.effect(
  OrchestrationEngineService,
  Effect.gen(function* () {
    const harness = yield* WorktreeHarness;
    return {
      readEvents: () => Stream.empty,
      dispatch: harness.dispatch,
      streamDomainEvents: harness.eventStream,
      latestSequence: Effect.succeed(0),
    } satisfies OrchestrationEngineService["Service"];
  }),
);

const FakeQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  Effect.gen(function* () {
    const harness = yield* WorktreeHarness;
    return ProjectionSnapshotQuery.of({
      getMissionDetailSnapshot: () => Effect.succeed(Option.some(harness.detail())),
      getSnapshot: () =>
        Effect.succeed({
          missions: [harness.detail().mission],
        } as unknown as OrchestrationReadModel),
    } as unknown as ProjectionSnapshotQuery["Service"]);
  }),
);

const FakeProjectRepositoryLive = Layer.effect(
  ProjectionProjectRepository,
  Effect.gen(function* () {
    const harness = yield* WorktreeHarness;
    return ProjectionProjectRepository.of({
      getById: () =>
        Effect.succeed(
          Option.some({
            projectId,
            title: "Worktree Reactor",
            workspaceRoot: harness.getWorkspaceRoot(),
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }),
        ),
    } as unknown as ProjectionProjectRepository["Service"]);
  }),
);

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-mission-worktree-reactor-",
});
const VcsProcessLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const GitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(VcsProcessLayer),
  Layer.provide(NodeServices.layer),
);
const GitServiceLive = MissionGitServiceLayer.pipe(
  Layer.provideMerge(GitLayer),
  Layer.provideMerge(NodeServices.layer),
);
const FakeServicesLive = Layer.mergeAll(
  FakeEngineLive,
  FakeQueryLive,
  FakeProjectRepositoryLive,
).pipe(Layer.provideMerge(WorktreeHarnessLive));
const TestLayer = MissionWorktreeReactorLive.pipe(
  Layer.provideMerge(FakeServicesLive),
  Layer.provideMerge(GitServiceLive),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = Effect.fn("MissionWorktreeReactor.test.runGit")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  return yield* git.execute({
    operation: "MissionWorktreeReactor.test",
    cwd,
    args,
    timeoutMs: 10_000,
  });
});

const writeFile = Effect.fn("MissionWorktreeReactor.test.writeFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, relativePath), contents);
});

const commitFile = Effect.fn("MissionWorktreeReactor.test.commitFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
  message: string,
) {
  yield* writeFile(cwd, relativePath, contents);
  yield* runGit(cwd, ["add", "--", relativePath]);
  yield* runGit(cwd, ["commit", "-m", message]);
});

const makeRepository = Effect.fn("MissionWorktreeReactor.test.makeRepository")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-worktree-reactor-" });
  const repositoryPath = path.join(root, "repository");
  yield* fileSystem.makeDirectory(repositoryPath, { recursive: true });
  yield* runGit(repositoryPath, ["init", "--initial-branch=main"]);
  yield* runGit(repositoryPath, ["config", "user.email", "worktree-reactor@example.test"]);
  yield* runGit(repositoryPath, ["config", "user.name", "Worktree Reactor Test"]);
  yield* commitFile(repositoryPath, "base.txt", "base\n", "initial commit");
  return { root, repositoryPath };
});

const makeDetail = (): OrchestrationMissionDetailSnapshot => ({
  snapshotSequence: 0,
  mission: {
    id: missionId,
    projectId,
    title: "Mission Worktrees",
    description: "Exercise managed worktrees",
    status: "running",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    cancelledAt: null,
    teamSettings: DEFAULT_MISSION_TEAM_SETTINGS,
    schedulerStatus: "running",
  },
  tasks: [
    {
      id: taskId,
      missionId,
      title: "Implement feature",
      description: "Write the implementation",
      status: "ready",
      position: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      assignedMissionAgentId: missionAgentId,
      worktreeId: null,
      attemptCount: 0,
      maximumAttempts: 3,
      readyAt: now,
      blockedReason: null,
      integrationStatus: "not_requested",
      requiresDependencyHandoffs: true,
    },
  ],
  agentRuns: [],
  agentRoles: [],
  missionAgents: [
    {
      id: missionAgentId,
      missionId,
      roleId: null,
      roleKind: "implementer",
      displayName: "Implementer",
      providerInstanceId,
      model: "gpt-5",
      reasoningLevel: null,
      permissions: ["read_files", "write_files", "create_commits"],
      maximumConcurrentRuns: 1,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    },
  ],
  taskDependencies: [],
  managedWorktrees: [],
  agentHandoffs: [],
  events: [],
});

const eventBase = (sequence: number) => ({
  sequence,
  eventId: EventId.make(`worktree-reactor-event-${sequence}`),
  aggregateKind: "mission" as const,
  aggregateId: missionId,
  occurredAt: now,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
});

describe("MissionWorktreeReactor", () => {
  it.effect("creates integration first and task worktrees from its branch", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const harness = yield* WorktreeHarness;
      const reactor = yield* MissionWorktreeReactor;
      const path = yield* Path.Path;
      const git = yield* MissionGitService;
      harness.seed(makeDetail(), fixture.repositoryPath);

      yield* reactor.reconcileMission(missionId);

      const detail = harness.detail();
      assert.lengthOf(detail.managedWorktrees, 2);
      const integration = detail.managedWorktrees.find((entry) => entry.purpose === "integration");
      const task = detail.managedWorktrees.find((entry) => entry.purpose === "task");
      assert.isDefined(integration);
      assert.isDefined(task);
      assert.strictEqual(task.baseBranch, integration.branchName);
      assert.strictEqual(task.baseCommit, integration.headCommit);
      assert.strictEqual(
        path.dirname(path.dirname(path.dirname(integration.worktreePath))),
        fixture.root,
      );
      assert.notInclude(integration.worktreePath, path.join(fixture.repositoryPath, "worktrees"));
      assert.lengthOf(yield* git.listWorktrees(fixture.repositoryPath), 3);
      assert.deepEqual(
        harness
          .commands()
          .filter((command) => command.type === "mission.worktree.record")
          .map((command) => command.worktree.purpose),
        ["integration", "task"],
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("reports dirty and externally orphaned worktrees without pruning them", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const harness = yield* WorktreeHarness;
      const reactor = yield* MissionWorktreeReactor;
      const fileSystem = yield* FileSystem.FileSystem;
      harness.seed(makeDetail(), fixture.repositoryPath);
      yield* reactor.reconcileMission(missionId);
      const task = harness.detail().managedWorktrees.find((entry) => entry.purpose === "task");
      assert.isDefined(task);

      yield* writeFile(task.worktreePath, "uncommitted.txt", "keep me\n");
      yield* reactor.reconcileMission(missionId);
      const dirty = harness.detail().managedWorktrees.find((entry) => entry.id === task.id);
      assert.strictEqual(dirty?.status, "dirty");
      assert.isTrue(dirty?.hasUncommittedChanges);
      assert.strictEqual(dirty?.changedFileCount, 1);

      yield* fileSystem.remove(task.worktreePath, { recursive: true });
      yield* reactor.reconcileMission(missionId);
      const orphaned = harness.detail().managedWorktrees.find((entry) => entry.id === task.id);
      assert.strictEqual(orphaned?.status, "orphaned");
      assert.match(orphaned?.errorSummary ?? "", /prunable|no longer/);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("integrates only after approval and safely removes the integrated task worktree", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const harness = yield* WorktreeHarness;
      const reactor = yield* MissionWorktreeReactor;
      const git = yield* MissionGitService;
      harness.seed(makeDetail(), fixture.repositoryPath);
      yield* reactor.start();
      const taskWorktree = harness
        .detail()
        .managedWorktrees.find((entry) => entry.purpose === "task");
      const integration = harness
        .detail()
        .managedWorktrees.find((entry) => entry.purpose === "integration");
      assert.isDefined(taskWorktree);
      assert.isDefined(integration);
      yield* commitFile(taskWorktree.worktreePath, "feature.txt", "done\n", "complete feature");
      harness.updateTask({
        status: "completed",
        completedAt: now,
        integrationStatus: "ready",
      });

      yield* harness.publish({
        ...eventBase(10),
        type: "integration.approved",
        payload: {
          missionId,
          taskId,
          worktreeId: taskWorktree.id,
          integrationStatus: "ready",
          occurredAt: now,
        },
      });
      yield* harness.awaitCommand("mission.integration.complete");
      yield* reactor.drain;
      const integrated = yield* git.inspectWorktreeStatus({
        repositoryPath: fixture.repositoryPath,
        worktreePath: taskWorktree.worktreePath,
        integrationRef: integration.branchName,
      });
      assert.isTrue(integrated.integrated);
      assert.strictEqual(harness.detail().tasks[0]?.integrationStatus, "integrated");

      yield* harness.publish({
        ...eventBase(11),
        type: "managed_worktree.removal-requested",
        payload: { missionId, worktreeId: taskWorktree.id, requestedAt: now },
      });
      yield* harness.awaitCommand(
        "mission.worktree.status.update",
        (command) => command.worktreeId === taskWorktree.id && command.status === "removed",
      );
      yield* reactor.drain;
      assert.strictEqual(
        harness.detail().managedWorktrees.find((entry) => entry.id === taskWorktree.id)?.status,
        "removed",
      );
      assert.isFalse(
        (yield* git.listWorktrees(fixture.repositoryPath)).some(
          (entry) => entry.path === taskWorktree.worktreePath,
        ),
      );
      const types = harness.commands().map((command) => command.type);
      assert.isBelow(
        types.indexOf("mission.integration.start"),
        types.indexOf("mission.integration.complete"),
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("refuses explicit removal when external changes make the worktree dirty", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const harness = yield* WorktreeHarness;
      const reactor = yield* MissionWorktreeReactor;
      const fileSystem = yield* FileSystem.FileSystem;
      harness.seed(makeDetail(), fixture.repositoryPath);
      yield* reactor.start();
      const taskWorktree = harness
        .detail()
        .managedWorktrees.find((entry) => entry.purpose === "task");
      assert.isDefined(taskWorktree);
      yield* writeFile(taskWorktree.worktreePath, "precious.txt", "do not delete\n");

      yield* harness.publish({
        ...eventBase(20),
        type: "managed_worktree.removal-requested",
        payload: { missionId, worktreeId: taskWorktree.id, requestedAt: now },
      });
      yield* harness.awaitCommand(
        "mission.worktree.status.update",
        (command) =>
          command.worktreeId === taskWorktree.id &&
          command.status === "dirty" &&
          command.errorSummary?.includes("Removal refused") === true,
      );
      yield* reactor.drain;
      assert.isTrue(yield* fileSystem.exists(taskWorktree.worktreePath));
      assert.strictEqual(
        harness.detail().managedWorktrees.find((entry) => entry.id === taskWorktree.id)?.status,
        "dirty",
      );
      assert.isFalse(
        harness
          .commands()
          .some(
            (command) =>
              command.type === "mission.worktree.status.update" &&
              command.worktreeId === taskWorktree.id &&
              command.status === "removing",
          ),
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
