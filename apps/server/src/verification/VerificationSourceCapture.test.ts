// @effect-diagnostics nodeBuiltinImport:off - test fixtures use disposable Git repositories.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as PathGuard from "./VerificationPathGuard.ts";
import * as SourceCapture from "./VerificationSourceCapture.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(PathGuard.layer),
  Layer.provideMerge(SourceCapture.layer),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

it.layer(TestLayer)("VerificationSourceCapture", (it) => {
  it.effect("captures exact clean and dirty fingerprints in a disposable repository", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const guard = yield* PathGuard.VerificationPathGuard;
      const capture = yield* SourceCapture.VerificationSourceCapture;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-verification-git-" });
      git(root, ["init", "-b", "agent/task"]);
      git(root, ["config", "user.email", "verification@example.test"]);
      git(root, ["config", "user.name", "Verification Test"]);
      yield* fileSystem.writeFileString(path.join(root, "source.ts"), "export const value = 1;\n");
      git(root, ["add", "source.ts"]);
      git(root, ["commit", "-m", "initial"]);
      const worktree = yield* guard.authorizeWorktree({
        assignedWorktreeRoot: root,
        registeredWorktreeRoots: [root],
      });

      const clean = yield* capture.capture({ worktree });
      expect(clean.branchName).toBe("agent/task");
      expect(clean.commitHash).toMatch(/^[a-f0-9]{40}$/u);
      expect(clean.dirtyStateFingerprint).toBeNull();

      yield* fileSystem.writeFileString(path.join(root, "source.ts"), "export const value = 2;\n");
      yield* fileSystem.writeFileString(path.join(root, "new.ts"), "export const added = true;\n");
      const dirty = yield* capture.capture({ worktree });

      expect(dirty.changedFiles).toEqual(["new.ts", "source.ts"]);
      expect(dirty.dirtyStateFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(dirty.sourceFingerprint).not.toBe(clean.sourceFingerprint);
    }),
  );

  it.effect("rejects a registered-root mismatch and lexical working-directory escape", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const guard = yield* PathGuard.VerificationPathGuard;
      const assigned = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-verification-a-" });
      const other = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-verification-b-" });

      const mismatch = yield* guard
        .authorizeWorktree({ assignedWorktreeRoot: assigned, registeredWorktreeRoots: [other] })
        .pipe(Effect.flip);
      expect(mismatch.reason).toBe("worktree_not_registered");

      const worktree = yield* guard.authorizeWorktree({
        assignedWorktreeRoot: assigned,
        registeredWorktreeRoots: [assigned],
      });
      const escape = yield* guard
        .resolveDirectory({ worktree, relativePath: "../" })
        .pipe(Effect.flip);
      expect(escape.reason).toBe("path_escape");
    }),
  );
});
