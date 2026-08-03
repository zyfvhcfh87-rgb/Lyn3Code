import {
  MemoryAggregateId,
  MemoryIndexOperationId,
  MemoryNotFoundError,
  MemoryUnavailableError,
  type AddMemorySourceInput,
  type CreateMemoryEntryInput,
  type CreateMemoryProposalInput,
  type CreateMemoryRelationInput,
  type IndexedSourceListInput,
  type IndexedSourcePage,
  type MemoryEntryActionInput,
  type MemoryEntryDetail,
  type MemoryEntryPage,
  type MemoryExportBundle,
  type MemoryImportInput,
  type MemoryImportResult,
  type MemoryIndexOperation,
  type MemoryIndexRequest,
  type MemoryListFilter,
  type MemoryOrchestrationEventType,
  type MemoryProposal,
  type MemoryProposalListFilter,
  type MemoryProposalPage,
  type MemoryRelation,
  type MemoryRetrievalListInput,
  type MemoryRetrievalRecord,
  type MemoryRetrievalRecordId,
  type MemoryRetrievalRecordPage,
  type MemorySearchInput,
  type MemorySearchResult,
  type MemorySource,
  type MemorySourceDraft,
  type MemoryWorkspaceSnapshot,
  type ProjectId,
  type ReviewMemoryProposalInput,
  type SupersedeMemoryEntryInput,
  type UpdateMemoryEntryInput,
  type UpdateMemorySettingsInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProjectionMemoryRepository } from "../persistence/Services/ProjectionMemory.ts";
import type { ProjectionMemoryRepositoryError } from "../persistence/Services/ProjectionMemory.ts";
import { ProjectionMissionRepository } from "../persistence/Services/ProjectionMissions.ts";
import { ProjectionMissionTeamRepository } from "../persistence/Services/ProjectionMissionTeams.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { MemoryEventRecorder, type MemoryEventReference } from "./MemoryEventRecorder.ts";
import { MemoryEmbeddingCoordinator } from "./MemoryEmbeddingCoordinator.ts";
import { MemoryRetrieval } from "./MemoryRetrieval.ts";
import { RepositoryIndexer, type RepositoryIndexError } from "./RepositoryIndexer.ts";
import { redactMemorySourceText } from "./MemorySourceSecurity.ts";
import { MemoryStalenessService } from "./MemoryStalenessService.ts";

export type MemoryWorkspaceError =
  | Exclude<ProjectionMemoryRepositoryError, ProjectionRepositoryError>
  | MemoryUnavailableError;

export interface MemoryWorkspaceChange {
  readonly projectId: ProjectId;
  readonly reason: "entry" | "proposal" | "index" | "retrieval" | "settings" | "import";
}

export interface MemoryWorkspaceServiceShape {
  readonly getWorkspace: (
    projectId: ProjectId,
  ) => Effect.Effect<MemoryWorkspaceSnapshot, MemoryWorkspaceError>;
  readonly listEntries: (
    input: MemoryListFilter,
  ) => Effect.Effect<MemoryEntryPage, MemoryWorkspaceError>;
  readonly getEntry: (
    memoryEntryId: MemoryEntryDetail["entry"]["id"],
  ) => Effect.Effect<MemoryEntryDetail, MemoryWorkspaceError>;
  readonly createEntry: (
    input: CreateMemoryEntryInput,
  ) => Effect.Effect<MemoryEntryDetail, MemoryWorkspaceError>;
  readonly updateEntry: (
    input: UpdateMemoryEntryInput,
  ) => Effect.Effect<MemoryEntryDetail, MemoryWorkspaceError>;
  readonly actionEntry: (
    input: MemoryEntryActionInput,
  ) => Effect.Effect<MemoryEntryDetail, MemoryWorkspaceError>;
  readonly supersedeEntry: (input: SupersedeMemoryEntryInput) => Effect.Effect<
    {
      readonly superseded: MemoryEntryDetail["entry"];
      readonly replacement: MemoryEntryDetail["entry"];
    },
    MemoryWorkspaceError
  >;
  readonly addSource: (
    input: AddMemorySourceInput,
  ) => Effect.Effect<MemorySource, MemoryWorkspaceError>;
  readonly createRelation: (
    input: CreateMemoryRelationInput,
  ) => Effect.Effect<MemoryRelation, MemoryWorkspaceError>;
  readonly listProposals: (
    input: MemoryProposalListFilter,
  ) => Effect.Effect<MemoryProposalPage, MemoryWorkspaceError>;
  readonly createProposal: (
    input: CreateMemoryProposalInput,
  ) => Effect.Effect<MemoryProposal, MemoryWorkspaceError>;
  readonly reviewProposal: (
    input: ReviewMemoryProposalInput,
  ) => Effect.Effect<
    { readonly proposal: MemoryProposal; readonly memory: MemoryEntryDetail | null },
    MemoryWorkspaceError
  >;
  readonly listIndexedSources: (
    input: IndexedSourceListInput,
  ) => Effect.Effect<IndexedSourcePage, MemoryWorkspaceError>;
  readonly requestIndex: (
    input: MemoryIndexRequest,
  ) => Effect.Effect<MemoryIndexOperation, MemoryWorkspaceError>;
  readonly search: (
    input: MemorySearchInput,
  ) => Effect.Effect<MemorySearchResult, MemoryWorkspaceError>;
  readonly listRetrievals: (
    input: MemoryRetrievalListInput,
  ) => Effect.Effect<MemoryRetrievalRecordPage, MemoryWorkspaceError>;
  readonly getRetrieval: (
    id: MemoryRetrievalRecordId,
  ) => Effect.Effect<MemoryRetrievalRecord, MemoryWorkspaceError>;
  readonly updateSettings: (
    input: UpdateMemorySettingsInput,
  ) => Effect.Effect<MemoryWorkspaceSnapshot, MemoryWorkspaceError>;
  readonly exportMemory: (
    projectId: ProjectId | null,
  ) => Effect.Effect<MemoryExportBundle, MemoryWorkspaceError>;
  readonly importMemory: (
    input: MemoryImportInput,
  ) => Effect.Effect<MemoryImportResult, MemoryWorkspaceError>;
  readonly changes: Stream.Stream<MemoryWorkspaceChange>;
  readonly recoverInterruptedIndexes: () => Effect.Effect<void>;
  readonly startBackgroundRefresh: () => Effect.Effect<void, never, Scope.Scope>;
}

