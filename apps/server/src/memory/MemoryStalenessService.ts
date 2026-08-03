import {
  MemoryAggregateId,
  type IndexedSource,
  type MemoryEntry,
  type MemorySource,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  ProjectionMemoryRepository,
  type ProjectionMemoryRepositoryShape,
} from "../persistence/Services/ProjectionMemory.ts";
import { MemoryEventRecorder } from "./MemoryEventRecorder.ts";

export type MemorySourceFreshness = "current" | "changed" | "missing" | "unresolved";

export interface MemorySourceFreshnessResult {
  readonly sourceId: MemorySource["id"];
  readonly freshness: MemorySourceFreshness;
  readonly currentFingerprint: string | null;
  readonly reason: string | null;
}

export class MemoryStalenessError extends Schema.TaggedErrorClass<MemoryStalenessError>()(
  "MemoryStalenessError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export interface MemorySourceFreshnessResolverShape {
  readonly resolve: (
    source: MemorySource,
  ) => Effect.Effect<MemorySourceFreshnessResult, MemoryStalenessError>;
}

export class MemorySourceFreshnessResolver extends Context.Service<
  MemorySourceFreshnessResolver,
  MemorySourceFreshnessResolverShape
>()("t3/memory/MemoryStalenessService/MemorySourceFreshnessResolver") {}

export interface MemoryStalenessAssessment {
  readonly memoryEntryId: MemoryEntry["id"];
  readonly stale: boolean;
  readonly reason: string | null;
  readonly changedSourceIds: ReadonlyArray<MemorySource["id"]>;
  readonly missingSourceIds: ReadonlyArray<MemorySource["id"]>;
  readonly unresolvedSourceIds: ReadonlyArray<MemorySource["id"]>;
}

export const assessMemoryStaleness = (input: {
  readonly entry: MemoryEntry;
  readonly sources: ReadonlyArray<MemorySource>;
  readonly freshness: ReadonlyArray<MemorySourceFreshnessResult>;
  readonly nowEpochMillis: number;
}): MemoryStalenessAssessment => {
  const changedSourceIds = input.freshness
    .filter((result) => result.freshness === "changed")
    .map((result) => result.sourceId);
  const missingSourceIds = input.freshness
    .filter((result) => result.freshness === "missing")
    .map((result) => result.sourceId);
  const unresolvedSourceIds = input.freshness
    .filter((result) => result.freshness === "unresolved")
    .map((result) => result.sourceId);
  const expired =
    input.entry.expiresAt !== null &&
    DateTime.toEpochMillis(DateTime.makeUnsafe(input.entry.expiresAt)) <= input.nowEpochMillis;
  const reasons: Array<string> = [];
  if (expired) reasons.push(`Memory expired at ${input.entry.expiresAt}`);
  if (changedSourceIds.length > 0) {
    reasons.push(`${changedSourceIds.length} supporting source fingerprint changed`);
  }
  if (missingSourceIds.length > 0) {
    reasons.push(`${missingSourceIds.length} supporting source is missing`);
  }
  return {
    memoryEntryId: input.entry.id,
    stale: reasons.length > 0,
    reason: reasons.length === 0 ? null : reasons.join("; ").slice(0, 4_000),
    changedSourceIds,
    missingSourceIds,
    unresolvedSourceIds,
  };
};

const normalPath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const sourcePath = (source: MemorySource) =>
  source.filePath ??
  (source.sourceType === "repository_file" ||
  source.sourceType === "agents_file" ||
  source.sourceType === "documentation"
    ? source.sourceIdentifier
    : null);

