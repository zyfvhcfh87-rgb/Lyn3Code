import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  IndexedChunkId,
  IndexedSourceId,
  MemoryIndexOperationId,
  ProjectId,
} from "@t3tools/contracts";

import {
  makeRepositoryIndexerWith,
  type RepositoryGitExecutor,
  type RepositoryIndexOperationState,
  type RepositoryIndexState,
  type RepositoryIndexStore,
  type StoredRepositoryChunk,
  type StoredRepositorySource,
} from "./RepositoryIndexer.ts";

const projectId = ProjectId.make("project-repository-indexer");

const makeMemoryStore = () => {
  let sourceSequence = 0;
  let chunkSequence = 0;
  let operationSequence = 0;
  const sources: StoredRepositorySource[] = [];
  const chunks = new Map<IndexedSourceId, StoredRepositoryChunk[]>();
  const operations: RepositoryIndexOperationState[] = [];

  const sourceIdentity = (source: {
    readonly projectId: ProjectId;
    readonly sourceType: "repository_file" | "repository_map";
    readonly sourceIdentifier: string;
    readonly branchName: string | null;
    readonly commitHash: string | null;
  }): string =>
    [
      source.projectId,
      source.sourceType,
      source.sourceIdentifier,
      source.branchName ?? "",
      source.commitHash ?? "",
    ].join("\0");

  const store: RepositoryIndexStore = {
    loadState: () =>
      Effect.succeed({
        sources: sources.map((source) => ({ ...source, chunks: chunks.get(source.id) ?? [] })),
        interruptedOperations: [...operations],
        repositoryMaps: [...chunks.values()]
          .flat()
          .flatMap((chunk) => (chunk.repositoryMap === null ? [] : [chunk.repositoryMap])),
      } satisfies RepositoryIndexState),
    startOperation: (input) => {
      const id = MemoryIndexOperationId.make(`operation-${++operationSequence}`);
      operations.push({ id, ...input, status: "running" });
      return Effect.succeed(id);
    },
    upsertSource: (input) => {
      const identity = sourceIdentity(input);
      const existingIndex = sources.findIndex((source) => sourceIdentity(source) === identity);
      const stored: StoredRepositorySource = {
        id:
          existingIndex >= 0
            ? (sources[existingIndex]?.id ?? IndexedSourceId.make("missing"))
            : IndexedSourceId.make(`source-${++sourceSequence}`),
        ...input,
        lastIndexedAt: "2026-08-03T00:00:00.000Z",
        chunks: [],
      };
      if (existingIndex >= 0) sources[existingIndex] = stored;
      else sources.push(stored);
      return Effect.succeed({ ...stored, chunks: chunks.get(stored.id) ?? [] });
    },
    replaceChunks: ({ indexedSourceId, chunks: drafts }) => {
      chunks.set(
        indexedSourceId,
        drafts.map((draft) => ({
          id: IndexedChunkId.make(`chunk-${++chunkSequence}`),
          chunkIndex: draft.chunkIndex,
          contentFingerprint: draft.contentFingerprint,
          repositoryMap:
            typeof draft.symbolMetadata === "object" &&
            draft.symbolMetadata !== null &&
            "repositoryMap" in draft.symbolMetadata
              ? (draft.symbolMetadata.repositoryMap as StoredRepositoryChunk["repositoryMap"])
              : null,
        })),
      );
      return Effect.void;
    },
    reuseChunks: ({ indexedSourceId, reuseFromIndexedSourceId }) => {
      chunks.set(
        indexedSourceId,
        (chunks.get(reuseFromIndexedSourceId) ?? []).map((chunk) => ({
          ...chunk,
          id: IndexedChunkId.make(`chunk-${++chunkSequence}`),
        })),
      );
      return Effect.void;
    },
    markSourceRemoved: ({ indexedSourceId }) => {
      const index = sources.findIndex((source) => source.id === indexedSourceId);
      const source = sources[index];
      if (source !== undefined) sources[index] = { ...source, indexStatus: "removed" };
      return Effect.void;
    },
    finishOperation: ({ operationId }) => {
      const index = operations.findIndex((operation) => operation.id === operationId);
      if (index >= 0) operations.splice(index, 1);
      return Effect.void;
    },
    recoverInterruptedOperations: () => {
      const interrupted = operations.filter(
        (operation) => operation.status === "queued" || operation.status === "running",
      );
      operations.splice(0, operations.length);
      return Effect.succeed(
        interrupted.map((operation) => ({ ...operation, status: "interrupted" })),
      );
    },
  };

  return { store, sources, chunks, operations };
};

interface FakeGitState {
  branch: string;
  commit: string;
  files: string[];
  status: string;
  diff: string;
}

const makeGitExecutor =
  (state: FakeGitState): RepositoryGitExecutor =>
  (input) => {
    const command = input.args[0];
    if (command === "rev-parse" && input.args[1] === "--show-toplevel") {
      return Effect.succeed({ exitCode: 0, stdout: `${input.cwd}\n`, stderr: "" });
    }
    if (command === "rev-parse") {
      return Effect.succeed({ exitCode: 0, stdout: `${state.commit}\n`, stderr: "" });
    }
    if (command === "symbolic-ref") {
      return Effect.succeed({ exitCode: 0, stdout: `${state.branch}\n`, stderr: "" });
    }
    if (command === "ls-files") {
      return Effect.succeed({ exitCode: 0, stdout: `${state.files.join("\0")}\0`, stderr: "" });
    }
    if (command === "status") {
      return Effect.succeed({ exitCode: 0, stdout: state.status, stderr: "" });
    }
    if (command === "diff") {
      return Effect.succeed({ exitCode: 0, stdout: state.diff, stderr: "" });
    }
    return Effect.succeed({ exitCode: 1, stdout: "", stderr: "unsupported fake git command" });
  };

