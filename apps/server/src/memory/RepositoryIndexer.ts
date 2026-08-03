import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { IndexedChunkId, IndexedSourceId, MemoryIndexOperationId } from "@t3tools/contracts";
import type {
  IndexedChunk,
  IndexedSource,
  IndexedSourceStatus,
  MemoryIndexOperation,
  MemoryIndexOperationType,
  ProjectId,
} from "@t3tools/contracts";

import * as ProjectionMemory from "../persistence/Services/ProjectionMemory.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  chunkMemorySource,
  detectMemorySourceLanguage,
  type MemorySourceChunk,
} from "./MemoryChunking.ts";
import {
  classifyMemorySourcePath,
  fingerprintMemorySource,
  isBinaryMemorySource,
  redactMemorySourceText,
  resolveContainedRepositoryFile,
  resolveRepositoryRoot,
} from "./MemorySourceSecurity.ts";

const MEMORY_IGNORE_FILES = [".memoryignore", ".t3memoryignore"] as const;
const REPOSITORY_MAP_SOURCE_IDENTIFIER = "repository-map";

const PackageManifest = Schema.fromJsonString(
  Schema.Struct({
    scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
);
const decodePackageManifest = Schema.decodeUnknownOption(PackageManifest);

const RepositoryMapSchema = Schema.Struct({
  branchName: Schema.NullOr(Schema.String),
  commitHash: Schema.NullOr(Schema.String),
  isInferred: Schema.Literal(true),
  topLevelModules: Schema.Array(Schema.String),
  manifests: Schema.Array(Schema.String),
  entryPoints: Schema.Array(Schema.String),
  buildCommands: Schema.Array(Schema.String),
  testCommands: Schema.Array(Schema.String),
  majorDependencies: Schema.Array(Schema.String),
  keyConfiguration: Schema.Array(Schema.String),
  architectureFiles: Schema.Array(Schema.String),
  symbols: Schema.Array(Schema.Struct({ path: Schema.String, names: Schema.Array(Schema.String) })),
  sourcePaths: Schema.Array(Schema.String),
});
const decodeRepositoryMap = Schema.decodeUnknownOption(RepositoryMapSchema);
const RepositoryMapMetadataSchema = Schema.Struct({
  repositoryMap: RepositoryMapSchema,
  chunk: Schema.Unknown,
});
const decodeRepositoryMapMetadata = Schema.decodeUnknownOption(RepositoryMapMetadataSchema);

export class RepositoryIndexError extends Schema.TaggedErrorClass<RepositoryIndexError>()(
  "RepositoryIndexError",
  {
    operation: Schema.String,
    detail: Schema.String,
    relativePath: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface RepositoryGitExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type RepositoryGitExecutor = (input: {
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly allowNonZeroExit?: boolean;
  readonly maxOutputBytes?: number;
}) => Effect.Effect<RepositoryGitExecutionResult, RepositoryIndexError>;

export interface StoredRepositoryChunk {
  readonly id: IndexedChunkId;
  readonly chunkIndex: number;
  readonly contentFingerprint: string;
  readonly repositoryMap: RepositoryMap | null;
}

export interface StoredRepositorySource {
  readonly id: IndexedSourceId;
  readonly projectId: ProjectId;
  readonly sourceType: "repository_file" | "repository_map";
  readonly sourceIdentifier: string;
  readonly relativePath: string | null;
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly contentFingerprint: string;
  readonly language: string | null;
  readonly sizeBytes: number;
  readonly indexStatus: IndexedSourceStatus;
  readonly skipReason: string | null;
  readonly lastIndexedAt: string | null;
  readonly chunks: ReadonlyArray<StoredRepositoryChunk>;
}

export interface RepositoryIndexOperationState {
  readonly id: MemoryIndexOperationId;
  readonly projectId: ProjectId;
  readonly operationType: MemoryIndexOperationType;
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly status: "queued" | "running" | "interrupted";
}

export interface RepositoryMap {
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly isInferred: true;
  readonly topLevelModules: ReadonlyArray<string>;
  readonly manifests: ReadonlyArray<string>;
  readonly entryPoints: ReadonlyArray<string>;
  readonly buildCommands: ReadonlyArray<string>;
  readonly testCommands: ReadonlyArray<string>;
  readonly majorDependencies: ReadonlyArray<string>;
  readonly keyConfiguration: ReadonlyArray<string>;
  readonly architectureFiles: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<{ readonly path: string; readonly names: ReadonlyArray<string> }>;
  readonly sourcePaths: ReadonlyArray<string>;
}

export interface RepositoryIndexState {
  readonly sources: ReadonlyArray<StoredRepositorySource>;
  readonly interruptedOperations: ReadonlyArray<RepositoryIndexOperationState>;
  readonly repositoryMaps: ReadonlyArray<RepositoryMap>;
}

export interface RepositoryIndexedSourceDraft {
  readonly projectId: ProjectId;
  readonly sourceType: "repository_file" | "repository_map";
  readonly sourceIdentifier: string;
  readonly relativePath: string | null;
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly contentFingerprint: string;
  readonly language: string | null;
  readonly sizeBytes: number;
  readonly indexStatus: IndexedSourceStatus;
  readonly skipReason: string | null;
  readonly lastError: string | null;
}

export interface RepositoryIndexedChunkDraft {
  readonly chunkIndex: number;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly content: string;
  readonly contentFingerprint: string;
  readonly tokenEstimate: number;
  readonly symbolMetadata: unknown;
  readonly embeddingStatus: "disabled" | "queued";
}

export interface RepositoryIndexStore {
  readonly loadState: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<RepositoryIndexState, RepositoryIndexError>;
  readonly startOperation: (input: {
    readonly projectId: ProjectId;
    readonly operationType: MemoryIndexOperationType;
    readonly branchName: string | null;
    readonly commitHash: string | null;
  }) => Effect.Effect<MemoryIndexOperationId, RepositoryIndexError>;
  readonly upsertSource: (
    input: RepositoryIndexedSourceDraft,
  ) => Effect.Effect<StoredRepositorySource, RepositoryIndexError>;
  readonly replaceChunks: (input: {
    readonly indexedSourceId: IndexedSourceId;
    readonly chunks: ReadonlyArray<RepositoryIndexedChunkDraft>;
  }) => Effect.Effect<void, RepositoryIndexError>;
  readonly reuseChunks: (input: {
    readonly indexedSourceId: IndexedSourceId;
    readonly reuseFromIndexedSourceId: IndexedSourceId;
  }) => Effect.Effect<void, RepositoryIndexError>;
  readonly markSourceRemoved: (input: {
    readonly indexedSourceId: IndexedSourceId;
  }) => Effect.Effect<void, RepositoryIndexError>;
  readonly finishOperation: (input: {
    readonly operationId: MemoryIndexOperationId;
    readonly status: "completed" | "interrupted" | "failed" | "cancelled";
    readonly processedSources: number;
    readonly changedSources: number;
    readonly skippedSources: number;
    readonly failedSources: number;
    readonly errorSummary: string | null;
  }) => Effect.Effect<void, RepositoryIndexError>;
  readonly recoverInterruptedOperations: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<ReadonlyArray<RepositoryIndexOperationState>, RepositoryIndexError>;
}

export interface RepositoryIndexInput {
  readonly projectId: ProjectId;
  readonly repositoryRoot: string;
  readonly operationType: MemoryIndexOperationType;
  readonly branchName?: string | null;
  readonly exclusions?: ReadonlyArray<string>;
  readonly maximumFileSizeBytes?: number;
  readonly semanticEmbeddingEnabled?: boolean;
}

export interface RepositoryIndexRecoveryTarget {
  readonly projectId: ProjectId;
  readonly repositoryRoot: string;
  readonly exclusions?: ReadonlyArray<string>;
  readonly maximumFileSizeBytes?: number;
}

export interface RepositoryIndexResult {
  readonly operationId: MemoryIndexOperationId | null;
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly processedSources: number;
  readonly changedSources: number;
  readonly removedSources: number;
  readonly skippedSources: number;
  readonly failedSources: number;
  readonly reusedChunkSources: number;
  readonly repositoryMap: RepositoryMap | null;
  readonly paused: boolean;
}

interface GitRepositorySnapshot {
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly paths: ReadonlyArray<string>;
  readonly dirtyPaths: ReadonlySet<string>;
  readonly renamedPaths: ReadonlyMap<string, string>;
}

interface ProcessedMapSource {
  readonly relativePath: string;
  readonly content: string;
  readonly chunks: ReadonlyArray<MemorySourceChunk>;
}

type ProcessedRepositoryFile =
  | { readonly kind: "binary"; readonly sizeBytes: number }
  | {
      readonly kind: "text";
      readonly content: string;
      readonly contentFingerprint: string;
      readonly chunks: ReadonlyArray<MemorySourceChunk>;
      readonly sizeBytes: number;
    };

const normalizeRelativePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "");

const nullSeparated = (value: string): ReadonlyArray<string> =>
  value
    .split("\0")
    .map(normalizeRelativePath)
    .filter((entry) => entry.length > 0);

const parsePorcelainPaths = (
  value: string,
): { readonly paths: ReadonlySet<string>; readonly renames: ReadonlyMap<string, string> } => {
  const records = value.split("\0");
  const paths = new Set<string>();
  const renames = new Map<string, string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const currentPath = normalizeRelativePath(record.slice(3));
    if (currentPath.length > 0) paths.add(currentPath);
    if (/[RC]/.test(status)) {
      const previousPath = normalizeRelativePath(records[index + 1] ?? "");
      index += 1;
      if (previousPath.length > 0 && currentPath.length > 0) {
        paths.add(previousPath);
        renames.set(previousPath, currentPath);
      }
    }
  }
  return { paths, renames };
};

const parseNameStatus = (
  value: string,
): { readonly paths: ReadonlySet<string>; readonly renames: ReadonlyMap<string, string> } => {
  const records = value.split("\0");
  const paths = new Set<string>();
  const renames = new Map<string, string>();
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index] ?? "";
    if (status.length === 0) continue;
    const firstPath = normalizeRelativePath(records[index + 1] ?? "");
    index += 1;
    if (firstPath.length > 0) paths.add(firstPath);
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = normalizeRelativePath(records[index + 1] ?? "");
      index += 1;
      if (secondPath.length > 0) {
        paths.add(secondPath);
        renames.set(firstPath, secondPath);
      }
    }
  }
  return { paths, renames };
};