const resolveAgainstIndex = (
  source: MemorySource,
  indexed: ReadonlyArray<IndexedSource>,
): MemorySourceFreshnessResult => {
  const path = sourcePath(source);
  if (path === null || source.contentFingerprint === null) {
    return {
      sourceId: source.id,
      freshness: "unresolved",
      currentFingerprint: null,
      reason: "Source does not have a comparable repository fingerprint",
    };
  }
  const normalizedPath = normalPath(path);
  const current = indexed
    .filter(
      (candidate) =>
        candidate.branchName === source.branchName &&
        candidate.relativePath !== null &&
        normalPath(candidate.relativePath) === normalizedPath,
    )
    .sort((left, right) => {
      const statusPriority = (status: IndexedSource["indexStatus"]) =>
        status === "indexed" ? 3 : status === "stale" ? 2 : status === "removed" ? 0 : 1;
      return (
        statusPriority(right.indexStatus) - statusPriority(left.indexStatus) ||
        (right.lastIndexedAt ?? "").localeCompare(left.lastIndexedAt ?? "")
      );
    })[0];
  if (current === undefined || current.indexStatus === "removed") {
    return {
      sourceId: source.id,
      freshness: source.sourceStatus === "unresolved" ? "unresolved" : "missing",
      currentFingerprint: null,
      reason: "The indexed repository source is missing",
    };
  }
  if (current.indexStatus !== "indexed" && current.indexStatus !== "stale") {
    return {
      sourceId: source.id,
      freshness: "unresolved",
      currentFingerprint: current.contentFingerprint,
      reason: `Indexed source status is ${current.indexStatus}`,
    };
  }
  if (current.contentFingerprint !== source.contentFingerprint) {
    return {
      sourceId: source.id,
      freshness: "changed",
      currentFingerprint: current.contentFingerprint,
      reason: "The indexed repository source fingerprint changed",
    };
  }
  return {
    sourceId: source.id,
    freshness: "current",
    currentFingerprint: current.contentFingerprint,
    reason: null,
  };
};

const stalenessError = (operation: string) =>
  Effect.mapError(
    () =>
      new MemoryStalenessError({
        operation,
        message: `Memory staleness operation failed: ${operation}`,
      }),
  );

export const makeProjectionMemorySourceFreshnessResolver = (
  repository: Pick<ProjectionMemoryRepositoryShape, "listIndexedSources">,
): MemorySourceFreshnessResolverShape => ({
  resolve: (source) => {
    if (source.projectId === null || sourcePath(source) === null) {
      return Effect.succeed({
        sourceId: source.id,
        freshness: "unresolved",
        currentFingerprint: null,
        reason: "Source is not a repository-backed project source",
      });
    }
    return repository
      .listIndexedSources({
        projectId: source.projectId,
        branchName: source.branchName,
        statuses: ["queued", "indexing", "indexed", "skipped", "stale", "failed", "removed"],
        limit: 10_000,
        offset: 0,
      })
      .pipe(
        Effect.map((indexed) => resolveAgainstIndex(source, indexed)),
        stalenessError("listIndexedSources"),
      );
  },
});

export interface MemoryStalenessServiceShape {
  readonly refreshProject: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyArray<MemoryStalenessAssessment>, MemoryStalenessError>;
}

export class MemoryStalenessService extends Context.Service<
  MemoryStalenessService,
  MemoryStalenessServiceShape
>()("t3/memory/MemoryStalenessService") {}

