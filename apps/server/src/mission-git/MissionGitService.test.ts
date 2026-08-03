import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  makeManagedWorktreeNames,
  MissionGitService,
  layer as MissionGitServiceLayer,
} from "./MissionGitService.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-mission-git-service-",
});
const VcsProcessLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const GitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(VcsProcessLayer),
  Layer.provide(NodeServices.layer),
);
const TestLayer = MissionGitServiceLayer.pipe(
  Layer.provideMerge(GitLayer),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = Effect.fn("MissionGitService.test.runGit")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
  allowNonZeroExit = false,
) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  return yield* git.execute({
    operation: "MissionGitService.test",
    cwd,
    args,
    allowNonZeroExit,
    timeoutMs: 10_000,
  });
});

const writeFile = Effect.fn("MissionGitService.test.writeFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(cwd, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, contents);
});

const commitFile = Effect.fn("MissionGitService.test.commitFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
  message: string,
) {
  yield* writeFile(cwd, relativePath, contents);
  yield* runGit(cwd, ["add", "--", relativePath]);
  yield* runGit(cwd, ["commit", "-m", message]);
});

const makeRepository = Effect.fn("MissionGitService.test.makeRepository")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-mission-git-repo-" });
  const repositoryPath = path.join(root, "repository");
  const worktreesRoot = path.join(root, "worktrees");
  yield* fileSystem.makeDirectory(repositoryPath, { recursive: true });
  yield* runGit(repositoryPath, ["init", "--initial-branch=main"]);
  yield* runGit(repositoryPath, ["config", "user.email", "mission-git@example.test"]);
  yield* runGit(repositoryPath, ["config", "user.name", "Mission Git Test"]);
  yield* commitFile(repositoryPath, "shared.txt", "base\n", "initial commit");
  return { root, repositoryPath, worktreesRoot };
});

const createIntegration = Effect.fn("MissionGitService.test.createIntegration")(function* (
  repositoryPath: string,
  worktreesRoot: string,
) {
  const service = yield* MissionGitService;
  return yield* service.createMissionIntegrationBranch({
    repositoryPath,
    worktreesRoot,
    missionName: "Mission Alpha",
    shortId: "m-001",
  });
});

