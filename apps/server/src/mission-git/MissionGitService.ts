import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/i;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const CONFLICT_STATUS_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export type ManagedGitErrorCode =
  | "path-not-found"
  | "not-a-repository"
  | "repository-busy"
  | "invalid-ref"
  | "invalid-branch"
  | "branch-collision"
  | "path-collision"
  | "path-overlap"
  | "unknown-worktree"
  | "active-worktree"
  | "dirty-worktree"
  | "conflicted-worktree"
  | "unintegrated-commits"
  | "protected-branch"
  | "approval-required"
  | "integration-head-changed"
  | "git-command-failed";

export class ManagedGitError extends Data.TaggedError("ManagedGitError")<{
  readonly code: ManagedGitErrorCode;
  readonly operation: string;
  readonly detail: string;
  readonly repositoryPath?: string;
  readonly worktreePath?: string;
  readonly conflictingFiles?: ReadonlyArray<string>;
  readonly cause?: unknown;
}> {}

export type RepositoryOperation =
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert"
  | "bisect"
  | "sequencer";

export interface ManagedWorktreeInfo {
  readonly path: string;
  readonly headCommit: string | null;
  readonly branch: string | null;
  readonly isMain: boolean;
  readonly isBare: boolean;
  readonly isDetached: boolean;
  readonly lockedReason: string | null;
  readonly prunableReason: string | null;
}

export interface ResolvedGitRef {
  readonly refName: string;
  readonly commit: string;
}

export interface RepositoryInspection {
  readonly repositoryPath: string;
  readonly repositoryRoot: string;
  readonly gitCommonDir: string;
  readonly currentBranch: string | null;
  readonly headCommit: string;
  readonly defaultBranch: ResolvedGitRef;
  readonly isDirty: boolean;
  readonly changedPaths: ReadonlyArray<string>;
  readonly inProgressOperation: RepositoryOperation | null;
  readonly worktrees: ReadonlyArray<ManagedWorktreeInfo>;
}

export interface ManagedWorktreeNames {
  readonly branchName: string;
  readonly directoryName: string;
}

export interface CreateManagedWorktreeInput {
  readonly repositoryPath: string;
  readonly worktreesRoot: string;
  readonly missionName: string;
  readonly taskName: string;
  readonly shortId: string;
  readonly baseRef?: string;
  readonly branchName?: string;
  readonly worktreePath?: string;
  readonly kind?: "task" | "integration";
}

export interface ManagedWorktreeCreation {
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly mainWorktreeDirty: boolean;
}

export interface WorktreeStatus {
  readonly path: string;
  readonly exists: boolean;
  readonly registered: boolean;
  readonly branch: string | null;
  readonly headCommit: string | null;
  readonly isDirty: boolean;
  readonly hasUntrackedFiles: boolean;
  readonly hasConflicts: boolean;
  readonly changedPaths: ReadonlyArray<string>;
  readonly conflictingFiles: ReadonlyArray<string>;
  readonly inProgressOperation: RepositoryOperation | null;
  readonly commitsAheadOfIntegration: number | null;
  readonly integrated: boolean | null;
}

export interface ConflictPreflight {
  readonly mergeBase: string;
  readonly integrationCommit: string;
  readonly taskCommit: string;
  readonly hasConflicts: boolean;
  readonly conflictingFiles: ReadonlyArray<string>;
}

export type IntegrationResult =
  | {
      readonly status: "merged";
      readonly integrationBranch: string;
      readonly taskBranch: string;
      readonly previousHeadCommit: string;
      readonly headCommit: string;
      readonly taskHeadCommit: string;
      readonly changedFiles: ReadonlyArray<string>;
    }
  | {
      readonly status: "already-integrated";
      readonly integrationBranch: string;
      readonly taskBranch: string;
      readonly headCommit: string;
      readonly taskHeadCommit: string;
      readonly changedFiles: ReadonlyArray<string>;
    }
  | {
      readonly status: "conflicted";
      readonly integrationBranch: string;
      readonly taskBranch: string;
      readonly integrationHeadCommit: string;
      readonly taskHeadCommit: string;
      readonly conflictingFiles: ReadonlyArray<string>;
      readonly mergeStarted: boolean;
    };

export interface ManagedWorktreeExpectation {
  readonly id: string;
  readonly path: string;
  readonly branchName: string;
}

export type ManagedWorktreeReconciliationState =
  | "healthy"
  | "missing"
  | "moved"
  | "branch-mismatch"
  | "prunable";

export interface ManagedWorktreeReconciliation {
  readonly id: string;
  readonly expectedPath: string;
  readonly actualPath: string | null;
  readonly expectedBranch: string;
  readonly actualBranch: string | null;
  readonly state: ManagedWorktreeReconciliationState;
}

export interface ReconcileManagedWorktreesResult {
  readonly managed: ReadonlyArray<ManagedWorktreeReconciliation>;
  readonly unknownManagedWorktrees: ReadonlyArray<ManagedWorktreeInfo>;
}

export interface PruneManagedWorktreesResult {
  readonly prunablePaths: ReadonlyArray<string>;
  readonly pruned: boolean;
}

export function sanitizeManagedGitSegment(value: string, fallback: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-._]+$/g, "")
    .replace(/^[-._]+/g, "")
    .slice(0, 48)
    .replace(/[-._]+$/g, "");
  const safe = ascii.length > 0 ? ascii : fallback;
  return WINDOWS_RESERVED_SEGMENT.test(safe) ? `${safe}-managed` : safe;
}

export function makeManagedWorktreeNames(input: {
  readonly missionName: string;
  readonly taskName: string;
  readonly shortId: string;
  readonly kind?: "task" | "integration";
}): ManagedWorktreeNames {
  const mission = sanitizeManagedGitSegment(input.missionName, "mission");
  const task = sanitizeManagedGitSegment(input.taskName, "task");
  const shortId = sanitizeManagedGitSegment(input.shortId, "run").slice(0, 16);
  const leaf = input.kind === "integration" ? `integration-${shortId}` : `${task}-${shortId}`;
  return {
    branchName: `agent/${mission}/${leaf}`,
    directoryName: `${mission}-${leaf}`.slice(0, 96).replace(/[-._]+$/g, ""),
  };
}

interface PorcelainStatus {
  readonly changedPaths: ReadonlyArray<string>;
  readonly conflictingFiles: ReadonlyArray<string>;
  readonly hasUntrackedFiles: boolean;
}

