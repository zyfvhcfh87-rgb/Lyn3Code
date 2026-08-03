// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  IndexedSourceId,
  MemoryRetrievalRecordId,
  MissionId,
  MissionTaskId,
  ProjectId,
  type CreateMemoryEntryInput,
  type MemoryEntryId as MemoryEntryIdType,
  type MemoryScopeType,
  type MemorySourceDraft,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlClientService from "effect/unstable/sql/SqlClient";

import { ProjectionMemoryRepositoryLive } from "../persistence/Layers/ProjectionMemory.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import { ProjectionMemoryRepository } from "../persistence/Services/ProjectionMemory.ts";
import { makeMemoryRetrieval } from "./MemoryRetrieval.ts";
import { makeProjectionMemoryRetrievalDataSource } from "./ProjectionMemoryRetrievalDataSource.ts";
import {
  makeMemoryStalenessService,
  makeProjectionMemorySourceFreshnessResolver,
} from "./MemoryStalenessService.ts";

const now = "2026-08-03T14:00:00.000Z";
const projectId = ProjectId.make("memory-integration-project");
const missionId = MissionId.make("memory-integration-mission");
const taskId = MissionTaskId.make("memory-integration-task");
const currentBranch = "agent/memory/current";
const otherBranch = "agent/memory/other";

