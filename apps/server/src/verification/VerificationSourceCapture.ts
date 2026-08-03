import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import type { AuthorizedVerificationWorktree } from "./VerificationPathGuard.ts";
import type { VerificationSourceState } from "./VerificationPlan.ts";

const BASE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface CapturedVerificationSource extends VerificationSourceState {
  readonly changedFiles: ReadonlyArray<string>;
  readonly statusPorcelain: string;
}

export class VerificationSourceCaptureError extends Schema.TaggedErrorClass<VerificationSourceCaptureError>()(
  "VerificationSourceCaptureError",
  {
    operation: Schema.Literals([
      "repository_root",
      "branch",
      "commit",
      "status",
      "changed_files",
      "content_hash",
      "fingerprint",
    ]),
    worktreeRoot: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Unable to capture verification source state (${this.operation}): ${this.detail}`;
  }
}

const normalizePath = (value: string): string => value.replaceAll("\\", "/");

const pathKey = (platform: NodeJS.Platform, value: string): string =>
  platform === "win32" ? value.toLocaleLowerCase("en-US") : value;

export const parseGitStatusChangedFiles = (status: string): ReadonlyArray<string> => {
  const records = status.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const statusCode = record.slice(0, 2);
    paths.add(normalizePath(record.slice(3)));
    if (/[RC]/.test(statusCode)) {
      const source = records[index + 1];
      if (source) paths.add(normalizePath(source));
      index += 1;
    }
  }
  return [...paths].sort();
};

const parseNullSeparatedPaths = (value: string): ReadonlyArray<string> =>
  value
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map(normalizePath);

export class VerificationSourceCapture extends Context.Service<
  VerificationSourceCapture,
  {
    readonly capture: (input: {
      readonly worktree: AuthorizedVerificationWorktree;
      readonly baseRef?: string;
    }) => Effect.Effect<CapturedVerificationSource, VerificationSourceCaptureError>;
  }
>()("t3/verification/VerificationSourceCapture") {}

export const make = Effect.gen(function* () {
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const hostPlatform = yield* HostProcessPlatform;

  const git = Effect.fn("VerificationSourceCapture.git")(function* (
    worktreeRoot: string,
    operation: VerificationSourceCaptureError["operation"],
    args: ReadonlyArray<string>,
    allowNonZeroExit = false,
  ) {
    return yield* vcsProcess
      .run({
        operation: `verification-${operation}`,
        command: "git",
        args,
        cwd: worktreeRoot,
        allowNonZeroExit,
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerificationSourceCaptureError({
              operation,
              worktreeRoot,
              detail: `Git command failed: git ${args.join(" ")}`,
              cause,
            }),
        ),
      );
  });

  const digest = Effect.fn("VerificationSourceCapture.digest")(function* (
    worktreeRoot: string,
    value: string,
  ) {
    return yield* crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Encoding.encodeHex),
      Effect.mapError(
        (cause) =>
          new VerificationSourceCaptureError({
            operation: "fingerprint",
            worktreeRoot,
            detail: "Unable to calculate the source-state fingerprint.",
            cause,
          }),
      ),
    );
  });

  const hashChangedPath = Effect.fn("VerificationSourceCapture.hashChangedPath")(function* (
    worktreeRoot: string,
    relativePath: string,
  ) {
    const lexical = path.resolve(worktreeRoot, relativePath);
    const relative = path.relative(worktreeRoot, lexical);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return yield* new VerificationSourceCaptureError({
        operation: "content_hash",
        worktreeRoot,
        detail: `Changed path escapes the assigned worktree: ${relativePath}`,
      });
    }
    const exists = yield* fileSystem.exists(lexical).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return `${relativePath}\0deleted`;

    const linkTarget = yield* fileSystem.readLink(lexical).pipe(Effect.option);
    if (linkTarget._tag === "Some") {
      return `${relativePath}\0symlink:${linkTarget.value}`;
    }
    const canonical = yield* fileSystem.realPath(lexical).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationSourceCaptureError({
            operation: "content_hash",
            worktreeRoot,
            detail: `Unable to resolve changed path ${relativePath}.`,
            cause,
          }),
      ),
    );
    const canonicalRelative = path.relative(worktreeRoot, canonical);
    if (
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(canonicalRelative)
    ) {
      return yield* new VerificationSourceCaptureError({
        operation: "content_hash",
        worktreeRoot,
        detail: `Changed path resolves outside the assigned worktree: ${relativePath}`,
      });
    }
    const output = yield* git(worktreeRoot, "content_hash", [
      "hash-object",
      "--no-filters",
      "--",
      relativePath,
    ]);
    return `${relativePath}\0${output.stdout.trim()}`;
  });

  const capture: VerificationSourceCapture["Service"]["capture"] = Effect.fn(
    "VerificationSourceCapture.capture",
  )(function* (input) {
    const worktreeRoot = input.worktree.canonicalRoot;
    const rootOutput = yield* git(worktreeRoot, "repository_root", [
      "rev-parse",
      "--show-toplevel",
    ]);
    const reportedRoot = yield* fileSystem.realPath(rootOutput.stdout.trim()).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationSourceCaptureError({
            operation: "repository_root",
            worktreeRoot,
            detail: "Git reported a repository root that cannot be resolved.",
            cause,
          }),
      ),
    );
    if (pathKey(hostPlatform, reportedRoot) !== pathKey(hostPlatform, worktreeRoot)) {
      return yield* new VerificationSourceCaptureError({
        operation: "repository_root",
        worktreeRoot,
        detail: `Git root ${reportedRoot} does not match the assigned worktree root.`,
      });
    }

    const [branchOutput, commitOutput, statusOutput] = yield* Effect.all(
      [
        git(worktreeRoot, "branch", ["symbolic-ref", "--quiet", "--short", "HEAD"], true),
        git(worktreeRoot, "commit", ["rev-parse", "--verify", "HEAD"], true),
        git(worktreeRoot, "status", [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ]),
      ],
      { concurrency: 3 },
    );
    const branchName = branchOutput.exitCode === 0 ? branchOutput.stdout.trim() : "HEAD";
    const commitHash = commitOutput.exitCode === 0 ? commitOutput.stdout.trim() : null;
    const statusPorcelain = statusOutput.stdout;
    const changed = new Set(parseGitStatusChangedFiles(statusPorcelain));

    if (input.baseRef !== undefined) {
      if (!BASE_REF_PATTERN.test(input.baseRef) || input.baseRef.startsWith("-")) {
        return yield* new VerificationSourceCaptureError({
          operation: "changed_files",
          worktreeRoot,
          detail: `Invalid base ref: ${input.baseRef}`,
        });
      }
      const committedOutput = yield* git(worktreeRoot, "changed_files", [
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=ACDMRTUXB",
        `${input.baseRef}...HEAD`,
        "--",
      ]);
      for (const filePath of parseNullSeparatedPaths(committedOutput.stdout)) changed.add(filePath);
    }

    const changedFiles = [...changed].sort();
    const contentHashes = yield* Effect.forEach(
      changedFiles,
      (filePath) => hashChangedPath(worktreeRoot, filePath),
      { concurrency: 4 },
    );
    const dirtyStateFingerprint =
      statusPorcelain.length === 0
        ? null
        : yield* digest(worktreeRoot, `${statusPorcelain}\0${contentHashes.join("\0")}`);
    const sourceFingerprint = yield* digest(
      worktreeRoot,
      `${commitHash ?? "unborn"}\0${dirtyStateFingerprint ?? "clean"}`,
    );
    return {
      worktreeRoot,
      branchName,
      commitHash,
      dirtyStateFingerprint,
      sourceFingerprint,
      changedFiles,
      statusPorcelain,
    } satisfies CapturedVerificationSource;
  });

  return VerificationSourceCapture.of({ capture });
});

export const layer = Layer.effect(VerificationSourceCapture, make).pipe(
  Layer.provide(VcsProcess.layer),
);