function parseStatusPorcelain(stdout: string): PorcelainStatus {
  const changedPaths: string[] = [];
  const conflictingFiles: string[] = [];
  let hasUntrackedFiles = false;
  const records = stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 3) continue;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (filePath.length > 0) changedPaths.push(filePath);
    if (status === "??") hasUntrackedFiles = true;
    if (CONFLICT_STATUS_CODES.has(status) && filePath.length > 0) conflictingFiles.push(filePath);
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return {
    changedPaths: [...new Set(changedPaths)].sort(),
    conflictingFiles: [...new Set(conflictingFiles)].sort(),
    hasUntrackedFiles,
  };
}

function parseWorktreeList(stdout: string): ReadonlyArray<Omit<ManagedWorktreeInfo, "isMain">> {
  const entries: Array<Omit<ManagedWorktreeInfo, "isMain">> = [];
  let current:
    | {
        path: string;
        headCommit: string | null;
        branch: string | null;
        isBare: boolean;
        isDetached: boolean;
        lockedReason: string | null;
        prunableReason: string | null;
      }
    | undefined;
  const flush = () => {
    if (current !== undefined) entries.push(current);
    current = undefined;
  };
  for (const token of stdout.split("\0")) {
    if (token === "") {
      flush();
      continue;
    }
    if (token.startsWith("worktree ")) {
      flush();
      current = {
        path: token.slice("worktree ".length),
        headCommit: null,
        branch: null,
        isBare: false,
        isDetached: false,
        lockedReason: null,
        prunableReason: null,
      };
      continue;
    }
    if (!current) continue;
    if (token.startsWith("HEAD ")) current.headCommit = token.slice("HEAD ".length);
    else if (token.startsWith("branch refs/heads/")) {
      current.branch = token.slice("branch refs/heads/".length);
    } else if (token === "bare") current.isBare = true;
    else if (token === "detached") current.isDetached = true;
    else if (token === "locked") current.lockedReason = "locked";
    else if (token.startsWith("locked ")) current.lockedReason = token.slice("locked ".length);
    else if (token === "prunable") current.prunableReason = "prunable";
    else if (token.startsWith("prunable ")) {
      current.prunableReason = token.slice("prunable ".length);
    }
  }
  flush();
  return entries;
}

export class MissionGitService extends Context.Service<
  MissionGitService,
  {
    readonly inspectRepository: (input: {
      readonly repositoryPath: string;
    }) => Effect.Effect<RepositoryInspection, ManagedGitError>;
    readonly validateRepository: (input: {
      readonly repositoryPath: string;
      readonly baseRef?: string;
    }) => Effect.Effect<RepositoryInspection & { readonly base: ResolvedGitRef }, ManagedGitError>;
    readonly resolveDefaultBranch: (
      repositoryPath: string,
    ) => Effect.Effect<ResolvedGitRef, ManagedGitError>;
    readonly getCurrentBranch: (
      repositoryPath: string,
    ) => Effect.Effect<string | null, ManagedGitError>;
    readonly getHeadCommit: (repositoryPath: string) => Effect.Effect<string, ManagedGitError>;
    readonly listWorktrees: (
      repositoryPath: string,
    ) => Effect.Effect<ReadonlyArray<ManagedWorktreeInfo>, ManagedGitError>;
    readonly createManagedWorktree: (
      input: CreateManagedWorktreeInput,
    ) => Effect.Effect<ManagedWorktreeCreation, ManagedGitError>;
    readonly createMissionIntegrationBranch: (
      input: Omit<CreateManagedWorktreeInput, "taskName" | "kind">,
    ) => Effect.Effect<ManagedWorktreeCreation, ManagedGitError>;
    readonly inspectWorktreeStatus: (input: {
      readonly repositoryPath: string;
      readonly worktreePath: string;
      readonly integrationRef?: string;
    }) => Effect.Effect<WorktreeStatus, ManagedGitError>;
    readonly calculateMergeBase: (input: {
      readonly repositoryPath: string;
      readonly leftRef: string;
      readonly rightRef: string;
    }) => Effect.Effect<string, ManagedGitError>;
    readonly detectChangedFiles: (input: {
      readonly repositoryPath: string;
      readonly baseRef: string;
      readonly headRef: string;
    }) => Effect.Effect<ReadonlyArray<string>, ManagedGitError>;
    readonly detectConflicts: (input: {
      readonly repositoryPath: string;
      readonly integrationRef: string;
      readonly taskRef: string;
    }) => Effect.Effect<ConflictPreflight, ManagedGitError>;
    readonly integrateTaskBranch: (input: {
      readonly repositoryPath: string;
      readonly integrationWorktreePath: string;
      readonly integrationBranch: string;
      readonly taskBranch: string;
      readonly approved: boolean;
      readonly expectedIntegrationHeadCommit?: string;
      readonly expectedTaskHeadCommit?: string;
    }) => Effect.Effect<IntegrationResult, ManagedGitError>;
    readonly abortIntegration: (input: {
      readonly repositoryPath: string;
      readonly integrationWorktreePath: string;
      readonly integrationBranch: string;
    }) => Effect.Effect<boolean, ManagedGitError>;
    readonly removeManagedWorktree: (input: {
      readonly repositoryPath: string;
      readonly worktreesRoot: string;
      readonly worktreePath: string;
      readonly integratedIntoRef: string;
      readonly active: boolean;
      readonly expectedBranch?: string;
    }) => Effect.Effect<{ readonly branch: string; readonly headCommit: string }, ManagedGitError>;
    readonly pruneManagedWorktrees: (input: {
      readonly repositoryPath: string;
      readonly worktreesRoot: string;
      readonly expectedOrphanPaths: ReadonlyArray<string>;
      readonly activeWorktreePaths: ReadonlyArray<string>;
      readonly approved: boolean;
    }) => Effect.Effect<PruneManagedWorktreesResult, ManagedGitError>;
    readonly reconcileManagedWorktrees: (input: {
      readonly repositoryPath: string;
      readonly worktreesRoot: string;
      readonly managedWorktrees: ReadonlyArray<ManagedWorktreeExpectation>;
    }) => Effect.Effect<ReconcileManagedWorktreesResult, ManagedGitError>;
  }