const readGitSnapshot = Effect.fn("RepositoryIndexer.readGitSnapshot")(function* (
  repositoryRoot: string,
  executeGit: RepositoryGitExecutor,
  previousCommit: string | null,
) {
  const repository = yield* executeGit({
    operation: "memory.index.detect-repository",
    cwd: repositoryRoot,
    args: ["rev-parse", "--show-toplevel"],
    allowNonZeroExit: true,
  });
  if (repository.exitCode !== 0) return null;

  const [branch, commit, files, status] = yield* Effect.all(
    [
      executeGit({
        operation: "memory.index.current-branch",
        cwd: repositoryRoot,
        args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
        allowNonZeroExit: true,
      }),
      executeGit({
        operation: "memory.index.current-commit",
        cwd: repositoryRoot,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
      }),
      executeGit({
        operation: "memory.index.list-files",
        cwd: repositoryRoot,
        args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"],
        maxOutputBytes: 32 * 1024 * 1024,
      }),
      executeGit({
        operation: "memory.index.status",
        cwd: repositoryRoot,
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"],
        maxOutputBytes: 16 * 1024 * 1024,
      }),
    ],
    { concurrency: 4 },
  );
  const porcelain = parsePorcelainPaths(status.stdout);
  let changedFromCommit: {
    readonly paths: ReadonlySet<string>;
    readonly renames: ReadonlyMap<string, string>;
  } = { paths: new Set<string>(), renames: new Map<string, string>() };
  const commitHash = commit.exitCode === 0 ? commit.stdout.trim() || null : null;
  if (previousCommit !== null && commitHash !== null && previousCommit !== commitHash) {
    const diff = yield* executeGit({
      operation: "memory.index.commit-diff",
      cwd: repositoryRoot,
      args: ["diff", "--name-status", "-z", "--find-renames", previousCommit, commitHash, "--"],
      allowNonZeroExit: true,
      maxOutputBytes: 16 * 1024 * 1024,
    });
    if (diff.exitCode === 0) changedFromCommit = parseNameStatus(diff.stdout);
  }
  return {
    branchName: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
    commitHash,
    paths: [...new Set(nullSeparated(files.stdout))].sort(),
    dirtyPaths: new Set([...porcelain.paths, ...changedFromCommit.paths]),
    renamedPaths: new Map([...changedFromCommit.renames, ...porcelain.renames]),
  } satisfies GitRepositorySnapshot;
});