export const makeMemoryStalenessService = (dependencies: {
  readonly repository: Pick<
    ProjectionMemoryRepositoryShape,
    "listEntries" | "listEntrySources" | "applyEntryAction"
  > &
    Partial<Pick<ProjectionMemoryRepositoryShape, "updateMemorySourceStatus">>;
  readonly freshnessResolver: MemorySourceFreshnessResolverShape;
  readonly recordMarkedStale?: (entry: MemoryEntry, reason: string) => Effect.Effect<void, never>;
  readonly recordSourceFreshness?: (
    entry: MemoryEntry,
    source: MemorySource,
    freshness: "changed" | "missing",
  ) => Effect.Effect<void, never>;
}): MemoryStalenessServiceShape => {
  const refreshProject: MemoryStalenessServiceShape["refreshProject"] = (projectId) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const entries = yield* dependencies.repository.listEntries({
        projectId,
        scopeTypes: ["project", "branch", "mission", "task"],
        types: [],
        statuses: ["active", "stale"],
        trustLevels: [],
        sourceTypes: [],
        branchName: null,
        missionId: null,
        taskId: null,
        query: "",
        createdAfter: null,
        staleOnly: false,
        pinnedOnly: false,
        limit: 10_000,
        offset: 0,
      });
      return yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const sources = yield* dependencies.repository.listEntrySources(entry.id);
            const freshness = yield* Effect.forEach(
              sources,
              (source) => dependencies.freshnessResolver.resolve(source),
              {
                concurrency: 4,
              },
            );
            if (dependencies.repository.updateMemorySourceStatus !== undefined) {
              yield* Effect.forEach(
                freshness,
                (result) => {
                  const source = sources.find((candidate) => candidate.id === result.sourceId);
                  if (source === undefined) return Effect.void;
                  const status: MemorySource["sourceStatus"] =
                    result.freshness === "current"
                      ? "resolved"
                      : result.freshness === "changed"
                        ? "changed"
                        : result.freshness;
                  if (source.sourceStatus === status) return Effect.void;
                  return dependencies.repository.updateMemorySourceStatus!({
                    memorySourceId: source.id,
                    status,
                  }).pipe(
                    Effect.tap(() =>
                      (result.freshness === "changed" || result.freshness === "missing") &&
                      dependencies.recordSourceFreshness !== undefined
                        ? dependencies.recordSourceFreshness(entry, source, result.freshness)
                        : Effect.void,
                    ),
                  );
                },
                { concurrency: 4, discard: true },
              );
            }
            const assessment = assessMemoryStaleness({
              entry,
              sources,
              freshness,
              nowEpochMillis: DateTime.toEpochMillis(now),
            });
            if (assessment.stale && entry.status === "active") {
              yield* dependencies.repository.applyEntryAction({
                memoryEntryId: entry.id,
                action: "mark_stale",
                reason: assessment.reason,
                actorType: "system",
                actorId: null,
              });
              if (dependencies.recordMarkedStale !== undefined && assessment.reason !== null) {
                yield* dependencies.recordMarkedStale(entry, assessment.reason);
              }
            }
            return assessment;
          }),
        { concurrency: 4 },
      );
    }).pipe(stalenessError("refreshProject"));
  return { refreshProject };
};

const make = Effect.gen(function* () {
  const repository = yield* ProjectionMemoryRepository;
  const freshnessResolver = yield* MemorySourceFreshnessResolver;
  const eventRecorder = yield* Effect.serviceOption(MemoryEventRecorder);
  return MemoryStalenessService.of(
    makeMemoryStalenessService({
      repository,
      freshnessResolver,
      ...(Option.isNone(eventRecorder)
        ? {}
        : {
            recordMarkedStale: (entry: MemoryEntry, reason: string) =>
              eventRecorder.value
                .record({
                  eventType: "memory.entry_marked_stale",
                  aggregateId: MemoryAggregateId.make(`entry:${entry.id}`),
                  projectId: entry.projectId,
                  missionId: entry.missionId,
                  taskId: entry.taskId,
                  memoryEntryId: entry.id,
                  summary: reason,
                })
                .pipe(Effect.ignoreCause({ log: true })),
            recordSourceFreshness: (
              entry: MemoryEntry,
              source: MemorySource,
              freshness: "changed" | "missing",
            ) =>
              eventRecorder.value
                .record({
                  eventType:
                    freshness === "changed" ? "memory.source_changed" : "memory.source_missing",
                  aggregateId: MemoryAggregateId.make(`entry:${entry.id}`),
                  projectId: entry.projectId,
                  missionId: entry.missionId,
                  taskId: entry.taskId,
                  memoryEntryId: entry.id,
                  memorySourceId: source.id,
                })
                .pipe(Effect.ignoreCause({ log: true })),
          }),
    }),
  );
});

export const MemorySourceFreshnessResolverLive = Layer.effect(
  MemorySourceFreshnessResolver,
  Effect.map(ProjectionMemoryRepository, makeProjectionMemorySourceFreshnessResolver),
);

export const MemoryStalenessServiceLive = Layer.effect(MemoryStalenessService, make);