const unavailableService = () =>
  Effect.fail(
    new MemoryUnavailableError({
      reason: "index_unavailable",
      message: "The project memory service is unavailable.",
    }),
  );

export class MemoryWorkspaceService extends Context.Reference<MemoryWorkspaceServiceShape>(
  "t3/memory/MemoryWorkspaceService",
  {
    defaultValue: () => ({
      getWorkspace: unavailableService,
      listEntries: unavailableService,
      getEntry: unavailableService,
      createEntry: unavailableService,
      updateEntry: unavailableService,
      actionEntry: unavailableService,
      supersedeEntry: unavailableService,
      addSource: unavailableService,
      createRelation: unavailableService,
      listProposals: unavailableService,
      createProposal: unavailableService,
      reviewProposal: unavailableService,
      listIndexedSources: unavailableService,
      requestIndex: unavailableService,
      search: unavailableService,
      listRetrievals: unavailableService,
      getRetrieval: unavailableService,
      updateSettings: unavailableService,
      exportMemory: unavailableService,
      importMemory: unavailableService,
      changes: Stream.empty,
      recoverInterruptedIndexes: () => Effect.void,
      startBackgroundRefresh: () => Effect.void,
    }),
  },
) {}

const unavailable = (message: string) =>
  new MemoryUnavailableError({ reason: "index_unavailable", message });

const mapPersistenceError = (
  error: ProjectionMemoryRepositoryError,
): Exclude<ProjectionMemoryRepositoryError, ProjectionRepositoryError> | MemoryUnavailableError => {
  switch (error._tag) {
    case "MemoryValidationError":
    case "MemoryNotFoundError":
    case "MemoryConflictError":
      return error;
    default:
      return unavailable("The local project memory store is unavailable.");
  }
};

const mapIndexError = (_error: RepositoryIndexError) =>
  unavailable("The repository memory index is unavailable.");

const projectAggregate = (projectId: ProjectId) =>
  MemoryAggregateId.make(`memory:project:${projectId}`);

const entryAggregate = (entry: MemoryEntryDetail["entry"]) =>
  MemoryAggregateId.make(`memory:entry:${entry.id}`);

const redactString = <Value extends string>(value: Value): Value =>
  redactMemorySourceText(value).content as Value;

const redactStructuredData = (value: unknown): unknown => {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactStructuredData);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactStructuredData(nested)]),
    );
  }
  return value;
};

const redactSourceDraft = (source: MemorySourceDraft): MemorySourceDraft => ({
  ...source,
  sourceIdentifier: redactString(source.sourceIdentifier),
  repositoryPath: source.repositoryPath === null ? null : redactString(source.repositoryPath),
  filePath: source.filePath === null ? null : redactString(source.filePath),
  commitHash: source.commitHash === null ? null : redactString(source.commitHash),
  branchName: source.branchName === null ? null : redactString(source.branchName),
  githubRecordType: source.githubRecordType === null ? null : redactString(source.githubRecordType),
  githubRecordId: source.githubRecordId === null ? null : redactString(source.githubRecordId),
  messageReference: source.messageReference === null ? null : redactString(source.messageReference),
});

const redactEntryInput = (input: CreateMemoryEntryInput): CreateMemoryEntryInput => ({
  ...input,
  title: redactString(input.title),
  content: redactString(input.content),
  structuredData: input.structuredData === null ? null : redactStructuredData(input.structuredData),
  sources: input.sources.map(redactSourceDraft),
});

const redactProposalInput = (input: CreateMemoryProposalInput): CreateMemoryProposalInput => ({
  ...input,
  proposedTitle: redactString(input.proposedTitle),
  proposedContent: redactString(input.proposedContent),
  proposedStructuredData:
    input.proposedStructuredData === null
      ? null
      : redactStructuredData(input.proposedStructuredData),
  sources: input.sources.map(redactSourceDraft),
});