const readOptionalTextFile = Effect.fn("RepositoryIndexer.readOptionalTextFile")(function* (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  repositoryRoot: string,
  relativePath: string,
) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const exists = yield* fileSystem.exists(absolutePath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return null;
  return yield* fileSystem.readFileString(absolutePath).pipe(Effect.orElseSucceed(() => null));
});

const walkRepository = Effect.fn("RepositoryIndexer.walkRepository")(function* (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  repositoryRoot: string,
  exclusions: ReadonlyArray<string>,
) {
  const files: string[] = [];
  const visited = new Set<string>();
  const pendingDirectories = [repositoryRoot];
  while (pendingDirectories.length > 0) {
    const absoluteDirectory = pendingDirectories.shift();
    if (absoluteDirectory === undefined) continue;
    const canonicalDirectory = yield* fileSystem.realPath(absoluteDirectory).pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryIndexError({
            operation: "walk-directory",
            detail: `Unable to resolve repository directory ${absoluteDirectory}.`,
            cause,
          }),
      ),
    );
    const relativeCanonical = path.relative(repositoryRoot, canonicalDirectory);
    if (
      relativeCanonical === ".." ||
      relativeCanonical.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeCanonical) ||
      visited.has(canonicalDirectory)
    ) {
      continue;
    }
    visited.add(canonicalDirectory);
    const entries = yield* fileSystem.readDirectory(canonicalDirectory).pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryIndexError({
            operation: "read-directory",
            detail: `Unable to read repository directory ${canonicalDirectory}.`,
            cause,
          }),
      ),
    );
    for (const entry of entries) {
      const absolutePath = path.join(canonicalDirectory, entry);
      const relativePath = normalizeRelativePath(path.relative(repositoryRoot, absolutePath));
      const stat = yield* fileSystem.stat(absolutePath).pipe(Effect.orElseSucceed(() => null));
      if (stat === null) continue;
      if (stat.type === "Directory") {
        const classification = classifyMemorySourcePath(`${relativePath}/placeholder`, 0, {
          exclusions,
        });
        if (classification.indexable) pendingDirectories.push(absolutePath);
      } else if (stat.type === "File") {
        files.push(relativePath);
      }
    }
  }
  return [...new Set(files)].sort();
});

const previousCommitForBranch = (
  sources: ReadonlyArray<StoredRepositorySource>,
  branchName: string | null,
): string | null =>
  sources
    .filter(
      (source) =>
        source.sourceType === "repository_file" &&
        source.branchName === branchName &&
        source.commitHash !== null &&
        source.indexStatus !== "removed",
    )
    .sort((left, right) => (right.lastIndexedAt ?? "").localeCompare(left.lastIndexedAt ?? ""))[0]
    ?.commitHash ?? null;

const createRepositoryMap = (input: {
  readonly paths: ReadonlyArray<string>;
  readonly branchName: string | null;
  readonly commitHash: string | null;
  readonly processedSources: ReadonlyArray<ProcessedMapSource>;
  readonly previous: RepositoryMap | null;
}): RepositoryMap => {
  const paths = [...new Set(input.paths.map(normalizeRelativePath))].sort();
  const topLevelModules = [...new Set(paths.map((entry) => entry.split("/")[0] ?? entry))]
    .filter((entry) => entry.length > 0 && !entry.includes("."))
    .sort();
  const manifests = paths.filter((entry) =>
    /(?:^|\/)(?:package\.json|cargo\.toml|pyproject\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|requirements\.txt)$/i.test(
      entry,
    ),
  );
  const entryPoints = paths.filter((entry) =>
    /(?:^|\/)(?:index|main|app|server|bin|cli)\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift)$/i.test(
      entry,
    ),
  );
  const keyConfiguration = paths.filter((entry) =>
    /(?:^|\/)(?:tsconfig(?:\.[^/]+)?\.json|vite\.config\.[^/]+|eslint\.config\.[^/]+|dockerfile|makefile|t3\.json|\.github\/workflows\/[^/]+)$/i.test(
      entry,
    ),
  );
  const architectureFiles = paths.filter((entry) =>
    /(?:^|\/)(?:agents\.md|architecture\.md|contributing\.md|docs\/internals\/[^/]+\.md)$/i.test(
      entry,
    ),
  );
  const processedSymbols = input.processedSources
    .map((source) => ({
      path: source.relativePath,
      names: [...new Set(source.chunks.flatMap((chunk) => chunk.symbolMetadata.symbols))].slice(
        0,
        100,
      ),
    }))
    .filter((entry) => entry.names.length > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
  const symbolsByPath = new Map(
    (input.previous?.symbols ?? [])
      .filter((entry) => paths.includes(entry.path))
      .map((entry) => [entry.path, entry] as const),
  );
  for (const entry of processedSymbols) symbolsByPath.set(entry.path, entry);
  const symbols = [...symbolsByPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  let buildCommands = input.previous?.buildCommands ?? [];
  let testCommands = input.previous?.testCommands ?? [];
  let majorDependencies = input.previous?.majorDependencies ?? [];
  const packageJson = input.processedSources.find(
    (source) => source.relativePath === "package.json",
  );
  if (!paths.includes("package.json")) {
    buildCommands = [];
    testCommands = [];
    majorDependencies = [];
  } else if (packageJson !== undefined) {
    const decoded = decodePackageManifest(packageJson.content);
    if (Option.isSome(decoded)) {
      const scripts = decoded.value.scripts ?? {};
      buildCommands = Object.entries(scripts)
        .filter(([name]) => /^(?:build|compile|bundle|pack)/i.test(name))
        .map(([name, command]) => `${name}: ${command}`)
        .sort();
      testCommands = Object.entries(scripts)
        .filter(([name]) => /^(?:test|check|typecheck|lint)/i.test(name))
        .map(([name, command]) => `${name}: ${command}`)
        .sort();
      majorDependencies = [
        ...new Set([
          ...Object.keys(decoded.value.dependencies ?? {}),
          ...Object.keys(decoded.value.devDependencies ?? {}),
        ]),
      ]
        .sort()
        .slice(0, 100);
    }
  }

  return {
    branchName: input.branchName,
    commitHash: input.commitHash,
    isInferred: true,
    topLevelModules,
    manifests,
    entryPoints,
    buildCommands,
    testCommands,
    majorDependencies,
    keyConfiguration,
    architectureFiles,
    symbols,
    sourcePaths: [...new Set([...manifests, ...keyConfiguration, ...architectureFiles])].sort(),
  };
};

const repositoryMapContent = (map: RepositoryMap): string =>
  [
    "# Inferred repository map",
    "",
    "This map is generated from the cited repository sources and is not authoritative.",
    "",
    `Top-level modules: ${map.topLevelModules.join(", ") || "none detected"}`,
    `Manifests: ${map.manifests.join(", ") || "none detected"}`,
    `Entry points: ${map.entryPoints.join(", ") || "none detected"}`,
    `Build commands: ${map.buildCommands.join("; ") || "none detected"}`,
    `Test commands: ${map.testCommands.join("; ") || "none detected"}`,
    `Architecture files: ${map.architectureFiles.join(", ") || "none detected"}`,
    `Key configuration: ${map.keyConfiguration.join(", ") || "none detected"}`,
  ].join("\n");

const toChunkDrafts = (
  chunks: ReadonlyArray<MemorySourceChunk>,
  semanticEmbeddingEnabled: boolean,
): ReadonlyArray<RepositoryIndexedChunkDraft> =>
  chunks.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
    contentFingerprint: chunk.contentFingerprint,
    tokenEstimate: chunk.tokenEstimate,
    symbolMetadata: chunk.symbolMetadata,
    embeddingStatus: semanticEmbeddingEnabled ? "queued" : "disabled",
  }));