describe("MissionGitService", () => {
  it("builds predictable cross-platform-safe managed names", () => {
    assert.deepStrictEqual(
      makeManagedWorktreeNames({
        missionName: "CON / Release: One",
        taskName: "UI \\ Polish?",
        shortId: "TASK 123",
      }),
      {
        branchName: "agent/con-release-one/ui-polish-task-123",
        directoryName: "con-release-one-ui-polish-task-123",
      },
    );
  });

  it.effect("inspects a repository and creates a clean managed worktree", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const service = yield* MissionGitService;
      const inspection = yield* service.inspectRepository({
        repositoryPath: fixture.repositoryPath,
      });

      assert.strictEqual(inspection.currentBranch, "main");
      assert.strictEqual(inspection.defaultBranch.refName, "main");
      assert.isFalse(inspection.isDirty);
      assert.strictEqual(inspection.inProgressOperation, null);

      const created = yield* service.createManagedWorktree({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        missionName: "Mission Alpha",
        taskName: "Implement API",
        shortId: "task-001",
      });
      assert.strictEqual(created.branchName, "agent/mission-alpha/implement-api-task-001");
      assert.strictEqual(created.baseCommit, inspection.headCommit);
      assert.isFalse(created.mainWorktreeDirty);

      const status = yield* service.inspectWorktreeStatus({
        repositoryPath: fixture.repositoryPath,
        worktreePath: created.worktreePath,
      });
      assert.isTrue(status.exists);
      assert.isTrue(status.registered);
      assert.strictEqual(status.branch, created.branchName);
      assert.isFalse(status.isDirty);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("allows dirty main while reporting it honestly", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const service = yield* MissionGitService;
      yield* writeFile(fixture.repositoryPath, "local-notes.txt", "keep me\n");

      const created = yield* service.createManagedWorktree({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        missionName: "Dirty Main",
        taskName: "Safe Task",
        shortId: "task-002",
      });
      assert.isTrue(created.mainWorktreeDirty);

      const mainStatus = yield* runGit(fixture.repositoryPath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      assert.include(mainStatus.stdout, "local-notes.txt");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "rejects branch, path, and nesting collisions without altering existing worktrees",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeRepository();
        const path = yield* Path.Path;
        const service = yield* MissionGitService;
        const missingBaseError = yield* Effect.flip(
          service.validateRepository({
            repositoryPath: fixture.repositoryPath,
            baseRef: "missing/base",
          }),
        );
        assert.strictEqual(missingBaseError.code, "invalid-ref");

        const created = yield* service.createManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          missionName: "Collision",
          taskName: "First",
          shortId: "task-003",
        });

        const branchError = yield* Effect.flip(
          service.createManagedWorktree({
            repositoryPath: fixture.repositoryPath,
            worktreesRoot: fixture.worktreesRoot,
            missionName: "Collision",
            taskName: "First",
            shortId: "task-003",
          }),
        );
        assert.strictEqual(branchError.code, "branch-collision");

        const pathError = yield* Effect.flip(
          service.createManagedWorktree({
            repositoryPath: fixture.repositoryPath,
            worktreesRoot: fixture.worktreesRoot,
            missionName: "Collision",
            taskName: "Second",
            shortId: "task-004",
            worktreePath: created.worktreePath,
          }),
        );
        assert.strictEqual(pathError.code, "path-collision");

        const nestedError = yield* Effect.flip(
          service.createManagedWorktree({
            repositoryPath: fixture.repositoryPath,
            worktreesRoot: fixture.repositoryPath,
            missionName: "Collision",
            taskName: "Nested",
            shortId: "task-005",
            worktreePath: path.join(fixture.repositoryPath, "nested-worktree"),
          }),
        );
        assert.strictEqual(nestedError.code, "path-overlap");
        assert.lengthOf(yield* service.listWorktrees(fixture.repositoryPath), 2);
      }).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "integrates a clean task once and reports duplicate integration deterministically",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeRepository();
        const service = yield* MissionGitService;
        const integration = yield* createIntegration(fixture.repositoryPath, fixture.worktreesRoot);
        const task = yield* service.createManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          missionName: "Mission Alpha",
          taskName: "Task One",
          shortId: "task-006",
          baseRef: integration.branchName,
        });
        yield* commitFile(task.worktreePath, "task.txt", "task output\n", "complete task");
        const taskHead = yield* service.getHeadCommit(task.worktreePath);

        const merged = yield* service.integrateTaskBranch({
          repositoryPath: fixture.repositoryPath,
          integrationWorktreePath: integration.worktreePath,
          integrationBranch: integration.branchName,
          taskBranch: task.branchName,
          approved: true,
          expectedIntegrationHeadCommit: integration.headCommit,
          expectedTaskHeadCommit: taskHead,
        });
        assert.strictEqual(merged.status, "merged");
        if (merged.status !== "merged") {
          return yield* Effect.die(new Error("expected task integration to merge"));
        }
        assert.deepStrictEqual(merged.changedFiles, ["task.txt"]);

        const duplicate = yield* service.integrateTaskBranch({
          repositoryPath: fixture.repositoryPath,
          integrationWorktreePath: integration.worktreePath,
          integrationBranch: integration.branchName,
          taskBranch: task.branchName,
          approved: true,
        });
        assert.strictEqual(duplicate.status, "already-integrated");
        assert.strictEqual(
          yield* service.getHeadCommit(integration.worktreePath),
          merged.headCommit,
        );

        const removed = yield* service.removeManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          worktreePath: task.worktreePath,
          integratedIntoRef: integration.branchName,
          active: false,
          expectedBranch: task.branchName,
        });
        assert.strictEqual(removed.branch, task.branchName);
        assert.isFalse(yield* (yield* FileSystem.FileSystem).exists(task.worktreePath));
        const retainedBranch = yield* runGit(fixture.repositoryPath, [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${task.branchName}`,
        ]);
        assert.strictEqual(retainedBranch.exitCode, 0);
      }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reports conflicts without mutating either branch or discarding either worktree", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const service = yield* MissionGitService;
      const integration = yield* createIntegration(fixture.repositoryPath, fixture.worktreesRoot);
      const task = yield* service.createManagedWorktree({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        missionName: "Mission Alpha",
        taskName: "Conflicting Task",
        shortId: "task-007",
        baseRef: "main",
      });
      yield* commitFile(
        integration.worktreePath,
        "shared.txt",
        "integration version\n",
        "integration edit",
      );
      yield* commitFile(task.worktreePath, "shared.txt", "task version\n", "task edit");
      const integrationHead = yield* service.getHeadCommit(integration.worktreePath);

      const result = yield* service.integrateTaskBranch({
        repositoryPath: fixture.repositoryPath,
        integrationWorktreePath: integration.worktreePath,
        integrationBranch: integration.branchName,
        taskBranch: task.branchName,
        approved: true,
      });
      assert.strictEqual(result.status, "conflicted");
      if (result.status !== "conflicted") return;
      assert.deepStrictEqual(result.conflictingFiles, ["shared.txt"]);
      assert.isFalse(result.mergeStarted);
      assert.strictEqual(yield* service.getHeadCommit(integration.worktreePath), integrationHead);

      const integrationStatus = yield* service.inspectWorktreeStatus({
        repositoryPath: fixture.repositoryPath,
        worktreePath: integration.worktreePath,
      });
      assert.isFalse(integrationStatus.isDirty);
      assert.isTrue(
        yield* (yield* FileSystem.FileSystem).exists(task.worktreePath),
        "task worktree should be preserved",
      );

      const externalMerge = yield* runGit(
        integration.worktreePath,
        ["merge", "--no-ff", "--no-edit", task.branchName],
        true,
      );
      assert.strictEqual(Number(externalMerge.exitCode), 1);
      assert.isTrue(
        (yield* service.inspectWorktreeStatus({
          repositoryPath: fixture.repositoryPath,
          worktreePath: integration.worktreePath,
        })).hasConflicts,
      );
      assert.isTrue(
        yield* service.abortIntegration({
          repositoryPath: fixture.repositoryPath,
          integrationWorktreePath: integration.worktreePath,
          integrationBranch: integration.branchName,
        }),
      );
      const afterAbort = yield* service.inspectWorktreeStatus({
        repositoryPath: fixture.repositoryPath,
        worktreePath: integration.worktreePath,
      });
      assert.isFalse(afterAbort.isDirty);
      assert.strictEqual(yield* service.getHeadCommit(integration.worktreePath), integrationHead);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("refuses dirty, active, and unintegrated worktree removal", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const service = yield* MissionGitService;
      const integration = yield* createIntegration(fixture.repositoryPath, fixture.worktreesRoot);
      const task = yield* service.createManagedWorktree({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        missionName: "Mission Alpha",
        taskName: "Cleanup Task",
        shortId: "task-008",
        baseRef: integration.branchName,
      });

      const activeError = yield* Effect.flip(
        service.removeManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          worktreePath: task.worktreePath,
          integratedIntoRef: integration.branchName,
          active: true,
          expectedBranch: task.branchName,
        }),
      );
      assert.strictEqual(activeError.code, "active-worktree");

      yield* commitFile(task.worktreePath, "not-integrated.txt", "work\n", "unintegrated work");
      const unintegratedError = yield* Effect.flip(
        service.removeManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          worktreePath: task.worktreePath,
          integratedIntoRef: integration.branchName,
          active: false,
          expectedBranch: task.branchName,
        }),
      );
      assert.strictEqual(unintegratedError.code, "unintegrated-commits");

      yield* writeFile(task.worktreePath, "local-only.txt", "do not delete\n");
      const dirtyError = yield* Effect.flip(
        service.removeManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          worktreePath: task.worktreePath,
          integratedIntoRef: integration.branchName,
          active: false,
          expectedBranch: task.branchName,
        }),
      );
      assert.strictEqual(dirtyError.code, "dirty-worktree");
      assert.isTrue(yield* (yield* FileSystem.FileSystem).exists(task.worktreePath));
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("detects externally removed worktrees as deterministic orphans", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRepository();
      const fileSystem = yield* FileSystem.FileSystem;
      const service = yield* MissionGitService;
      const task = yield* service.createManagedWorktree({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        missionName: "Mission Alpha",
        taskName: "Orphan Task",
        shortId: "task-009",
      });
      yield* fileSystem.remove(task.worktreePath, { recursive: true });

      const reconciliation = yield* service.reconcileManagedWorktrees({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        managedWorktrees: [
          { id: "worktree-009", path: task.worktreePath, branchName: task.branchName },
        ],
      });
      assert.lengthOf(reconciliation.managed, 1);
      assert.include(["prunable", "missing"], reconciliation.managed[0]?.state);

      const dryRun = yield* service.pruneManagedWorktrees({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        expectedOrphanPaths: [task.worktreePath],
        activeWorktreePaths: [],
        approved: false,
      });
      assert.deepStrictEqual(dryRun.prunablePaths, [task.worktreePath]);
      assert.isFalse(dryRun.pruned);

      const pruned = yield* service.pruneManagedWorktrees({
        repositoryPath: fixture.repositoryPath,
        worktreesRoot: fixture.worktreesRoot,
        expectedOrphanPaths: [task.worktreePath],
        activeWorktreePaths: [],
        approved: true,
      });
      assert.deepStrictEqual(pruned.prunablePaths, [task.worktreePath]);
      assert.isTrue(pruned.pruned);
      assert.isFalse(
        (yield* service.listWorktrees(fixture.repositoryPath)).some(
          (entry) => entry.path === task.worktreePath,
        ),
      );
      const retainedBranch = yield* runGit(fixture.repositoryPath, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${task.branchName}`,
      ]);
      assert.strictEqual(retainedBranch.exitCode, 0);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "requires explicit approval and refuses the main worktree as an integration target",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeRepository();
        const service = yield* MissionGitService;
        const task = yield* service.createManagedWorktree({
          repositoryPath: fixture.repositoryPath,
          worktreesRoot: fixture.worktreesRoot,
          missionName: "Mission Alpha",
          taskName: "Approval Task",
          shortId: "task-010",
        });

        const approvalError = yield* Effect.flip(
          service.integrateTaskBranch({
            repositoryPath: fixture.repositoryPath,
            integrationWorktreePath: task.worktreePath,
            integrationBranch: task.branchName,
            taskBranch: task.branchName,
            approved: false,
          }),
        );
        assert.strictEqual(approvalError.code, "approval-required");

        const protectedError = yield* Effect.flip(
          service.integrateTaskBranch({
            repositoryPath: fixture.repositoryPath,
            integrationWorktreePath: fixture.repositoryPath,
            integrationBranch: "main",
            taskBranch: task.branchName,
            approved: true,
          }),
        );
        assert.include(["unknown-worktree", "protected-branch"], protectedError.code);
      }).pipe(Effect.provide(TestLayer)),
  );
});
