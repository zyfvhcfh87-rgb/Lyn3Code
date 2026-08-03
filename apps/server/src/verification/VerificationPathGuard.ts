import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

export class VerificationPathError extends Schema.TaggedErrorClass<VerificationPathError>()(
  "VerificationPathError",
  {
    reason: Schema.Literals([
      "worktree_not_registered",
      "worktree_unavailable",
      "absolute_path",
      "path_escape",
      "path_unavailable",
      "wrong_type",
    ]),
    worktreeRoot: Schema.String,
    requestedPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Verification path rejected (${this.reason}): ${this.detail}`;
  }
}

export interface AuthorizedVerificationWorktree {
  readonly requestedRoot: string;
  readonly canonicalRoot: string;
}

const pathKey = (platform: NodeJS.Platform, value: string): string =>
  platform === "win32" ? value.toLocaleLowerCase("en-US") : value;

const containedRelativePath = (path: Path.Path, root: string, candidate: string): string | null => {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
};

export class VerificationPathGuard extends Context.Service<
  VerificationPathGuard,
  {
    readonly authorizeWorktree: (input: {
      readonly assignedWorktreeRoot: string;
      readonly registeredWorktreeRoots: ReadonlyArray<string>;
    }) => Effect.Effect<AuthorizedVerificationWorktree, VerificationPathError>;
    readonly resolveDirectory: (input: {
      readonly worktree: AuthorizedVerificationWorktree;
      readonly relativePath: string;
    }) => Effect.Effect<string, VerificationPathError>;
    readonly resolveFile: (input: {
      readonly worktree: AuthorizedVerificationWorktree;
      readonly relativePath: string;
    }) => Effect.Effect<string, VerificationPathError>;
  }
>()("t3/verification/VerificationPathGuard") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostPlatform = yield* HostProcessPlatform;

  const canonicalizeRoot = Effect.fn("VerificationPathGuard.canonicalizeRoot")(function* (
    value: string,
    assignedRoot: string,
  ) {
    const resolved = path.resolve(value);
    return yield* fileSystem.realPath(resolved).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationPathError({
            reason: "worktree_unavailable",
            worktreeRoot: assignedRoot,
            requestedPath: value,
            detail: `Unable to resolve registered worktree root ${JSON.stringify(value)}.`,
            cause,
          }),
      ),
    );
  });

  const authorizeWorktree: VerificationPathGuard["Service"]["authorizeWorktree"] = Effect.fn(
    "VerificationPathGuard.authorizeWorktree",
  )(function* (input) {
    const canonicalRoot = yield* canonicalizeRoot(
      input.assignedWorktreeRoot,
      input.assignedWorktreeRoot,
    );
    const info = yield* fileSystem.stat(canonicalRoot).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationPathError({
            reason: "worktree_unavailable",
            worktreeRoot: input.assignedWorktreeRoot,
            requestedPath: input.assignedWorktreeRoot,
            detail: "The assigned worktree root is unavailable.",
            cause,
          }),
      ),
    );
    if (info.type !== "Directory") {
      return yield* new VerificationPathError({
        reason: "wrong_type",
        worktreeRoot: input.assignedWorktreeRoot,
        requestedPath: input.assignedWorktreeRoot,
        detail: "The assigned worktree root is not a directory.",
      });
    }
    const registered = yield* Effect.forEach(
      input.registeredWorktreeRoots,
      (root) => canonicalizeRoot(root, input.assignedWorktreeRoot),
      { concurrency: 4 },
    );
    if (
      !registered.some(
        (root) => pathKey(hostPlatform, root) === pathKey(hostPlatform, canonicalRoot),
      )
    ) {
      return yield* new VerificationPathError({
        reason: "worktree_not_registered",
        worktreeRoot: input.assignedWorktreeRoot,
        requestedPath: input.assignedWorktreeRoot,
        detail: "The assigned root is not one of the persisted managed worktrees.",
      });
    }
    return { requestedRoot: input.assignedWorktreeRoot, canonicalRoot };
  });

  const resolveExisting = Effect.fn("VerificationPathGuard.resolveExisting")(function* (
    worktree: AuthorizedVerificationWorktree,
    relativePath: string,
    expectedType: "Directory" | "File",
  ) {
    const requestedPath = relativePath.trim() || ".";
    if (path.isAbsolute(requestedPath)) {
      return yield* new VerificationPathError({
        reason: "absolute_path",
        worktreeRoot: worktree.canonicalRoot,
        requestedPath: relativePath,
        detail: "Verification paths must be relative to the assigned worktree.",
      });
    }
    const lexical = path.resolve(worktree.canonicalRoot, requestedPath);
    if (containedRelativePath(path, worktree.canonicalRoot, lexical) === null) {
      return yield* new VerificationPathError({
        reason: "path_escape",
        worktreeRoot: worktree.canonicalRoot,
        requestedPath: relativePath,
        detail: "The requested path lexically escapes the assigned worktree.",
      });
    }
    const canonical = yield* fileSystem.realPath(lexical).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationPathError({
            reason: "path_unavailable",
            worktreeRoot: worktree.canonicalRoot,
            requestedPath: relativePath,
            detail: "The requested path does not exist or cannot be resolved.",
            cause,
          }),
      ),
    );
    if (containedRelativePath(path, worktree.canonicalRoot, canonical) === null) {
      return yield* new VerificationPathError({
        reason: "path_escape",
        worktreeRoot: worktree.canonicalRoot,
        requestedPath: relativePath,
        detail: "The requested path resolves through a symlink or junction outside the worktree.",
      });
    }
    const info = yield* fileSystem.stat(canonical).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationPathError({
            reason: "path_unavailable",
            worktreeRoot: worktree.canonicalRoot,
            requestedPath: relativePath,
            detail: "The requested path cannot be inspected.",
            cause,
          }),
      ),
    );
    if (info.type !== expectedType) {
      return yield* new VerificationPathError({
        reason: "wrong_type",
        worktreeRoot: worktree.canonicalRoot,
        requestedPath: relativePath,
        detail: `The requested path is not a ${expectedType.toLocaleLowerCase("en-US")}.`,
      });
    }
    return canonical;
  });

  return VerificationPathGuard.of({
    authorizeWorktree,
    resolveDirectory: (input) => resolveExisting(input.worktree, input.relativePath, "Directory"),
    resolveFile: (input) => resolveExisting(input.worktree, input.relativePath, "File"),
  });
});

export const layer = Layer.effect(VerificationPathGuard, make);
