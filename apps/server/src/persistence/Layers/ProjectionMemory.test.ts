// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  IndexedChunkId,
  IndexedSourceId,
  MemoryEntryId,
  MemoryIndexOperationId,
  MissionId,
  MissionTaskId,
  ProjectId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlClientService from "effect/unstable/sql/SqlClient";

import {
  encodeMemoryEmbeddingVector,
  ProjectionMemoryRepository,
} from "../Services/ProjectionMemory.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionMemoryRepositoryLive } from "./ProjectionMemory.ts";

const now = "2026-08-03T10:00:00.000Z";
const projectId = ProjectId.make("memory-project");
const missionId = MissionId.make("memory-mission");
const taskId = MissionTaskId.make("memory-task");

const seedProject = Effect.gen(function* () {
  const sql = yield* SqlClientService.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'Memory', '/repo', NULL, '[]', ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_missions (
      mission_id, project_id, title, description, status, created_at, updated_at,
      started_at, completed_at, cancelled_at
    ) VALUES (${missionId}, ${projectId}, 'Memory mission', '', 'running', ${now}, ${now}, ${now}, NULL, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_mission_tasks (
      task_id, mission_id, title, description, status, position, created_at, updated_at,
      started_at, completed_at
    ) VALUES (${taskId}, ${missionId}, 'Memory task', '', 'running', 0, ${now}, ${now}, ${now}, NULL)
  `;
});

function makeLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  return Layer.mergeAll(
    ProjectionMemoryRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  );
}

const source = {
  sourceType: "repository_file" as const,
  sourceIdentifier: "apps/desktop/src/preload.ts",
  projectId,
  repositoryPath: "/repo",
  filePath: "apps/desktop/src/preload.ts",
  startLine: 1,
  endLine: 80,
  commitHash: "abc123",
  branchName: "main",
  missionId: null,
  taskId: null,
  agentRunId: null,
  verificationRunId: null,
  githubRecordType: null,
  githubRecordId: null,
  messageReference: null,
  contentFingerprint: "source-fingerprint",
};
const createInput = {
  scopeType: "project" as const,
  scopeId: projectId,
  projectId,
  branchName: null,
  missionId: null,
  taskId: null,
  type: "architecture_decision" as const,
  title: "Preload bridge",
  content: "Desktop renderer filesystem access must use the preload bridge.",
  structuredData: null,
  trustLevel: "verified" as const,
  confidence: 0.95,
  creationMode: "explicit" as const,
  createdByType: "user" as const,
  createdById: "maintainer",
  sources: [source],
  pinned: false,
  expiresAt: null,
};

const layer = it.layer(makeLayer(SqlitePersistenceMemory));

layer("persistent project memory repository", (it) => {
  it.effect("enforces provenance, lifecycle, duplicate detection, and supersession", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionMemoryRepository;
      const unresolved = yield* Effect.flip(
        repository.createEntry({
          ...createInput,
          title: "Unresolved source",
          content: "This claim has only an unresolved repository reference.",
          sources: [{ ...source, commitHash: null, contentFingerprint: null }],
        }),
      );
      assert.strictEqual(unresolved._tag, "MemoryValidationError");
      const created = yield* repository.createEntry(createInput);
      assert.strictEqual(created.entry.status, "active");
      assert.strictEqual(created.sources.length, 1);
      assert.deepStrictEqual(
        created.lifecycle.map((record) => record.action),
        ["created", "activated"],
      );
      const sourcePathMatches = yield* repository.listEntries({
        projectId,
        scopeTypes: [],
        types: [],
        statuses: [],
        trustLevels: [],
        sourceTypes: [],
        branchName: null,
        missionId: null,
        taskId: null,
        query: "apps/desktop/src/preload.ts",
        createdAfter: null,
        staleOnly: false,
        pinnedOnly: false,
        limit: 10,
        offset: 0,
      });
      assert.deepStrictEqual(
        sourcePathMatches.map((entry) => entry.id),
        [created.entry.id],
      );
      const duplicate = yield* Effect.flip(repository.createEntry(createInput));
      assert.strictEqual(duplicate._tag, "MemoryConflictError");

      const stale = yield* repository.applyEntryAction({
        memoryEntryId: created.entry.id,
        action: "mark_stale",
        reason: "Source changed",
        actorType: "system",
        actorId: null,
      });
      assert.strictEqual(stale.entry.status, "stale");
      const verified = yield* repository.applyEntryAction({
        memoryEntryId: created.entry.id,
        action: "verify",
        reason: "Rechecked",
        actorType: "user",
        actorId: "maintainer",
      });
      assert.strictEqual(verified.entry.status, "active");
      assert.notStrictEqual(verified.entry.lastVerifiedAt, null);

      const replacement = yield* repository.createEntry({
        ...createInput,
        title: "Preload API boundary",
        content: "Desktop renderer filesystem access uses the typed preload API only.",
      });
      const superseded = yield* repository.supersedeEntry({
        supersededMemoryEntryId: created.entry.id,
        replacementMemoryEntryId: replacement.entry.id,
        reason: "New approved boundary",
        actorType: "user",
        actorId: "maintainer",
      });
      assert.strictEqual(superseded.entry.status, "superseded");
      assert.strictEqual(superseded.entry.supersededById, replacement.entry.id);
      const cycle = yield* Effect.flip(
        repository.supersedeEntry({
          supersededMemoryEntryId: replacement.entry.id,
          replacementMemoryEntryId: created.entry.id,
          reason: "Invalid cycle",
          actorType: "user",
          actorId: "maintainer",
        }),
      );
      assert.strictEqual(cycle._tag, "MemoryValidationError");
    }),
  );

  it.effect("reviews proposals and performs phrase-aware lexical chunk retrieval", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionMemoryRepository;
      const proposal = yield* repository.createProposal({
        scopeType: "project",
        scopeId: projectId,
        projectId,
        branchName: null,
        missionId: null,
        taskId: null,
        proposedType: "coding_convention",
        proposedTitle: "Bridge convention",
        proposedContent: "Use the preload bridge for desktop capabilities.",
        proposedStructuredData: null,
        proposedTrustLevel: "supported",
        confidence: 0.8,
        extractionSource: "verified_handoff",
        sources: [source],
        expiresAt: null,
      });
      const accepted = yield* repository.reviewProposal({
        proposalId: proposal.id,
        action: "accept",
        reviewedBy: "maintainer",
        rejectionReason: null,
        duplicateOfMemoryEntryId: null,
        mergeIntoMemoryEntryId: null,
        editedEntry: null,
      });
      assert.strictEqual(accepted.status, "accepted");
      assert.notStrictEqual(accepted.acceptedMemoryEntryId, null);

      const editedProposal = yield* repository.createProposal({
        scopeType: "project",
        scopeId: projectId,
        projectId,
        branchName: null,
        missionId: null,
        taskId: null,
        proposedType: "known_issue",
        proposedTitle: "Original proposal title",
        proposedContent: "The original evidence-backed claim.",
        proposedStructuredData: null,
        proposedTrustLevel: "supported",
        confidence: 0.7,
        extractionSource: "verified_handoff",
        sources: [source],
        expiresAt: null,
      });
      const editedAccepted = yield* repository.reviewProposal({
        proposalId: editedProposal.id,
        action: "edit_and_accept",
        reviewedBy: "maintainer",
        rejectionReason: null,
        duplicateOfMemoryEntryId: null,
        mergeIntoMemoryEntryId: null,
        editedEntry: {
          ...createInput,
          type: "known_issue",
          title: "Corrected proposal title",
          content: "The corrected evidence-backed claim.",
          creationMode: "proposed",
          sources: [
            {
              ...source,
              sourceType: "derived",
              commitHash: null,
              contentFingerprint: null,
            },
          ],
        },
      });
      const editedDetail = yield* repository.getEntryDetail(editedAccepted.acceptedMemoryEntryId!);
      assert.isTrue(Option.isSome(editedDetail));
      if (Option.isSome(editedDetail)) {
        assert.strictEqual(editedDetail.value.sources[0]?.sourceType, "repository_file");
        assert.strictEqual(editedDetail.value.sources[0]?.contentFingerprint, "source-fingerprint");
      }

      const indexedSourceId = IndexedSourceId.make("indexed-preload");
      yield* repository.upsertIndexedSource({
        id: indexedSourceId,
        projectId,
        sourceType: "repository_file",
        sourceIdentifier: source.sourceIdentifier,
        relativePath: source.filePath,
        branchName: "main",
        commitHash: "abc123",
        contentFingerprint: "indexed-source-fingerprint",
        language: "typescript",
        sizeBytes: 120,
        indexStatus: "indexing",
        skipReason: null,
        lastIndexedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
      yield* repository.replaceIndexedChunks({
        indexedSourceId,
        lastIndexedAt: now,
        chunks: [
          {
            id: IndexedChunkId.make("chunk-preload"),
            indexedSourceId,
            chunkIndex: 0,
            startLine: 1,
            endLine: 10,
            content: "The preload bridge exposes a typed filesystem capability.",
            contentFingerprint: "chunk-fingerprint",
            tokenEstimate: 12,
            symbolMetadata: { symbols: ["preloadBridge"] },
            embeddingStatus: "disabled",
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const hits = yield* repository.searchIndexedChunks({
        projectId,
        query: '"preload bridge"',
        branchName: "main",
        pathPrefix: null,
        limit: 10,
      });
      assert.strictEqual(hits.length, 1);
      assert.strictEqual(hits[0]?.chunk.id, IndexedChunkId.make("chunk-preload"));

      yield* repository.saveIndexOperation({
        id: MemoryIndexOperationId.make("interrupted-index"),
        projectId,
        operationType: "refresh_changed",
        status: "running",
        branchName: "main",
        commitHash: "abc123",
        processedSources: 0,
        changedSources: 0,
        skippedSources: 0,
        failedSources: 0,
        errorSummary: null,
        requestedAt: now,
        startedAt: now,
        completedAt: null,
      });
      const recovered = yield* repository.recoverInterruptedIndexOperations({
        projectId,
        recoveredAt: "2026-08-03T10:05:00.000Z",
      });
      assert.strictEqual(recovered[0]?.status, "interrupted");
    }),
  );

  it.effect("exports entries and imports them as reviewable proposals without overwriting", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionMemoryRepository;
      const sql = yield* SqlClientService.SqlClient;
      const targetProjectId = ProjectId.make("memory-import-target");
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (${targetProjectId}, 'Imported memory', '/import-target', NULL, '[]', ${now}, ${now}, NULL)
      `;
      const created = yield* repository.createEntry(createInput);
      const bundle = yield* repository.exportMemory(projectId);
      assert.ok(bundle.entries.some((detail) => detail.entry.id === created.entry.id));

      const imported = yield* repository.importMemory({
        bundle,
        targetProjectId,
        conflictPolicy: "propose",
        importedBy: "maintainer",
      });
      assert.strictEqual(imported.importedEntryIds.length, 0);
      assert.strictEqual(imported.createdProposalIds.length, bundle.entries.length);
      const proposals = yield* repository.listProposals({
        projectId: targetProjectId,
        statuses: ["pending"],
        limit: 10,
        offset: 0,
      });
      const importedProposal = proposals.find(
        (proposal) => proposal.proposedTitle === created.entry.title,
      );
      assert.ok(importedProposal);
      assert.strictEqual(importedProposal.sourceReferences[0]?.projectId, targetProjectId);
    }),
  );

  it.effect("reads only current provider-, model-, dimension-, and branch-safe embeddings", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionMemoryRepository;
      const indexedSourceId = IndexedSourceId.make("semantic-source");
      yield* repository.upsertIndexedSource({
        id: indexedSourceId,
        projectId,
        sourceType: "repository_file",
        sourceIdentifier: "src/semantic.ts",
        relativePath: "src/semantic.ts",
        branchName: "main",
        commitHash: "semantic-commit",
        contentFingerprint: "semantic-source-fingerprint",
        language: "typescript",
        sizeBytes: 200,
        indexStatus: "indexing",
        skipReason: null,
        lastIndexedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
      const firstChunkId = IndexedChunkId.make("semantic-first");
      const secondChunkId = IndexedChunkId.make("semantic-second");
      yield* repository.replaceIndexedChunks({
        indexedSourceId,
        lastIndexedAt: now,
        chunks: [
          {
            id: firstChunkId,
            indexedSourceId,
            chunkIndex: 0,
            startLine: 1,
            endLine: 2,
            content: "Use the preload bridge.",
            contentFingerprint: "semantic-first-fingerprint",
            tokenEstimate: 5,
            symbolMetadata: null,
            embeddingStatus: "disabled",
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: secondChunkId,
            indexedSourceId,
            chunkIndex: 1,
            startLine: 3,
            endLine: 4,
            content: "Use the worker queue.",
            contentFingerprint: "semantic-second-fingerprint",
            tokenEstimate: 5,
            symbolMetadata: null,
            embeddingStatus: "disabled",
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      yield* repository.saveChunkEmbedding({
        indexedChunkId: firstChunkId,
        providerId: "local-test",
        model: "tiny-v1",
        dimensions: 2,
        vector: encodeMemoryEmbeddingVector([1, 0]),
        contentFingerprint: "semantic-first-fingerprint",
        createdAt: now,
        updatedAt: now,
      });
      yield* repository.saveChunkEmbedding({
        indexedChunkId: secondChunkId,
        providerId: "local-test",
        model: "tiny-v1",
        dimensions: 2,
        vector: encodeMemoryEmbeddingVector([0, 1]),
        contentFingerprint: "semantic-second-fingerprint",
        createdAt: now,
        updatedAt: now,
      });

      const hits = yield* repository.searchChunkEmbeddings({
        projectId,
        branchName: "main",
        pathPrefix: "src/",
        providerId: "local-test",
        model: "tiny-v1",
        dimensions: 2,
        queryVector: [0.95, 0.05],
        limit: 10,
      });
      assert.deepStrictEqual(
        hits.map((hit) => hit.chunk.id),
        [firstChunkId, secondChunkId],
      );
      assert.isAbove(hits[0]?.similarity ?? 0, hits[1]?.similarity ?? 0);
      assert.deepStrictEqual(
        yield* repository.searchIndexedChunks({
          projectId,
          query: '"preload bridge"',
          branchName: null,
          pathPrefix: null,
          limit: 10,
        }),
        [],
      );
      assert.deepStrictEqual(
        yield* repository.searchChunkEmbeddings({
          projectId,
          branchName: null,
          pathPrefix: null,
          providerId: "local-test",
          model: "tiny-v1",
          dimensions: 2,
          queryVector: [1, 0],
          limit: 10,
        }),
        [],
      );
      assert.deepStrictEqual(
        yield* repository.searchChunkEmbeddings({
          projectId,
          branchName: "other",
          pathPrefix: null,
          providerId: "local-test",
          model: "tiny-v1",
          dimensions: 2,
          queryVector: [1, 0],
          limit: 10,
        }),
        [],
      );
      assert.deepStrictEqual(
        yield* repository.searchChunkEmbeddings({
          projectId,
          branchName: "main",
          pathPrefix: null,
          providerId: "local-test",
          model: "tiny-v2",
          dimensions: 2,
          queryVector: [1, 0],
          limit: 10,
        }),
        [],
      );
      const invalidQuery = yield* Effect.flip(
        repository.searchChunkEmbeddings({
          projectId,
          branchName: "main",
          pathPrefix: null,
          providerId: "local-test",
          model: "tiny-v1",
          dimensions: 3,
          queryVector: [1, 0],
          limit: 10,
        }),
      );
      assert.strictEqual(invalidQuery._tag, "MemoryValidationError");
      const invalidStoredVector = yield* Effect.flip(
        repository.saveChunkEmbedding({
          indexedChunkId: firstChunkId,
          providerId: "local-test",
          model: "tiny-v1",
          dimensions: 2,
          vector: new Uint8Array([1, 2]),
          contentFingerprint: "semantic-first-fingerprint",
          createdAt: now,
          updatedAt: now,
        }),
      );
      assert.strictEqual(invalidStoredVector._tag, "MemoryValidationError");
    }),
  );
});

describe("persistent memory restart recovery", () => {
  it.effect("reopens entries and safely interrupts unfinished indexing", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-memory-"))),
      (tempDir) =>
        Effect.gen(function* () {
          const dbPath = NodePath.join(tempDir, "state.sqlite");
          let entryId: MemoryEntryId | null = null;
          yield* Effect.gen(function* () {
            yield* seedProject;
            const repository = yield* ProjectionMemoryRepository;
            const created = yield* repository.createEntry(createInput);
            entryId = created.entry.id;
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));
          yield* Effect.gen(function* () {
            const repository = yield* ProjectionMemoryRepository;
            assert.notStrictEqual(entryId, null);
            const detail = yield* repository.getEntryDetail(entryId!);
            assert.strictEqual(Option.isSome(detail), true);
            assert.strictEqual(Option.getOrThrow(detail).entry.status, "active");
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));
        }),
      (tempDir) => Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
