import {
  IndexedSourceId,
  MemoryEntryId,
  MemorySourceId,
  ProjectId,
  type IndexedSource,
  type MemoryEntry,
  type MemoryEntryActionInput,
  type MemorySource,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  assessMemoryStaleness,
  makeMemoryStalenessService,
  makeProjectionMemorySourceFreshnessResolver,
} from "./MemoryStalenessService.ts";

const now = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("staleness-project");
const memoryEntryId = MemoryEntryId.make("staleness-memory");
const sourceId = MemorySourceId.make("staleness-source");

const entry: MemoryEntry = {
  id: memoryEntryId,
  scopeType: "project",
  scopeId: projectId,
  projectId,
  branchName: null,
  missionId: null,
  taskId: null,
  type: "repository_fact",
  title: "Source-backed fact",
  content: "The setting is enabled.",
  structuredData: null,
  trustLevel: "authoritative",
  status: "active",
  confidence: 1,
  createdByType: "system",
  createdById: null,
  creationMode: "automatic_authoritative",
  pinned: false,
  createdAt: now,
  updatedAt: now,
  lastVerifiedAt: now,
  expiresAt: null,
  supersededById: null,
  contradictionGroupId: null,
  staleReason: null,
};

const source: MemorySource = {
  id: sourceId,
  memoryEntryId,
  sourceType: "repository_file",
  sourceIdentifier: "src/config.ts",
  projectId,
  repositoryPath: "C:/repo",
  filePath: "src/config.ts",
  startLine: 1,
  endLine: 20,
  commitHash: "abc123",
  branchName: null,
  missionId: null,
  taskId: null,
  agentRunId: null,
  verificationRunId: null,
  githubRecordType: null,
  githubRecordId: null,
  messageReference: null,
  contentFingerprint: "old-fingerprint",
  sourceStatus: "resolved",
  createdAt: now,
};

const indexedSource = (input: {
  readonly fingerprint: string;
  readonly status?: IndexedSource["indexStatus"];
}): IndexedSource => ({
  id: IndexedSourceId.make("indexed-config"),
  projectId,
  sourceType: "repository_file",
  sourceIdentifier: "src/config.ts",
  relativePath: "src/config.ts",
  branchName: null,
  commitHash: "def456",
  contentFingerprint: input.fingerprint,
  language: "typescript",
  sizeBytes: 100,
  indexStatus: input.status ?? "indexed",
  skipReason: null,
  lastIndexedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
});

describe("MemoryStalenessService", () => {
  it.effect("resolves repository fingerprints as current, changed, or missing", () =>
    Effect.gen(function* () {
      const current = makeProjectionMemorySourceFreshnessResolver({
        listIndexedSources: () =>
          Effect.succeed([indexedSource({ fingerprint: "old-fingerprint" })]),
      });
      const changed = makeProjectionMemorySourceFreshnessResolver({
        listIndexedSources: () =>
          Effect.succeed([indexedSource({ fingerprint: "new-fingerprint" })]),
      });
      const missing = makeProjectionMemorySourceFreshnessResolver({
        listIndexedSources: () => Effect.succeed([]),
      });

      expect((yield* current.resolve(source)).freshness).toBe("current");
      expect((yield* changed.resolve(source)).freshness).toBe("changed");
      expect((yield* missing.resolve(source)).freshness).toBe("missing");
    }),
  );

  it("preserves unresolved evidence without falsely declaring it stale", () => {
    expect(
      assessMemoryStaleness({
        entry,
        sources: [source],
        freshness: [
          {
            sourceId,
            freshness: "unresolved",
            currentFingerprint: null,
            reason: "Index refresh has not finished",
          },
        ],
        nowEpochMillis: Date.parse(now),
      }),
    ).toMatchObject({ stale: false, unresolvedSourceIds: [sourceId] });
  });

  it.effect("marks changed memories stale while retaining the historical entry", () =>
    Effect.gen(function* () {
      const actions: Array<MemoryEntryActionInput> = [];
      const service = makeMemoryStalenessService({
        repository: {
          listEntries: () => Effect.succeed([entry]),
          listEntrySources: () => Effect.succeed([source]),
          applyEntryAction: (action) => {
            actions.push(action);
            return Effect.succeed({
              entry: { ...entry, status: "stale" as const, staleReason: action.reason },
              sources: [source],
              relations: [],
              lifecycle: [],
              retrievalCount: 0,
            });
          },
        },
        freshnessResolver: {
          resolve: () =>
            Effect.succeed({
              sourceId,
              freshness: "changed",
              currentFingerprint: "new-fingerprint",
              reason: "Fingerprint changed",
            }),
        },
      });

      const assessments = yield* service.refreshProject(projectId);
      expect(assessments[0]).toMatchObject({ stale: true, changedSourceIds: [sourceId] });
      expect(actions).toEqual([
        expect.objectContaining({
          memoryEntryId,
          action: "mark_stale",
          actorType: "system",
        }),
      ]);
      expect(entry.status).toBe("active");
    }),
  );
});
