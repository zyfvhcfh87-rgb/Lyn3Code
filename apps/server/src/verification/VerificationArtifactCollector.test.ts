// @effect-diagnostics nodeBuiltinImport:off - symlink/junction fixtures are disposable.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as ArtifactCollector from "./VerificationArtifactCollector.ts";
import * as PathGuard from "./VerificationPathGuard.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ArtifactCollector.layer),
  Layer.provideMerge(PathGuard.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("VerificationArtifactCollector", (it) => {
  it.effect("collects bounded text evidence with checksum and secret redaction", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const guard = yield* PathGuard.VerificationPathGuard;
      const collector = yield* ArtifactCollector.VerificationArtifactCollector;
      const worktreeRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-artifact-worktree-",
      });
      const artifactRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-artifact-store-",
      });
      yield* fileSystem.makeDirectory(path.join(worktreeRoot, "reports"));
      yield* fileSystem.writeFileString(
        path.join(worktreeRoot, "reports", "result.json"),
        `{ "token": "artifact-secret-value", "passed": true }`,
      );
      const worktree = yield* guard.authorizeWorktree({
        assignedWorktreeRoot: worktreeRoot,
        registeredWorktreeRoots: [worktreeRoot],
      });

      const artifacts = yield* collector.collect({
        worktree,
        artifactRoot,
        runId: "verification-run:1",
        checkRunId: "verification-check:report",
        rules: [{ pattern: "reports/*.json", type: "test_result", required: true }],
        secrets: ["artifact-secret-value"],
      });
      const stored = yield* fileSystem.readFileString(path.join(artifactRoot, artifacts[0]!.path));

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifacts[0]?.metadata.redacted).toBe(true);
      expect(stored).toContain("[REDACTED]");
      expect(stored).not.toContain("artifact-secret-value");
    }),
  );

  it.effect("rejects traversal, symlink escape, and per-file caps", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const hostPlatform = yield* HostProcessPlatform;
      const guard = yield* PathGuard.VerificationPathGuard;
      const collector = yield* ArtifactCollector.VerificationArtifactCollector;
      const worktreeRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-artifact-safety-",
      });
      const artifactRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-artifact-output-",
      });
      const outside = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lyn-verification-artifact-outside-",
      });
      yield* fileSystem.makeDirectory(path.join(worktreeRoot, "reports"));
      yield* fileSystem.writeFileString(path.join(worktreeRoot, "reports", "large.txt"), "123456");
      yield* fileSystem.writeFileString(path.join(outside, "private.txt"), "outside");
      NodeFS.symlinkSync(
        outside,
        path.join(worktreeRoot, "reports", "external"),
        hostPlatform === "win32" ? "junction" : "dir",
      );
      const worktree = yield* guard.authorizeWorktree({
        assignedWorktreeRoot: worktreeRoot,
        registeredWorktreeRoots: [worktreeRoot],
      });
      const base = {
        worktree,
        artifactRoot,
        secrets: [],
      } as const;

      const traversal = yield* collector
        .collect({
          ...base,
          runId: "run-traversal",
          checkRunId: "check",
          rules: [{ pattern: "../*", type: "custom", required: false }],
        })
        .pipe(Effect.flip);
      expect(traversal.reason).toBe("invalid_pattern");

      const symlink = yield* collector
        .collect({
          ...base,
          runId: "run-symlink",
          checkRunId: "check",
          rules: [{ pattern: "reports/**", type: "custom", required: false }],
        })
        .pipe(Effect.flip);
      expect(symlink.reason).toBe("unsafe_path");

      const cap = yield* collector
        .collect({
          ...base,
          runId: "run-cap",
          checkRunId: "check",
          rules: [{ pattern: "reports/large.txt", type: "custom", required: true, maxBytes: 3 }],
        })
        .pipe(Effect.flip);
      expect(cap.reason).toBe("file_too_large");
    }),
  );
});