>()("t3/mission-git/MissionGitService") {}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostPlatform = yield* HostProcessPlatform;

  const fail = (
    code: ManagedGitErrorCode,
    operation: string,
    detail: string,
    extras: Partial<Omit<ManagedGitError, "_tag" | "code" | "operation" | "detail">> = {},
  ) => new ManagedGitError({ code, operation, detail, ...extras });

  const execute = Effect.fn("MissionGitService.execute")(function* (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly allowNonZeroExit?: boolean;
  }) {
    return yield* git
      .execute({
        operation: `MissionGitService.${input.operation}`,
        cwd: input.cwd,
        args: input.args,
        ...(input.allowNonZeroExit === undefined
          ? {}
          : { allowNonZeroExit: input.allowNonZeroExit }),
        timeoutMs: 30_000,
        maxOutputBytes: 4 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError((cause) =>
          fail("git-command-failed", input.operation, "Git command failed.", {
            repositoryPath: input.cwd,
            cause,
          }),
        ),
      );
  });

  const canonicalizePotentialPath = Effect.fn("MissionGitService.canonicalizePotentialPath")(
    function* (value: string) {
      const resolved = path.normalize(path.resolve(value));
      let cursor = resolved;
      const suffix: string[] = [];
      for (;;) {
        if (yield* fileSystem.exists(cursor).pipe(Effect.orElseSucceed(() => false))) {
          const real = yield* fileSystem.realPath(cursor).pipe(Effect.orElseSucceed(() => cursor));
          return path.normalize(path.resolve(real, ...suffix));
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) return resolved;
        suffix.unshift(path.basename(cursor));
        cursor = parent;
      }
    },
  );

  const comparablePath = (value: string) =>
    hostPlatform === "win32" ? value.toLocaleLowerCase("en-US") : value;

  const isWithin = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };

  const pathsOverlap = (left: string, right: string) => {
    const normalizedLeft = comparablePath(left);
    const normalizedRight = comparablePath(right);
    return isWithin(normalizedLeft, normalizedRight) || isWithin(normalizedRight, normalizedLeft);
  };

  const resolveCommit = Effect.fn("MissionGitService.resolveCommit")(function* (
    repositoryPath: string,
    refName: string,
    operation: string,
  ) {
    const normalizedRef = refName.trim();
    if (normalizedRef.length === 0 || normalizedRef.startsWith("-")) {
      return yield* fail("invalid-ref", operation, `Invalid Git ref '${refName}'.`, {
        repositoryPath,
      });
    }
    const result = yield* execute({
      operation,
      cwd: repositoryPath,
      args: ["rev-parse", "--verify", "--end-of-options", `${normalizedRef}^{commit}`],
      allowNonZeroExit: true,
    });
    const commit = result.stdout.trim();
    if (result.exitCode !== 0 || !COMMIT_PATTERN.test(commit)) {
      return yield* fail("invalid-ref", operation, `Git ref '${normalizedRef}' does not exist.`, {
        repositoryPath,
      });
    }
    return commit.toLowerCase();
  });

  const getCurrentBranch = Effect.fn("MissionGitService.getCurrentBranch")(function* (
    repositoryPath: string,
  ) {
    const result = yield* execute({
      operation: "getCurrentBranch",
      cwd: repositoryPath,
      args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
      allowNonZeroExit: true,
    });
    if (result.exitCode !== 0) return null;
    const branch = result.stdout.trim();
    return branch.length > 0 ? branch : null;
  });

  const getHeadCommit = Effect.fn("MissionGitService.getHeadCommit")(function* (
    repositoryPath: string,
  ) {
    return yield* resolveCommit(repositoryPath, "HEAD", "getHeadCommit");
  });

  const resolveDefaultBranch = Effect.fn("MissionGitService.resolveDefaultBranch")(function* (
    repositoryPath: string,
  ) {
    const remoteHead = yield* execute({
      operation: "resolveDefaultBranch.remoteHead",
      cwd: repositoryPath,
      args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      allowNonZeroExit: true,
    });
    const candidates: string[] = [];
    const remoteHeadName = remoteHead.exitCode === 0 ? remoteHead.stdout.trim() : "";
    if (remoteHeadName.startsWith("origin/")) {
      const localName = remoteHeadName.slice("origin/".length);
      candidates.push(localName, remoteHeadName);
    }
    candidates.push("main", "master");
    const currentBranch = yield* getCurrentBranch(repositoryPath);
    if (currentBranch !== null) candidates.push(currentBranch);

    for (const candidate of new Set(candidates)) {
      const result = yield* execute({
        operation: "resolveDefaultBranch.candidate",
        cwd: repositoryPath,
        args: ["rev-parse", "--verify", "--end-of-options", `${candidate}^{commit}`],
        allowNonZeroExit: true,
      });
      const commit = result.stdout.trim();
      if (result.exitCode === 0 && COMMIT_PATTERN.test(commit)) {
        return { refName: candidate, commit: commit.toLowerCase() } satisfies ResolvedGitRef;
      }
    }
    return yield* fail(
      "invalid-ref",
      "resolveDefaultBranch",
      "Could not resolve a default branch from origin/HEAD, main, master, or the current branch.",
      { repositoryPath },
    );
  });

  const detectInProgressOperation = Effect.fn("MissionGitService.detectInProgressOperation")(
    function* (cwd: string) {
      const markers: ReadonlyArray<readonly [RepositoryOperation, string]> = [
        ["merge", "MERGE_HEAD"],
        ["rebase", "rebase-merge"],
        ["rebase", "rebase-apply"],
        ["cherry-pick", "CHERRY_PICK_HEAD"],
        ["revert", "REVERT_HEAD"],
        ["bisect", "BISECT_LOG"],
        ["sequencer", "sequencer"],
      ];
      for (const [operation, marker] of markers) {
        const result = yield* execute({
          operation: "detectInProgressOperation",
          cwd,
          args: ["rev-parse", "--git-path", marker],
        });
        const markerPath = path.isAbsolute(result.stdout.trim())
          ? result.stdout.trim()
          : path.resolve(cwd, result.stdout.trim());
        if (yield* fileSystem.exists(markerPath).pipe(Effect.orElseSucceed(() => false))) {
          return operation;
        }
      }
      return null;
    },
  );

  const readStatus = Effect.fn("MissionGitService.readStatus")(function* (cwd: string) {
    const result = yield* execute({
      operation: "readStatus",
      cwd,
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    });
    return parseStatusPorcelain(result.stdout);
  });

  const listWorktrees = Effect.fn("MissionGitService.listWorktrees")(function* (
    repositoryPath: string,
  ) {
    const result = yield* execute({
      operation: "listWorktrees",
      cwd: repositoryPath,
      args: ["worktree", "list", "--porcelain", "-z"],
    });
    const parsed = parseWorktreeList(result.stdout);
    const canonical = yield* Effect.forEach(parsed, (entry) =>
      canonicalizePotentialPath(entry.path).pipe(
        Effect.map((canonicalPath) => ({ ...entry, path: canonicalPath })),
      ),
    );
    const mainPath = canonical[0]?.path ?? null;
    return canonical.map((entry) => ({
      ...entry,
      isMain: mainPath !== null && comparablePath(entry.path) === comparablePath(mainPath),
    })) satisfies ReadonlyArray<ManagedWorktreeInfo>;
  });

  const assertRepository = Effect.fn("MissionGitService.assertRepository")(function* (
    repositoryPath: string,
  ) {
    const canonical = yield* canonicalizePotentialPath(repositoryPath);
    if (!(yield* fileSystem.exists(canonical).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* fail("path-not-found", "inspectRepository", "Repository path does not exist.", {
        repositoryPath: canonical,
      });
    }
    const inside = yield* execute({
      operation: "inspectRepository.isInside",
      cwd: canonical,
      args: ["rev-parse", "--is-inside-work-tree"],
      allowNonZeroExit: true,
    });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
      return yield* fail("not-a-repository", "inspectRepository", "Path is not a Git worktree.", {
        repositoryPath: canonical,
      });
    }
    const rootResult = yield* execute({
      operation: "inspectRepository.root",
      cwd: canonical,
      args: ["rev-parse", "--show-toplevel"],
    });
    const commonResult = yield* execute({
      operation: "inspectRepository.commonDir",
      cwd: canonical,
      args: ["rev-parse", "--git-common-dir"],
    });
    const repositoryRoot = yield* canonicalizePotentialPath(rootResult.stdout.trim());
    const rawCommonDir = commonResult.stdout.trim();
    const gitCommonDir = yield* canonicalizePotentialPath(
      path.isAbsolute(rawCommonDir) ? rawCommonDir : path.resolve(canonical, rawCommonDir),
    );
    return { repositoryPath: canonical, repositoryRoot, gitCommonDir };
  });

  const inspectRepository = Effect.fn("MissionGitService.inspectRepository")(function* (input: {
    readonly repositoryPath: string;
  }) {
    const repository = yield* assertRepository(input.repositoryPath);
    const [currentBranch, headCommit, defaultBranch, status, inProgressOperation, worktrees] =
      yield* Effect.all([
        getCurrentBranch(repository.repositoryRoot),
        getHeadCommit(repository.repositoryRoot),
        resolveDefaultBranch(repository.repositoryRoot),
        readStatus(repository.repositoryRoot),
        detectInProgressOperation(repository.repositoryRoot),
        listWorktrees(repository.repositoryRoot),
      ]);
    return {
      ...repository,
      currentBranch,
      headCommit,
      defaultBranch,
      isDirty: status.changedPaths.length > 0,
      changedPaths: status.changedPaths,
      inProgressOperation,
      worktrees,
    } satisfies RepositoryInspection;
  });

  const validateRepository = Effect.fn("MissionGitService.validateRepository")(function* (input: {
    readonly repositoryPath: string;
    readonly baseRef?: string;
  }) {
    const inspection = yield* inspectRepository({ repositoryPath: input.repositoryPath });
    if (inspection.inProgressOperation !== null) {
      return yield* fail(
        "repository-busy",
        "validateRepository",
        `Repository has an in-progress ${inspection.inProgressOperation} operation.`,
        { repositoryPath: inspection.repositoryRoot },
      );
    }
    const baseRef = input.baseRef ?? inspection.defaultBranch.refName;
    if (!(yield* baseBranchExists(inspection.repositoryRoot, baseRef))) {
      return yield* fail(
        "invalid-ref",
        "validateRepository",
        `Base branch '${baseRef}' does not exist as a local or remote branch.`,
        { repositoryPath: inspection.repositoryRoot },
      );
    }
    const commit = yield* resolveCommit(
      inspection.repositoryRoot,
      baseRef,
      "validateRepository.base",
    );
    return { ...inspection, base: { refName: baseRef, commit } };
  });

  const validateBranchName = Effect.fn("MissionGitService.validateBranchName")(function* (
    repositoryPath: string,
    branchName: string,
  ) {
    if (branchName.trim() !== branchName || branchName.startsWith("-")) {
      return yield* fail(
        "invalid-branch",
        "validateBranchName",
        "Managed branch name is invalid.",
        {
          repositoryPath,
        },
      );
    }
    const format = yield* execute({
      operation: "validateBranchName.format",
      cwd: repositoryPath,
      args: ["check-ref-format", "--branch", branchName],
      allowNonZeroExit: true,
    });
    if (format.exitCode !== 0) {
      return yield* fail(
        "invalid-branch",
        "validateBranchName",
        `Managed branch '${branchName}' is not a valid Git branch name.`,
        { repositoryPath },
      );
    }
  });

  const branchExists = Effect.fn("MissionGitService.branchExists")(function* (
    repositoryPath: string,
    branchName: string,
  ) {
    const result = yield* execute({
      operation: "branchExists",
      cwd: repositoryPath,
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      allowNonZeroExit: true,
    });
    return result.exitCode === 0;
  });

  const baseBranchExists = Effect.fn("MissionGitService.baseBranchExists")(function* (
    repositoryPath: string,
    branchName: string,
  ) {
    const candidates = branchName.startsWith("refs/heads/")
      ? [branchName]
      : branchName.startsWith("refs/remotes/")
        ? [branchName]
        : [`refs/heads/${branchName}`, `refs/remotes/${branchName}`];
    for (const candidate of candidates) {
      const result = yield* execute({
        operation: "baseBranchExists",
        cwd: repositoryPath,
        args: ["show-ref", "--verify", "--quiet", candidate],
        allowNonZeroExit: true,
      });
      if (result.exitCode === 0) return true;
    }
    return false;
  });

  const createManagedWorktree = Effect.fn("MissionGitService.createManagedWorktree")(function* (
    input: CreateManagedWorktreeInput,
  ) {
    const validation = yield* validateRepository({
      repositoryPath: input.repositoryPath,
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
    });
    const mainWorktree = validation.worktrees.find((entry) => entry.isMain);
    if (
      mainWorktree === undefined ||
      comparablePath(mainWorktree.path) !== comparablePath(validation.repositoryRoot)
    ) {
      return yield* fail(
        "unknown-worktree",
        "createManagedWorktree",
        "Managed worktrees must be created from the repository's main worktree.",
        { repositoryPath: validation.repositoryRoot },
      );
    }
    const names = makeManagedWorktreeNames(input);
    const branchName = input.branchName ?? names.branchName;
    yield* validateBranchName(validation.repositoryRoot, branchName);
    if (yield* branchExists(validation.repositoryRoot, branchName)) {
      return yield* fail(
        "branch-collision",
        "createManagedWorktree",
        `Branch '${branchName}' already exists.`,
        { repositoryPath: validation.repositoryRoot },
      );
    }

    const worktreesRoot = yield* canonicalizePotentialPath(input.worktreesRoot);
    const requestedPath = yield* canonicalizePotentialPath(
      input.worktreePath ?? path.join(worktreesRoot, names.directoryName),
    );
    if (!isWithin(comparablePath(requestedPath), comparablePath(worktreesRoot))) {
      return yield* fail(
        "path-overlap",
        "createManagedWorktree",
        "Managed worktree path must stay within the configured worktrees root.",
        { repositoryPath: validation.repositoryRoot, worktreePath: requestedPath },
      );
    }
    if (yield* fileSystem.exists(requestedPath).pipe(Effect.orElseSucceed(() => false))) {
      return yield* fail(
        "path-collision",
        "createManagedWorktree",
        "Managed worktree path already exists.",
        { repositoryPath: validation.repositoryRoot, worktreePath: requestedPath },
      );
    }
    const overlap = validation.worktrees.find((entry) => pathsOverlap(requestedPath, entry.path));
    if (overlap !== undefined) {
      return yield* fail(
        "path-overlap",
        "createManagedWorktree",
        `Managed worktree path overlaps existing worktree '${overlap.path}'.`,
        { repositoryPath: validation.repositoryRoot, worktreePath: requestedPath },
      );
    }

    yield* fileSystem.makeDirectory(worktreesRoot, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        fail("path-not-found", "createManagedWorktree", "Could not create worktrees root.", {
          repositoryPath: validation.repositoryRoot,
          worktreePath: worktreesRoot,
          cause,
        }),
      ),
    );
    yield* execute({
      operation: "createManagedWorktree",
      cwd: validation.repositoryRoot,
      args: [
        "worktree",
        "add",
        "--no-track",
        "-b",
        branchName,
        requestedPath,
        validation.base.commit,
      ],
    });
    const headCommit = yield* getHeadCommit(requestedPath);
    return {
      repositoryPath: validation.repositoryRoot,
      worktreePath: yield* canonicalizePotentialPath(requestedPath),
      branchName,
      baseRef: validation.base.refName,
      baseCommit: validation.base.commit,
      headCommit,
      mainWorktreeDirty: validation.isDirty,
    } satisfies ManagedWorktreeCreation;
  });

  const createMissionIntegrationBranch: MissionGitService["Service"]["createMissionIntegrationBranch"] =
    Effect.fn("MissionGitService.createMissionIntegrationBranch")(function* (input) {
      return yield* createManagedWorktree({
        ...input,
        taskName: "integration",
        kind: "integration",
      });
    });

  const findRegisteredWorktree = Effect.fn("MissionGitService.findRegisteredWorktree")(function* (
    repositoryPath: string,
    worktreePath: string,
  ) {
    const canonicalTarget = yield* canonicalizePotentialPath(worktreePath);
    const worktrees = yield* listWorktrees(repositoryPath);
    const match = worktrees.find(
      (entry) => comparablePath(entry.path) === comparablePath(canonicalTarget),
    );
    return { canonicalTarget, worktrees, match };
  });

  const isAncestor = Effect.fn("MissionGitService.isAncestor")(function* (
    cwd: string,
    ancestorCommit: string,
    descendantCommit: string,
  ) {
    const result = yield* execute({
      operation: "isAncestor",
      cwd,
      args: ["merge-base", "--is-ancestor", ancestorCommit, descendantCommit],
      allowNonZeroExit: true,
    });
    if (result.exitCode === 0) return true;
    if (Number(result.exitCode) === 1) return false;
    return yield* fail(
      "git-command-failed",
      "isAncestor",
      "Git could not compare commit ancestry.",
      { repositoryPath: cwd },
    );
  });

  const inspectWorktreeStatus = Effect.fn("MissionGitService.inspectWorktreeStatus")(
    function* (input: {
      readonly repositoryPath: string;
      readonly worktreePath: string;
      readonly integrationRef?: string;
    }) {
      const repository = yield* assertRepository(input.repositoryPath);
      const registered = yield* findRegisteredWorktree(
        repository.repositoryRoot,
        input.worktreePath,
      );
      const exists = yield* fileSystem
        .exists(registered.canonicalTarget)
        .pipe(Effect.orElseSucceed(() => false));
      if (registered.match === undefined || !exists || registered.match.prunableReason !== null) {
        return {
          path: registered.canonicalTarget,
          exists,
          registered: registered.match !== undefined,
          branch: registered.match?.branch ?? null,
          headCommit: registered.match?.headCommit ?? null,
          isDirty: false,
          hasUntrackedFiles: false,
          hasConflicts: false,
          changedPaths: [],
          conflictingFiles: [],
          inProgressOperation: null,
          commitsAheadOfIntegration: null,
          integrated: null,
        } satisfies WorktreeStatus;
      }
      const [status, operation, branch, headCommit] = yield* Effect.all([
        readStatus(registered.canonicalTarget),
        detectInProgressOperation(registered.canonicalTarget),
        getCurrentBranch(registered.canonicalTarget),
        getHeadCommit(registered.canonicalTarget),
      ]);
      let commitsAheadOfIntegration: number | null = null;
      let integrated: boolean | null = null;
      if (input.integrationRef !== undefined) {
        const integrationCommit = yield* resolveCommit(
          repository.repositoryRoot,
          input.integrationRef,
          "inspectWorktreeStatus.integrationRef",
        );
        const count = yield* execute({
          operation: "inspectWorktreeStatus.ahead",
          cwd: repository.repositoryRoot,
          args: ["rev-list", "--count", `${integrationCommit}..${headCommit}`],
        });
        commitsAheadOfIntegration = Number.parseInt(count.stdout.trim(), 10) || 0;
        integrated = yield* isAncestor(repository.repositoryRoot, headCommit, integrationCommit);
      }
      return {
        path: registered.canonicalTarget,
        exists: true,
        registered: true,
        branch,
        headCommit,
        isDirty: status.changedPaths.length > 0,
        hasUntrackedFiles: status.hasUntrackedFiles,
        hasConflicts: status.conflictingFiles.length > 0,
        changedPaths: status.changedPaths,
        conflictingFiles: status.conflictingFiles,
        inProgressOperation: operation,
        commitsAheadOfIntegration,
        integrated,
      } satisfies WorktreeStatus;
    },
  );

  const calculateMergeBase = Effect.fn("MissionGitService.calculateMergeBase")(function* (input: {
    readonly repositoryPath: string;
    readonly leftRef: string;
    readonly rightRef: string;
  }) {
    const [left, right] = yield* Effect.all([
      resolveCommit(input.repositoryPath, input.leftRef, "calculateMergeBase.left"),
      resolveCommit(input.repositoryPath, input.rightRef, "calculateMergeBase.right"),
    ]);
    const result = yield* execute({
      operation: "calculateMergeBase",
      cwd: input.repositoryPath,
      args: ["merge-base", left, right],
      allowNonZeroExit: true,
    });
    const commit = result.stdout.trim();
    if (result.exitCode !== 0 || !COMMIT_PATTERN.test(commit)) {
      return yield* fail(
        "invalid-ref",
        "calculateMergeBase",
        "Refs do not have a common merge base.",
        { repositoryPath: input.repositoryPath },
      );
    }
    return commit.toLowerCase();
  });

  const detectChangedFiles = Effect.fn("MissionGitService.detectChangedFiles")(function* (input: {
    readonly repositoryPath: string;
    readonly baseRef: string;
    readonly headRef: string;
  }) {
    const [base, head] = yield* Effect.all([
      resolveCommit(input.repositoryPath, input.baseRef, "detectChangedFiles.base"),
      resolveCommit(input.repositoryPath, input.headRef, "detectChangedFiles.head"),
    ]);
    const result = yield* execute({
      operation: "detectChangedFiles",
      cwd: input.repositoryPath,
      args: ["diff", "--name-only", "-z", `${base}...${head}`, "--"],
    });
    return [...new Set(result.stdout.split("\0").filter((value) => value.length > 0))].sort();
  });

  const detectConflicts = Effect.fn("MissionGitService.detectConflicts")(function* (input: {
    readonly repositoryPath: string;
    readonly integrationRef: string;
    readonly taskRef: string;
  }) {
    const [integrationCommit, taskCommit, mergeBase] = yield* Effect.all([
      resolveCommit(input.repositoryPath, input.integrationRef, "detectConflicts.integration"),
      resolveCommit(input.repositoryPath, input.taskRef, "detectConflicts.task"),
      calculateMergeBase({
        repositoryPath: input.repositoryPath,
        leftRef: input.integrationRef,
        rightRef: input.taskRef,
      }),
    ]);
    const result = yield* execute({
      operation: "detectConflicts",
      cwd: input.repositoryPath,
      args: [
        "merge-tree",
        "--write-tree",
        "--name-only",
        "--no-messages",
        "-z",
        integrationCommit,
        taskCommit,
      ],
      allowNonZeroExit: true,
    });
    if (result.exitCode !== 0 && Number(result.exitCode) !== 1) {
      return yield* fail(
        "git-command-failed",
        "detectConflicts",
        "Git conflict preflight failed.",
        { repositoryPath: input.repositoryPath },
      );
    }
    const tokens = result.stdout.split("\0").filter((value) => value.length > 0);
    const conflictingFiles = tokens
      .slice(COMMIT_PATTERN.test(tokens[0] ?? "") ? 1 : 0)
      .filter((value) => !COMMIT_PATTERN.test(value))
      .sort();
    return {
      mergeBase,
      integrationCommit,
      taskCommit,
      hasConflicts: result.exitCode !== 0,
      conflictingFiles: [...new Set(conflictingFiles)],
    } satisfies ConflictPreflight;
  });

  const assertIntegrationTarget = Effect.fn("MissionGitService.assertIntegrationTarget")(
    function* (input: {
      readonly repositoryPath: string;
      readonly integrationWorktreePath: string;
      readonly integrationBranch: string;
    }) {
      const repository = yield* assertRepository(input.repositoryPath);
      const target = yield* findRegisteredWorktree(
        repository.repositoryRoot,
        input.integrationWorktreePath,
      );
      if (target.match === undefined || target.match.isMain) {
        return yield* fail(
          "unknown-worktree",
          "assertIntegrationTarget",
          "Integration target must be an explicitly registered linked worktree.",
          {
            repositoryPath: repository.repositoryRoot,
            worktreePath: target.canonicalTarget,
          },
        );
      }
      const currentBranch = yield* getCurrentBranch(target.canonicalTarget);
      if (
        currentBranch !== input.integrationBranch ||
        target.match.branch !== input.integrationBranch
      ) {
        return yield* fail(
          "integration-head-changed",
          "assertIntegrationTarget",
          `Integration worktree is no longer on '${input.integrationBranch}'.`,
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      const defaultBranch = yield* resolveDefaultBranch(repository.repositoryRoot);
      if (input.integrationBranch === defaultBranch.refName) {
        return yield* fail(
          "protected-branch",
          "assertIntegrationTarget",
          "The repository default branch cannot be used as a mission integration target.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      return { repository, target, currentBranch };
    },
  );

  const integrateTaskBranch = Effect.fn("MissionGitService.integrateTaskBranch")(function* (input: {
    readonly repositoryPath: string;
    readonly integrationWorktreePath: string;
    readonly integrationBranch: string;
    readonly taskBranch: string;
    readonly approved: boolean;
    readonly expectedIntegrationHeadCommit?: string;
    readonly expectedTaskHeadCommit?: string;
  }) {
    if (!input.approved) {
      return yield* fail(
        "approval-required",
        "integrateTaskBranch",
        "Task branch integration requires explicit approval.",
        { repositoryPath: input.repositoryPath, worktreePath: input.integrationWorktreePath },
      );
    }
    const target = yield* assertIntegrationTarget(input);
    yield* validateBranchName(target.repository.repositoryRoot, input.taskBranch);
    if (!(yield* branchExists(target.repository.repositoryRoot, input.taskBranch))) {
      return yield* fail(
        "invalid-ref",
        "integrateTaskBranch",
        `Task branch '${input.taskBranch}' does not exist.`,
        { repositoryPath: target.repository.repositoryRoot },
      );
    }
    const status = yield* inspectWorktreeStatus({
      repositoryPath: target.repository.repositoryRoot,
      worktreePath: target.target.canonicalTarget,
    });
    if (status.hasConflicts) {
      return yield* fail(
        "conflicted-worktree",
        "integrateTaskBranch",
        "Integration worktree already contains unresolved conflicts.",
        {
          repositoryPath: target.repository.repositoryRoot,
          worktreePath: status.path,
          conflictingFiles: status.conflictingFiles,
        },
      );
    }
    if (status.isDirty) {
      return yield* fail(
        "dirty-worktree",
        "integrateTaskBranch",
        "Integration worktree has uncommitted or untracked changes.",
        { repositoryPath: target.repository.repositoryRoot, worktreePath: status.path },
      );
    }
    if (status.inProgressOperation !== null) {
      return yield* fail(
        "repository-busy",
        "integrateTaskBranch",
        `Integration worktree has an in-progress ${status.inProgressOperation} operation.`,
        { repositoryPath: target.repository.repositoryRoot, worktreePath: status.path },
      );
    }

    const integrationHeadCommit = yield* getHeadCommit(target.target.canonicalTarget);
    const taskHeadCommit = yield* resolveCommit(
      target.repository.repositoryRoot,
      input.taskBranch,
      "integrateTaskBranch.taskHead",
    );
    if (
      input.expectedIntegrationHeadCommit !== undefined &&
      input.expectedIntegrationHeadCommit.toLowerCase() !== integrationHeadCommit
    ) {
      return yield* fail(
        "integration-head-changed",
        "integrateTaskBranch",
        "Integration branch HEAD changed after approval.",
        { repositoryPath: target.repository.repositoryRoot, worktreePath: status.path },
      );
    }
    if (
      input.expectedTaskHeadCommit !== undefined &&
      input.expectedTaskHeadCommit.toLowerCase() !== taskHeadCommit
    ) {
      return yield* fail(
        "integration-head-changed",
        "integrateTaskBranch",
        "Task branch HEAD changed after approval.",
        { repositoryPath: target.repository.repositoryRoot },
      );
    }
    const mergeBase = yield* calculateMergeBase({
      repositoryPath: target.repository.repositoryRoot,
      leftRef: integrationHeadCommit,
      rightRef: taskHeadCommit,
    });
    const changedFiles = yield* detectChangedFiles({
      repositoryPath: target.repository.repositoryRoot,
      baseRef: mergeBase,
      headRef: taskHeadCommit,
    });
    if (
      yield* isAncestor(target.repository.repositoryRoot, taskHeadCommit, integrationHeadCommit)
    ) {
      return {
        status: "already-integrated",
        integrationBranch: input.integrationBranch,
        taskBranch: input.taskBranch,
        headCommit: integrationHeadCommit,
        taskHeadCommit,
        changedFiles,
      } satisfies IntegrationResult;
    }

    const preflight = yield* detectConflicts({
      repositoryPath: target.repository.repositoryRoot,
      integrationRef: integrationHeadCommit,
      taskRef: taskHeadCommit,
    });
    if (preflight.hasConflicts) {
      return {
        status: "conflicted",
        integrationBranch: input.integrationBranch,
        taskBranch: input.taskBranch,
        integrationHeadCommit,
        taskHeadCommit,
        conflictingFiles: preflight.conflictingFiles,
        mergeStarted: false,
      } satisfies IntegrationResult;
    }

    const merge = yield* execute({
      operation: "integrateTaskBranch.merge",
      cwd: target.target.canonicalTarget,
      args: ["merge", "--no-ff", "--no-edit", "--no-stat", input.taskBranch],
      allowNonZeroExit: true,
    });
    if (merge.exitCode !== 0) {
      const afterFailure = yield* readStatus(target.target.canonicalTarget);
      if (afterFailure.conflictingFiles.length > 0) {
        return {
          status: "conflicted",
          integrationBranch: input.integrationBranch,
          taskBranch: input.taskBranch,
          integrationHeadCommit,
          taskHeadCommit,
          conflictingFiles: afterFailure.conflictingFiles,
          mergeStarted: true,
        } satisfies IntegrationResult;
      }
      return yield* fail(
        "git-command-failed",
        "integrateTaskBranch",
        "Git could not merge the task branch.",
        { repositoryPath: target.repository.repositoryRoot, worktreePath: status.path },
      );
    }
    return {
      status: "merged",
      integrationBranch: input.integrationBranch,
      taskBranch: input.taskBranch,
      previousHeadCommit: integrationHeadCommit,
      headCommit: yield* getHeadCommit(target.target.canonicalTarget),
      taskHeadCommit,
      changedFiles,
    } satisfies IntegrationResult;
  });

  const abortIntegration = Effect.fn("MissionGitService.abortIntegration")(function* (input: {
    readonly repositoryPath: string;
    readonly integrationWorktreePath: string;
    readonly integrationBranch: string;
  }) {
    const target = yield* assertIntegrationTarget(input);
    const operation = yield* detectInProgressOperation(target.target.canonicalTarget);
    if (operation !== "merge") return false;
    yield* execute({
      operation: "abortIntegration",
      cwd: target.target.canonicalTarget,
      args: ["merge", "--abort"],
    });
    return true;
  });

  const removeManagedWorktree = Effect.fn("MissionGitService.removeManagedWorktree")(
    function* (input: {
      readonly repositoryPath: string;
      readonly worktreesRoot: string;
      readonly worktreePath: string;
      readonly integratedIntoRef: string;
      readonly active: boolean;
      readonly expectedBranch?: string;
    }) {
      const repository = yield* assertRepository(input.repositoryPath);
      const root = yield* canonicalizePotentialPath(input.worktreesRoot);
      const target = yield* findRegisteredWorktree(repository.repositoryRoot, input.worktreePath);
      if (
        target.match === undefined ||
        target.match.isMain ||
        !isWithin(comparablePath(target.canonicalTarget), comparablePath(root))
      ) {
        return yield* fail(
          "unknown-worktree",
          "removeManagedWorktree",
          "Removal target is not an explicitly managed linked worktree.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      if (input.active) {
        return yield* fail(
          "active-worktree",
          "removeManagedWorktree",
          "An active agent still owns this worktree.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      const status = yield* inspectWorktreeStatus({
        repositoryPath: repository.repositoryRoot,
        worktreePath: target.canonicalTarget,
        integrationRef: input.integratedIntoRef,
      });
      if (status.hasConflicts || status.inProgressOperation !== null) {
        return yield* fail(
          "conflicted-worktree",
          "removeManagedWorktree",
          "Worktree has unresolved conflicts or an in-progress Git operation.",
          {
            repositoryPath: repository.repositoryRoot,
            worktreePath: target.canonicalTarget,
            conflictingFiles: status.conflictingFiles,
          },
        );
      }
      if (status.isDirty) {
        return yield* fail(
          "dirty-worktree",
          "removeManagedWorktree",
          "Worktree has uncommitted or untracked changes.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      if (status.branch === null || status.headCommit === null) {
        return yield* fail(
          "unknown-worktree",
          "removeManagedWorktree",
          "Detached or missing worktrees cannot be removed by the managed cleanup path.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      if (input.expectedBranch !== undefined && status.branch !== input.expectedBranch) {
        return yield* fail(
          "integration-head-changed",
          "removeManagedWorktree",
          "Worktree branch changed since it was recorded.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      if (status.integrated !== true) {
        return yield* fail(
          "unintegrated-commits",
          "removeManagedWorktree",
          "Worktree contains commits that are not integrated into the requested target.",
          { repositoryPath: repository.repositoryRoot, worktreePath: target.canonicalTarget },
        );
      }
      yield* execute({
        operation: "removeManagedWorktree",
        cwd: repository.repositoryRoot,
        args: ["worktree", "remove", target.canonicalTarget],
      });
      return { branch: status.branch, headCommit: status.headCommit };
    },
  );

  const reconcileManagedWorktrees = Effect.fn("MissionGitService.reconcileManagedWorktrees")(
    function* (input: {
      readonly repositoryPath: string;
      readonly worktreesRoot: string;
      readonly managedWorktrees: ReadonlyArray<ManagedWorktreeExpectation>;
    }) {
      const repository = yield* assertRepository(input.repositoryPath);
      const root = yield* canonicalizePotentialPath(input.worktreesRoot);
      const actual = yield* listWorktrees(repository.repositoryRoot);
      const expectations = yield* Effect.forEach(input.managedWorktrees, (entry) =>
        canonicalizePotentialPath(entry.path).pipe(
          Effect.map((canonicalPath) => ({ ...entry, path: canonicalPath })),
        ),
      );
      const managed = expectations.map((expected) => {
        const atPath = actual.find(
          (entry) => comparablePath(entry.path) === comparablePath(expected.path),
        );
        const byBranch = actual.find((entry) => entry.branch === expected.branchName);
        if (atPath?.prunableReason !== null && atPath?.prunableReason !== undefined) {
          return {
            id: expected.id,
            expectedPath: expected.path,
            actualPath: atPath.path,
            expectedBranch: expected.branchName,
            actualBranch: atPath.branch,
            state: "prunable" as const,
          };
        }
        if (atPath !== undefined && atPath.branch === expected.branchName) {
          return {
            id: expected.id,
            expectedPath: expected.path,
            actualPath: atPath.path,
            expectedBranch: expected.branchName,
            actualBranch: atPath.branch,
            state: "healthy" as const,
          };
        }
        if (atPath !== undefined) {
          return {
            id: expected.id,
            expectedPath: expected.path,
            actualPath: atPath.path,
            expectedBranch: expected.branchName,
            actualBranch: atPath.branch,
            state: "branch-mismatch" as const,
          };
        }
        if (byBranch !== undefined) {
          return {
            id: expected.id,
            expectedPath: expected.path,
            actualPath: byBranch.path,
            expectedBranch: expected.branchName,
            actualBranch: byBranch.branch,
            state: "moved" as const,
          };
        }
        return {
          id: expected.id,
          expectedPath: expected.path,
          actualPath: null,
          expectedBranch: expected.branchName,
          actualBranch: null,
          state: "missing" as const,
        };
      });
      const expectedPaths = new Set(expectations.map((entry) => comparablePath(entry.path)));
      const unknownManagedWorktrees = actual.filter(
        (entry) =>
          !entry.isMain &&
          isWithin(comparablePath(entry.path), comparablePath(root)) &&
          !expectedPaths.has(comparablePath(entry.path)),
      );
      return { managed, unknownManagedWorktrees } satisfies ReconcileManagedWorktreesResult;
    },
  );

  const pruneManagedWorktrees = Effect.fn("MissionGitService.pruneManagedWorktrees")(
    function* (input: {
      readonly repositoryPath: string;
      readonly worktreesRoot: string;
      readonly expectedOrphanPaths: ReadonlyArray<string>;
      readonly activeWorktreePaths: ReadonlyArray<string>;
      readonly approved: boolean;
    }) {
      const repository = yield* assertRepository(input.repositoryPath);
      const root = yield* canonicalizePotentialPath(input.worktreesRoot);
      const worktrees = yield* listWorktrees(repository.repositoryRoot);
      const expected = new Set(
        yield* Effect.forEach(input.expectedOrphanPaths, (value) =>
          canonicalizePotentialPath(value).pipe(Effect.map(comparablePath)),
        ),
      );
      const active = new Set(
        yield* Effect.forEach(input.activeWorktreePaths, (value) =>
          canonicalizePotentialPath(value).pipe(Effect.map(comparablePath)),
        ),
      );
      const prunable = worktrees.filter((entry) => entry.prunableReason !== null);
      for (const entry of prunable) {
        const key = comparablePath(entry.path);
        if (!isWithin(key, comparablePath(root)) || !expected.has(key) || active.has(key)) {
          return yield* fail(
            active.has(key) ? "active-worktree" : "unknown-worktree",
            "pruneManagedWorktrees",
            "Git reported a prunable worktree that was not explicitly authorized for cleanup.",
            { repositoryPath: repository.repositoryRoot, worktreePath: entry.path },
          );
        }
      }
      const prunablePaths = prunable.map((entry) => entry.path).sort();
      if (!input.approved || prunablePaths.length === 0) {
        return { prunablePaths, pruned: false } satisfies PruneManagedWorktreesResult;
      }
      yield* execute({
        operation: "pruneManagedWorktrees",
        cwd: repository.repositoryRoot,
        args: ["worktree", "prune", "--expire=now", "--verbose"],
      });
      return { prunablePaths, pruned: true } satisfies PruneManagedWorktreesResult;
    },
  );

  return MissionGitService.of({
    inspectRepository,
    validateRepository,
    resolveDefaultBranch,
    getCurrentBranch,
    getHeadCommit,
    listWorktrees,
    createManagedWorktree,
    createMissionIntegrationBranch,
    inspectWorktreeStatus,
    calculateMergeBase,
    detectChangedFiles,
    detectConflicts,
    integrateTaskBranch,
    abortIntegration,
    removeManagedWorktree,
    pruneManagedWorktrees,
    reconcileManagedWorktrees,
  });
});

export const layer = Layer.effect(MissionGitService, make);