const proposalEventType = (
  action: ReviewMemoryProposalInput["action"],
): MemoryOrchestrationEventType | null => {
  switch (action) {
    case "accept":
    case "merge":
      return "memory.proposal_accepted";
    case "edit_and_accept":
      return "memory.proposal_edited_and_accepted";
    case "reject":
      return "memory.proposal_rejected";
    case "mark_duplicate":
      return "memory.proposal_marked_duplicate";
    case "defer":
      return null;
  }
};

const entryActionEventType = (
  action: MemoryEntryActionInput["action"],
): MemoryOrchestrationEventType => {
  switch (action) {
    case "activate":
    case "restore":
      return "memory.entry_activated";
    case "mark_stale":
      return "memory.entry_marked_stale";
    case "dispute":
      return "memory.entry_disputed";
    case "reject":
      return "memory.entry_rejected";
    case "archive":
      return "memory.entry_archived";
    case "pin":
    case "unpin":
    case "verify":
      return "memory.entry_updated";
  }
};

export const make = Effect.gen(function* () {
  const repository = yield* ProjectionMemoryRepository;
  const projects = yield* ProjectionProjectRepository;
  const missions = yield* ProjectionMissionRepository;
  const missionTeams = yield* ProjectionMissionTeamRepository;
  const indexer = yield* RepositoryIndexer;
  const retrieval = yield* MemoryRetrieval;
  const events = yield* MemoryEventRecorder;
  const embeddingCoordinator = yield* Effect.serviceOption(MemoryEmbeddingCoordinator);
  const staleness = yield* Effect.serviceOption(MemoryStalenessService);
  const crypto = yield* Crypto.Crypto;
  const changesPubSub = yield* PubSub.unbounded<MemoryWorkspaceChange>();

  const persist = <A>(effect: Effect.Effect<A, ProjectionMemoryRepositoryError>) =>
    effect.pipe(Effect.mapError(mapPersistenceError));

  const publish = (projectId: ProjectId, reason: MemoryWorkspaceChange["reason"]) =>
    PubSub.publish(changesPubSub, { projectId, reason }).pipe(Effect.asVoid);

  const record = (input: MemoryEventReference) =>
    events.record(input).pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.logWarning("Memory reference event could not be recorded", {
          eventType: input.eventType,
          errorTag: error._tag,
        }),
      ),
    );

  const loadProject = (projectId: ProjectId) =>
    projects.getById({ projectId }).pipe(
      Effect.mapError(() => unavailable("The project workspace could not be read.")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new MemoryNotFoundError({ entityType: "index", entityId: projectId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const resolveRepositoryRoot = Effect.fn("MemoryWorkspaceService.resolveRepositoryRoot")(
    function* (projectId: ProjectId, branchName: string | null) {
      const project = yield* loadProject(projectId);
      if (branchName === null) return project.workspaceRoot;
      const projectMissions = (yield* missions
        .listAll()
        .pipe(Effect.mapError(() => unavailable("Mission worktrees could not be read.")))).filter(
        (mission) => mission.projectId === projectId,
      );
      for (const mission of projectMissions) {
        const worktrees = yield* missionTeams
          .listManagedWorktreesByMissionId({ missionId: mission.id })
          .pipe(Effect.mapError(() => unavailable("Mission worktrees could not be read.")));
        const matching = worktrees.find((worktree) => worktree.branchName === branchName);
        if (matching !== undefined) return matching.worktreePath;
      }
      return yield* unavailable(`No managed worktree is available for branch '${branchName}'.`);
    },
  );

  const getWorkspace: MemoryWorkspaceServiceShape["getWorkspace"] = Effect.fn(
    "MemoryWorkspaceService.getWorkspace",
  )(function* (projectId) {
    const settings = yield* persist(repository.getOrCreateSettings(projectId));
    const entryFilter = {
      projectId,
      scopeTypes: [],
      types: [],
      trustLevels: [],
      sourceTypes: [],
      branchName: null,
      missionId: null,
      taskId: null,
      query: "",
      createdAfter: null,
      pinnedOnly: false,
      limit: 1,
      offset: 0,
    } as const;
    const [
      activeMemoryCount,
      staleMemoryCount,
      conflictCount,
      proposalCount,
      stats,
      current,
      latestOperations,
      recent,
    ] = yield* Effect.all(
      [
        persist(
          repository.countEntries({ ...entryFilter, statuses: ["active"], staleOnly: false }),
        ),
        persist(repository.countEntries({ ...entryFilter, statuses: ["stale"], staleOnly: true })),
        persist(
          repository.countEntries({ ...entryFilter, statuses: ["disputed"], staleOnly: false }),
        ),
        persist(
          repository.countProposals({
            projectId,
            statuses: ["pending", "deferred"],
            limit: 1,
            offset: 0,
          }),
        ),
        persist(repository.getIndexStats({ projectId, branchName: null })),
        persist(repository.getCurrentIndexOperation({ projectId })),
        persist(repository.listIndexOperations({ projectId, limit: 1, offset: 0 })),
        persist(
          repository.listRetrievalRecords({
            projectId,
            agentRunId: null,
            threadId: null,
            limit: 1,
            offset: 0,
          }),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const activeOperation = Option.getOrNull(current);
    const currentOperation = activeOperation ?? latestOperations[0] ?? null;
    const status: MemoryWorkspaceSnapshot["indexStatus"]["status"] = settings.indexingPaused
      ? "paused"
      : activeOperation?.status === "running" || activeOperation?.status === "queued"
        ? activeOperation.operationType === "recovery"
          ? "recovering"
          : "indexing"
        : currentOperation?.status === "failed"
          ? "failed"
          : stats.indexedFiles === 0
            ? "not_indexed"
            : stats.failedFiles > 0
              ? "partial"
              : "current";
    return {
      projectId,
      settings,
      indexStatus: {
        projectId,
        status,
        currentBranch: currentOperation?.branchName ?? null,
        currentCommit: currentOperation?.commitHash ?? null,
        indexedFiles: stats.indexedFiles,
        indexedChunks: stats.indexedChunks,
        skippedPaths: stats.skippedFiles,
        failedFiles: stats.failedFiles,
        indexSizeBytes: stats.indexSizeBytes,
        embeddingStatus: stats.embeddingStatus,
        lastIndexedAt: stats.lastIndexedAt,
        currentOperation,
      },
      activeMemoryCount,
      proposalCount,
      staleMemoryCount,
      conflictCount,
      lastRetrievalAt: recent[0]?.createdAt ?? null,
    };
  });

  const getEntry: MemoryWorkspaceServiceShape["getEntry"] = (memoryEntryId) =>
    persist(repository.getEntryDetail(memoryEntryId)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new MemoryNotFoundError({ entityType: "entry", entityId: memoryEntryId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const listEntries: MemoryWorkspaceServiceShape["listEntries"] = (input) =>
    Effect.all([persist(repository.listEntries(input)), persist(repository.countEntries(input))], {
      concurrency: 2,
    }).pipe(
      Effect.map(([entries, total]) => ({
        entries,
        total,
        limit: input.limit,
        offset: input.offset,
      })),
    );

  const createEntry: MemoryWorkspaceServiceShape["createEntry"] = Effect.fn(
    "MemoryWorkspaceService.createEntry",
  )(function* (input) {
    let detail = yield* persist(repository.createEntry(redactEntryInput(input)));
    if (detail.entry.projectId !== null) yield* publish(detail.entry.projectId, "entry");
    yield* record({
      eventType: "memory.entry_created",
      aggregateId: entryAggregate(detail.entry),
      projectId: detail.entry.projectId,
      missionId: detail.entry.missionId,
      taskId: detail.entry.taskId,
      memoryEntryId: detail.entry.id,
    });
    if (detail.entry.projectId !== null && detail.entry.status === "active") {
      const candidates = yield* persist(
        repository.listEntries({
          projectId: detail.entry.projectId,
          scopeTypes: [detail.entry.scopeType],
          types: [],
          statuses: ["active"],
          trustLevels: [],
          sourceTypes: [],
          branchName: detail.entry.branchName,
          missionId: detail.entry.missionId,
          taskId: detail.entry.taskId,
          query: "",
          createdAfter: null,
          staleOnly: false,
          pinnedOnly: false,
          limit: 10_000,
          offset: 0,
        }),
      );
      const normalizeClaim = (value: string) =>
        value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
      const contradictions = candidates.filter(
        (candidate) =>
          candidate.id !== detail.entry.id &&
          candidate.scopeId === detail.entry.scopeId &&
          normalizeClaim(candidate.title) === normalizeClaim(detail.entry.title) &&
          normalizeClaim(candidate.content) !== normalizeClaim(detail.entry.content),
      );
      for (const contradiction of contradictions) {
        yield* persist(
          repository.createRelation({
            fromMemoryEntryId: detail.entry.id,
            toMemoryEntryId: contradiction.id,
            relationType: "contradicts",
          }),
        );
      }
      if (contradictions.length > 0) {
        detail = yield* getEntry(detail.entry.id);
        yield* record({
          eventType: "memory.contradiction_detected",
          aggregateId: entryAggregate(detail.entry),
          projectId: detail.entry.projectId,
          missionId: detail.entry.missionId,
          taskId: detail.entry.taskId,
          memoryEntryId: detail.entry.id,
          contradictionGroupId: detail.entry.contradictionGroupId,
        });
      }
    }
    return detail;
  });

  const updateEntry: MemoryWorkspaceServiceShape["updateEntry"] = Effect.fn(
    "MemoryWorkspaceService.updateEntry",
  )(function* (input) {
    let detail = yield* persist(
      repository.updateEntry({
        ...input,
        ...(input.title === undefined ? {} : { title: redactString(input.title) }),
        ...(input.content === undefined ? {} : { content: redactString(input.content) }),
        ...(input.structuredData === undefined
          ? {}
          : {
              structuredData:
                input.structuredData === null ? null : redactStructuredData(input.structuredData),
            }),
        reason: input.reason === null ? null : redactString(input.reason),
      }),
    );
    if (input.scope !== undefined && detail.entry.status === "disputed") {
      detail = yield* persist(
        repository.applyEntryAction({
          memoryEntryId: detail.entry.id,
          action: "activate",
          reason: "Contradiction resolved by changing memory scope",
          actorType: input.actorType,
          actorId: input.actorId,
        }),
      );
      yield* record({
        eventType: "memory.contradiction_resolved",
        aggregateId: entryAggregate(detail.entry),
        projectId: detail.entry.projectId,
        missionId: detail.entry.missionId,
        taskId: detail.entry.taskId,
        memoryEntryId: detail.entry.id,
      });
    }
    if (detail.entry.projectId !== null) yield* publish(detail.entry.projectId, "entry");
    yield* record({
      eventType: "memory.entry_updated",
      aggregateId: entryAggregate(detail.entry),
      projectId: detail.entry.projectId,
      missionId: detail.entry.missionId,
      taskId: detail.entry.taskId,
      memoryEntryId: detail.entry.id,
    });
    return detail;
  });

  const actionEntry: MemoryWorkspaceServiceShape["actionEntry"] = Effect.fn(
    "MemoryWorkspaceService.actionEntry",
  )(function* (input) {
    const before = yield* getEntry(input.memoryEntryId);
    const sanitizedInput = {
      ...input,
      reason: input.reason === null ? null : redactString(input.reason),
    };
    const detail = yield* persist(repository.applyEntryAction(sanitizedInput));
    if (detail.entry.projectId !== null) yield* publish(detail.entry.projectId, "entry");
    yield* record({
      eventType: entryActionEventType(input.action),
      aggregateId: entryAggregate(detail.entry),
      projectId: detail.entry.projectId,
      missionId: detail.entry.missionId,
      taskId: detail.entry.taskId,
      memoryEntryId: detail.entry.id,
      summary: sanitizedInput.reason,
    });
    if (before.entry.contradictionGroupId !== null && detail.entry.contradictionGroupId === null) {
      yield* record({
        eventType: "memory.contradiction_resolved",
        aggregateId: entryAggregate(detail.entry),
        projectId: detail.entry.projectId,
        missionId: detail.entry.missionId,
        taskId: detail.entry.taskId,
        memoryEntryId: detail.entry.id,
        contradictionGroupId: before.entry.contradictionGroupId,
        summary: sanitizedInput.reason,
      });
    }
    return detail;
  });

  const supersedeEntry: MemoryWorkspaceServiceShape["supersedeEntry"] = Effect.fn(
    "MemoryWorkspaceService.supersedeEntry",
  )(function* (input) {
    const before = yield* getEntry(input.supersededMemoryEntryId);
    const sanitizedInput = { ...input, reason: redactString(input.reason) };
    const oldDetail = yield* persist(repository.supersedeEntry(sanitizedInput));
    const replacement = yield* getEntry(input.replacementMemoryEntryId);
    if (oldDetail.entry.projectId !== null) yield* publish(oldDetail.entry.projectId, "entry");
    yield* record({
      eventType: "memory.entry_superseded",
      aggregateId: entryAggregate(oldDetail.entry),
      projectId: oldDetail.entry.projectId,
      missionId: oldDetail.entry.missionId,
      taskId: oldDetail.entry.taskId,
      memoryEntryId: oldDetail.entry.id,
      summary: sanitizedInput.reason,
    });
    if (before.entry.contradictionGroupId !== null) {
      yield* record({
        eventType: "memory.contradiction_resolved",
        aggregateId: entryAggregate(oldDetail.entry),
        projectId: oldDetail.entry.projectId,
        missionId: oldDetail.entry.missionId,
        taskId: oldDetail.entry.taskId,
        memoryEntryId: oldDetail.entry.id,
        contradictionGroupId: before.entry.contradictionGroupId,
        summary: sanitizedInput.reason,
      });
    }
    return { superseded: oldDetail.entry, replacement: replacement.entry };
  });

  const addSource: MemoryWorkspaceServiceShape["addSource"] = Effect.fn(
    "MemoryWorkspaceService.addSource",
  )(function* (input) {
    const source = yield* persist(
      repository.addSource({
        ...input,
        source: redactSourceDraft(input.source),
        actorType: "user",
        actorId: null,
        reason: "Source added through the memory workspace",
      }),
    );
    const detail = yield* getEntry(input.memoryEntryId);
    if (detail.entry.projectId !== null) yield* publish(detail.entry.projectId, "entry");
    yield* record({
      eventType: "memory.source_added",
      aggregateId: entryAggregate(detail.entry),
      projectId: detail.entry.projectId,
      missionId: detail.entry.missionId,
      taskId: detail.entry.taskId,
      memoryEntryId: detail.entry.id,
      memorySourceId: source.id,
    });
    return source;
  });

  const createRelation: MemoryWorkspaceServiceShape["createRelation"] = Effect.fn(
    "MemoryWorkspaceService.createRelation",
  )(function* (input) {
    const relation = yield* persist(repository.createRelation(input));
    const detail = yield* getEntry(input.fromMemoryEntryId);
    if (detail.entry.projectId !== null) yield* publish(detail.entry.projectId, "entry");
    if (input.relationType === "contradicts") {
      yield* record({
        eventType: "memory.contradiction_detected",
        aggregateId: entryAggregate(detail.entry),
        projectId: detail.entry.projectId,
        missionId: detail.entry.missionId,
        taskId: detail.entry.taskId,
        memoryEntryId: detail.entry.id,
        contradictionGroupId: detail.entry.contradictionGroupId,
      });
    }
    return relation;
  });

  const listProposals: MemoryWorkspaceServiceShape["listProposals"] = (input) =>
    Effect.all(
      [persist(repository.listProposals(input)), persist(repository.countProposals(input))],
      { concurrency: 2 },
    ).pipe(
      Effect.map(([proposals, total]) => ({
        proposals,
        total,
        limit: input.limit,
        offset: input.offset,
      })),
    );

  const createProposal: MemoryWorkspaceServiceShape["createProposal"] = Effect.fn(
    "MemoryWorkspaceService.createProposal",
  )(function* (input) {
    const proposal = yield* persist(repository.createProposal(redactProposalInput(input)));
    yield* publish(input.projectId, "proposal");
    yield* record({
      eventType: "memory.proposal_created",
      aggregateId: projectAggregate(input.projectId),
      projectId: input.projectId,
      missionId: input.missionId,
      taskId: input.taskId,
      proposalId: proposal.id,
    });
    return proposal;
  });

  const reviewProposal: MemoryWorkspaceServiceShape["reviewProposal"] = Effect.fn(
    "MemoryWorkspaceService.reviewProposal",
  )(function* (input) {
    const proposal = yield* persist(
      repository.reviewProposal({
        ...input,
        rejectionReason:
          input.rejectionReason === null ? null : redactString(input.rejectionReason),
        editedEntry: input.editedEntry === null ? null : redactEntryInput(input.editedEntry),
      }),
    );
    const memory =
      proposal.acceptedMemoryEntryId === null
        ? null
        : yield* getEntry(proposal.acceptedMemoryEntryId);
    yield* publish(proposal.projectId, "proposal");
    const eventType = proposalEventType(input.action);
    if (eventType !== null) {
      yield* record({
        eventType,
        aggregateId: projectAggregate(proposal.projectId),
        projectId: proposal.projectId,
        missionId: proposal.missionId,
        taskId: proposal.taskId,
        proposalId: proposal.id,
        memoryEntryId: proposal.acceptedMemoryEntryId,
        summary: input.rejectionReason,
      });
    }
    return { proposal, memory };
  });

  const listIndexedSources: MemoryWorkspaceServiceShape["listIndexedSources"] = Effect.fn(
    "MemoryWorkspaceService.listIndexedSources",
  )(function* (input) {
    const pageSize = input.pathPrefix === null ? input.limit : 10_000;
    const pageOffset = input.pathPrefix === null ? input.offset : 0;
    const sources = yield* persist(
      repository.listIndexedSources({
        projectId: input.projectId,
        branchName: null,
        statuses: input.statuses,
        limit: pageSize,
        offset: pageOffset,
      }),
    );
    if (input.pathPrefix === null) {
      const total = yield* persist(
        repository.countIndexedSources({
          projectId: input.projectId,
          branchName: null,
          statuses: input.statuses,
          limit: input.limit,
          offset: input.offset,
        }),
      );
      return { sources, total, limit: input.limit, offset: input.offset };
    }
    const prefix = input.pathPrefix.replaceAll("\\", "/").toLocaleLowerCase();
    const matched = sources.filter((source) =>
      (source.relativePath ?? source.sourceIdentifier)
        .replaceAll("\\", "/")
        .toLocaleLowerCase()
        .startsWith(prefix),
    );
    return {
      sources: matched.slice(input.offset, input.offset + input.limit),
      total: matched.length,
      limit: input.limit,
      offset: input.offset,
    };
  });

  const requestIndex: MemoryWorkspaceServiceShape["requestIndex"] = Effect.fn(
    "MemoryWorkspaceService.requestIndex",
  )(function* (input) {
    const settings = yield* persist(repository.getOrCreateSettings(input.projectId));
    if (!settings.enabled) {
      return yield* new MemoryUnavailableError({
        reason: "disabled",
        message: "Project memory is disabled.",
      });
    }
    if (settings.indexingPaused) {
      return yield* unavailable("Repository memory indexing is paused.");
    }
    const repositoryRoot = yield* resolveRepositoryRoot(input.projectId, input.branchName);
    yield* record({
      eventType: "memory.index_requested",
      aggregateId: projectAggregate(input.projectId),
      projectId: input.projectId,
    });
    if (input.operationType === "clear_derived_index") {
      const [uuid, timestamp] = yield* Effect.all([
        crypto.randomUUIDv4.pipe(Effect.orDie),
        DateTime.now.pipe(Effect.map(DateTime.formatIso)),
      ]);
      const operation: MemoryIndexOperation = {
        id: MemoryIndexOperationId.make(uuid),
        projectId: input.projectId,
        operationType: input.operationType,
        status: "completed",
        branchName: input.branchName,
        commitHash: null,
        processedSources: 0,
        changedSources: yield* persist(
          repository.clearDerivedIndex({
            projectId: input.projectId,
            branchName: input.branchName,
          }),
        ),
        skippedSources: 0,
        failedSources: 0,
        errorSummary: null,
        requestedAt: timestamp,
        startedAt: timestamp,
        completedAt: timestamp,
      };
      yield* persist(repository.saveIndexOperation(operation));
      yield* publish(input.projectId, "index");
      return operation;
    }
    yield* record({
      eventType: "memory.index_started",
      aggregateId: projectAggregate(input.projectId),
      projectId: input.projectId,
    });
    const indexResult = yield* Effect.result(
      indexer
        .index({
          projectId: input.projectId,
          repositoryRoot,
          operationType: input.operationType,
          branchName: input.branchName,
          exclusions: settings.repositoryExclusions,
          maximumFileSizeBytes: settings.maximumIndexedFileSizeBytes,
          semanticEmbeddingEnabled: settings.semanticRetrievalEnabled && !settings.lexicalOnly,
        })
        .pipe(Effect.mapError(mapIndexError)),
    );
    if (Result.isFailure(indexResult)) {
      yield* record({
        eventType: "memory.index_source_failed",
        aggregateId: projectAggregate(input.projectId),
        projectId: input.projectId,
        summary: redactString(indexResult.failure.message),
      });
      return yield* indexResult.failure;
    }
    const result = indexResult.success;
    if (result.operationId === null) {
      return yield* unavailable("Repository memory indexing did not start.");
    }
    const operation = yield* persist(repository.getIndexOperation(result.operationId)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new MemoryNotFoundError({ entityType: "index", entityId: result.operationId! }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (
      settings.semanticRetrievalEnabled &&
      !settings.lexicalOnly &&
      Option.isSome(embeddingCoordinator)
    ) {
      yield* record({
        eventType: "memory.embedding_started",
        aggregateId: projectAggregate(input.projectId),
        projectId: input.projectId,
        embeddingProvider: settings.embeddingProviderId,
        embeddingModel: settings.embeddingModel,
      });
      const embedding = yield* embeddingCoordinator.value.processProject({
        projectId: input.projectId,
        branchName: input.branchName,
      });
      yield* record({
        eventType:
          embedding.status === "completed"
            ? "memory.embedding_completed"
            : "memory.embedding_failed",
        aggregateId: projectAggregate(input.projectId),
        projectId: input.projectId,
        embeddingProvider: settings.embeddingProviderId,
        embeddingModel: settings.embeddingModel,
        summary:
          embedding.reason ??
          `Embedded ${embedding.processedChunks} chunks from ${embedding.uniqueContentsEmbedded} unique contents.`,
      });
    }
    if (Option.isSome(staleness)) {
      yield* staleness.value.refreshProject(input.projectId).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Memory staleness refresh failed after indexing", {
            projectId: input.projectId,
            operation: error.operation,
          }),
        ),
      );
    }
    yield* publish(input.projectId, "index");
    yield* record({
      eventType:
        operation.status === "completed"
          ? "memory.index_completed"
          : operation.status === "interrupted"
            ? "memory.index_interrupted"
            : "memory.index_source_failed",
      aggregateId: projectAggregate(input.projectId),
      projectId: input.projectId,
      indexOperationId: operation.id,
      summary: operation.errorSummary,
    });
    return operation;
  });

  const search: MemoryWorkspaceServiceShape["search"] = Effect.fn("MemoryWorkspaceService.search")(
    function* (input) {
      yield* record({
        eventType: "memory.retrieval_started",
        aggregateId: projectAggregate(input.projectId),
        projectId: input.projectId,
        missionId: input.missionId,
        taskId: input.taskId,
      });
      const retrievalResult = yield* Effect.result(
        retrieval
          .retrieve({
            ...input,
            agentRunId: null,
            threadId: null,
            messageId: null,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new MemoryUnavailableError({
                  reason:
                    error.reason === "semantic_search_failed"
                      ? "semantic_unavailable"
                      : "index_unavailable",
                  message: error.message,
                }),
            ),
          ),
      );
      if (Result.isFailure(retrievalResult)) {
        yield* record({
          eventType: "memory.retrieval_failed",
          aggregateId: projectAggregate(input.projectId),
          projectId: input.projectId,
          missionId: input.missionId,
          taskId: input.taskId,
          summary: redactString(retrievalResult.failure.message),
        });
        return yield* retrievalResult.failure;
      }
      const result = retrievalResult.success;
      yield* publish(input.projectId, "retrieval");
      yield* record({
        eventType: "memory.retrieval_completed",
        aggregateId: projectAggregate(input.projectId),
        projectId: input.projectId,
        missionId: input.missionId,
        taskId: input.taskId,
        retrievalRecordId: result.context.auditRecordId,
      });
      return result;
    },
  );

  const listRetrievals: MemoryWorkspaceServiceShape["listRetrievals"] = (input) =>
    Effect.all(
      [
        persist(repository.listRetrievalRecords(input)),
        persist(repository.countRetrievalRecords(input)),
      ],
      { concurrency: 2 },
    ).pipe(
      Effect.map(([records, total]) => ({
        records,
        total,
        limit: input.limit,
        offset: input.offset,
      })),
    );

  const getRetrieval: MemoryWorkspaceServiceShape["getRetrieval"] = (id) =>
    persist(repository.getRetrievalRecord(id)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new MemoryNotFoundError({ entityType: "retrieval", entityId: id })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const updateSettings: MemoryWorkspaceServiceShape["updateSettings"] = Effect.fn(
    "MemoryWorkspaceService.updateSettings",
  )(function* (input) {
    const previous = yield* persist(repository.getOrCreateSettings(input.projectId));
    const settings = yield* persist(repository.updateSettings(input));
    yield* publish(input.projectId, "settings");
    if (
      settings.embeddingProviderKind !== previous.embeddingProviderKind ||
      settings.embeddingProviderId !== previous.embeddingProviderId ||
      settings.embeddingModel !== previous.embeddingModel
    ) {
      yield* record({
        eventType: "memory.embedding_provider_changed",
        aggregateId: projectAggregate(input.projectId),
        projectId: input.projectId,
        embeddingProvider: settings.embeddingProviderId,
        embeddingModel: settings.embeddingModel,
      });
    }
    return yield* getWorkspace(input.projectId);
  });

  const importMemory: MemoryWorkspaceServiceShape["importMemory"] = Effect.fn(
    "MemoryWorkspaceService.importMemory",
  )(function* (input) {
    const imported = yield* persist(
      repository.importMemory({
        ...input,
        bundle: {
          ...input.bundle,
          entries: input.bundle.entries.map((detail) => ({
            ...detail,
            entry: {
              ...detail.entry,
              title: redactString(detail.entry.title),
              content: redactString(detail.entry.content),
              structuredData:
                detail.entry.structuredData === null
                  ? null
                  : redactStructuredData(detail.entry.structuredData),
            },
            sources: detail.sources.map((source) => ({ ...source, ...redactSourceDraft(source) })),
          })),
          proposals: input.bundle.proposals.map((proposal) => ({
            ...proposal,
            proposedTitle: redactString(proposal.proposedTitle),
            proposedContent: redactString(proposal.proposedContent),
            proposedStructuredData:
              proposal.proposedStructuredData === null
                ? null
                : redactStructuredData(proposal.proposedStructuredData),
            sourceReferences: proposal.sourceReferences.map(redactSourceDraft),
          })),
        },
      }),
    );
    const projectId = input.targetProjectId ?? input.bundle.projectId;
    if (projectId !== null) yield* publish(projectId, "import");
    return {
      importedMemoryIds: imported.importedEntryIds,
      proposedMemoryIds: imported.createdProposalIds,
      skippedCount: imported.skippedCount,
    };
  });

  const recoverInterruptedIndexes: MemoryWorkspaceServiceShape["recoverInterruptedIndexes"] =
    Effect.fn("MemoryWorkspaceService.recoverInterruptedIndexes")(function* () {
      const allProjects = yield* projects.listAll().pipe(Effect.orElseSucceed(() => []));
      const recoveredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* Effect.forEach(
        allProjects,
        (project) =>
          Effect.gen(function* () {
            const settings = yield* repository.getOrCreateSettings(project.projectId);
            const interrupted = yield* repository.recoverInterruptedIndexOperations({
              projectId: project.projectId,
              recoveredAt,
            });
            if (!settings.enabled || settings.indexingPaused) return;
            yield* Effect.forEach(
              interrupted,
              (operation) =>
                requestIndex({
                  projectId: project.projectId,
                  operationType: "recovery",
                  branchName: operation.branchName,
                }).pipe(Effect.asVoid),
              { concurrency: 1, discard: true },
            );
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Interrupted memory indexing recovery failed", {
                projectId: project.projectId,
                cause,
              }),
            ),
          ),
        { concurrency: 1, discard: true },
      );
    });

  const startBackgroundRefresh: MemoryWorkspaceServiceShape["startBackgroundRefresh"] = Effect.fn(
    "MemoryWorkspaceService.startBackgroundRefresh",
  )(function* () {
    const cycle = Effect.gen(function* () {
      const allProjects = yield* projects.listAll().pipe(Effect.orElseSucceed(() => []));
      yield* Effect.forEach(
        allProjects,
        (project) =>
          repository.getSettings(project.projectId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (settings) =>
                  settings.enabled &&
                  settings.automaticAuthoritativeIndexing &&
                  !settings.indexingPaused
                    ? requestIndex({
                        projectId: project.projectId,
                        operationType: "refresh_changed",
                        branchName: null,
                      }).pipe(
                        Effect.catch((error) =>
                          Effect.logWarning("Background memory index refresh failed", {
                            projectId: project.projectId,
                            errorTag: error._tag,
                          }),
                        ),
                        Effect.asVoid,
                      )
                    : Effect.void,
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("Background memory index settings could not be read", {
                projectId: project.projectId,
                cause,
              }),
            ),
          ),
        { concurrency: 1, discard: true },
      );
    });
    yield* Effect.forkScoped(
      Effect.sleep(Duration.minutes(1)).pipe(
        Effect.andThen(
          cycle.pipe(Effect.andThen(Effect.sleep(Duration.minutes(5))), Effect.forever),
        ),
        Effect.ignore,
      ),
    );
  });

  return MemoryWorkspaceService.of({
    getWorkspace,
    listEntries,
    getEntry,
    createEntry,
    updateEntry,
    actionEntry,
    supersedeEntry,
    addSource,
    createRelation,
    listProposals,
    createProposal,
    reviewProposal,
    listIndexedSources,
    requestIndex,
    search,
    listRetrievals,
    getRetrieval,
    updateSettings,
    exportMemory: (projectId) => persist(repository.exportMemory(projectId)),
    importMemory,
    changes: Stream.fromPubSub(changesPubSub),
    recoverInterruptedIndexes,
    startBackgroundRefresh,
  });
});

export const layer = Layer.effect(MemoryWorkspaceService, make);
