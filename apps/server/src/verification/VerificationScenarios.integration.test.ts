// @effect-diagnostics nodeBuiltinImport:off - every command runs in a disposable Git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  AgentRunId,
  ManagedWorktreeId,
  MissionId,
  MissionTaskId,
  ProjectId,
  type T3ProjectVerificationCheckDefinition,
  type T3ProjectVerificationConfig,
  VerificationCheckDefinitionId,
  VerificationGateId,
  VerificationProfileId,
  VerificationRunId,
  type VerificationRun,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import {
  MissionGitService,
  layer as MissionGitServiceLayer,
} from "../mission-git/MissionGitService.ts";
import { evaluateVerificationIntegrationEvidence } from "../orchestration/Layers/MissionWorktreeReactor.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ArtifactCollector from "./VerificationArtifactCollector.ts";
import {
  type DiscoveredVerificationConfig,
  resolveVerificationProfiles,
} from "./VerificationConfig.ts";
import * as Engine from "./VerificationEngine.ts";
import * as LogStore from "./VerificationLogStore.ts";
import * as PathGuard from "./VerificationPathGuard.ts";
import {
  createVerificationExecutionPlan,
  type VerificationExecutionPlanSnapshot,
  type VerificationPlanIdentities,
} from "./VerificationPlan.ts";
import * as ProcessRunner from "./VerificationProcessRunner.ts";
import * as SourceCapture from "./VerificationSourceCapture.ts";

const Components = Layer.mergeAll(
  ArtifactCollector.layer,
  LogStore.layer,
  PathGuard.layer,
  ProcessRunner.layer,
  SourceCapture.layer,
).pipe(Layer.provide(NodeServices.layer));

const EngineLayer = Engine.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, Components)));

const ServerConfigLayer = ServerConfig.layerTest(NodeProcess.cwd(), {
  prefix: "t3-verification-complete-flow-",
});
const VcsProcessLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const GitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(VcsProcessLayer),
  Layer.provide(NodeServices.layer),
);
const MissionGitLayer = MissionGitServiceLayer.pipe(
  Layer.provideMerge(GitLayer),
  Layer.provideMerge(NodeServices.layer),
);

const TestLayer = Layer.mergeAll(NodeServices.layer, Components, EngineLayer, MissionGitLayer);

const TestPlatform = Schema.decodeUnknownSync(Schema.Literals(["win32", "darwin", "linux"]))(
  NodeProcess.platform,
);

const git = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const makeFixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const guard = yield* PathGuard.VerificationPathGuard;
  const sourceCapture = yield* SourceCapture.VerificationSourceCapture;
  const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "lyn-verification-scenario-",
  });
  const worktreeRoot = path.join(fixtureRoot, "worktree");
  yield* fileSystem.makeDirectory(worktreeRoot);
  git(worktreeRoot, ["init", "-b", "agent/task"]);
  git(worktreeRoot, ["config", "user.email", "verification@example.test"]);
  git(worktreeRoot, ["config", "user.name", "Verification Test"]);
  yield* fileSystem.writeFileString(path.join(worktreeRoot, "source.ts"), "export {}\n");
  yield* fileSystem.makeDirectory(path.join(worktreeRoot, "reports"));
  yield* fileSystem.writeFileString(
    path.join(worktreeRoot, "reports", "result.json"),
    '{"passed":true}\n',
  );
  git(worktreeRoot, ["add", "."]);
  git(worktreeRoot, ["commit", "-m", "fixture"]);
  const worktree = yield* guard.authorizeWorktree({
    assignedWorktreeRoot: worktreeRoot,
    registeredWorktreeRoots: [worktreeRoot],
  });
  const source = yield* sourceCapture.capture({ worktree });
  return { fileSystem, path, fixtureRoot, worktreeRoot, source } as const;
});

const makePlan = Effect.fn("VerificationScenarios.makePlan")(function* (input: {
  readonly source: SourceCapture.CapturedVerificationSource;
  readonly checks: ReadonlyArray<T3ProjectVerificationCheckDefinition>;
  readonly category?: "typecheck" | "unit_test" | "custom";
}) {
  const config = {
    version: 1,
    defaultProfile: "standard",
    profiles: {
      standard: {
        name: "Standard",
        gates: [
          {
            id: "quality",
            name: "Quality",
            category: input.category ?? "custom",
            required: true,
            failurePolicy: "block",
            executionMode: "sequential",
            checks: [...input.checks],
          },
        ],
      },
    },
  } satisfies T3ProjectVerificationConfig;
  const profiles = yield* resolveVerificationProfiles(config, "t3.json");
  const discovered: DiscoveredVerificationConfig = {
    source: "repository",
    configPath: "t3.json",
    revision: "c".repeat(64),
    trust: "accepted",
    config,
    profiles,
    suggestions: [],
  };
  const gateId = VerificationGateId.make("gate:quality");
  const checkDefinitionIds = Object.fromEntries(
    input.checks.map((check) => [
      check.id,
      VerificationCheckDefinitionId.make(`check:${check.id}`),
    ]),
  );
  const identities: VerificationPlanIdentities = {
    profileId: VerificationProfileId.make("profile:standard"),
    gateIds: { quality: gateId },
    checkDefinitionIds: { quality: checkDefinitionIds },
  };
  return yield* createVerificationExecutionPlan({
    discovered,
    profileKey: "standard",
    identities,
    source: input.source,
    changedFiles: input.source.changedFiles,
    environment: {
      platform: TestPlatform,
      architecture: NodeProcess.arch,
      runtimeVersions: { node: NodeProcess.version },
      continuousIntegration: false,
    },
  });
});

