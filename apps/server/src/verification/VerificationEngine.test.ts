// @effect-diagnostics nodeBuiltinImport:off - fixtures use only a disposable Git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  type T3ProjectVerificationConfig,
  VerificationCheckDefinitionId,
  VerificationExecutionPlan,
  VerificationGateId,
  VerificationProfileId,
} from "@t3tools/contracts";

import * as ArtifactCollector from "./VerificationArtifactCollector.ts";
import {
  type DiscoveredVerificationConfig,
  resolveVerificationProfiles,
} from "./VerificationConfig.ts";
import * as Engine from "./VerificationEngine.ts";
import * as LogStore from "./VerificationLogStore.ts";
import * as PathGuard from "./VerificationPathGuard.ts";
import { createVerificationExecutionPlan } from "./VerificationPlan.ts";
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

const TestLayer = Layer.mergeAll(NodeServices.layer, Components, EngineLayer);

const PlanJson = Schema.fromJsonString(VerificationExecutionPlan);
const encodePlanJson = Schema.encodeEffect(PlanJson);
const decodePlanJson = Schema.decodeEffect(PlanJson);
const TestPlatform = Schema.decodeUnknownSync(Schema.Literals(["win32", "darwin", "linux"]))(
  NodeProcess.platform,
);
const Identities = {
  profileId: Schema.decodeUnknownSync(VerificationProfileId)("profile:standard"),
  gateIds: {
    proof: Schema.decodeUnknownSync(VerificationGateId)("gate:proof"),
  },
  checkDefinitionIds: {
    proof: {
      "persisted-command": Schema.decodeUnknownSync(VerificationCheckDefinitionId)(
        "check:persisted-command",
      ),
    },
  },
} as const;

const git = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

it.live("executes the persisted plan after the in-memory configuration changes", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const guard = yield* PathGuard.VerificationPathGuard;
    const sourceCapture = yield* SourceCapture.VerificationSourceCapture;
    const engine = yield* Engine.VerificationEngine;
    const logStore = yield* LogStore.VerificationLogStore;
    const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "lyn-verification-engine-",
    });
    const worktreeRoot = path.join(fixtureRoot, "worktree");
    yield* fileSystem.makeDirectory(worktreeRoot);
    git(worktreeRoot, ["init", "-b", "agent/task"]);
    git(worktreeRoot, ["config", "user.email", "verification@example.test"]);
    git(worktreeRoot, ["config", "user.name", "Verification Test"]);
    yield* fileSystem.writeFileString(path.join(worktreeRoot, "source.ts"), "export {}\n");
    git(worktreeRoot, ["add", "source.ts"]);
    git(worktreeRoot, ["commit", "-m", "initial"]);

    const worktree = yield* guard.authorizeWorktree({
      assignedWorktreeRoot: worktreeRoot,
      registeredWorktreeRoots: [worktreeRoot],
    });
    const source = yield* sourceCapture.capture({ worktree });
    const config = {
      version: 1,
      profiles: {
        standard: {
          gates: [
            {
              id: "proof",
              category: "custom",
              checks: [
                {
                  id: "persisted-command",
                  name: "Persisted command",
                  command: {
                    executable: path.basename(NodeProcess.execPath),
                    args: ["-e", "process.stdout.write('persisted-plan-ran\\n')"],
                  },
                },
              ],
            },
          ],
        },
      },
    } satisfies T3ProjectVerificationConfig;
    const profiles = yield* resolveVerificationProfiles(config, "t3.json");
    const discovered: DiscoveredVerificationConfig = {
      source: "repository",
      configPath: "t3.json",
      revision: "b".repeat(64),
      trust: "accepted",
      config,
      profiles,
      suggestions: [],
    };
    const plan = yield* createVerificationExecutionPlan({
      discovered,
      profileKey: "standard",
      identities: Identities,
      source,
      changedFiles: source.changedFiles,
      environment: {
        platform: TestPlatform,
        architecture: NodeProcess.arch,
        runtimeVersions: { node: NodeProcess.version },
        continuousIntegration: false,
      },
    });
    const persistedPlan = yield* encodePlanJson(plan).pipe(Effect.flatMap(decodePlanJson));

    config.profiles.standard.gates[0]!.checks[0]!.command.args = ["-e", "process.exit(91)"];

    const progressEvents: Array<Engine.VerificationEngineProgress> = [];
    const result = yield* engine.execute({
      runId: "run-persisted-plan",
      plan: persistedPlan,
      assignedWorktreeRoot: worktreeRoot,
      registeredWorktreeRoots: [worktreeRoot],
      logRoot: path.join(fixtureRoot, "logs"),
      artifactRoot: path.join(fixtureRoot, "artifacts"),
      managedRuntimeRoot: path.join(fixtureRoot, "runtime"),
      hostEnvironment: NodeProcess.env,
      onProgress: (event) => Effect.sync(() => progressEvents.push(event)),
    });
    const check = result.checks[0]!;
    const evidence = yield* logStore.read({
      rootDirectory: path.join(fixtureRoot, "logs"),
      logReference: check.logReference!,
    });

    expect(result.result).toBe("passed");
    expect(check.exitCode).toBe(0);
    const started = progressEvents.find((event) => event._tag === "check_started");
    expect(started?._tag === "check_started" ? started.logReference : null).toBe(
      check.logReference,
    );
    expect(evidence.records.map((record) => record.text).join("")).toContain("persisted-plan-ran");

    const gate = persistedPlan.gates[0]!;
    const plannedCheck = gate.checks[0]!;
    const sourceMutatingPlan = {
      ...persistedPlan,
      gates: [
        {
          ...gate,
          checks: [
            {
              ...plannedCheck,
              arguments: ["-e", "require('node:fs').writeFileSync('generated.txt', 'mutation')"],
            },
          ],
        },
      ],
    } satisfies typeof persistedPlan;
    const invalidated = yield* engine.execute({
      runId: "run-source-mutation",
      plan: sourceMutatingPlan,
      assignedWorktreeRoot: worktreeRoot,
      registeredWorktreeRoots: [worktreeRoot],
      logRoot: path.join(fixtureRoot, "logs"),
      artifactRoot: path.join(fixtureRoot, "artifacts"),
      managedRuntimeRoot: path.join(fixtureRoot, "runtime"),
      hostEnvironment: NodeProcess.env,
    });

    expect(invalidated.result).toBe("invalidated");
    expect(invalidated.sourceMutatedDuringVerification).toBe(true);
    expect(invalidated.sourceAfter.changedFiles).toContain("generated.txt");
  }).pipe(Effect.provide(TestLayer)),
);