const seedProject = Effect.gen(function* () {
  const sql = yield* SqlClientService.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'Memory integration', '/repo', NULL, '[]', ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_missions (
      mission_id, project_id, title, description, status, created_at, updated_at,
      started_at, completed_at, cancelled_at
    ) VALUES (
      ${missionId}, ${projectId}, 'Memory integration', '', 'running', ${now}, ${now},
      ${now}, NULL, NULL
    )
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_mission_tasks (
      task_id, mission_id, title, description, status, position, created_at, updated_at,
      started_at, completed_at
    ) VALUES (
      ${taskId}, ${missionId}, 'Memory integration', '', 'running', 0, ${now}, ${now},
      ${now}, NULL
    )
  `;
});

function makeLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  return Layer.mergeAll(
    ProjectionMemoryRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  );
}

const source = (
  sourceIdentifier: string,
  overrides: Partial<MemorySourceDraft> = {},
): MemorySourceDraft => ({
  sourceType: "user_instruction",
  sourceIdentifier,
  projectId,
  repositoryPath: null,
  filePath: null,
  startLine: null,
  endLine: null,
  commitHash: null,
  branchName: null,
  missionId: null,
  taskId: null,
  agentRunId: null,
  verificationRunId: null,
  githubRecordType: null,
  githubRecordId: null,
  messageReference: `instruction:${sourceIdentifier}`,
  contentFingerprint: `fingerprint:${sourceIdentifier}`,
  ...overrides,
});

const entryInput = (
  scopeType: MemoryScopeType,
  title: string,
  content: string,
  branchName: string | null = null,
): CreateMemoryEntryInput => ({
  scopeType,
  scopeId:
    scopeType === "user"
      ? null
      : scopeType === "project"
        ? projectId
        : scopeType === "branch"
          ? branchName
          : scopeType === "mission"
            ? missionId
            : taskId,
  projectId: scopeType === "user" ? null : projectId,
  branchName: scopeType === "branch" ? branchName : null,
  missionId: scopeType === "mission" || scopeType === "task" ? missionId : null,
  taskId: scopeType === "task" ? taskId : null,
  type: scopeType === "user" ? "user_preference" : "coding_convention",
  title,
  content,
  structuredData: null,
  trustLevel: "verified",
  confidence: 0.95,
  creationMode: "explicit",
  createdByType: "user",
  createdById: "maintainer",
  sources: [source(title, { projectId: scopeType === "user" ? null : projectId })],
  pinned: false,
  expiresAt: null,
});

const retrievalRequest = (query: string) => ({
  projectId,
  branchName: currentBranch,
  missionId,
  taskId,
  query,
  mode: "lexical" as const,
  pathPrefix: null,
  types: [],
  statuses: [],
  minimumTrust: null,
  tokenBudget: 1_000,
  limit: 20,
  agentRunId: null,
  threadId: null,
  messageId: null,
});

describe("persistent project memory integration", () => {
  it.effect(
    "persists scoped retrieval, reviewed proposals, bounded audits, and disabled state",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-memory-e2e-"))),
        (tempDir) => {
          const dbPath = NodePath.join(tempDir, "state.sqlite");
          let auditSequence = 0;
          const nextAuditId = Effect.sync(() =>
            MemoryRetrievalRecordId.make(`memory-integration-audit-${++auditSequence}`),
          );
          const expectedIds: Array<MemoryEntryIdType> = [];

          return Effect.gen(function* () {
            yield* Effect.gen(function* () {
              yield* seedProject;
              const repository = yield* ProjectionMemoryRepository;
              yield* repository.updateSettings({
                projectId,
                contextTokenBudget: 1_000,
                lexicalOnly: true,
                semanticRetrievalEnabled: false,
              });

              const user = yield* repository.createEntry(
                entryInput("user", "Generic bridge protocol", "Use the generic bridge protocol."),
              );
              const project = yield* repository.createEntry(
                entryInput(
                  "project",
                  "Project bridge protocol",
                  "Use the project bridge protocol.",
                ),
              );
              const current = yield* repository.createEntry(
                entryInput(
                  "branch",
                  "Current branch bridge protocol",
                  "Use the current branch bridge protocol.",
                  currentBranch,
                ),
              );
              const other = yield* repository.createEntry(
                entryInput(
                  "branch",
                  "Other branch bridge protocol",
                  "Use the other branch bridge protocol.",
                  otherBranch,
                ),
              );
              expectedIds.push(current.entry.id, project.entry.id, user.entry.id);

              const pending = yield* repository.createProposal({
                scopeType: "project",
                scopeId: projectId,
                projectId,
                branchName: null,
                missionId: null,
                taskId: null,
                proposedType: "test_procedure",
                proposedTitle: "Accepted validation procedure",
                proposedContent: "Run the accepted validation procedure before integration.",
                proposedStructuredData: null,
                proposedTrustLevel: "supported",
                confidence: 0.85,
                extractionSource: "verified_handoff",
                sources: [source("accepted-validation")],
                expiresAt: null,
              });
              const rejected = yield* repository.createProposal({
                scopeType: "project",
                scopeId: projectId,
                projectId,
                branchName: null,
                missionId: null,
                taskId: null,
                proposedType: "failed_approach",
                proposedTitle: "Rejected validation procedure",
                proposedContent: "Run the rejected validation procedure.",
                proposedStructuredData: null,
                proposedTrustLevel: "unverified",
                confidence: 0.4,
                extractionSource: "agent_handoff",
                sources: [source("rejected-validation")],
                expiresAt: null,
              });

              const retrieval = makeMemoryRetrieval({
                dataSource: makeProjectionMemoryRetrievalDataSource(repository),
                embeddingProvider: { configured: Option.none() },
                now: Effect.succeed(DateTime.makeUnsafe(now)),
                nextAuditId,
              });
              const scoped = yield* retrieval.retrieve(retrievalRequest("bridge protocol"));
              const scopedIds = scoped.context.memories.map((memory) => memory.entry.id);
              assert.sameMembers(scopedIds, expectedIds);
              assert.notInclude(
                scoped.context.memories.map((memory) => memory.entry.id),
                other.entry.id,
              );
              assert.isAtMost(scoped.context.tokenEstimate, 1_000);

              const beforeReview = yield* retrieval.retrieve(
                retrievalRequest("accepted validation procedure"),
              );
              assert.deepStrictEqual(beforeReview.context.memories, []);

              const accepted = yield* repository.reviewProposal({
                proposalId: pending.id,
                action: "accept",
                reviewedBy: "maintainer",
                rejectionReason: null,
                duplicateOfMemoryEntryId: null,
                mergeIntoMemoryEntryId: null,
                editedEntry: null,
              });
              assert.notStrictEqual(accepted.acceptedMemoryEntryId, null);
              const afterReview = yield* retrieval.retrieve(
                retrievalRequest("accepted validation procedure"),
              );
              assert.deepStrictEqual(
                afterReview.context.memories.map((memory) => memory.entry.id),
                [accepted.acceptedMemoryEntryId],
              );
              yield* repository.reviewProposal({
                proposalId: rejected.id,
                action: "reject",
                reviewedBy: "maintainer",
                rejectionReason: "Unsupported by project sources",
                duplicateOfMemoryEntryId: null,
                mergeIntoMemoryEntryId: null,
                editedEntry: null,
              });

              yield* repository.updateSettings({ projectId, enabled: false });
              const disabled = yield* retrieval.retrieve(retrievalRequest("bridge protocol"));
              assert.strictEqual(disabled.context.retrievalMode, "disabled");
              assert.deepStrictEqual(disabled.context.memories, []);
              yield* repository.updateSettings({ projectId, enabled: true });
            }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));

            yield* Effect.gen(function* () {
              const repository = yield* ProjectionMemoryRepository;
              const retrieval = makeMemoryRetrieval({
                dataSource: makeProjectionMemoryRetrievalDataSource(repository),
                embeddingProvider: { configured: Option.none() },
                now: Effect.succeed(DateTime.makeUnsafe(now)),
                nextAuditId,
              });
              const reopened = yield* retrieval.retrieve(retrievalRequest("bridge protocol"));
              assert.sameMembers(
                reopened.context.memories.map((memory) => memory.entry.id),
                expectedIds,
              );
              const records = yield* repository.listRetrievalRecords({
                projectId,
                agentRunId: null,
                threadId: null,
                limit: 20,
                offset: 0,
              });
              assert.strictEqual(records.length, 5);
              assert.isTrue(records.some((record) => record.status === "disabled"));
              assert.isTrue(
                records.some(
                  (record) =>
                    record.status === "completed" &&
                    record.selectedMemoryIds.includes(expectedIds[0]!),
                ),
              );
            }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));
          });
        },
        (tempDir) => Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("marks changed sources stale while preserving superseded and disputed history", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionMemoryRepository;
      const sourceBacked = yield* repository.createEntry({
        ...entryInput(
          "project",
          "Source-backed renderer transport",
          "The renderer transport uses the preload channel.",
        ),
        sources: [
          source("src/transport.ts", {
            sourceType: "repository_file",
            sourceIdentifier: "src/transport.ts",
            repositoryPath: "/repo",
            filePath: "src/transport.ts",
            commitHash: "abc123",
            contentFingerprint: "old-source-fingerprint",
          }),
        ],
      });
      yield* repository.upsertIndexedSource({
        id: IndexedSourceId.make("memory-integration-indexed-source"),
        projectId,
        sourceType: "repository_file",
        sourceIdentifier: "src/transport.ts",
        relativePath: "src/transport.ts",
        branchName: null,
        commitHash: "def456",
        contentFingerprint: "new-source-fingerprint",
        language: "typescript",
        sizeBytes: 120,
        indexStatus: "indexed",
        skipReason: null,
        lastIndexedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
      const staleness = makeMemoryStalenessService({
        repository,
        freshnessResolver: makeProjectionMemorySourceFreshnessResolver(repository),
      });
      const assessments = yield* staleness.refreshProject(projectId);
      assert.strictEqual(assessments.length, 1);
      assert.isTrue(assessments[0]?.stale ?? false);
      const staleDetail = Option.getOrThrow(
        yield* repository.getEntryDetail(sourceBacked.entry.id),
      );
      assert.strictEqual(staleDetail.entry.status, "stale");
      assert.include(staleDetail.entry.staleReason ?? "", "fingerprint changed");

      const replacement = yield* repository.createEntry(
        entryInput(
          "project",
          "Replacement renderer transport",
          "The renderer transport uses the typed preload bridge.",
        ),
      );
      yield* repository.supersedeEntry({
        supersededMemoryEntryId: sourceBacked.entry.id,
        replacementMemoryEntryId: replacement.entry.id,
        reason: "The source-backed boundary was revised",
        actorType: "user",
        actorId: "maintainer",
      });
      const historical = Option.getOrThrow(yield* repository.getEntryDetail(sourceBacked.entry.id));
      assert.strictEqual(historical.entry.status, "superseded");
      assert.strictEqual(historical.entry.supersededById, replacement.entry.id);

      const firstConflict = yield* repository.createEntry(
        entryInput("project", "Conflicting formatter A", "The formatter must use tabs."),
      );
      const secondConflict = yield* repository.createEntry(
        entryInput("project", "Conflicting formatter B", "The formatter must use spaces."),
      );
      yield* repository.createRelation({
        fromMemoryEntryId: firstConflict.entry.id,
        toMemoryEntryId: secondConflict.entry.id,
        relationType: "contradicts",
      });
      const firstDetail = Option.getOrThrow(
        yield* repository.getEntryDetail(firstConflict.entry.id),
      );
      const secondDetail = Option.getOrThrow(
        yield* repository.getEntryDetail(secondConflict.entry.id),
      );
      assert.strictEqual(firstDetail.entry.status, "disputed");
      assert.strictEqual(secondDetail.entry.status, "disputed");
      assert.notStrictEqual(firstDetail.entry.contradictionGroupId, null);
      assert.strictEqual(
        firstDetail.entry.contradictionGroupId,
        secondDetail.entry.contradictionGroupId,
      );

      const activeHits = yield* repository.searchEligibleEntries({
        projectId,
        branchName: currentBranch,
        missionId,
        taskId,
        query: "renderer transport",
        mode: "lexical",
        pathPrefix: null,
        types: [],
        statuses: [],
        minimumTrust: null,
        tokenBudget: 1_000,
        limit: 20,
      });
      assert.deepStrictEqual(
        activeHits.map((hit) => hit.entry.id),
        [replacement.entry.id],
      );
      assert.notInclude(
        activeHits.map((hit) => hit.entry.id),
        sourceBacked.entry.id,
      );
    }).pipe(
      Effect.provide(
        makeLayer(makeSqlitePersistenceLive(":memory:")).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});