const processRepositoryFile = Effect.fn("RepositoryIndexer.processRepositoryFile")(function* (
  fileSystem: FileSystem.FileSystem,
  repositoryRoot: string,
  relativePath: string,
): Effect.fn.Return<
  ProcessedRepositoryFile,
  RepositoryIndexError,
  FileSystem.FileSystem | Path.Path
> {
  const resolved = yield* resolveContainedRepositoryFile(repositoryRoot, relativePath).pipe(
    Effect.mapError(
      (cause) =>
        new RepositoryIndexError({
          operation: "resolve-source",
          detail: cause.message,
          relativePath,
          cause,
        }),
    ),
  );
  const bytes = yield* fileSystem.readFile(resolved.absolutePath).pipe(
    Effect.mapError(
      (cause) =>
        new RepositoryIndexError({
          operation: "read-source",
          detail: `Unable to read repository source ${relativePath}.`,
          relativePath,
          cause,
        }),
    ),
  );
  if (isBinaryMemorySource(bytes)) {
    return { kind: "binary", sizeBytes: bytes.length };
  }
  const content = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: (cause) =>
      new RepositoryIndexError({
        operation: "decode-source",
        detail: `Repository source ${relativePath} is not valid UTF-8 text.`,
        relativePath,
        cause,
      }),
  });
  const redacted = redactMemorySourceText(content);
  const contentFingerprint = fingerprintMemorySource(redacted.content);
  const chunks = chunkMemorySource({ relativePath, content: redacted.content });
  return {
    kind: "text",
    content: redacted.content,
    contentFingerprint,
    chunks,
    sizeBytes: bytes.length,
  };
});