const writeFile = Effect.fn("RepositoryIndexerTest.writeFile")(function* (
  repositoryRoot: string,
  relativePath: string,
  content: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(repositoryRoot, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
  yield* fileSystem.writeFileString(absolutePath, content);
});

describe("RepositoryIndexer", () => {
  it.effect(
    "indexes incrementally, removes deleted sources, skips secrets, and reuses fingerprints",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repositoryRoot = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "memory-indexer-incremental-",
        });
        yield* writeFile(repositoryRoot, "src/changed.ts", "export const value = 1;\n");
        yield* writeFile(repositoryRoot, "src/unchanged.ts", "export function stable() {}\n");
        yield* writeFile(repositoryRoot, "src/removed.ts", "export const removed = true;\n");
        yield* writeFile(repositoryRoot, ".env", "DATABASE_URL=postgres://secret\n");
        yield* writeFile(repositoryRoot, "dist/bundle.js", "secret-dist-value\n");

        const git: FakeGitState = {
          branch: "main",
          commit: "1111111111111111111111111111111111111111",
          files: ["src/changed.ts", "src/unchanged.ts", "src/removed.ts", ".env", "dist/bundle.js"],
          status: "",
          diff: "",
        };
        const memory = makeMemoryStore();
        const indexer = yield* makeRepositoryIndexerWith(memory.store, makeGitExecutor(git));

        const initial = yield* indexer.index({
          projectId,
          repositoryRoot,
          operationType: "full_reindex",
        });

        expect(initial).toMatchObject({
          processedSources: 5,
          changedSources: 3,
          skippedSources: 2,
          failedSources: 0,
        });
        expect(memory.sources.find((source) => source.relativePath === ".env")?.skipReason).toBe(
          "secret_bearing_path",
        );
        expect(
          memory.sources.find((source) => source.relativePath === "dist/bundle.js")?.skipReason,
        ).toBe("generated_or_dependency");

        yield* writeFile(repositoryRoot, "src/changed.ts", "export const value = 2;\n");
        yield* writeFile(repositoryRoot, "src/added.ts", "export const added = true;\n");
        yield* fileSystem.remove(path.join(repositoryRoot, "src/removed.ts"));
        git.files = [
          "src/changed.ts",
          "src/unchanged.ts",
          "src/added.ts",
          ".env",
          "dist/bundle.js",
        ];
        git.status = " M src/changed.ts\0?? src/added.ts\0 D src/removed.ts\0";

        const incremental = yield* indexer.index({
          projectId,
          repositoryRoot,
          operationType: "refresh_changed",
        });

        expect(incremental).toMatchObject({
          processedSources: 2,
          changedSources: 2,
          removedSources: 1,
          skippedSources: 0,
          failedSources: 0,
        });
        expect(
          memory.sources.some(
            (source) =>
              source.relativePath === "src/removed.ts" && source.indexStatus === "removed",
          ),
        ).toBe(true);
        expect(
          memory.sources.filter(
            (source) =>
              source.relativePath === "src/unchanged.ts" && source.indexStatus === "indexed",
          ),
        ).toHaveLength(1);
        expect(
          incremental.repositoryMap?.symbols.some(
            (entry) => entry.path === "src/unchanged.ts" && entry.names.includes("stable"),
          ),
        ).toBe(true);
        expect(
          memory.sources.filter(
            (source) =>
              source.relativePath === "src/changed.ts" && source.indexStatus === "indexed",
          ),
        ).toHaveLength(1);
        expect(
          memory.sources.some(
            (source) =>
              source.relativePath === "src/changed.ts" && source.indexStatus === "removed",
          ),
        ).toBe(true);
        expect(
          memory.sources.filter(
            (source) =>
              source.sourceType === "repository_map" &&
              source.branchName === null &&
              source.indexStatus === "indexed",
          ),
        ).toHaveLength(1);

        git.branch = "feature/memory";
        git.commit = "2222222222222222222222222222222222222222";
        git.status = "";
        const branch = yield* indexer.index({
          projectId,
          repositoryRoot,
          operationType: "branch_refresh",
          branchName: git.branch,
        });

        expect(branch.reusedChunkSources).toBeGreaterThanOrEqual(2);
        expect(
          memory.sources.some(
            (source) =>
              source.relativePath === "src/unchanged.ts" && source.branchName === "feature/memory",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("recovers only newly interrupted operations and does not duplicate chunks", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const repositoryRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "memory-indexer-recovery-",
      });
      yield* writeFile(repositoryRoot, "src/index.ts", "export const recovered = true;\n");
      const git: FakeGitState = {
        branch: "main",
        commit: "3333333333333333333333333333333333333333",
        files: ["src/index.ts"],
        status: "",
        diff: "",
      };
      const memory = makeMemoryStore();
      const indexer = yield* makeRepositoryIndexerWith(memory.store, makeGitExecutor(git));
      yield* indexer.index({ projectId, repositoryRoot, operationType: "full_reindex" });
      yield* memory.store.startOperation({
        projectId,
        operationType: "refresh_changed",
        branchName: null,
        commitHash: git.commit,
      });
      const chunkCountBefore = [...memory.chunks.values()].flat().length;

      const recovered = yield* indexer.recoverInterrupted([{ projectId, repositoryRoot }]);
      const secondRecovery = yield* indexer.recoverInterrupted([{ projectId, repositoryRoot }]);

      expect(recovered).toHaveLength(1);
      expect(secondRecovery).toHaveLength(0);
      expect([...memory.chunks.values()].flat()).toHaveLength(chunkCountBefore);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
