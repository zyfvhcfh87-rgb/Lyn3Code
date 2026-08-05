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

import * as ProcessRunner from "../verification/VerificationProcessRunner.ts";
import { makeRepositoryScriptDeploymentAdapter } from "./RepositoryScriptDeploymentAdapter.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(NodeServices.layer),
);

const startInput = (root: string) => ({
  deploymentId: "deployment-1",
  executionId: "deployment-1:execution-1",
  idempotencyKey: "idempotency-1",
  sourceFingerprint: "a".repeat(64),
  sourceCommitSha: "b".repeat(40),
  strategy: "standard" as const,
  hostEnvironment: { PATH: NodeProcess.env.PATH, DEPLOY_TEST_TOKEN: "split-secret-value" },
  managedHome: `${root}/home`,
  managedTemp: `${root}/temp`,
});

describe("RepositoryScriptDeploymentAdapter", () => {
  it.live("uses fixed argv and redacts secrets before returning or publishing logs", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-delivery-script-" });
      const observed: Array<string> = [];
      const adapter = yield* makeRepositoryScriptDeploymentAdapter({
        executable: NodeProcess.execPath,
        args: ["-e", "process.stdout.write(`token=${process.env.DEPLOY_TOKEN}\\n`)"],
        workingDirectory: root,
        timeoutSeconds: 10,
        environment: [
          {
            name: "DEPLOY_TOKEN",
            source: "host_environment",
            fromEnvironment: "DEPLOY_TEST_TOKEN",
            sensitive: true,
          },
        ],
      });
      const result = yield* adapter.start({
        ...startInput(root),
        managedHome: path.join(root, "home"),
        managedTemp: path.join(root, "temp"),
        onLog: (entry) => Effect.sync(() => observed.push(entry.text)),
      });

      expect(result.status).toBe("succeeded");
      expect(result.logText).toContain("[REDACTED]");
      expect(result.logText).not.toContain("split-secret-value");
      expect(observed.join("")).not.toContain("split-secret-value");
      expect(NodeProcess.env.DEPLOY_TOKEN).toBeUndefined();
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("cancels only its captured execution and advertises no rollback", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-delivery-cancel-" });
      const started = yield* Deferred.make<void>();
      const adapter = yield* makeRepositoryScriptDeploymentAdapter({
        executable: NodeProcess.execPath,
        args: ["-e", "process.stdout.write('started\\n'); setInterval(() => {}, 1000)"],
        workingDirectory: root,
        timeoutSeconds: 30,
      });
      const fiber = yield* adapter
        .start({
          ...startInput(root),
          onLog: () => Deferred.succeed(started, undefined).pipe(Effect.asVoid),
        })
        .pipe(Effect.forkChild);

      yield* Deferred.await(started);
      expect(adapter.capabilities.rollback).toBe(false);
      expect(adapter.rollback).toBeUndefined();
      expect(
        yield* adapter.cancel!({
          deploymentId: "deployment-1",
          executionId: "deployment-1:execution-1",
          providerDeploymentId: null,
        }),
      ).toBe(true);
      const result = yield* Fiber.join(fiber);
      expect(result.status).toBe("cancelled");
      expect(
        yield* adapter.cancel!({
          deploymentId: "unrelated",
          executionId: "unrelated",
          providerDeploymentId: null,
        }),
      ).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );
});