const indexRepositoryWith = Effect.fn("RepositoryIndexer.indexRepository")(function* (
  store: RepositoryIndexStore,
  executeGit: RepositoryGitExecutor,
  paused: Ref.Ref<boolean>,
  input: RepositoryIndexInput,
) {
  if (yield* Ref.get(paused)) {
    return {
      operationId: null,
      branchName: input.branchName ?? null,
      commitHash: null,
      processedSources: 0,
      changedSources: 0,
      removedSources: 0,
      skippedSources: 0,
      failedSources: 0,
      reusedChunkSources: 0,
      repositoryMap: null,
      paused: true,
    } satisfies RepositoryIndexResult;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = yield* resolveRepositoryRoot(input.repositoryRoot).pipe(
    Effect.mapError(
      (cause) =>
        new RepositoryIndexError({
          operation: "validate-root",
          detail: cause.message,
          cause,
        }),
    ),
  );
  const state = yield* store.loadState({ projectId: input.projectId });
  const provisionalBranch = input.branchName ?? null;
  const provisionalPreviousCommit = previousCommitForBranch(state.sources, provisionalBranch);
  let gitSnapshot = yield* readGitSnapshot(repositoryRoot, executeGit, provisionalPreviousCommit);
  // A null branch is the shared base-project index. Managed mission worktrees pass their branch
  // explicitly, so ordinary project threads can consume base sources without pretending they are
  // branch-specific.
  const branchName = input.branchName ?? null;
  const previousCommit = previousCommitForBranch(state.sources, branchName);
  if (previousCommit !== provisionalPreviousCommit && gitSnapshot !== null) {
    gitSnapshot = yield* readGitSnapshot(repositoryRoot, executeGit, previousCommit);
  }
  const commitHash = gitSnapshot?.commitHash ?? null;
  const ignoreFileContents = yield* Effect.forEach(
    MEMORY_IGNORE_FILES,
    (ignoreFile) => readOptionalTextFile(fileSystem, path, repositoryRoot, ignoreFile),
    { concurrency: 2 },
  );
  const repositoryExclusions = [
    ...(input.exclusions ?? []),
    ...ignoreFileContents.flatMap((content) => content?.split(/\r?\n/) ?? []),
  ];
  const gitIgnore =
    gitSnapshot === null
      ? yield* readOptionalTextFile(fileSystem, path, repositoryRoot, ".gitignore")
      : null;
  const currentPaths =
    gitSnapshot?.paths ??
    (yield* walkRepository(fileSystem, path, repositoryRoot, [
      ...(gitIgnore?.split(/\r?\n/) ?? []),
      ...repositoryExclusions,
    ]));
  const currentPathSet = new Set(currentPaths);
  const branchSources = state.sources.filter(
    (source) => source.sourceType === "repository_file" && source.branchName === branchName,
  );
  const activeByPath = new Map<string, StoredRepositorySource>();
  for (const source of branchSources
    .filter((candidate) => candidate.relativePath !== null && candidate.indexStatus !== "removed")
    .sort((left, right) => (right.lastIndexedAt ?? "").localeCompare(left.lastIndexedAt ?? ""))) {
    const relativePath = normalizeRelativePath(source.relativePath ?? "");
    if (!activeByPath.has(relativePath) || source.commitHash === commitHash) {
      activeByPath.set(relativePath, source);
    }
  }
  const changedPaths = new Set<string>();
  const completeRefresh =
    input.operationType === "full_reindex" ||
    input.operationType === "branch_refresh" ||
    activeByPath.size === 0;
  if (completeRefresh) {
    currentPaths.forEach((relativePath) => changedPaths.add(relativePath));
  } else {
    currentPaths.forEach((relativePath) => {
      if (!activeByPath.has(relativePath)) changedPaths.add(relativePath);
    });
    gitSnapshot?.dirtyPaths.forEach((relativePath) => changedPaths.add(relativePath));
    if (input.operationType === "recovery") {
      branchSources
        .filter((source) => ["queued", "indexing", "failed", "stale"].includes(source.indexStatus))
        .forEach((source) => {
          if (source.relativePath !== null) changedPaths.add(source.relativePath);
        });
    }
  }
  const removedSources = [...activeByPath.entries()].filter(
    ([relativePath]) => !currentPathSet.has(relativePath),
  );
  const operationId = yield* store.startOperation({
    projectId: input.projectId,
    operationType: input.operationType,
    branchName,
    commitHash,
  });
  let processedSources = 0;
  let changedSources = 0;
  let skippedSources = 0;
  let failedSources = 0;
  let reusedChunkSources = 0;
  const processedMapSources: ProcessedMapSource[] = [];

  const run = Effect.gen(function* () {
    const retireReplacedSource = (existing: StoredRepositorySource | undefined, nextId: string) =>
      existing !== undefined && existing.id !== nextId
        ? store.markSourceRemoved({ indexedSourceId: existing.id })
        : Effect.void;

    for (const [, source] of removedSources) {
      yield* store.markSourceRemoved({ indexedSourceId: source.id });
    }

    for (const relativePath of [...changedPaths].sort()) {
      if (!currentPathSet.has(relativePath)) continue;
      processedSources += 1;
      const existing = activeByPath.get(relativePath);
      const lexicalPath = path.join(repositoryRoot, relativePath);
      const stat = yield* fileSystem.stat(lexicalPath).pipe(Effect.orElseSucceed(() => null));
      if (stat === null || stat.type !== "File") {
        failedSources += 1;
        const stored = yield* store.upsertSource({
          projectId: input.projectId,
          sourceType: "repository_file",
          sourceIdentifier: relativePath,
          relativePath,
          branchName,
          commitHash: null,
          contentFingerprint:
            existing?.contentFingerprint ?? fingerprintMemorySource(`missing:${relativePath}`),
          language: detectMemorySourceLanguage(relativePath),
          sizeBytes: 0,
          indexStatus: "failed",
          skipReason: null,
          lastError: "The source disappeared before it could be indexed.",
        });
        yield* retireReplacedSource(existing, stored.id);
        continue;
      }
      const classification = classifyMemorySourcePath(relativePath, Number(stat.size), {
        exclusions: repositoryExclusions,
        ...(input.maximumFileSizeBytes === undefined
          ? {}
          : { maximumFileSizeBytes: input.maximumFileSizeBytes }),
      });
      if (!classification.indexable) {
        skippedSources += 1;
        const stored = yield* store.upsertSource({
          projectId: input.projectId,
          sourceType: "repository_file",
          sourceIdentifier: relativePath,
          relativePath,
          branchName,
          commitHash: null,
          contentFingerprint:
            existing?.contentFingerprint ??
            fingerprintMemorySource(
              `skipped:${classification.reason ?? "unknown"}:${relativePath}`,
            ),
          language: detectMemorySourceLanguage(relativePath),
          sizeBytes: Number(stat.size),
          indexStatus: "skipped",
          skipReason: classification.reason,
          lastError: null,
        });
        yield* retireReplacedSource(existing, stored.id);
        continue;
      }

      const processed = yield* Effect.result(
        processRepositoryFile(fileSystem, repositoryRoot, relativePath),
      );

      if (Result.isFailure(processed)) {
        failedSources += 1;
        const stored = yield* store.upsertSource({
          projectId: input.projectId,
          sourceType: "repository_file",
          sourceIdentifier: relativePath,
          relativePath,
          branchName,
          commitHash: null,
          contentFingerprint:
            existing?.contentFingerprint ?? fingerprintMemorySource(`failed:${relativePath}`),
          language: detectMemorySourceLanguage(relativePath),
          sizeBytes: Number(stat.size),
          indexStatus: "failed",
          skipReason: null,
          lastError: processed.failure.message,
        });
        yield* retireReplacedSource(existing, stored.id);
        continue;
      }
      if (processed.success.kind === "binary") {
        skippedSources += 1;
        const stored = yield* store.upsertSource({
          projectId: input.projectId,
          sourceType: "repository_file",
          sourceIdentifier: relativePath,
          relativePath,
          branchName,
          commitHash: null,
          contentFingerprint:
            existing?.contentFingerprint ?? fingerprintMemorySource(`binary:${relativePath}`),
          language: null,
          sizeBytes: processed.success.sizeBytes,
          indexStatus: "skipped",
          skipReason: "binary",
          lastError: null,
        });
        yield* retireReplacedSource(existing, stored.id);
        continue;
      }
      const textFile = processed.success;

      const sourceCommitHash = gitSnapshot?.dirtyPaths.has(relativePath) ? null : commitHash;
      const stored = yield* store.upsertSource({
        projectId: input.projectId,
        sourceType: "repository_file",
        sourceIdentifier: relativePath,
        relativePath,
        branchName,
        commitHash: sourceCommitHash,
        contentFingerprint: textFile.contentFingerprint,
        language: detectMemorySourceLanguage(relativePath),
        sizeBytes: textFile.sizeBytes,
        indexStatus: "indexed",
        skipReason: null,
        lastError: null,
      });
      processedMapSources.push({
        relativePath,
        content: textFile.content,
        chunks: textFile.chunks,
      });
      if (
        existing?.contentFingerprint === textFile.contentFingerprint &&
        existing.id === stored.id
      ) {
        continue;
      }
      changedSources += 1;
      const reusable = state.sources.find(
        (source) =>
          source.id !== stored.id &&
          source.indexStatus === "indexed" &&
          source.contentFingerprint === textFile.contentFingerprint &&
          source.chunks.length > 0,
      );
      if (reusable !== undefined) {
        yield* store.reuseChunks({
          indexedSourceId: stored.id,
          reuseFromIndexedSourceId: reusable.id,
        });
        reusedChunkSources += 1;
      } else {
        yield* store.replaceChunks({
          indexedSourceId: stored.id,
          chunks: toChunkDrafts(textFile.chunks, input.semanticEmbeddingEnabled ?? false),
        });
      }
      yield* retireReplacedSource(existing, stored.id);
    }

    const repositoryMap = createRepositoryMap({
      paths: currentPaths,
      branchName,
      commitHash,
      processedSources: processedMapSources,
      previous:
        state.repositoryMaps.find((repositoryMap) => repositoryMap.branchName === branchName) ??
        null,
    });
    const mapContent = repositoryMapContent(repositoryMap);
    const mapFingerprint = fingerprintMemorySource(mapContent);
    const existingMap = state.sources
      .filter(
        (source) =>
          source.sourceType === "repository_map" &&
          source.branchName === branchName &&
          source.indexStatus !== "removed",
      )
      .sort((left, right) =>
        (right.lastIndexedAt ?? "").localeCompare(left.lastIndexedAt ?? ""),
      )[0];
    const storedMap = yield* store.upsertSource({
      projectId: input.projectId,
      sourceType: "repository_map",
      sourceIdentifier: REPOSITORY_MAP_SOURCE_IDENTIFIER,
      relativePath: null,
      branchName,
      commitHash,
      contentFingerprint: mapFingerprint,
      language: "markdown",
      sizeBytes: new TextEncoder().encode(mapContent).length,
      indexStatus: "indexed",
      skipReason: null,
      lastError: null,
    });
    if (existingMap?.contentFingerprint === mapFingerprint && existingMap.id !== storedMap.id) {
      yield* store.reuseChunks({
        indexedSourceId: storedMap.id,
        reuseFromIndexedSourceId: existingMap.id,
      });
    } else if (existingMap?.contentFingerprint !== mapFingerprint) {
      const repositoryMapChunks = toChunkDrafts(
        chunkMemorySource({ relativePath: "REPOSITORY_MAP.md", content: mapContent }),
        false,
      ).map((chunk, index) => ({
        ...chunk,
        symbolMetadata:
          index === 0 ? { repositoryMap, chunk: chunk.symbolMetadata } : chunk.symbolMetadata,
      }));
      yield* store.replaceChunks({
        indexedSourceId: storedMap.id,
        chunks: repositoryMapChunks,
      });
    }
    yield* retireReplacedSource(existingMap, storedMap.id);
    yield* store.finishOperation({
      operationId,
      status: "completed",
      processedSources,
      changedSources,
      skippedSources,
      failedSources,
      errorSummary: null,
    });
    return repositoryMap;
  });

  const repositoryMap = yield* run.pipe(
    Effect.onInterrupt(() =>
      store.finishOperation({
        operationId,
        status: "interrupted",
        processedSources,
        changedSources,
        skippedSources,
        failedSources,
        errorSummary: "Repository indexing was interrupted and can be recovered safely.",
      }),
    ),
    Effect.tapError((error) =>
      store.finishOperation({
        operationId,
        status: "failed",
        processedSources,
        changedSources,
        skippedSources,
        failedSources,
        errorSummary: error.message,
      }),
    ),
  );

  return {
    operationId,
    branchName,
    commitHash,
    processedSources,
    changedSources,
    removedSources: removedSources.length,
    skippedSources,
    failedSources,
    reusedChunkSources,
    repositoryMap,
    paused: false,
  } satisfies RepositoryIndexResult;
});

export class RepositoryIndexer extends Context.Service<
  RepositoryIndexer,
  {
    readonly index: (
      input: RepositoryIndexInput,
    ) => Effect.Effect<RepositoryIndexResult, RepositoryIndexError>;
    readonly recoverInterrupted: (
      targets: ReadonlyArray<RepositoryIndexRecoveryTarget>,
    ) => Effect.Effect<ReadonlyArray<RepositoryIndexResult>, RepositoryIndexError>;
    readonly setPaused: (paused: boolean) => Effect.Effect<void>;
    readonly isPaused: Effect.Effect<boolean>;
  }
>()("t3/memory/RepositoryIndexer") {}

export const makeRepositoryIndexerWith = Effect.fn("RepositoryIndexer.makeWith")(function* (
  store: RepositoryIndexStore,
  executeGit: RepositoryGitExecutor,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mutex = yield* Semaphore.make(1);
  const paused = yield* Ref.make(false);
  const index: RepositoryIndexer["Service"]["index"] = (input) =>
    mutex.withPermits(1)(
      indexRepositoryWith(store, executeGit, paused, input).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
    );
  const recoverInterrupted: RepositoryIndexer["Service"]["recoverInterrupted"] = (targets) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const results: RepositoryIndexResult[] = [];
        for (const target of targets) {
          const interruptedOperations = yield* store.recoverInterruptedOperations({
            projectId: target.projectId,
          });
          for (const interrupted of interruptedOperations) {
            results.push(
              yield* indexRepositoryWith(store, executeGit, paused, {
                ...target,
                operationType: "recovery",
                branchName: interrupted.branchName,
              }).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
              ),
            );
          }
        }
        return results;
      }),
    );
  return RepositoryIndexer.of({
    index,
    recoverInterrupted,
    setPaused: (value) => Ref.set(paused, value),
    isPaused: Ref.get(paused),
  });
});