const execute = (input: {
  readonly engine: Engine.VerificationEngine["Service"];
  readonly runId: string;
  readonly plan: VerificationExecutionPlanSnapshot;
  readonly fixtureRoot: string;
  readonly worktreeRoot: string;
  readonly path: Path.Path;
  readonly onProgress?: Parameters<
    Engine.VerificationEngine["Service"]["execute"]
  >[0]["onProgress"];
}) =>
  input.engine.execute({
    runId: input.runId,
    plan: input.plan,
    assignedWorktreeRoot: input.worktreeRoot,
    registeredWorktreeRoots: [input.worktreeRoot],
    logRoot: input.path.join(input.fixtureRoot, "logs"),
    artifactRoot: input.path.join(input.fixtureRoot, "artifacts"),
    managedRuntimeRoot: input.path.join(input.fixtureRoot, "runtime"),
    hostEnvironment: NodeProcess.env,
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  });

it.live("records successful commands, durable logs, artifacts, and the exact source", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture;
    const engine = yield* Engine.VerificationEngine;
    const logs = yield* LogStore.VerificationLogStore;
    const plan = yield* makePlan({
      source: fixture.source,
      category: "unit_test",
      checks: [
        {
          id: "tests",
          name: "Tests",
          command: {
            executable: fixture.path.basename(NodeProcess.execPath),
            args: ["-e", "process.stdout.write('tests passed\\n')"],
          },
          artifacts: [
            {
              pattern: "reports/result.json",
              type: "test_result",
              required: true,
            },
          ],
        },
      ],
    });

    const result = yield* execute({
      engine,
      runId: "scenario-success",
      plan,
      ...fixture,
    });
    const check = result.checks[0]!;
    const log = yield* logs.read({
      rootDirectory: fixture.path.join(fixture.fixtureRoot, "logs"),
      logReference: check.logReference!,
    });

    expect(result.result).toBe("passed");
    expect(result.sourceBefore.sourceFingerprint).toBe(plan.source.sourceFingerprint);
    expect(result.sourceAfter.sourceFingerprint).toBe(plan.source.sourceFingerprint);
    expect(check.status).toBe("passed");
    expect(check.exitCode).toBe(0);
    expect(log.records.map((record) => record.text).join("")).toContain("tests passed");
    expect(check.artifacts).toEqual([
      expect.objectContaining({
        type: "test_result",
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
  }).pipe(Effect.provide(TestLayer)),
);

it.live("persists actionable diagnostics and honestly skips later sequential checks", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture;
    const engine = yield* Engine.VerificationEngine;
    const plan = yield* makePlan({
      source: fixture.source,
      category: "typecheck",
      checks: [
        {
          id: "types",
          name: "TypeScript",
          command: {
            executable: fixture.path.basename(NodeProcess.execPath),
            args: [
              "-e",
              "process.stderr.write('source.ts(7,3): error TS2322: incompatible value\\n'); process.exit(2)",
            ],
          },
          diagnosticParser: "typescript",
        },
        {
          id: "later-build",
          name: "Later build",
          command: {
            executable: fixture.path.basename(NodeProcess.execPath),
            args: ["-e", "process.stdout.write('must not run\\n')"],
          },
        },
      ],
    });

    const result = yield* execute({
      engine,
      runId: "scenario-failure",
      plan,
      ...fixture,
    });

    expect(result.result).toBe("failed");
    expect(result.checks[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        exitCode: 2,
        failureCategory: "type_error",
      }),
    );
    expect(result.checks[0]?.diagnostics).toEqual([
      expect.objectContaining({
        filePath: "source.ts",
        line: 7,
        column: 3,
        code: "TS2322",
      }),
    ]);
    expect(result.checks[1]).toEqual(
      expect.objectContaining({
        status: "skipped",
        exitCode: null,
        summary: expect.stringContaining("earlier sequential check failed"),
      }),
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.live("classifies timeout and missing-runtime failures without blaming source code", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture;
    const engine = yield* Engine.VerificationEngine;
    const timeoutPlan = yield* makePlan({
      source: fixture.source,
      checks: [
        {
          id: "hang",
          name: "Hanging command",
          command: {
            executable: fixture.path.basename(NodeProcess.execPath),
            args: ["-e", "process.stdout.write('partial\\n'); setInterval(() => {}, 1000)"],
          },
          timeoutSeconds: 1,
        },
      ],
    });
    const timedOut = yield* execute({
      engine,
      runId: "scenario-timeout",
      plan: timeoutPlan,
      ...fixture,
    });
    expect(timedOut.result).toBe("failed");
    expect(timedOut.checks[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        timedOut: true,
        failureCategory: "timeout",
      }),
    );

    const environmentPlan = yield* makePlan({
      source: fixture.source,
      checks: [
        {
          id: "missing-runtime",
          name: "Missing runtime",
          command: { executable: "lyn-runtime-that-does-not-exist-62d23f", args: [] },
        },
      ],
    });
    const environmentFailure = yield* execute({
      engine,
      runId: "scenario-environment",
      plan: environmentPlan,
      ...fixture,
    });
    expect(environmentFailure.result).toBe("failed");
    expect(environmentFailure.checks[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        failureCategory: "environment_error",
        exitCode: null,
      }),
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.live(
  "cancels the active command, preserves partial logs, and never schedules the next check",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture;
      const engine = yield* Engine.VerificationEngine;
      const logs = yield* LogStore.VerificationLogStore;
      const outputSeen = yield* Deferred.make<void>();
      const plan = yield* makePlan({
        source: fixture.source,
        checks: [
          {
            id: "active",
            name: "Active command",
            command: {
              executable: fixture.path.basename(NodeProcess.execPath),
              args: ["-e", "process.stdout.write('started\\n'); setInterval(() => {}, 1000)"],
            },
            timeoutSeconds: 30,
          },
          {
            id: "never-started",
            name: "Never started",
            command: {
              executable: fixture.path.basename(NodeProcess.execPath),
              args: ["-e", "process.stdout.write('unexpected\\n')"],
            },
          },
        ],
      });
      const fiber = yield* execute({
        engine,
        runId: "scenario-cancel",
        plan,
        ...fixture,
        onProgress: (event) =>
          event._tag === "output"
            ? Deferred.succeed(outputSeen, undefined).pipe(Effect.asVoid)
            : Effect.void,
      }).pipe(Effect.forkChild);

      yield* Deferred.await(outputSeen);
      expect(yield* engine.cancel("scenario-cancel")).toBe(true);
      const result = yield* Fiber.join(fiber);
      const evidence = yield* logs.read({
        rootDirectory: fixture.path.join(fixture.fixtureRoot, "logs"),
        logReference: result.checks[0]!.logReference!,
      });

      expect(result.result).toBe("cancelled");
      expect(result.checks[0]).toEqual(
        expect.objectContaining({ status: "cancelled", failureCategory: "cancelled" }),
      );
      expect(result.checks[1]).toEqual(
        expect.objectContaining({ status: "cancelled", exitCode: null }),
      );
      expect(evidence.records.map((record) => record.text).join("")).toContain("started");
      expect(yield* engine.cancel("unrelated-run")).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
);

it.live(
  "integrates one completed task only after real verification authorizes its exact source",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceCapture = yield* SourceCapture.VerificationSourceCapture;
      const pathGuard = yield* PathGuard.VerificationPathGuard;
      const engine = yield* Engine.VerificationEngine;
      const missionGit = yield* MissionGitService;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-complete-flow-",
      });
      const repositoryPath = path.join(fixtureRoot, "repository");
      const worktreesRoot = path.join(fixtureRoot, "worktrees");
      yield* fileSystem.makeDirectory(repositoryPath, { recursive: true });
      git(repositoryPath, ["init", "--initial-branch=main"]);
      git(repositoryPath, ["config", "user.email", "verification@example.test"]);
      git(repositoryPath, ["config", "user.name", "Verification Flow"]);
      yield* fileSystem.writeFileString(path.join(repositoryPath, "base.txt"), "base\n");
      git(repositoryPath, ["add", "base.txt"]);
      git(repositoryPath, ["commit", "-m", "base"]);

      const integration = yield* missionGit.createMissionIntegrationBranch({
        repositoryPath,
        worktreesRoot,
        missionName: "Verification flow",
        shortId: "mission-flow",
      });
      const task = yield* missionGit.createManagedWorktree({
        repositoryPath,
        worktreesRoot,
        missionName: "Verification flow",
        taskName: "Implement feature",
        shortId: "task-flow",
        baseRef: integration.branchName,
      });

      yield* fileSystem.writeFileString(
        path.join(task.worktreePath, "implemented.ts"),
        "export const implemented = true;\n",
      );
      git(task.worktreePath, ["add", "implemented.ts"]);
      git(task.worktreePath, ["commit", "-m", "implement feature"]);
      const implementationHead = yield* missionGit.getHeadCommit(task.worktreePath);

      const authorizedWorktree = yield* pathGuard.authorizeWorktree({
        assignedWorktreeRoot: task.worktreePath,
        registeredWorktreeRoots: [task.worktreePath],
      });
      const source = yield* sourceCapture.capture({
        worktree: authorizedWorktree,
        baseRef: integration.branchName,
      });
      expect(source.commitHash).toBe(implementationHead);
      expect(source.changedFiles).toEqual(["implemented.ts"]);

      const plan = yield* makePlan({
        source,
        category: "unit_test",
        checks: [
          {
            id: "required-tests",
            name: "Required tests",
            command: {
              executable: path.basename(NodeProcess.execPath),
              args: ["-e", "process.stdout.write('required verification passed\\n')"],
            },
          },
        ],
      });
      const execution = yield* engine.execute({
        runId: "complete-flow-verification",
        plan,
        assignedWorktreeRoot: task.worktreePath,
        registeredWorktreeRoots: [task.worktreePath],
        baseRef: integration.branchName,
        logRoot: path.join(fixtureRoot, "logs"),
        artifactRoot: path.join(fixtureRoot, "artifacts"),
        managedRuntimeRoot: path.join(fixtureRoot, "runtime"),
        hostEnvironment: NodeProcess.env,
      });
      expect(execution.result).toBe("passed");
      expect(execution.sourceMutatedDuringVerification).toBe(false);
      expect(execution.sourceAfter.sourceFingerprint).toBe(source.sourceFingerprint);

      const verificationRun: VerificationRun = {
        id: VerificationRunId.make("verification-run:complete-flow"),
        projectId: ProjectId.make("project:complete-flow"),
        missionId: MissionId.make("mission:complete-flow"),
        taskId: MissionTaskId.make("task:complete-flow"),
        worktreeId: ManagedWorktreeId.make("worktree:complete-flow"),
        agentRunId: AgentRunId.make("agent-run:implementation-complete"),
        profileId: plan.profileId,
        requestedBy: "system:task-completion",
        trigger: "task_completion",
        authorizationScope: "full_profile",
        sourceVerificationRunId: null,
        status: "passed",
        configurationRevision: plan.configurationRevision,
        configurationDigest: plan.configurationDigest,
        branchName: execution.sourceAfter.branchName,
        commitHash: execution.sourceAfter.commitHash,
        dirtyStateFingerprint: execution.sourceAfter.dirtyStateFingerprint,
        sourceFingerprint: execution.sourceAfter.sourceFingerprint,
        changedFilesSnapshot: execution.sourceAfter.changedFiles,
        environmentSnapshot: plan.environment,
        executionPlan: plan,
        startedAt: "2026-08-03T12:09:59.000Z",
        completedAt: "2026-08-03T12:10:00.000Z",
        cancelledAt: null,
        result: "passed",
        failureSummary: null,
        invalidatedAt: null,
        invalidationReason: null,
        createdAt: "2026-08-03T12:09:58.000Z",
      };
      const authorization = evaluateVerificationIntegrationEvidence({
        requiredProfileId: plan.profileId,
        sourceFingerprint: source.sourceFingerprint,
        runs: [verificationRun],
        overrides: [],
      });
      expect(authorization.authorized).toBe(true);
      expect(authorization.matchingRun?.id).toBe(verificationRun.id);

      const merged = yield* missionGit.integrateTaskBranch({
        repositoryPath,
        integrationWorktreePath: integration.worktreePath,
        integrationBranch: integration.branchName,
        taskBranch: task.branchName,
        approved: authorization.authorized,
        expectedIntegrationHeadCommit: integration.headCommit,
        expectedTaskHeadCommit: implementationHead,
      });
      expect(merged.status).toBe("merged");
      if (merged.status !== "merged") {
        return yield* Effect.die(new Error("Expected verified task branch to integrate."));
      }
      expect(merged.taskHeadCommit).toBe(implementationHead);
      expect(merged.changedFiles).toEqual(["implemented.ts"]);
      const integratedSource = yield* fileSystem.readFileString(
        path.join(integration.worktreePath, "implemented.ts"),
      );
      expect(integratedSource.replaceAll("\r\n", "\n")).toBe("export const implemented = true;\n");
    }).pipe(Effect.provide(TestLayer)),
);
