// @effect-diagnostics nodeBuiltinImport:off - tests launch only the current Node executable.
import * as NodeProcess from "node:process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as LogStore from "./VerificationLogStore.ts";
import * as ProcessRunner from "./VerificationProcessRunner.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(LogStore.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(NodeServices.layer),
);

describe("VerificationProcessRunner", () => {
  it.effect(
    "redacts secret-looking host references even when config marks them non-sensitive",
    () =>
      Effect.gen(function* () {
        const result = yield* ProcessRunner.buildVerificationProcessEnvironment({
          hostEnvironment: { UNTRUSTED_API_TOKEN: "must-still-be-redacted" },
          configured: [
            {
              name: "PUBLIC_VALUE",
              source: "host_environment",
              fromEnvironment: "UNTRUSTED_API_TOKEN",
              sensitive: false,
            },
          ],
          managedHome: "managed-home",
          managedTemp: "managed-temp",
          platform: NodeProcess.platform,
        });

        expect(result.environment.PUBLIC_VALUE).toBe("must-still-be-redacted");
        expect(result.secrets).toContain("must-still-be-redacted");
        expect(result.summary.PUBLIC_VALUE).toBe("host_environment");
      }),
  );

  it.live("times out an exact process tree while preserving partial redacted logs", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runner = yield* ProcessRunner.VerificationProcessRunner;
      const logs = yield* LogStore.VerificationLogStore;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-timeout-",
      });
      const logRoot = path.join(root, "logs");
      const writer = yield* logs.open({
        rootDirectory: logRoot,
        runId: "timeout-run",
        checkRunId: "hanging-check",
        secrets: ["split-secret-value"],
      });
      const environment = yield* ProcessRunner.buildVerificationProcessEnvironment({
        hostEnvironment: NodeProcess.env,
        configured: [],
        managedHome: path.join(root, "home"),
        managedTemp: path.join(root, "temp"),
        platform: NodeProcess.platform,
      });

      const result = yield* runner.run({
        executionId: "timeout-run:hanging-check",
        executable: NodeProcess.execPath,
        args: [
          "-e",
          "process.stdout.write('partial split-secret-value\\n'); setInterval(() => {}, 1000)",
        ],
        cwd: root,
        environment: environment.environment,
        timeoutSeconds: 1,
        onOutput: (chunk) =>
          writer.append(chunk).pipe(
            Effect.mapError(
              (cause) =>
                new ProcessRunner.VerificationProcessError({
                  reason: "output_failed",
                  executionId: "timeout-run:hanging-check",
                  command: NodeProcess.execPath,
                  detail: cause.message,
                  cause,
                }),
            ),
            Effect.asVoid,
          ),
      });
      yield* writer.close();
      const page = yield* logs.read({ rootDirectory: logRoot, logReference: writer.logReference });
      const evidence = page.records.map((record) => record.text).join("");

      expect(result.timedOut).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(evidence).toContain("partial");
      expect(evidence).toContain("[REDACTED]");
      expect(evidence).not.toContain("split-secret-value");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("cancels only the captured execution after observing output", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runner = yield* ProcessRunner.VerificationProcessRunner;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-cancel-",
      });
      const observed = yield* Deferred.make<void>();
      const environment = yield* ProcessRunner.buildVerificationProcessEnvironment({
        hostEnvironment: NodeProcess.env,
        configured: [],
        managedHome: path.join(root, "home"),
        managedTemp: path.join(root, "temp"),
        platform: NodeProcess.platform,
      });
      const executionId = "cancel-run:active-check";
      const fiber = yield* runner
        .run({
          executionId,
          executable: NodeProcess.execPath,
          args: ["-e", "process.stdout.write('started\\n'); setInterval(() => {}, 1000)"],
          cwd: root,
          environment: environment.environment,
          timeoutSeconds: 30,
          onOutput: () => Deferred.succeed(observed, undefined).pipe(Effect.asVoid),
        })
        .pipe(Effect.forkChild);

      yield* Deferred.await(observed);
      expect(yield* runner.cancel(executionId)).toBe(true);
      const result = yield* Fiber.join(fiber);

      expect(result.cancelled).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(yield* runner.cancel("unrelated-execution")).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("classifies an unavailable executable as a spawn failure", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runner = yield* ProcessRunner.VerificationProcessRunner;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-missing-runtime-",
      });
      const environment = yield* ProcessRunner.buildVerificationProcessEnvironment({
        hostEnvironment: NodeProcess.env,
        configured: [],
        managedHome: path.join(root, "home"),
        managedTemp: path.join(root, "temp"),
        platform: NodeProcess.platform,
      });

      const error = yield* runner
        .run({
          executionId: "missing-runtime:check",
          executable: "lyn-verification-runtime-that-does-not-exist-3f37f0",
          args: [],
          cwd: root,
          environment: environment.environment,
          timeoutSeconds: 5,
          onOutput: () => Effect.void,
        })
        .pipe(Effect.flip);

      expect(error.reason).toBe("spawn_failed");
      expect(error.message).toContain("could not be started");
    }).pipe(Effect.provide(TestLayer)),
  );
});