const projectionMemoryError =
  (operation: string) =>
  (cause: ProjectionMemory.ProjectionMemoryRepositoryError): RepositoryIndexError =>
    new RepositoryIndexError({
      operation,
      detail: `Memory index persistence failed during ${operation}.`,
      cause,
    });

const makeProjectionMemoryIndexStore = Effect.fn(
  "RepositoryIndexer.makeProjectionMemoryIndexStore",
)(function* () {
  const repository = yield* ProjectionMemory.ProjectionMemoryRepository;
  const crypto = yield* Crypto.Crypto;
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const uuid = crypto.randomUUIDv4;
  const nextUuid = (operation: string) =>
    uuid.pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryIndexError({
            operation,
            detail: `Unable to generate a durable identifier during ${operation}.`,
            cause,
          }),
      ),
    );

  const listAllSources = Effect.fn("RepositoryIndexer.listAllSources")(function* (
    projectId: ProjectId,
  ) {
    const sources: IndexedSource[] = [];
    const limit = 500;
    let offset = 0;
    while (true) {
      const page = yield* repository
        .listIndexedSources({
          projectId,
          branchName: null,
          statuses: ["queued", "indexing", "indexed", "skipped", "stale", "failed", "removed"],
          limit,
          offset,
        })
        .pipe(Effect.mapError(projectionMemoryError("list-indexed-sources")));
      sources.push(...page);
      if (page.length < limit) break;
      offset += page.length;
    }
    return sources;
  });

  const listSourceChunks = Effect.fn("RepositoryIndexer.listSourceChunks")(function* (
    source: IndexedSource,
  ) {
    const hits = yield* repository
      .listIndexedChunks({
        projectId: source.projectId,
        indexedSourceId: source.id,
        branchName: null,
        pathPrefix: null,
        limit: 10_000,
        offset: 0,
      })
      .pipe(Effect.mapError(projectionMemoryError("list-indexed-chunks")));
    return hits.map(({ chunk }) => {
      const metadata = decodeRepositoryMapMetadata(chunk.symbolMetadata);
      const directMap = decodeRepositoryMap(chunk.symbolMetadata);
      return {
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        contentFingerprint: chunk.contentFingerprint,
        repositoryMap: Option.isSome(metadata)
          ? metadata.value.repositoryMap
          : Option.getOrNull(directMap),
      } satisfies StoredRepositoryChunk;
    });
  });

  const loadState: RepositoryIndexStore["loadState"] = Effect.fn(
    "RepositoryIndexer.store.loadState",
  )(function* ({ projectId }) {
    const sources = yield* listAllSources(projectId);
    const chunksBySource = yield* Effect.forEach(
      sources,
      (source) =>
        listSourceChunks(source).pipe(Effect.map((chunks) => [source.id, chunks] as const)),
      { concurrency: 8 },
    );
    const chunks = new Map(chunksBySource);
    const operations = yield* repository
      .listIndexOperations({ projectId, limit: 500, offset: 0 })
      .pipe(Effect.mapError(projectionMemoryError("list-index-operations")));
    const storedSources = sources.map(
      (source): StoredRepositorySource => ({
        id: source.id,
        projectId: source.projectId,
        sourceType: source.sourceType === "repository_map" ? "repository_map" : "repository_file",
        sourceIdentifier: source.sourceIdentifier,
        relativePath: source.relativePath,
        branchName: source.branchName,
        commitHash: source.commitHash,
        contentFingerprint: source.contentFingerprint,
        language: source.language,
        sizeBytes: source.sizeBytes,
        indexStatus: source.indexStatus,
        skipReason: source.skipReason,
        lastIndexedAt: source.lastIndexedAt,
        chunks: chunks.get(source.id) ?? [],
      }),
    );
    return {
      sources: storedSources,
      interruptedOperations: operations
        .filter(
          (operation) =>
            operation.status === "queued" ||
            operation.status === "running" ||
            operation.status === "interrupted",
        )
        .map(
          (operation): RepositoryIndexOperationState => ({
            id: operation.id,
            projectId: operation.projectId,
            operationType: operation.operationType,
            branchName: operation.branchName,
            commitHash: operation.commitHash,
            status:
              operation.status === "running"
                ? "running"
                : operation.status === "queued"
                  ? "queued"
                  : "interrupted",
          }),
        ),
      repositoryMaps: storedSources.flatMap((source) =>
        source.sourceType === "repository_map"
          ? source.chunks.flatMap((chunk) =>
              chunk.repositoryMap === null ? [] : [chunk.repositoryMap],
            )
          : [],
      ),
    } satisfies RepositoryIndexState;
  });

  const upsertSource: RepositoryIndexStore["upsertSource"] = Effect.fn(
    "RepositoryIndexer.store.upsertSource",
  )(function* (input) {
    const existing = yield* repository
      .findIndexedSource({
        projectId: input.projectId,
        sourceType: input.sourceType,
        sourceIdentifier: input.sourceIdentifier,
        branchName: input.branchName,
        commitHash: input.commitHash,
      })
      .pipe(Effect.mapError(projectionMemoryError("find-indexed-source")));
    const now = yield* nowIso;
    const source: IndexedSource = {
      id: Option.isSome(existing)
        ? existing.value.id
        : IndexedSourceId.make(yield* nextUuid("create-indexed-source-id")),
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceIdentifier: input.sourceIdentifier,
      relativePath: input.relativePath,
      branchName: input.branchName,
      commitHash: input.commitHash,
      contentFingerprint: input.contentFingerprint,
      language: input.language,
      sizeBytes: input.sizeBytes,
      indexStatus: input.indexStatus,
      skipReason: input.skipReason,
      lastIndexedAt: now,
      lastError: input.lastError?.slice(0, 4_000) ?? null,
      createdAt: Option.isSome(existing) ? existing.value.createdAt : now,
      updatedAt: now,
    };
    const stored = yield* repository
      .upsertIndexedSource(source)
      .pipe(Effect.mapError(projectionMemoryError("upsert-indexed-source")));
    const storedChunks = yield* listSourceChunks(stored);
    return {
      id: stored.id,
      projectId: stored.projectId,
      sourceType: stored.sourceType === "repository_map" ? "repository_map" : "repository_file",
      sourceIdentifier: stored.sourceIdentifier,
      relativePath: stored.relativePath,
      branchName: stored.branchName,
      commitHash: stored.commitHash,
      contentFingerprint: stored.contentFingerprint,
      language: stored.language,
      sizeBytes: stored.sizeBytes,
      indexStatus: stored.indexStatus,
      skipReason: stored.skipReason,
      lastIndexedAt: stored.lastIndexedAt,
      chunks: storedChunks,
    } satisfies StoredRepositorySource;
  });

  const replaceChunks: RepositoryIndexStore["replaceChunks"] = Effect.fn(
    "RepositoryIndexer.store.replaceChunks",
  )(function* ({ indexedSourceId, chunks }) {
    const now = yield* nowIso;
    const rows = yield* Effect.forEach(
      chunks,
      Effect.fn("RepositoryIndexer.store.makeChunk")(function* (chunk) {
        return {
          id: IndexedChunkId.make(yield* nextUuid("create-indexed-chunk-id")),
          indexedSourceId,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          contentFingerprint: chunk.contentFingerprint,
          tokenEstimate: chunk.tokenEstimate,
          symbolMetadata: chunk.symbolMetadata,
          embeddingStatus: chunk.embeddingStatus,
          embeddingProvider: null,
          embeddingModel: null,
          embeddingDimensions: null,
          createdAt: now,
          updatedAt: now,
        } satisfies IndexedChunk;
      }),
    );
    yield* repository
      .replaceIndexedChunks({ indexedSourceId, chunks: rows, lastIndexedAt: now })
      .pipe(Effect.mapError(projectionMemoryError("replace-indexed-chunks")));
  });

  const startOperation: RepositoryIndexStore["startOperation"] = Effect.fn(
    "RepositoryIndexer.store.startOperation",
  )(function* (input) {
    const now = yield* nowIso;
    const operation: MemoryIndexOperation = {
      id: MemoryIndexOperationId.make(yield* nextUuid("create-index-operation-id")),
      projectId: input.projectId,
      operationType: input.operationType,
      status: "running",
      branchName: input.branchName,
      commitHash: input.commitHash,
      processedSources: 0,
      changedSources: 0,
      skippedSources: 0,
      failedSources: 0,
      errorSummary: null,
      requestedAt: now,
      startedAt: now,
      completedAt: null,
    };
    yield* repository
      .saveIndexOperation(operation)
      .pipe(Effect.mapError(projectionMemoryError("start-index-operation")));
    return operation.id;
  });

  const finishOperation: RepositoryIndexStore["finishOperation"] = Effect.fn(
    "RepositoryIndexer.store.finishOperation",
  )(function* (input) {
    const existing = yield* repository
      .getIndexOperation(input.operationId)
      .pipe(Effect.mapError(projectionMemoryError("get-index-operation")));
    if (Option.isNone(existing)) {
      return yield* new RepositoryIndexError({
        operation: "finish-index-operation",
        detail: `Index operation ${input.operationId} no longer exists.`,
      });
    }
    const now = yield* nowIso;
    yield* repository
      .saveIndexOperation({
        ...existing.value,
        status: input.status,
        processedSources: input.processedSources,
        changedSources: input.changedSources,
        skippedSources: input.skippedSources,
        failedSources: input.failedSources,
        errorSummary: input.errorSummary?.slice(0, 4_000) ?? null,
        completedAt: now,
      })
      .pipe(Effect.mapError(projectionMemoryError("finish-index-operation")));
  });

  return {
    loadState,
    startOperation,
    upsertSource,
    replaceChunks,
    reuseChunks: Effect.fn("RepositoryIndexer.store.reuseChunks")(function* (input) {
      const source = yield* repository
        .getIndexedSource(input.reuseFromIndexedSourceId)
        .pipe(Effect.mapError(projectionMemoryError("get-reusable-indexed-source")));
      if (Option.isNone(source)) {
        return yield* new RepositoryIndexError({
          operation: "reuse-indexed-chunks",
          detail: `Reusable indexed source ${input.reuseFromIndexedSourceId} no longer exists.`,
        });
      }
      const hits = yield* repository
        .listIndexedChunks({
          projectId: source.value.projectId,
          indexedSourceId: input.reuseFromIndexedSourceId,
          branchName: null,
          pathPrefix: null,
          limit: 10_000,
          offset: 0,
        })
        .pipe(Effect.mapError(projectionMemoryError("list-reusable-indexed-chunks")));
      yield* replaceChunks({
        indexedSourceId: input.indexedSourceId,
        chunks: hits.map(({ chunk }) => ({
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          contentFingerprint: chunk.contentFingerprint,
          tokenEstimate: chunk.tokenEstimate,
          symbolMetadata: chunk.symbolMetadata,
          embeddingStatus: chunk.embeddingStatus === "disabled" ? "disabled" : "queued",
        })),
      });
    }),
    markSourceRemoved: Effect.fn("RepositoryIndexer.store.markSourceRemoved")(function* (input) {
      const now = yield* nowIso;
      yield* repository
        .updateIndexedSourceStatus({
          indexedSourceId: input.indexedSourceId,
          status: "removed",
          skipReason: null,
          lastError: null,
          lastIndexedAt: now,
          updatedAt: now,
        })
        .pipe(Effect.mapError(projectionMemoryError("mark-indexed-source-removed")));
    }),
    finishOperation,
    recoverInterruptedOperations: Effect.fn("RepositoryIndexer.store.recoverInterruptedOperations")(
      function* ({ projectId }) {
        const recoveredAt = yield* nowIso;
        const recovered = yield* repository
          .recoverInterruptedIndexOperations({ projectId, recoveredAt })
          .pipe(Effect.mapError(projectionMemoryError("recover-index-operations")));
        return recovered.map(
          (operation): RepositoryIndexOperationState => ({
            id: operation.id,
            projectId: operation.projectId,
            operationType: operation.operationType,
            branchName: operation.branchName,
            commitHash: operation.commitHash,
            status: "interrupted",
          }),
        );
      },
    ),
  } satisfies RepositoryIndexStore;
});

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const store = yield* makeProjectionMemoryIndexStore();
  return yield* makeRepositoryIndexerWith(store, (input) =>
    git.execute(input).pipe(
      Effect.map((result) => ({
        exitCode: Number(result.exitCode),
        stdout: result.stdout,
        stderr: result.stderr,
      })),
      Effect.mapError(
        (cause) =>
          new RepositoryIndexError({
            operation: input.operation,
            detail: `Git source-intelligence command failed during ${input.operation}.`,
            cause,
          }),
      ),
    ),
  );
});

export const layer = Layer.effect(RepositoryIndexer, make);

export const layerWithStore = (store: RepositoryIndexStore, executeGit: RepositoryGitExecutor) =>
  Layer.effect(RepositoryIndexer, makeRepositoryIndexerWith(store, executeGit));
