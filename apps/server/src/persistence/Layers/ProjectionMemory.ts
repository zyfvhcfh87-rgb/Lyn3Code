import * as NodeCrypto from "node:crypto";

import {
  IndexedChunk,
  IndexedSource,
  IndexedSourceId,
  MemoryConflictError,
  MemoryEntry,
  MemoryEntryId,
  MemoryExportBundle,
  MemoryIndexOperation,
  MemoryLifecycleRecord,
  MemoryLifecycleRecordId,
  MemoryNotFoundError,
  MemoryProposal,
  MemoryProposalId,
  MemoryRelation,
  MemoryRelationId,
  MemoryRetrievalRecord,
  MemorySettings,
  MemorySource,
  MemorySourceDraft,
  MemorySourceId,
  MemoryValidationError,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError, isPersistenceError, toPersistenceSqlError } from "../Errors.ts";
import {
  decodeMemoryEmbeddingVector,
  ProjectionMemoryRepository,
  type ProjectionMemoryRepositoryError,
  type ProjectionMemoryRepositoryShape,
} from "../Services/ProjectionMemory.ts";

const SqlBoolean = Schema.BooleanFromBit;
const JsonUnknownOrNull = Schema.NullOr(Schema.fromJsonString(Schema.Unknown));
const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);
const encodeStringArrayJson = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeMemorySourceDraft = Schema.decodeUnknownEffect(MemorySourceDraft);

const MemoryEntryDbRow = MemoryEntry.mapFields(
  Struct.assign({
    structuredData: JsonUnknownOrNull,
    pinned: SqlBoolean,
  }),
);
const MemoryProposalDbRow = MemoryProposal.mapFields(
  Struct.assign({
    proposedStructuredData: JsonUnknownOrNull,
    sourceReferences: Schema.fromJsonString(Schema.Array(MemorySourceDraft)),
  }),
);
const IndexedChunkDbRow = IndexedChunk.mapFields(
  Struct.assign({
    symbolMetadata: JsonUnknownOrNull,
  }),
);
const MemorySettingsDbRow = MemorySettings.mapFields(
  Struct.assign({
    enabled: SqlBoolean,
    automaticProposalGeneration: SqlBoolean,
    automaticAuthoritativeIndexing: SqlBoolean,
    repositoryExclusions: Schema.fromJsonString(Schema.Array(Schema.String)),
    lexicalOnly: SqlBoolean,
    semanticRetrievalEnabled: SqlBoolean,
    indexingPaused: SqlBoolean,
  }),
);
const MemoryRetrievalRecordDbRow = MemoryRetrievalRecord.mapFields(
  Struct.assign({
    selectedMemoryIds: Schema.fromJsonString(MemoryRetrievalRecord.fields.selectedMemoryIds),
    selectedChunkIds: Schema.fromJsonString(MemoryRetrievalRecord.fields.selectedChunkIds),
    rankingMetadata: Schema.fromJsonString(Schema.Unknown),
  }),
);

const entryColumns = `
  memory_entry_id AS "id",
  scope_type AS "scopeType",
  scope_id AS "scopeId",
  project_id AS "projectId",
  branch_name AS "branchName",
  mission_id AS "missionId",
  task_id AS "taskId",
  type,
  title,
  content,
  structured_data_json AS "structuredData",
  trust_level AS "trustLevel",
  status,
  confidence,
  created_by_type AS "createdByType",
  created_by_id AS "createdById",
  creation_mode AS "creationMode",
  pinned,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  last_verified_at AS "lastVerifiedAt",
  expires_at AS "expiresAt",
  superseded_by_id AS "supersededById",
  contradiction_group_id AS "contradictionGroupId",
  stale_reason AS "staleReason"
`;
const sourceColumns = `
  memory_source_id AS "id",
  memory_entry_id AS "memoryEntryId",
  source_type AS "sourceType",
  source_identifier AS "sourceIdentifier",
  project_id AS "projectId",
  repository_path AS "repositoryPath",
  file_path AS "filePath",
  start_line AS "startLine",
  end_line AS "endLine",
  commit_hash AS "commitHash",
  branch_name AS "branchName",
  mission_id AS "missionId",
  task_id AS "taskId",
  agent_run_id AS "agentRunId",
  verification_run_id AS "verificationRunId",
  github_record_type AS "githubRecordType",
  github_record_id AS "githubRecordId",
  message_reference AS "messageReference",
  content_fingerprint AS "contentFingerprint",
  source_status AS "sourceStatus",
  created_at AS "createdAt"
`;
const relationColumns = `
  memory_relation_id AS "id",
  from_memory_entry_id AS "fromMemoryEntryId",
  to_memory_entry_id AS "toMemoryEntryId",
  relation_type AS "relationType",
  created_at AS "createdAt"
`;
const lifecycleColumns = `
  memory_lifecycle_record_id AS "id",
  memory_entry_id AS "memoryEntryId",
  action,
  previous_status AS "previousStatus",
  next_status AS "nextStatus",
  actor_type AS "actorType",
  actor_id AS "actorId",
  reason,
  created_at AS "createdAt"
`;
const proposalColumns = `
  proposal.memory_proposal_id AS "id",
  proposal.scope_type AS "scopeType",
  proposal.scope_id AS "scopeId",
  proposal.project_id AS "projectId",
  proposal.branch_name AS "branchName",
  proposal.mission_id AS "missionId",
  proposal.task_id AS "taskId",
  proposal.proposed_type AS "proposedType",
  proposal.proposed_title AS "proposedTitle",
  proposal.proposed_content AS "proposedContent",
  proposal.proposed_structured_data_json AS "proposedStructuredData",
  proposal.proposed_trust_level AS "proposedTrustLevel",
  proposal.confidence,
  proposal.extraction_source AS "extractionSource",
  coalesce((
    SELECT json_group_array(json(source_json))
    FROM (
      SELECT json_object(
        'sourceType', source_type,
        'sourceIdentifier', source_identifier,
        'projectId', project_id,
        'repositoryPath', repository_path,
        'filePath', file_path,
        'startLine', start_line,
        'endLine', end_line,
        'commitHash', commit_hash,
        'branchName', branch_name,
        'missionId', mission_id,
        'taskId', task_id,
        'agentRunId', agent_run_id,
        'verificationRunId', verification_run_id,
        'githubRecordType', github_record_type,
        'githubRecordId', github_record_id,
        'messageReference', message_reference,
        'contentFingerprint', content_fingerprint
      ) AS source_json
      FROM projection_memory_proposal_sources
      WHERE memory_proposal_id = proposal.memory_proposal_id
      ORDER BY created_at, proposal_source_id
    )
  ), '[]') AS "sourceReferences",
  proposal.status,
  proposal.reviewed_by AS "reviewedBy",
  proposal.reviewed_at AS "reviewedAt",
  proposal.rejection_reason AS "rejectionReason",
  proposal.duplicate_of_memory_entry_id AS "duplicateOfMemoryEntryId",
  proposal.accepted_memory_entry_id AS "acceptedMemoryEntryId",
  proposal.created_at AS "createdAt",
  proposal.expires_at AS "expiresAt"
`;
const indexedSourceColumns = `
  indexed_source_id AS "id",
  project_id AS "projectId",
  source_type AS "sourceType",
  source_identifier AS "sourceIdentifier",
  relative_path AS "relativePath",
  branch_name AS "branchName",
  commit_hash AS "commitHash",
  content_fingerprint AS "contentFingerprint",
  language,
  size_bytes AS "sizeBytes",
  index_status AS "indexStatus",
  skip_reason AS "skipReason",
  last_indexed_at AS "lastIndexedAt",
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const indexedChunkColumns = `
  indexed_chunk_id AS "id",
  indexed_source_id AS "indexedSourceId",
  chunk_index AS "chunkIndex",
  start_line AS "startLine",
  end_line AS "endLine",
  content,
  content_fingerprint AS "contentFingerprint",
  token_estimate AS "tokenEstimate",
  symbol_metadata_json AS "symbolMetadata",
  embedding_status AS "embeddingStatus",
  embedding_provider AS "embeddingProvider",
  embedding_model AS "embeddingModel",
  embedding_dimensions AS "embeddingDimensions",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const settingsColumns = `
  project_id AS "projectId",
  enabled,
  automatic_proposal_generation AS "automaticProposalGeneration",
  automatic_authoritative_indexing AS "automaticAuthoritativeIndexing",
  repository_exclusions_json AS "repositoryExclusions",
  maximum_indexed_file_size_bytes AS "maximumIndexedFileSizeBytes",
  context_token_budget AS "contextTokenBudget",
  lexical_only AS "lexicalOnly",
  semantic_retrieval_enabled AS "semanticRetrievalEnabled",
  embedding_provider_kind AS "embeddingProviderKind",
  embedding_provider_id AS "embeddingProviderId",
  embedding_model AS "embeddingModel",
  embedding_dimensions AS "embeddingDimensions",
  remote_code_upload_accepted_at AS "remoteCodeUploadAcceptedAt",
  proposal_retention_days AS "proposalRetentionDays",
  stale_memory_behavior AS "staleMemoryBehavior",
  indexing_paused AS "indexingPaused",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const operationColumns = `
  memory_index_operation_id AS "id",
  project_id AS "projectId",
  operation_type AS "operationType",
  status,
  branch_name AS "branchName",
  commit_hash AS "commitHash",
  processed_sources AS "processedSources",
  changed_sources AS "changedSources",
  skipped_sources AS "skippedSources",
  failed_sources AS "failedSources",
  error_summary AS "errorSummary",
  requested_at AS "requestedAt",
  started_at AS "startedAt",
  completed_at AS "completedAt"
`;
const retrievalColumns = `
  memory_retrieval_record_id AS "id",
  agent_run_id AS "agentRunId",
  thread_id AS "threadId",
  message_id AS "messageId",
  project_id AS "projectId",
  mission_id AS "missionId",
  task_id AS "taskId",
  branch_name AS "branchName",
  query,
  retrieval_mode AS "retrievalMode",
  selected_memory_ids_json AS "selectedMemoryIds",
  selected_chunk_ids_json AS "selectedChunkIds",
  excluded_candidate_count AS "excludedCandidateCount",
  token_estimate AS "tokenEstimate",
  ranking_metadata_json AS "rankingMetadata",
  status,
  error_summary AS "errorSummary",
  created_at AS "createdAt"
`;

const isMemoryValidationError = Schema.is(MemoryValidationError);
const isMemoryNotFoundError = Schema.is(MemoryNotFoundError);
const isMemoryConflictError = Schema.is(MemoryConflictError);

const makeId = () => NodeCrypto.randomUUID();
const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const normalizedClaim = (title: string, content: string) =>
  `${title.trim().replace(/\s+/gu, " ").toLocaleLowerCase()}\n${content
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase()}`;
const claimFingerprint = (title: string, content: string) => hash(normalizedClaim(title, content));
const duplicateKey = (input: {
  readonly scopeType: MemoryEntry["scopeType"];
  readonly projectId: MemoryEntry["projectId"];
  readonly branchName: MemoryEntry["branchName"];
  readonly missionId: MemoryEntry["missionId"];
  readonly taskId: MemoryEntry["taskId"];
  readonly type: MemoryEntry["type"];
  readonly title: string;
  readonly content: string;
}) =>
  hash(
    JSON.stringify([
      input.scopeType,
      input.projectId,
      input.branchName,
      input.missionId,
      input.taskId,
      input.type,
      normalizedClaim(input.title, input.content),
    ]),
  );
const ftsExpression = (query: string) => {
  const terms: Array<string> = [];
  const normalized = query.normalize("NFKC");
  const matcher = /"([^"]+)"|([\p{L}\p{N}_]+)/gu;
  for (const match of normalized.matchAll(matcher)) {
    const quoted = match[1];
    if (quoted !== undefined) {
      const phrase = quoted.match(/[\p{L}\p{N}_]+/gu)?.join(" ");
      if (phrase !== undefined && phrase.length > 0) terms.push(`"${phrase}"`);
      continue;
    }
    const token = match[2];
    if (token !== undefined && token.length > 0) terms.push(`"${token}"*`);
  }
  return terms.length === 0 ? null : terms.join(" AND ");
};
const likePattern = (query: string) =>
  `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

const makeProjectionMemoryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));
  const decodeRow = <A>(
    schema: Schema.Codec<A, unknown, never, never>,
    row: unknown,
    operation: string,
  ) =>
    Schema.decodeUnknownEffect(schema)(row).pipe(
      Effect.mapError((error) => PersistenceDecodeError.fromSchemaError(operation, error)),
    );
  const decodeRows = <A>(
    schema: Schema.Codec<A, unknown, never, never>,
    rows: ReadonlyArray<unknown>,
    operation: string,
  ) => Effect.forEach(rows, (row) => decodeRow(schema, row, operation));
  const transaction = <A>(
    operation: string,
    effect: Effect.Effect<A, ProjectionMemoryRepositoryError>,
  ): Effect.Effect<A, ProjectionMemoryRepositoryError> =>
    sql
      .withTransaction(effect)
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error) ||
          isMemoryValidationError(error) ||
          isMemoryNotFoundError(error) ||
          isMemoryConflictError(error)
            ? error
            : toPersistenceSqlError(`${operation}:transaction`)(error),
        ),
      );
  const validation = (message: string, field: string | null = null) =>
    new MemoryValidationError({ message, field });
  const notFound = (
    entityType: "entry" | "source" | "proposal" | "index" | "retrieval",
    entityId: string,
  ) => new MemoryNotFoundError({ entityType, entityId });

  const getEntry = Effect.fn("ProjectionMemoryRepository.getEntry")(function* (
    memoryEntryId: MemoryEntryId,
  ) {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT ${sql.unsafe(entryColumns)}
      FROM projection_memory_entries
      WHERE memory_entry_id = ${memoryEntryId}
    `.pipe(sqlError("ProjectionMemoryRepository.getEntry:query"));
    if (rows[0] === undefined) return Option.none<MemoryEntry>();
    return Option.some(
      yield* decodeRow(MemoryEntryDbRow, rows[0], "ProjectionMemoryRepository.getEntry:decode"),
    );
  });
  const requireEntry = Effect.fn("ProjectionMemoryRepository.requireEntry")(function* (
    memoryEntryId: MemoryEntryId,
  ) {
    const entry = yield* getEntry(memoryEntryId);
    if (Option.isNone(entry)) return yield* notFound("entry", memoryEntryId);
    return entry.value;
  });
  const getProposalRecord = Effect.fn("ProjectionMemoryRepository.getProposalRecord")(function* (
    proposalId: MemoryProposalId,
  ) {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT ${sql.unsafe(proposalColumns)}
      FROM projection_memory_proposals AS proposal
      WHERE proposal.memory_proposal_id = ${proposalId}
    `.pipe(sqlError("ProjectionMemoryRepository.getProposal:query"));
    if (rows[0] === undefined) return Option.none<MemoryProposal>();
    return Option.some(
      yield* decodeRow(
        MemoryProposalDbRow,
        rows[0],
        "ProjectionMemoryRepository.getProposal:decode",
      ),
    );
  });
  const requireProposal = Effect.fn("ProjectionMemoryRepository.requireProposal")(function* (
    proposalId: MemoryProposalId,
  ) {
    const proposal = yield* getProposalRecord(proposalId);
    if (Option.isNone(proposal)) return yield* notFound("proposal", proposalId);
    return proposal.value;
  });

  const validateScope = (scope: {
    readonly scopeType: MemoryEntry["scopeType"];
    readonly scopeId: string | null;
    readonly projectId: MemoryEntry["projectId"];
    readonly branchName: string | null;
    readonly missionId: MemoryEntry["missionId"];
    readonly taskId: MemoryEntry["taskId"];
  }) =>
    Effect.gen(function* () {
      const valid =
        (scope.scopeType === "user" &&
          scope.projectId === null &&
          scope.branchName === null &&
          scope.missionId === null &&
          scope.taskId === null) ||
        (scope.scopeType === "project" &&
          scope.projectId !== null &&
          scope.branchName === null &&
          scope.missionId === null &&
          scope.taskId === null) ||
        (scope.scopeType === "branch" &&
          scope.projectId !== null &&
          scope.branchName !== null &&
          scope.missionId === null &&
          scope.taskId === null) ||
        (scope.scopeType === "mission" &&
          scope.projectId !== null &&
          scope.branchName === null &&
          scope.missionId !== null &&
          scope.taskId === null) ||
        (scope.scopeType === "task" &&
          scope.projectId !== null &&
          scope.branchName === null &&
          scope.missionId !== null &&
          scope.taskId !== null);
      if (!valid)
        return yield* validation("Memory fields do not match the selected scope", "scope");
      const expectedScopeId =
        scope.scopeType === "project"
          ? scope.projectId
          : scope.scopeType === "branch"
            ? scope.branchName
            : scope.scopeType === "mission"
              ? scope.missionId
              : scope.scopeType === "task"
                ? scope.taskId
                : null;
      if (
        scope.scopeType !== "user" &&
        scope.scopeId !== null &&
        scope.scopeId !== expectedScopeId
      ) {
        return yield* validation("scopeId does not identify the selected scope", "scopeId");
      }
    });

  const sourceIsResolved = (
    source: Parameters<ProjectionMemoryRepositoryShape["addSource"]>[0]["source"],
  ) => {
    if (source.sourceType === "manual_entry") return true;
    switch (source.sourceType) {
      case "repository_file":
      case "agents_file":
      case "documentation":
        return source.filePath !== null && source.contentFingerprint !== null;
      case "user_instruction":
        return source.messageReference !== null;
      case "mission_event":
        return source.missionId !== null;
      case "agent_handoff":
        return source.missionId !== null && source.taskId !== null && source.agentRunId !== null;
      case "verification_result":
        return source.verificationRunId !== null;
      case "github_issue":
      case "github_pull_request":
      case "github_review":
        return source.githubRecordType !== null && source.githubRecordId !== null;
      case "git_commit":
      case "git_diff":
        return source.commitHash !== null && source.contentFingerprint !== null;
      case "derived":
        return source.contentFingerprint !== null;
    }
  };

  const validateSourceOwnership = Effect.fn("ProjectionMemoryRepository.validateSourceOwnership")(
    function* (
      entry: MemoryEntry,
      source: Parameters<ProjectionMemoryRepositoryShape["addSource"]>[0]["source"],
    ) {
      if (
        source.projectId !== null &&
        (entry.projectId === null || source.projectId !== entry.projectId)
      ) {
        return yield* validation(
          "Memory sources cannot reference a different project",
          "source.projectId",
        );
      }
      if (source.missionId !== null) {
        const rows = yield* sql<{ readonly found: number }>`
          SELECT count(*) AS found FROM projection_missions
          WHERE mission_id = ${source.missionId} AND project_id = ${entry.projectId}
        `.pipe(sqlError("ProjectionMemoryRepository.validateSourceOwnership:mission"));
        if ((rows[0]?.found ?? 0) === 0) {
          return yield* validation(
            "Memory source mission does not belong to the owning project",
            "source.missionId",
          );
        }
      }
      if (source.agentRunId !== null) {
        const rows = yield* sql<{ readonly found: number }>`
          SELECT count(*) AS found
          FROM projection_agent_runs AS run
          JOIN projection_missions AS mission ON mission.mission_id = run.mission_id
          WHERE run.agent_run_id = ${source.agentRunId} AND mission.project_id = ${entry.projectId}
        `.pipe(sqlError("ProjectionMemoryRepository.validateSourceOwnership:agentRun"));
        if ((rows[0]?.found ?? 0) === 0) {
          return yield* validation(
            "Memory source agent run does not belong to the owning project",
            "source.agentRunId",
          );
        }
      }
      if (source.verificationRunId !== null) {
        const rows = yield* sql<{ readonly found: number }>`
          SELECT count(*) AS found FROM projection_verification_runs
          WHERE verification_run_id = ${source.verificationRunId}
            AND project_id = ${entry.projectId}
        `.pipe(sqlError("ProjectionMemoryRepository.validateSourceOwnership:verification"));
        if ((rows[0]?.found ?? 0) === 0) {
          return yield* validation(
            "Memory source verification does not belong to the owning project",
            "source.verificationRunId",
          );
        }
      }
      if (source.githubRecordId !== null && entry.projectId !== null) {
        const table =
          source.sourceType === "github_issue"
            ? "projection_github_issues"
            : source.sourceType === "github_pull_request"
              ? "projection_github_pull_requests"
              : source.sourceType === "github_review"
                ? "projection_github_pull_request_reviews"
                : null;
        if (table !== null) {
          const rows =
            table === "projection_github_issues"
              ? yield* sql<{ readonly found: number }>`
                  SELECT count(*) AS found
                  FROM projection_github_issues AS record
                  JOIN projection_github_repository_connections AS connection
                    ON connection.repository_connection_id = record.repository_connection_id
                  WHERE record.github_issue_record_id = ${source.githubRecordId}
                    AND connection.project_id = ${entry.projectId}
                `.pipe(sqlError("ProjectionMemoryRepository.validateSourceOwnership:githubIssue"))
              : table === "projection_github_pull_requests"
                ? yield* sql<{ readonly found: number }>`
                    SELECT count(*) AS found
                    FROM projection_github_pull_requests AS record
                    JOIN projection_github_repository_connections AS connection
                      ON connection.repository_connection_id = record.repository_connection_id
                    WHERE record.pull_request_record_id = ${source.githubRecordId}
                      AND connection.project_id = ${entry.projectId}
                  `.pipe(sqlError("ProjectionMemoryRepository.validateSourceOwnership:githubPr"))
                : yield* sql<{ readonly found: number }>`
                    SELECT count(*) AS found
                    FROM projection_github_pull_request_reviews AS review
                    JOIN projection_github_pull_requests AS pull_request
                      ON pull_request.pull_request_record_id = review.pull_request_record_id
                    JOIN projection_github_repository_connections AS connection
                      ON connection.repository_connection_id = pull_request.repository_connection_id
                    WHERE review.pull_request_review_record_id = ${source.githubRecordId}
                      AND connection.project_id = ${entry.projectId}
                  `.pipe(
                    sqlError("ProjectionMemoryRepository.validateSourceOwnership:githubReview"),
                  );
          if ((rows[0]?.found ?? 0) === 0) {
            return yield* validation(
              "Memory source GitHub record does not belong to the owning project",
              "source.githubRecordId",
            );
          }
        }
      }
    },
  );

  const insertSource = Effect.fn("ProjectionMemoryRepository.insertSource")(function* (
    memoryEntryId: MemoryEntryId,
    source: Parameters<ProjectionMemoryRepositoryShape["addSource"]>[0]["source"],
    createdAt: string,
  ) {
    const entry = yield* requireEntry(memoryEntryId);
    yield* validateSourceOwnership(entry, source);
    const id = MemorySourceId.make(makeId());
    const record: MemorySource = {
      id,
      memoryEntryId,
      ...source,
      sourceStatus: sourceIsResolved(source) ? "resolved" : "unresolved",
      createdAt,
    };
    yield* sql`
      INSERT INTO projection_memory_sources (
        memory_source_id, memory_entry_id, source_type, source_identifier, project_id,
        repository_path, file_path, start_line, end_line, commit_hash, branch_name,
        mission_id, task_id, agent_run_id, verification_run_id, github_record_type,
        github_record_id, message_reference, content_fingerprint, source_status, created_at
      ) VALUES (
        ${record.id}, ${record.memoryEntryId}, ${record.sourceType}, ${record.sourceIdentifier},
        ${record.projectId}, ${record.repositoryPath}, ${record.filePath}, ${record.startLine},
        ${record.endLine}, ${record.commitHash}, ${record.branchName}, ${record.missionId},
        ${record.taskId}, ${record.agentRunId}, ${record.verificationRunId},
        ${record.githubRecordType}, ${record.githubRecordId}, ${record.messageReference},
        ${record.contentFingerprint}, ${record.sourceStatus}, ${record.createdAt}
      )
    `.pipe(sqlError("ProjectionMemoryRepository.insertSource:query"));
    return record;
  });

  const insertLifecycle = Effect.fn("ProjectionMemoryRepository.insertLifecycle")(function* (
    record: Omit<MemoryLifecycleRecord, "id">,
  ) {
    const lifecycle: MemoryLifecycleRecord = {
      ...record,
      id: MemoryLifecycleRecordId.make(makeId()),
    };
    yield* sql`
      INSERT INTO projection_memory_lifecycle (
        memory_lifecycle_record_id, memory_entry_id, action, previous_status, next_status,
        actor_type, actor_id, reason, created_at
      ) VALUES (
        ${lifecycle.id}, ${lifecycle.memoryEntryId}, ${lifecycle.action},
        ${lifecycle.previousStatus}, ${lifecycle.nextStatus}, ${lifecycle.actorType},
        ${lifecycle.actorId}, ${lifecycle.reason}, ${lifecycle.createdAt}
      )
    `.pipe(sqlError("ProjectionMemoryRepository.insertLifecycle:query"));
    return lifecycle;
  });

  const listEntrySources = Effect.fn("ProjectionMemoryRepository.listEntrySources")(function* (
    memoryEntryId: MemoryEntryId,
  ) {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT ${sql.unsafe(sourceColumns)}
      FROM projection_memory_sources
      WHERE memory_entry_id = ${memoryEntryId}
      ORDER BY created_at, memory_source_id
    `.pipe(sqlError("ProjectionMemoryRepository.listEntrySources:query"));
    return yield* decodeRows(
      MemorySource,
      rows,
      "ProjectionMemoryRepository.listEntrySources:decode",
    );
  });
  const listRelations = Effect.fn("ProjectionMemoryRepository.listRelations")(function* (
    input: Parameters<ProjectionMemoryRepositoryShape["listRelations"]>[0],
  ) {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT ${sql.unsafe(relationColumns)}
      FROM projection_memory_relations
      WHERE from_memory_entry_id = ${input.memoryEntryId}
         OR to_memory_entry_id = ${input.memoryEntryId}
      ORDER BY created_at, memory_relation_id
    `.pipe(sqlError("ProjectionMemoryRepository.listRelations:query"));
    return yield* decodeRows(
      MemoryRelation,
      rows,
      "ProjectionMemoryRepository.listRelations:decode",
    );
  });
  const getEntryDetail = Effect.fn("ProjectionMemoryRepository.getEntryDetail")(function* (
    memoryEntryId: MemoryEntryId,
  ) {
    const entry = yield* getEntry(memoryEntryId);
    if (Option.isNone(entry)) return Option.none();
    const [sources, relations, lifecycle, retrievalCountRows] = yield* Effect.all([
      listEntrySources(memoryEntryId),
      listRelations({ memoryEntryId }),
      sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(lifecycleColumns)}
        FROM projection_memory_lifecycle
        WHERE memory_entry_id = ${memoryEntryId}
        ORDER BY created_at, rowid
      `.pipe(
        sqlError("ProjectionMemoryRepository.getEntryDetail:lifecycle"),
        Effect.flatMap((rows) =>
          decodeRows(
            MemoryLifecycleRecord,
            rows,
            "ProjectionMemoryRepository.getEntryDetail:lifecycleDecode",
          ),
        ),
      ),
      sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM projection_memory_retrieval_records, json_each(selected_memory_ids_json)
        WHERE json_each.value = ${memoryEntryId}
      `.pipe(sqlError("ProjectionMemoryRepository.getEntryDetail:retrievalCount")),
    ]);
    return Option.some({
      entry: entry.value,
      sources,
      relations,
      lifecycle,
      retrievalCount: retrievalCountRows[0]?.count ?? 0,
    });
  });
  const requireDetail = Effect.fn("ProjectionMemoryRepository.requireDetail")(function* (
    memoryEntryId: MemoryEntryId,
  ) {
    const detail = yield* getEntryDetail(memoryEntryId);
    if (Option.isNone(detail)) return yield* notFound("entry", memoryEntryId);
    return detail.value;
  });

  const insertEntry = Effect.fn("ProjectionMemoryRepository.insertEntry")(function* (
    input: Parameters<ProjectionMemoryRepositoryShape["createEntry"]>[0],
    targetStatus: MemoryEntry["status"],
    timestamp: string,
  ) {
    yield* validateScope(input);
    if (targetStatus !== "proposed" && !input.sources.some(sourceIsResolved)) {
      return yield* validation("Active memory requires at least one resolved source", "sources");
    }
    if (input.creationMode === "automatic_authoritative" && input.trustLevel !== "authoritative") {
      return yield* validation(
        "Automatic authoritative memory must use authoritative trust",
        "trustLevel",
      );
    }
    if (
      input.creationMode === "automatic_authoritative" &&
      (input.createdByType !== "system" ||
        !input.sources.some(
          (source) =>
            ["repository_file", "agents_file", "documentation", "git_commit"].includes(
              source.sourceType,
            ) && source.contentFingerprint !== null,
        ))
    ) {
      return yield* validation(
        "Automatic authoritative memory requires deterministic system-owned source evidence",
        "creationMode",
      );
    }
    if (
      input.trustLevel === "authoritative" &&
      input.createdByType === "agent" &&
      input.creationMode !== "automatic_authoritative"
    ) {
      return yield* validation(
        "Agent-authored memories cannot become authoritative without deterministic sourcing",
        "trustLevel",
      );
    }
    const fingerprint = claimFingerprint(input.title, input.content);
    const key = duplicateKey(input);
    const duplicates = yield* sql<{ readonly id: string }>`
      SELECT memory_entry_id AS id
      FROM projection_memory_entries
      WHERE duplicate_key = ${key}
        AND status IN ('proposed', 'active', 'stale', 'disputed')
      LIMIT 1
    `.pipe(sqlError("ProjectionMemoryRepository.insertEntry:duplicate"));
    if (duplicates[0] !== undefined) {
      return yield* new MemoryConflictError({
        message: "An equivalent current memory already exists",
        conflictingMemoryIds: [MemoryEntryId.make(duplicates[0].id)],
      });
    }
    const id = MemoryEntryId.make(makeId());
    yield* sql`
      INSERT INTO projection_memory_entries (
        memory_entry_id, scope_type, scope_id, project_id, branch_name, mission_id,
        task_id, type, title, content, structured_data_json, trust_level, status,
        confidence, created_by_type, created_by_id, creation_mode, pinned,
        claim_fingerprint, duplicate_key, created_at, updated_at, last_verified_at,
        expires_at, superseded_by_id, contradiction_group_id, stale_reason
      ) VALUES (
        ${id}, ${input.scopeType}, ${input.scopeId}, ${input.projectId}, ${input.branchName},
        ${input.missionId}, ${input.taskId}, ${input.type}, ${input.title}, ${input.content},
        ${input.structuredData === null ? null : encodeUnknownJson(input.structuredData)},
        ${input.trustLevel}, 'proposed', ${input.confidence}, ${input.createdByType},
        ${input.createdById}, ${input.creationMode}, ${input.pinned ? 1 : 0}, ${fingerprint},
        ${key}, ${timestamp}, ${timestamp}, NULL, ${input.expiresAt}, NULL, NULL, NULL
      )
    `.pipe(sqlError("ProjectionMemoryRepository.insertEntry:insert"));
    yield* Effect.forEach(input.sources, (source) => insertSource(id, source, timestamp), {
      discard: true,
    });
    yield* insertLifecycle({
      memoryEntryId: id,
      action: "created",
      previousStatus: null,
      nextStatus: "proposed",
      actorType: input.createdByType,
      actorId: input.createdById,
      reason: null,
      createdAt: timestamp,
    });
    if (targetStatus !== "proposed") {
      yield* sql`
        UPDATE projection_memory_entries
        SET status = ${targetStatus}, updated_at = ${timestamp}
        WHERE memory_entry_id = ${id}
      `.pipe(sqlError("ProjectionMemoryRepository.insertEntry:activate"));
      yield* insertLifecycle({
        memoryEntryId: id,
        action: targetStatus === "active" ? "activated" : "updated",
        previousStatus: "proposed",
        nextStatus: targetStatus,
        actorType: input.createdByType,
        actorId: input.createdById,
        reason: null,
        createdAt: timestamp,
      });
    }
    return yield* requireDetail(id);
  });

  const createEntry: ProjectionMemoryRepositoryShape["createEntry"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.createEntry",
      Effect.gen(function* () {
        const timestamp = yield* nowIso;
        return yield* insertEntry(
          input,
          input.creationMode === "proposed" ? "proposed" : "active",
          timestamp,
        );
      }),
    );

  const updateEntry: ProjectionMemoryRepositoryShape["updateEntry"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.updateEntry",
      Effect.gen(function* () {
        const current = yield* requireEntry(input.memoryEntryId);
        if (current.status === "superseded") {
          return yield* validation(
            "Superseded memory is historical; create a replacement instead of editing it",
            "memoryEntryId",
          );
        }
        const scope = input.scope ?? current;
        yield* validateScope(scope);
        const next = {
          ...current,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.content === undefined ? {} : { content: input.content }),
          ...(input.structuredData === undefined ? {} : { structuredData: input.structuredData }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.trustLevel === undefined ? {} : { trustLevel: input.trustLevel }),
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
          ...(input.scope === undefined ? {} : input.scope),
          ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        };
        const timestamp = yield* nowIso;
        const key = duplicateKey(next);
        const duplicates = yield* sql<{ readonly id: string }>`
          SELECT memory_entry_id AS id
          FROM projection_memory_entries
          WHERE duplicate_key = ${key}
            AND memory_entry_id <> ${input.memoryEntryId}
            AND status IN ('proposed', 'active', 'stale', 'disputed')
          LIMIT 1
        `.pipe(sqlError("ProjectionMemoryRepository.updateEntry:duplicate"));
        if (duplicates[0] !== undefined) {
          return yield* new MemoryConflictError({
            message: "This edit duplicates another current memory",
            conflictingMemoryIds: [MemoryEntryId.make(duplicates[0].id)],
          });
        }
        yield* sql`
          UPDATE projection_memory_entries SET
            scope_type = ${next.scopeType}, scope_id = ${next.scopeId},
            project_id = ${next.projectId}, branch_name = ${next.branchName},
            mission_id = ${next.missionId}, task_id = ${next.taskId}, type = ${next.type},
            title = ${next.title}, content = ${next.content},
            structured_data_json = ${
              next.structuredData === null ? null : encodeUnknownJson(next.structuredData)
            },
            trust_level = ${next.trustLevel}, confidence = ${next.confidence},
            pinned = ${next.pinned ? 1 : 0}, expires_at = ${next.expiresAt},
            claim_fingerprint = ${claimFingerprint(next.title, next.content)},
            duplicate_key = ${key}, updated_at = ${timestamp}
          WHERE memory_entry_id = ${input.memoryEntryId}
        `.pipe(sqlError("ProjectionMemoryRepository.updateEntry:update"));
        yield* insertLifecycle({
          memoryEntryId: input.memoryEntryId,
          action:
            input.scope !== undefined
              ? "scope_changed"
              : input.pinned === true && !current.pinned
                ? "pinned"
                : input.pinned === false && current.pinned
                  ? "unpinned"
                  : "updated",
          previousStatus: current.status,
          nextStatus: current.status,
          actorType: input.actorType,
          actorId: input.actorId,
          reason: input.reason,
          createdAt: timestamp,
        });
        return yield* requireDetail(input.memoryEntryId);
      }),
    );

  const applyEntryAction: ProjectionMemoryRepositoryShape["applyEntryAction"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.applyEntryAction",
      Effect.gen(function* () {
        const current = yield* requireEntry(input.memoryEntryId);
        const timestamp = yield* nowIso;
        let nextStatus = current.status;
        let trustLevel = current.trustLevel;
        let pinned = current.pinned;
        let contradictionGroupId = current.contradictionGroupId;
        let staleReason = current.staleReason;
        let lastVerifiedAt = current.lastVerifiedAt;
        let lifecycleAction: MemoryLifecycleRecord["action"] = "updated";
        switch (input.action) {
          case "activate":
            nextStatus = "active";
            staleReason = null;
            lifecycleAction = "activated";
            break;
          case "mark_stale":
            nextStatus = "stale";
            staleReason = input.reason ?? "Supporting evidence may no longer be current";
            lifecycleAction = "marked_stale";
            break;
          case "dispute":
            nextStatus = "disputed";
            contradictionGroupId = contradictionGroupId ?? makeId();
            lifecycleAction = "disputed";
            break;
          case "reject":
            nextStatus = "rejected";
            lifecycleAction = "rejected";
            break;
          case "archive":
            nextStatus = "archived";
            lifecycleAction = "archived";
            break;
          case "restore":
            nextStatus = current.status === "rejected" ? "proposed" : "active";
            staleReason = null;
            lifecycleAction = "restored";
            break;
          case "pin":
            pinned = true;
            lifecycleAction = "pinned";
            break;
          case "unpin":
            pinned = false;
            lifecycleAction = "unpinned";
            break;
          case "verify":
            lastVerifiedAt = timestamp;
            if (current.status === "stale") {
              nextStatus = "active";
              staleReason = null;
            }
            lifecycleAction = "verified";
            break;
        }
        const resolvedGroupId =
          contradictionGroupId !== null &&
          (input.action === "activate" || input.action === "restore")
            ? contradictionGroupId
            : null;
        if (resolvedGroupId !== null) {
          contradictionGroupId = null;
          if (trustLevel === "disputed") trustLevel = "unverified";
        }
        yield* sql`
          UPDATE projection_memory_entries SET
            status = ${nextStatus}, trust_level = ${trustLevel}, pinned = ${pinned ? 1 : 0},
            contradiction_group_id = ${contradictionGroupId}, stale_reason = ${staleReason},
            last_verified_at = ${lastVerifiedAt}, updated_at = ${timestamp}
          WHERE memory_entry_id = ${input.memoryEntryId}
        `.pipe(sqlError("ProjectionMemoryRepository.applyEntryAction:update"));
        yield* insertLifecycle({
          memoryEntryId: input.memoryEntryId,
          action: lifecycleAction,
          previousStatus: current.status,
          nextStatus,
          actorType: input.actorType,
          actorId: input.actorId,
          reason: input.reason,
          createdAt: timestamp,
        });
        if (resolvedGroupId !== null) {
          const peers = yield* sql<Record<string, unknown>>`
            SELECT ${sql.unsafe(entryColumns)}
            FROM projection_memory_entries
            WHERE contradiction_group_id = ${resolvedGroupId}
              AND memory_entry_id <> ${input.memoryEntryId}
          `.pipe(
            sqlError("ProjectionMemoryRepository.applyEntryAction:contradictionPeers"),
            Effect.flatMap((rows) =>
              decodeRows(
                MemoryEntryDbRow,
                rows,
                "ProjectionMemoryRepository.applyEntryAction:contradictionPeersDecode",
              ),
            ),
          );
          yield* sql`
            UPDATE projection_memory_entries
            SET status = CASE WHEN status = 'disputed' THEN 'active' ELSE status END,
                trust_level = CASE WHEN trust_level = 'disputed' THEN 'unverified' ELSE trust_level END,
                contradiction_group_id = NULL, updated_at = ${timestamp}
            WHERE contradiction_group_id = ${resolvedGroupId}
          `.pipe(sqlError("ProjectionMemoryRepository.applyEntryAction:resolveContradiction"));
          yield* Effect.forEach(
            peers,
            (peer) =>
              insertLifecycle({
                memoryEntryId: peer.id,
                action: "restored",
                previousStatus: peer.status,
                nextStatus: peer.status === "disputed" ? "active" : peer.status,
                actorType: input.actorType,
                actorId: input.actorId,
                reason: input.reason ?? "Contradiction resolved",
                createdAt: timestamp,
              }),
            { discard: true },
          );
        }
        return yield* requireDetail(input.memoryEntryId);
      }),
    );

  const supersedeEntry: ProjectionMemoryRepositoryShape["supersedeEntry"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.supersedeEntry",
      Effect.gen(function* () {
        if (input.supersededMemoryEntryId === input.replacementMemoryEntryId) {
          return yield* validation("A memory cannot supersede itself", "replacementMemoryEntryId");
        }
        const [oldEntry, replacement] = yield* Effect.all([
          requireEntry(input.supersededMemoryEntryId),
          requireEntry(input.replacementMemoryEntryId),
        ]);
        if (oldEntry.status === "superseded") {
          if (oldEntry.supersededById === replacement.id) return yield* requireDetail(oldEntry.id);
          return yield* new MemoryConflictError({
            message: "Memory is already superseded by another entry",
            conflictingMemoryIds: [oldEntry.id, oldEntry.supersededById!],
          });
        }
        if (replacement.status !== "active" && replacement.status !== "stale") {
          return yield* validation(
            "Replacement memory must be active or stale",
            "replacementMemoryEntryId",
          );
        }
        if (oldEntry.projectId !== replacement.projectId) {
          return yield* validation(
            "Supersession cannot cross project boundaries",
            "replacementMemoryEntryId",
          );
        }
        const cycle = yield* sql<{ readonly found: number }>`
          WITH RECURSIVE chain(memory_entry_id, superseded_by_id) AS (
            SELECT memory_entry_id, superseded_by_id
            FROM projection_memory_entries
            WHERE memory_entry_id = ${replacement.id}
            UNION
            SELECT entry.memory_entry_id, entry.superseded_by_id
            FROM projection_memory_entries AS entry
            JOIN chain ON entry.memory_entry_id = chain.superseded_by_id
            WHERE entry.superseded_by_id IS NOT NULL
          )
          SELECT count(*) AS found FROM chain
          WHERE memory_entry_id = ${oldEntry.id}
        `.pipe(sqlError("ProjectionMemoryRepository.supersedeEntry:cycle"));
        if ((cycle[0]?.found ?? 0) > 0) {
          return yield* new MemoryConflictError({
            message: "Supersession would create a cycle",
            conflictingMemoryIds: [oldEntry.id, replacement.id],
          });
        }
        const timestamp = yield* nowIso;
        const contradictionPeers =
          oldEntry.contradictionGroupId === null
            ? []
            : yield* sql<Record<string, unknown>>`
                SELECT ${sql.unsafe(entryColumns)}
                FROM projection_memory_entries
                WHERE contradiction_group_id = ${oldEntry.contradictionGroupId}
                  AND memory_entry_id <> ${oldEntry.id}
              `.pipe(
                sqlError("ProjectionMemoryRepository.supersedeEntry:contradictionPeers"),
                Effect.flatMap((rows) =>
                  decodeRows(
                    MemoryEntryDbRow,
                    rows,
                    "ProjectionMemoryRepository.supersedeEntry:contradictionPeersDecode",
                  ),
                ),
              );
        yield* sql`
          UPDATE projection_memory_entries
          SET status = 'superseded', superseded_by_id = ${replacement.id}, updated_at = ${timestamp}
          WHERE memory_entry_id = ${oldEntry.id}
        `.pipe(sqlError("ProjectionMemoryRepository.supersedeEntry:update"));
        if (oldEntry.contradictionGroupId !== null) {
          yield* sql`
            UPDATE projection_memory_entries
            SET status = CASE WHEN status = 'disputed' THEN 'active' ELSE status END,
                trust_level = CASE WHEN trust_level = 'disputed' THEN 'unverified' ELSE trust_level END,
                contradiction_group_id = NULL, updated_at = ${timestamp}
            WHERE contradiction_group_id = ${oldEntry.contradictionGroupId}
              AND memory_entry_id <> ${oldEntry.id}
          `.pipe(sqlError("ProjectionMemoryRepository.supersedeEntry:resolveContradiction"));
          yield* Effect.forEach(
            contradictionPeers,
            (peer) =>
              insertLifecycle({
                memoryEntryId: peer.id,
                action: "restored",
                previousStatus: peer.status,
                nextStatus: peer.status === "disputed" ? "active" : peer.status,
                actorType: input.actorType,
                actorId: input.actorId,
                reason: input.reason,
                createdAt: timestamp,
              }),
            { discard: true },
          );
        }
        yield* sql`
          INSERT INTO projection_memory_relations (
            memory_relation_id, from_memory_entry_id, to_memory_entry_id, relation_type, created_at
          ) VALUES (
            ${MemoryRelationId.make(makeId())}, ${replacement.id}, ${oldEntry.id}, 'supersedes',
            ${timestamp}
          )
          ON CONFLICT (from_memory_entry_id, to_memory_entry_id, relation_type) DO NOTHING
        `.pipe(sqlError("ProjectionMemoryRepository.supersedeEntry:relation"));
        yield* insertLifecycle({
          memoryEntryId: oldEntry.id,
          action: "superseded",
          previousStatus: oldEntry.status,
          nextStatus: "superseded",
          actorType: input.actorType,
          actorId: input.actorId,
          reason: input.reason,
          createdAt: timestamp,
        });
        return yield* requireDetail(oldEntry.id);
      }),
    );

  const addSource: ProjectionMemoryRepositoryShape["addSource"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.addSource",
      Effect.gen(function* () {
        const entry = yield* requireEntry(input.memoryEntryId);
        const timestamp = yield* nowIso;
        const source = yield* insertSource(input.memoryEntryId, input.source, timestamp);
        yield* insertLifecycle({
          memoryEntryId: entry.id,
          action: "source_added",
          previousStatus: entry.status,
          nextStatus: entry.status,
          actorType: input.actorType,
          actorId: input.actorId,
          reason: input.reason,
          createdAt: timestamp,
        });
        return source;
      }),
    );

  const createRelation: ProjectionMemoryRepositoryShape["createRelation"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.createRelation",
      Effect.gen(function* () {
        if (input.fromMemoryEntryId === input.toMemoryEntryId) {
          return yield* validation("A memory relation cannot point to itself", "toMemoryEntryId");
        }
        const [fromEntry, toEntry] = yield* Effect.all([
          requireEntry(input.fromMemoryEntryId),
          requireEntry(input.toMemoryEntryId),
        ]);
        const timestamp = yield* nowIso;
        const relation: MemoryRelation = {
          id: MemoryRelationId.make(makeId()),
          ...input,
          createdAt: timestamp,
        };
        yield* sql`
          INSERT INTO projection_memory_relations (
            memory_relation_id, from_memory_entry_id, to_memory_entry_id, relation_type, created_at
          ) VALUES (
            ${relation.id}, ${relation.fromMemoryEntryId}, ${relation.toMemoryEntryId},
            ${relation.relationType}, ${relation.createdAt}
          )
        `.pipe(sqlError("ProjectionMemoryRepository.createRelation:insert"));
        if (relation.relationType === "contradicts") {
          if (fromEntry.projectId !== toEntry.projectId) {
            return yield* validation(
              "Contradictions cannot cross project boundaries",
              "toMemoryEntryId",
            );
          }
          const groupId =
            fromEntry.contradictionGroupId ?? toEntry.contradictionGroupId ?? makeId();
          for (const entry of [fromEntry, toEntry]) {
            if (["proposed", "active", "stale", "disputed"].includes(entry.status)) {
              yield* sql`
                UPDATE projection_memory_entries
                SET status = 'disputed', contradiction_group_id = ${groupId},
                    updated_at = ${timestamp}
                WHERE memory_entry_id = ${entry.id}
              `.pipe(sqlError("ProjectionMemoryRepository.createRelation:dispute"));
              yield* insertLifecycle({
                memoryEntryId: entry.id,
                action: "disputed",
                previousStatus: entry.status,
                nextStatus: "disputed",
                actorType: "system",
                actorId: null,
                reason: "Contradictory memory relation created",
                createdAt: timestamp,
              });
            }
          }
        }
        return relation;
      }),
    );

  const getSource: ProjectionMemoryRepositoryShape["getSource"] = (memorySourceId) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(sourceColumns)}
        FROM projection_memory_sources
        WHERE memory_source_id = ${memorySourceId}
      `.pipe(sqlError("ProjectionMemoryRepository.getSource:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(MemorySource, rows[0], "ProjectionMemoryRepository.getSource:decode"),
      );
    });

  const updateMemorySourceStatus: ProjectionMemoryRepositoryShape["updateMemorySourceStatus"] = (
    input,
  ) =>
    sql`
      UPDATE projection_memory_sources
      SET source_status = ${input.status}
      WHERE memory_source_id = ${input.memorySourceId}
    `.pipe(sqlError("ProjectionMemoryRepository.updateMemorySourceStatus:update"), Effect.asVoid);

  const entryFilterClauses = (
    filter: Parameters<ProjectionMemoryRepositoryShape["listEntries"]>[0],
  ) => {
    const clauses = [sql.literal("1=1")];
    if (filter.projectId !== null) {
      clauses.push(sql`(entry.project_id = ${filter.projectId} OR entry.scope_type = 'user')`);
    }
    if (filter.scopeTypes.length > 0) clauses.push(sql.in("entry.scope_type", filter.scopeTypes));
    if (filter.types.length > 0) clauses.push(sql.in("entry.type", filter.types));
    if (filter.statuses.length > 0) clauses.push(sql.in("entry.status", filter.statuses));
    if (filter.trustLevels.length > 0)
      clauses.push(sql.in("entry.trust_level", filter.trustLevels));
    if (filter.branchName !== null) {
      clauses.push(sql`(entry.scope_type <> 'branch' OR entry.branch_name = ${filter.branchName})`);
    }
    if (filter.missionId !== null) {
      clauses.push(
        sql`(entry.scope_type NOT IN ('mission', 'task') OR entry.mission_id = ${filter.missionId})`,
      );
    }
    if (filter.taskId !== null) {
      clauses.push(sql`(entry.scope_type <> 'task' OR entry.task_id = ${filter.taskId})`);
    }
    if (filter.createdAfter !== null) clauses.push(sql`entry.created_at >= ${filter.createdAfter}`);
    if (filter.staleOnly) clauses.push(sql`entry.status = 'stale'`);
    if (filter.pinnedOnly) clauses.push(sql`entry.pinned = 1`);
    if (filter.sourceTypes.length > 0) {
      clauses.push(sql`EXISTS (
        SELECT 1 FROM projection_memory_sources AS source
        WHERE source.memory_entry_id = entry.memory_entry_id
          AND ${sql.in("source.source_type", filter.sourceTypes)}
      )`);
    }
    if (filter.query.trim().length > 0) {
      const expression = ftsExpression(filter.query);
      clauses.push(
        expression === null
          ? sql`(entry.title LIKE ${likePattern(filter.query)} ESCAPE '\\'
              OR entry.content LIKE ${likePattern(filter.query)} ESCAPE '\\')`
          : sql`entry.rowid IN (
              SELECT rowid FROM projection_memory_entries_fts
              WHERE projection_memory_entries_fts MATCH ${expression}
            )`,
      );
    }
    return clauses;
  };

  const listEntries: ProjectionMemoryRepositoryShape["listEntries"] = (filter) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(entryColumns)}
        FROM projection_memory_entries AS entry
        WHERE ${sql.and(entryFilterClauses(filter))}
        ORDER BY entry.pinned DESC, entry.updated_at DESC, entry.memory_entry_id
        LIMIT ${filter.limit} OFFSET ${filter.offset}
      `.pipe(sqlError("ProjectionMemoryRepository.listEntries:query"));
      return yield* decodeRows(
        MemoryEntryDbRow,
        rows,
        "ProjectionMemoryRepository.listEntries:decode",
      );
    });
  const countEntries: ProjectionMemoryRepositoryShape["countEntries"] = (filter) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM projection_memory_entries AS entry
        WHERE ${sql.and(entryFilterClauses(filter))}
      `.pipe(sqlError("ProjectionMemoryRepository.countEntries:query"));
      return rows[0]?.count ?? 0;
    });

  const searchEligibleEntries: ProjectionMemoryRepositoryShape["searchEligibleEntries"] = (input) =>
    Effect.gen(function* () {
      const clauses = [
        sql`(
            entry.scope_type = 'user'
            OR (entry.scope_type = 'project' AND entry.project_id = ${input.projectId})
            OR (entry.scope_type = 'branch' AND entry.project_id = ${input.projectId}
                AND entry.branch_name = ${input.branchName})
            OR (entry.scope_type = 'mission' AND entry.project_id = ${input.projectId}
                AND entry.mission_id = ${input.missionId})
            OR (entry.scope_type = 'task' AND entry.project_id = ${input.projectId}
                AND entry.mission_id = ${input.missionId} AND entry.task_id = ${input.taskId})
          )`,
        input.statuses.length === 0
          ? sql`entry.status IN ('active', 'stale')`
          : sql.in("entry.status", input.statuses),
      ];
      if (input.types.length > 0) clauses.push(sql.in("entry.type", input.types));
      if (input.minimumTrust !== null) {
        const threshold = {
          authoritative: 6,
          verified: 5,
          supported: 4,
          inferred: 3,
          unverified: 2,
          disputed: 1,
        }[input.minimumTrust];
        clauses.push(sql`CASE entry.trust_level
            WHEN 'authoritative' THEN 6 WHEN 'verified' THEN 5 WHEN 'supported' THEN 4
            WHEN 'inferred' THEN 3 WHEN 'unverified' THEN 2 ELSE 1 END >= ${threshold}`);
      }
      const expression = ftsExpression(input.query);
      let rows: ReadonlyArray<Record<string, unknown>>;
      if (expression === null) {
        rows = yield* sql<Record<string, unknown>>`
            SELECT ${sql.unsafe(entryColumns)}, 0.0 AS "lexicalScore"
            FROM projection_memory_entries AS entry
            WHERE ${sql.and(clauses)}
              AND (entry.title LIKE ${likePattern(input.query)} ESCAPE '\\'
                   OR entry.content LIKE ${likePattern(input.query)} ESCAPE '\\')
            ORDER BY entry.pinned DESC, entry.updated_at DESC
            LIMIT ${input.limit}
          `.pipe(sqlError("ProjectionMemoryRepository.searchEligibleEntries:like"));
      } else {
        const qualifiedEntryColumns = entryColumns.replaceAll("\n  ", "\n  entry.");
        rows = yield* sql<Record<string, unknown>>`
            SELECT ${sql.unsafe(qualifiedEntryColumns)},
                   -bm25(projection_memory_entries_fts, 4.0, 1.0) AS "lexicalScore"
            FROM projection_memory_entries_fts
            JOIN projection_memory_entries AS entry
              ON entry.rowid = projection_memory_entries_fts.rowid
            WHERE projection_memory_entries_fts MATCH ${expression}
              AND ${sql.and(clauses)}
            ORDER BY bm25(projection_memory_entries_fts, 4.0, 1.0),
                     entry.pinned DESC, entry.updated_at DESC
            LIMIT ${input.limit}
          `.pipe(sqlError("ProjectionMemoryRepository.searchEligibleEntries:fts"));
      }
      return yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const entry = yield* decodeRow(
            MemoryEntryDbRow,
            row,
            "ProjectionMemoryRepository.searchEligibleEntries:decode",
          );
          return {
            entry,
            lexicalScore: typeof row.lexicalScore === "number" ? row.lexicalScore : 0,
          };
        }),
      );
    });

  const insertProposalSource = Effect.fn("ProjectionMemoryRepository.insertProposalSource")(
    function* (
      proposalId: MemoryProposalId,
      source: Parameters<ProjectionMemoryRepositoryShape["createProposal"]>[0]["sources"][number],
      createdAt: string,
    ) {
      yield* sql`
      INSERT INTO projection_memory_proposal_sources (
        proposal_source_id, memory_proposal_id, source_type, source_identifier, project_id,
        repository_path, file_path, start_line, end_line, commit_hash, branch_name,
        mission_id, task_id, agent_run_id, verification_run_id, github_record_type,
        github_record_id, message_reference, content_fingerprint, created_at
      ) VALUES (
        ${makeId()}, ${proposalId}, ${source.sourceType}, ${source.sourceIdentifier},
        ${source.projectId}, ${source.repositoryPath}, ${source.filePath}, ${source.startLine},
        ${source.endLine}, ${source.commitHash}, ${source.branchName}, ${source.missionId},
        ${source.taskId}, ${source.agentRunId}, ${source.verificationRunId},
        ${source.githubRecordType}, ${source.githubRecordId}, ${source.messageReference},
        ${source.contentFingerprint}, ${createdAt}
      )
    `.pipe(sqlError("ProjectionMemoryRepository.insertProposalSource:query"));
    },
  );

  const createProposal: ProjectionMemoryRepositoryShape["createProposal"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.createProposal",
      Effect.gen(function* () {
        const entryScope = {
          ...input,
          projectId: input.scopeType === "user" ? null : input.projectId,
        };
        yield* validateScope(entryScope);
        if (input.sources.length === 0) {
          return yield* validation("Memory proposals require supporting sources", "sources");
        }
        const fingerprint = claimFingerprint(input.proposedTitle, input.proposedContent);
        const duplicateRows = yield* sql<{ readonly id: string }>`
          SELECT memory_entry_id AS id
          FROM projection_memory_entries
          WHERE project_id = ${input.projectId}
            AND claim_fingerprint = ${fingerprint}
            AND status IN ('active', 'stale', 'disputed')
          LIMIT 1
        `.pipe(sqlError("ProjectionMemoryRepository.createProposal:duplicate"));
        if (duplicateRows[0] !== undefined) {
          return yield* new MemoryConflictError({
            message: "Proposal duplicates an existing memory",
            conflictingMemoryIds: [MemoryEntryId.make(duplicateRows[0].id)],
          });
        }
        const id = MemoryProposalId.make(makeId());
        const timestamp = yield* nowIso;
        yield* sql`
          INSERT INTO projection_memory_proposals (
            memory_proposal_id, scope_type, scope_id, project_id, branch_name, mission_id,
            task_id, proposed_type, proposed_title, proposed_content,
            proposed_structured_data_json, proposed_trust_level, confidence,
            extraction_source, claim_fingerprint, status, reviewed_by, reviewed_at,
            rejection_reason, duplicate_of_memory_entry_id, accepted_memory_entry_id,
            created_at, expires_at
          ) VALUES (
            ${id}, ${input.scopeType}, ${input.scopeId}, ${input.projectId}, ${input.branchName},
            ${input.missionId}, ${input.taskId}, ${input.proposedType}, ${input.proposedTitle},
            ${input.proposedContent}, ${
              input.proposedStructuredData === null
                ? null
                : encodeUnknownJson(input.proposedStructuredData)
            }, ${input.proposedTrustLevel}, ${input.confidence}, ${input.extractionSource},
            ${fingerprint}, 'pending', NULL, NULL, NULL, NULL, NULL, ${timestamp},
            ${input.expiresAt}
          )
        `.pipe(sqlError("ProjectionMemoryRepository.createProposal:insert"));
        yield* Effect.forEach(
          input.sources,
          (source) => insertProposalSource(id, source, timestamp),
          { discard: true },
        );
        return yield* requireProposal(id);
      }),
    );

  const reviewProposal: ProjectionMemoryRepositoryShape["reviewProposal"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.reviewProposal",
      Effect.gen(function* () {
        const proposal = yield* requireProposal(input.proposalId);
        if (proposal.status !== "pending" && proposal.status !== "deferred") {
          return yield* new MemoryConflictError({
            message: "Only pending or deferred proposals can be reviewed",
            conflictingMemoryIds: [],
          });
        }
        const timestamp = yield* nowIso;
        if (input.action === "defer") {
          yield* sql`
            UPDATE projection_memory_proposals SET status = 'deferred', reviewed_by = ${input.reviewedBy},
              reviewed_at = NULL, rejection_reason = NULL
            WHERE memory_proposal_id = ${input.proposalId}
          `.pipe(sqlError("ProjectionMemoryRepository.reviewProposal:defer"));
          return yield* requireProposal(input.proposalId);
        }
        if (input.action === "reject") {
          if (input.rejectionReason === null) {
            return yield* validation("Rejecting a proposal requires a reason", "rejectionReason");
          }
          yield* sql`
            UPDATE projection_memory_proposals SET status = 'rejected', reviewed_by = ${input.reviewedBy},
              reviewed_at = ${timestamp}, rejection_reason = ${input.rejectionReason}
            WHERE memory_proposal_id = ${input.proposalId}
          `.pipe(sqlError("ProjectionMemoryRepository.reviewProposal:reject"));
          return yield* requireProposal(input.proposalId);
        }
        if (input.action === "mark_duplicate") {
          if (input.duplicateOfMemoryEntryId === null) {
            return yield* validation(
              "Marking a proposal duplicate requires the existing memory",
              "duplicateOfMemoryEntryId",
            );
          }
          yield* requireEntry(input.duplicateOfMemoryEntryId);
          yield* sql`
            UPDATE projection_memory_proposals SET status = 'duplicate', reviewed_by = ${input.reviewedBy},
              reviewed_at = ${timestamp}, duplicate_of_memory_entry_id = ${input.duplicateOfMemoryEntryId}
            WHERE memory_proposal_id = ${input.proposalId}
          `.pipe(sqlError("ProjectionMemoryRepository.reviewProposal:duplicate"));
          return yield* requireProposal(input.proposalId);
        }
        if (input.action === "merge") {
          if (input.mergeIntoMemoryEntryId === null) {
            return yield* validation("Merging requires a target memory", "mergeIntoMemoryEntryId");
          }
          const target = yield* requireEntry(input.mergeIntoMemoryEntryId);
          if (target.projectId !== proposal.projectId) {
            return yield* validation(
              "Proposal cannot merge across projects",
              "mergeIntoMemoryEntryId",
            );
          }
          for (const source of proposal.sourceReferences) {
            const decoded = yield* decodeMemorySourceDraft(source).pipe(
              Effect.mapError((error) =>
                PersistenceDecodeError.fromSchemaError(
                  "ProjectionMemoryRepository.reviewProposal:mergeSource",
                  error,
                ),
              ),
            );
            yield* insertSource(target.id, decoded, timestamp).pipe(
              Effect.catch((error) =>
                isPersistenceError(error) ? Effect.succeed(null) : Effect.fail(error),
              ),
            );
          }
          yield* sql`
            UPDATE projection_memory_proposals SET status = 'accepted', reviewed_by = ${input.reviewedBy},
              reviewed_at = ${timestamp}, accepted_memory_entry_id = ${target.id}
            WHERE memory_proposal_id = ${input.proposalId}
          `.pipe(sqlError("ProjectionMemoryRepository.reviewProposal:merge"));
          return yield* requireProposal(input.proposalId);
        }
        if (input.action === "edit_and_accept" && input.editedEntry === null) {
          return yield* validation("Edited acceptance requires edited memory", "editedEntry");
        }
        const sourceDrafts = yield* Effect.forEach(proposal.sourceReferences, (source) =>
          decodeMemorySourceDraft(source).pipe(
            Effect.mapError((error) =>
              PersistenceDecodeError.fromSchemaError(
                "ProjectionMemoryRepository.reviewProposal:source",
                error,
              ),
            ),
          ),
        );
        const entryInput =
          input.action === "edit_and_accept"
            ? { ...input.editedEntry!, sources: sourceDrafts }
            : {
                scopeType: proposal.scopeType,
                scopeId: proposal.scopeId,
                projectId: proposal.scopeType === "user" ? null : proposal.projectId,
                branchName: proposal.branchName,
                missionId: proposal.missionId,
                taskId: proposal.taskId,
                type: proposal.proposedType,
                title: proposal.proposedTitle,
                content: proposal.proposedContent,
                structuredData: proposal.proposedStructuredData,
                trustLevel: proposal.proposedTrustLevel,
                confidence: proposal.confidence,
                creationMode: "proposed" as const,
                createdByType: "user" as const,
                createdById: input.reviewedBy,
                sources: sourceDrafts,
                pinned: false,
                expiresAt: null,
              };
        const accepted = yield* insertEntry(entryInput, "active", timestamp);
        const proposalStatus =
          input.action === "edit_and_accept" ? "edited_and_accepted" : "accepted";
        yield* sql`
          UPDATE projection_memory_proposals SET status = ${proposalStatus},
            reviewed_by = ${input.reviewedBy}, reviewed_at = ${timestamp},
            accepted_memory_entry_id = ${accepted.entry.id}
          WHERE memory_proposal_id = ${input.proposalId}
        `.pipe(sqlError("ProjectionMemoryRepository.reviewProposal:accept"));
        return yield* requireProposal(input.proposalId);
      }),
    );

  const proposalFilterClauses = (
    filter: Parameters<ProjectionMemoryRepositoryShape["listProposals"]>[0],
  ) => {
    const clauses = [sql.literal("1=1")];
    clauses.push(sql`proposal.project_id = ${filter.projectId}`);
    if (filter.statuses.length > 0) clauses.push(sql.in("proposal.status", filter.statuses));
    return clauses;
  };
  const listProposals: ProjectionMemoryRepositoryShape["listProposals"] = (filter) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(proposalColumns)}
        FROM projection_memory_proposals AS proposal
        WHERE ${sql.and(proposalFilterClauses(filter))}
        ORDER BY proposal.created_at DESC, proposal.memory_proposal_id
        LIMIT ${filter.limit} OFFSET ${filter.offset}
      `.pipe(sqlError("ProjectionMemoryRepository.listProposals:query"));
      return yield* decodeRows(
        MemoryProposalDbRow,
        rows,
        "ProjectionMemoryRepository.listProposals:decode",
      );
    });
  const countProposals: ProjectionMemoryRepositoryShape["countProposals"] = (filter) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM projection_memory_proposals AS proposal
        WHERE ${sql.and(proposalFilterClauses(filter))}
      `.pipe(sqlError("ProjectionMemoryRepository.countProposals:query"));
      return rows[0]?.count ?? 0;
    });

  const getSettings: ProjectionMemoryRepositoryShape["getSettings"] = (projectId) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(settingsColumns)}
        FROM projection_memory_settings
        WHERE project_id = ${projectId}
      `.pipe(sqlError("ProjectionMemoryRepository.getSettings:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(
          MemorySettingsDbRow,
          rows[0],
          "ProjectionMemoryRepository.getSettings:decode",
        ),
      );
    });
  const validateSettings = (settings: MemorySettings) =>
    Effect.gen(function* () {
      if (settings.semanticRetrievalEnabled && settings.embeddingProviderKind === "none") {
        return yield* validation(
          "Semantic retrieval requires an explicitly configured provider",
          "embeddingProviderKind",
        );
      }
      if (
        settings.embeddingProviderKind === "remote" &&
        settings.remoteCodeUploadAcceptedAt === null
      ) {
        return yield* validation(
          "Remote embeddings require explicit source-code upload consent",
          "remoteCodeUploadAcceptedAt",
        );
      }
      if (
        settings.embeddingProviderKind !== "none" &&
        (settings.embeddingProviderId === null ||
          settings.embeddingModel === null ||
          settings.embeddingDimensions === null)
      ) {
        return yield* validation(
          "Configured embeddings require provider, model, and dimensions",
          "embeddingProviderId",
        );
      }
    });
  const saveSettings: ProjectionMemoryRepositoryShape["saveSettings"] = (settings) =>
    transaction(
      "ProjectionMemoryRepository.saveSettings",
      Effect.gen(function* () {
        yield* validateSettings(settings);
        yield* sql`
          INSERT INTO projection_memory_settings (
            project_id, enabled, automatic_proposal_generation,
            automatic_authoritative_indexing, repository_exclusions_json,
            maximum_indexed_file_size_bytes, context_token_budget, lexical_only,
            semantic_retrieval_enabled, embedding_provider_kind, embedding_provider_id,
            embedding_model, embedding_dimensions, remote_code_upload_accepted_at,
            proposal_retention_days, stale_memory_behavior, indexing_paused, created_at, updated_at
          ) VALUES (
            ${settings.projectId}, ${settings.enabled ? 1 : 0},
            ${settings.automaticProposalGeneration ? 1 : 0},
            ${settings.automaticAuthoritativeIndexing ? 1 : 0},
            ${encodeStringArrayJson(settings.repositoryExclusions)},
            ${settings.maximumIndexedFileSizeBytes}, ${settings.contextTokenBudget},
            ${settings.lexicalOnly ? 1 : 0}, ${settings.semanticRetrievalEnabled ? 1 : 0},
            ${settings.embeddingProviderKind}, ${settings.embeddingProviderId},
            ${settings.embeddingModel}, ${settings.embeddingDimensions},
            ${settings.remoteCodeUploadAcceptedAt}, ${settings.proposalRetentionDays},
            ${settings.staleMemoryBehavior}, ${settings.indexingPaused ? 1 : 0},
            ${settings.createdAt}, ${settings.updatedAt}
          )
          ON CONFLICT (project_id) DO UPDATE SET
            enabled = excluded.enabled,
            automatic_proposal_generation = excluded.automatic_proposal_generation,
            automatic_authoritative_indexing = excluded.automatic_authoritative_indexing,
            repository_exclusions_json = excluded.repository_exclusions_json,
            maximum_indexed_file_size_bytes = excluded.maximum_indexed_file_size_bytes,
            context_token_budget = excluded.context_token_budget,
            lexical_only = excluded.lexical_only,
            semantic_retrieval_enabled = excluded.semantic_retrieval_enabled,
            embedding_provider_kind = excluded.embedding_provider_kind,
            embedding_provider_id = excluded.embedding_provider_id,
            embedding_model = excluded.embedding_model,
            embedding_dimensions = excluded.embedding_dimensions,
            remote_code_upload_accepted_at = excluded.remote_code_upload_accepted_at,
            proposal_retention_days = excluded.proposal_retention_days,
            stale_memory_behavior = excluded.stale_memory_behavior,
            indexing_paused = excluded.indexing_paused,
            updated_at = excluded.updated_at
        `.pipe(sqlError("ProjectionMemoryRepository.saveSettings:upsert"));
        return settings;
      }),
    );
  const getOrCreateSettings: ProjectionMemoryRepositoryShape["getOrCreateSettings"] = (projectId) =>
    transaction(
      "ProjectionMemoryRepository.getOrCreateSettings",
      Effect.gen(function* () {
        const existing = yield* getSettings(projectId);
        if (Option.isSome(existing)) return existing.value;
        const timestamp = yield* nowIso;
        const settings: MemorySettings = {
          projectId,
          enabled: true,
          automaticProposalGeneration: true,
          automaticAuthoritativeIndexing: true,
          repositoryExclusions: [
            ".git/**",
            "node_modules/**",
            "dist/**",
            "build/**",
            ".cache/**",
            ".env*",
            "**/*.pem",
            "**/*.key",
          ],
          maximumIndexedFileSizeBytes: 1_048_576,
          contextTokenBudget: 4_000,
          lexicalOnly: true,
          semanticRetrievalEnabled: false,
          embeddingProviderKind: "none",
          embeddingProviderId: null,
          embeddingModel: null,
          embeddingDimensions: null,
          remoteCodeUploadAcceptedAt: null,
          proposalRetentionDays: 90,
          staleMemoryBehavior: "demote",
          indexingPaused: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        return yield* saveSettings(settings);
      }),
    );
  const updateSettings: ProjectionMemoryRepositoryShape["updateSettings"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.updateSettings",
      Effect.gen(function* () {
        const current = yield* getOrCreateSettings(input.projectId);
        const updatedAt = yield* nowIso;
        const next: MemorySettings = {
          ...current,
          ...input,
          updatedAt,
        };
        return yield* saveSettings(next);
      }),
    );

  const decodeIndexedSourceRows = (rows: ReadonlyArray<unknown>, operation: string) =>
    decodeRows(IndexedSource, rows, operation);
  const getIndexedSource: ProjectionMemoryRepositoryShape["getIndexedSource"] = (indexedSourceId) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
          SELECT ${sql.unsafe(indexedSourceColumns)}
          FROM projection_memory_indexed_sources
          WHERE indexed_source_id = ${indexedSourceId}
        `.pipe(sqlError("ProjectionMemoryRepository.getIndexedSource:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(
          IndexedSource,
          rows[0],
          "ProjectionMemoryRepository.getIndexedSource:decode",
        ),
      );
    });
  const requireIndexedSource = Effect.fn("ProjectionMemoryRepository.requireIndexedSource")(
    function* (indexedSourceId: IndexedSourceId) {
      const source = yield* getIndexedSource(indexedSourceId);
      if (Option.isNone(source)) return yield* notFound("index", indexedSourceId);
      return source.value;
    },
  );
  const upsertIndexedSource: ProjectionMemoryRepositoryShape["upsertIndexedSource"] = (source) =>
    sql`
      INSERT INTO projection_memory_indexed_sources (
        indexed_source_id, project_id, source_type, source_identifier, relative_path,
        branch_name, commit_hash, content_fingerprint, language, size_bytes, index_status,
        skip_reason, last_indexed_at, last_error, created_at, updated_at
      ) VALUES (
        ${source.id}, ${source.projectId}, ${source.sourceType}, ${source.sourceIdentifier},
        ${source.relativePath}, ${source.branchName}, ${source.commitHash},
        ${source.contentFingerprint}, ${source.language}, ${source.sizeBytes},
        ${source.indexStatus}, ${source.skipReason}, ${source.lastIndexedAt}, ${source.lastError},
        ${source.createdAt}, ${source.updatedAt}
      )
      ON CONFLICT (indexed_source_id) DO UPDATE SET
        project_id = excluded.project_id,
        source_type = excluded.source_type,
        source_identifier = excluded.source_identifier,
        relative_path = excluded.relative_path,
        branch_name = excluded.branch_name,
        commit_hash = excluded.commit_hash,
        content_fingerprint = excluded.content_fingerprint,
        language = excluded.language,
        size_bytes = excluded.size_bytes,
        index_status = excluded.index_status,
        skip_reason = excluded.skip_reason,
        last_indexed_at = excluded.last_indexed_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `.pipe(sqlError("ProjectionMemoryRepository.upsertIndexedSource:query"), Effect.as(source));
  const findIndexedSource: ProjectionMemoryRepositoryShape["findIndexedSource"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(indexedSourceColumns)}
        FROM projection_memory_indexed_sources
        WHERE project_id = ${input.projectId}
          AND source_type = ${input.sourceType}
          AND source_identifier = ${input.sourceIdentifier}
          AND branch_name IS ${input.branchName}
          AND commit_hash IS ${input.commitHash}
        LIMIT 1
      `.pipe(sqlError("ProjectionMemoryRepository.findIndexedSource:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(
          IndexedSource,
          rows[0],
          "ProjectionMemoryRepository.findIndexedSource:decode",
        ),
      );
    });
  const indexedSourceFilterClauses = (
    input: Parameters<ProjectionMemoryRepositoryShape["listIndexedSources"]>[0],
  ) => {
    const clauses = [sql.literal("1=1")];
    clauses.push(sql`project_id = ${input.projectId}`);
    if (input.branchName !== null) clauses.push(sql`branch_name = ${input.branchName}`);
    if (input.statuses.length > 0) clauses.push(sql.in("index_status", input.statuses));
    return clauses;
  };
  const listIndexedSources: ProjectionMemoryRepositoryShape["listIndexedSources"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(indexedSourceColumns)}
        FROM projection_memory_indexed_sources
        WHERE ${sql.and(indexedSourceFilterClauses(input))}
        ORDER BY relative_path, source_identifier, indexed_source_id
        LIMIT ${input.limit} OFFSET ${input.offset}
      `.pipe(sqlError("ProjectionMemoryRepository.listIndexedSources:query"));
      return yield* decodeIndexedSourceRows(
        rows,
        "ProjectionMemoryRepository.listIndexedSources:decode",
      );
    });
  const countIndexedSources: ProjectionMemoryRepositoryShape["countIndexedSources"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM projection_memory_indexed_sources
        WHERE ${sql.and(indexedSourceFilterClauses(input))}
      `.pipe(sqlError("ProjectionMemoryRepository.countIndexedSources:query"));
      return rows[0]?.count ?? 0;
    });
  const updateIndexedSourceStatus: ProjectionMemoryRepositoryShape["updateIndexedSourceStatus"] = (
    input,
  ) =>
    transaction(
      "ProjectionMemoryRepository.updateIndexedSourceStatus",
      Effect.gen(function* () {
        yield* requireIndexedSource(input.indexedSourceId);
        yield* sql`
            UPDATE projection_memory_indexed_sources SET
              index_status = ${input.status}, skip_reason = ${input.skipReason},
              last_error = ${input.lastError}, last_indexed_at = ${input.lastIndexedAt},
              updated_at = ${input.updatedAt}
            WHERE indexed_source_id = ${input.indexedSourceId}
          `.pipe(sqlError("ProjectionMemoryRepository.updateIndexedSourceStatus:update"));
        return yield* requireIndexedSource(input.indexedSourceId);
      }),
    );
  const replaceIndexedChunks: ProjectionMemoryRepositoryShape["replaceIndexedChunks"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.replaceIndexedChunks",
      Effect.gen(function* () {
        yield* requireIndexedSource(input.indexedSourceId);
        if (input.chunks.some((chunk) => chunk.indexedSourceId !== input.indexedSourceId)) {
          return yield* validation(
            "Every replacement chunk must belong to the requested source",
            "chunks",
          );
        }
        const indexes = new Set(input.chunks.map((chunk) => chunk.chunkIndex));
        if (indexes.size !== input.chunks.length) {
          return yield* validation("Chunk indexes must be unique within a source", "chunks");
        }
        yield* sql`
          DELETE FROM projection_memory_indexed_chunks
          WHERE indexed_source_id = ${input.indexedSourceId}
        `.pipe(sqlError("ProjectionMemoryRepository.replaceIndexedChunks:delete"));
        yield* Effect.forEach(
          input.chunks,
          (chunk) =>
            sql`
              INSERT INTO projection_memory_indexed_chunks (
                indexed_chunk_id, indexed_source_id, chunk_index, start_line, end_line,
                content, content_fingerprint, token_estimate, symbol_metadata_json,
                embedding_status, embedding_provider, embedding_model, embedding_dimensions,
                created_at, updated_at
              ) VALUES (
                ${chunk.id}, ${chunk.indexedSourceId}, ${chunk.chunkIndex}, ${chunk.startLine},
                ${chunk.endLine}, ${chunk.content}, ${chunk.contentFingerprint},
                ${chunk.tokenEstimate}, ${
                  chunk.symbolMetadata === null ? null : encodeUnknownJson(chunk.symbolMetadata)
                }, ${chunk.embeddingStatus}, ${chunk.embeddingProvider}, ${chunk.embeddingModel},
                ${chunk.embeddingDimensions}, ${chunk.createdAt}, ${chunk.updatedAt}
              )
            `.pipe(sqlError("ProjectionMemoryRepository.replaceIndexedChunks:insert")),
          { discard: true },
        );
        yield* sql`
          UPDATE projection_memory_indexed_sources
          SET index_status = 'indexed', last_indexed_at = ${input.lastIndexedAt},
              last_error = NULL, skip_reason = NULL, updated_at = ${input.lastIndexedAt}
          WHERE indexed_source_id = ${input.indexedSourceId}
        `.pipe(sqlError("ProjectionMemoryRepository.replaceIndexedChunks:source"));
        return input.chunks;
      }),
    );

  const chunkRowsWithSources = Effect.fn("ProjectionMemoryRepository.chunkRowsWithSources")(
    function* (rows: ReadonlyArray<Record<string, unknown>>) {
      const chunks = yield* decodeRows(
        IndexedChunkDbRow,
        rows,
        "ProjectionMemoryRepository.chunkRowsWithSources:decode",
      );
      const sourceCache = new Map<string, IndexedSource>();
      return yield* Effect.forEach(chunks, (chunk, index) =>
        Effect.gen(function* () {
          let source = sourceCache.get(chunk.indexedSourceId);
          if (source === undefined) {
            source = yield* requireIndexedSource(chunk.indexedSourceId);
            sourceCache.set(chunk.indexedSourceId, source);
          }
          const lexicalScore = rows[index]?.lexicalScore;
          return {
            chunk,
            source,
            lexicalScore: typeof lexicalScore === "number" ? lexicalScore : 0,
          };
        }),
      );
    },
  );
  const qualifiedChunkColumns = indexedChunkColumns.replaceAll("\n  ", "\n  chunk.");
  const listIndexedChunks: ProjectionMemoryRepositoryShape["listIndexedChunks"] = (input) =>
    Effect.gen(function* () {
      const clauses = [sql`source.project_id = ${input.projectId}`];
      if (input.indexedSourceId !== null) {
        clauses.push(sql`chunk.indexed_source_id = ${input.indexedSourceId}`);
      }
      if (input.branchName !== null) clauses.push(sql`source.branch_name = ${input.branchName}`);
      if (input.pathPrefix !== null) {
        clauses.push(sql`source.relative_path LIKE ${`${input.pathPrefix}%`}`);
      }
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(qualifiedChunkColumns)}, 0.0 AS "lexicalScore"
        FROM projection_memory_indexed_chunks AS chunk
        JOIN projection_memory_indexed_sources AS source
          ON source.indexed_source_id = chunk.indexed_source_id
        WHERE ${sql.and(clauses)}
        ORDER BY source.relative_path, chunk.chunk_index, chunk.indexed_chunk_id
        LIMIT ${input.limit} OFFSET ${input.offset}
      `.pipe(sqlError("ProjectionMemoryRepository.listIndexedChunks:query"));
      return yield* chunkRowsWithSources(rows);
    });
  const searchIndexedChunks: ProjectionMemoryRepositoryShape["searchIndexedChunks"] = (input) =>
    Effect.gen(function* () {
      const clauses = [
        sql`source.project_id = ${input.projectId}`,
        sql`source.index_status = 'indexed'`,
      ];
      clauses.push(
        input.branchName === null
          ? sql`source.branch_name IS NULL`
          : sql`(source.branch_name IS NULL OR source.branch_name = ${input.branchName})`,
      );
      if (input.pathPrefix !== null) {
        clauses.push(sql`source.relative_path LIKE ${`${input.pathPrefix}%`}`);
      }
      const expression = ftsExpression(input.query);
      let rows: ReadonlyArray<Record<string, unknown>>;
      if (expression === null) {
        rows = yield* sql<Record<string, unknown>>`
          SELECT ${sql.unsafe(qualifiedChunkColumns)}, 0.0 AS "lexicalScore"
          FROM projection_memory_indexed_chunks AS chunk
          JOIN projection_memory_indexed_sources AS source
            ON source.indexed_source_id = chunk.indexed_source_id
          WHERE ${sql.and(clauses)}
            AND chunk.content LIKE ${likePattern(input.query)} ESCAPE '\\'
          ORDER BY source.relative_path, chunk.chunk_index
          LIMIT ${input.limit}
        `.pipe(sqlError("ProjectionMemoryRepository.searchIndexedChunks:like"));
      } else {
        rows = yield* sql<Record<string, unknown>>`
          SELECT ${sql.unsafe(qualifiedChunkColumns)},
                 -bm25(projection_memory_indexed_chunks_fts, 1.0, 2.0) AS "lexicalScore"
          FROM projection_memory_indexed_chunks_fts
          JOIN projection_memory_indexed_chunks AS chunk
            ON chunk.rowid = projection_memory_indexed_chunks_fts.rowid
          JOIN projection_memory_indexed_sources AS source
            ON source.indexed_source_id = chunk.indexed_source_id
          WHERE projection_memory_indexed_chunks_fts MATCH ${expression}
            AND ${sql.and(clauses)}
          ORDER BY bm25(projection_memory_indexed_chunks_fts, 1.0, 2.0),
                   source.relative_path, chunk.chunk_index
          LIMIT ${input.limit}
        `.pipe(sqlError("ProjectionMemoryRepository.searchIndexedChunks:fts"));
      }
      return yield* chunkRowsWithSources(rows);
    });
  const countIndexedChunks: ProjectionMemoryRepositoryShape["countIndexedChunks"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM projection_memory_indexed_chunks AS chunk
        JOIN projection_memory_indexed_sources AS source
          ON source.indexed_source_id = chunk.indexed_source_id
        WHERE source.project_id = ${input.projectId}
          AND source.index_status <> 'removed'
          AND ${
            input.branchName === null
              ? sql.literal("1=1")
              : sql`source.branch_name = ${input.branchName}`
          }
      `.pipe(sqlError("ProjectionMemoryRepository.countIndexedChunks:query"));
      return rows[0]?.count ?? 0;
    });
  const getIndexStats: ProjectionMemoryRepositoryShape["getIndexStats"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly indexedFiles: number;
        readonly skippedFiles: number;
        readonly failedFiles: number;
        readonly indexedChunks: number;
        readonly indexSizeBytes: number;
        readonly lastIndexedAt: string | null;
        readonly failedEmbeddings: number;
        readonly runningEmbeddings: number;
        readonly queuedEmbeddings: number;
        readonly embeddedChunks: number;
      }>`
        SELECT
          coalesce(sum(CASE WHEN source.index_status = 'indexed' THEN 1 ELSE 0 END), 0)
            AS "indexedFiles",
          coalesce(sum(CASE WHEN source.index_status = 'skipped' THEN 1 ELSE 0 END), 0)
            AS "skippedFiles",
          coalesce(sum(CASE WHEN source.index_status = 'failed' THEN 1 ELSE 0 END), 0)
            AS "failedFiles",
          count(chunk.indexed_chunk_id) AS "indexedChunks",
          coalesce(sum(CASE WHEN chunk.indexed_chunk_id IS NULL THEN 0 ELSE length(chunk.content) END), 0)
            AS "indexSizeBytes",
          max(source.last_indexed_at) AS "lastIndexedAt",
          coalesce(sum(CASE WHEN chunk.embedding_status = 'failed' THEN 1 ELSE 0 END), 0)
            AS "failedEmbeddings",
          coalesce(sum(CASE WHEN chunk.embedding_status = 'embedding' THEN 1 ELSE 0 END), 0)
            AS "runningEmbeddings",
          coalesce(sum(CASE WHEN chunk.embedding_status IN ('queued', 'stale') THEN 1 ELSE 0 END), 0)
            AS "queuedEmbeddings",
          coalesce(sum(CASE WHEN chunk.embedding_status = 'embedded' THEN 1 ELSE 0 END), 0)
            AS "embeddedChunks"
        FROM projection_memory_indexed_sources AS source
        LEFT JOIN projection_memory_indexed_chunks AS chunk
          ON chunk.indexed_source_id = source.indexed_source_id
        WHERE source.project_id = ${input.projectId}
          AND source.index_status <> 'removed'
          AND ${
            input.branchName === null
              ? sql.literal("1=1")
              : sql`source.branch_name = ${input.branchName}`
          }
      `.pipe(sqlError("ProjectionMemoryRepository.getIndexStats:query"));
      const row = rows[0];
      const indexedChunks = row?.indexedChunks ?? 0;
      return {
        indexedFiles: row?.indexedFiles ?? 0,
        skippedFiles: row?.skippedFiles ?? 0,
        failedFiles: row?.failedFiles ?? 0,
        indexedChunks,
        indexSizeBytes: row?.indexSizeBytes ?? 0,
        lastIndexedAt: row?.lastIndexedAt ?? null,
        embeddingStatus:
          (row?.failedEmbeddings ?? 0) > 0
            ? "failed"
            : (row?.runningEmbeddings ?? 0) > 0
              ? "embedding"
              : (row?.queuedEmbeddings ?? 0) > 0
                ? "queued"
                : indexedChunks > 0 && (row?.embeddedChunks ?? 0) === indexedChunks
                  ? "embedded"
                  : "disabled",
      };
    });
  const clearDerivedIndex: ProjectionMemoryRepositoryShape["clearDerivedIndex"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.clearDerivedIndex",
      Effect.gen(function* () {
        const branchClause =
          input.branchName === null ? sql.literal("1=1") : sql`branch_name = ${input.branchName}`;
        const countRows = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count
          FROM projection_memory_indexed_sources
          WHERE project_id = ${input.projectId} AND ${branchClause}
        `.pipe(sqlError("ProjectionMemoryRepository.clearDerivedIndex:count"));
        yield* sql`
          DELETE FROM projection_memory_indexed_sources
          WHERE project_id = ${input.projectId} AND ${branchClause}
        `.pipe(sqlError("ProjectionMemoryRepository.clearDerivedIndex:delete"));
        return countRows[0]?.count ?? 0;
      }),
    );
  const saveChunkEmbedding: ProjectionMemoryRepositoryShape["saveChunkEmbedding"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.saveChunkEmbedding",
      Effect.gen(function* () {
        if (decodeMemoryEmbeddingVector(input.vector, input.dimensions) === null) {
          return yield* validation(
            "Embedding vector must contain finite little-endian float32 components matching its dimensions",
            "vector",
          );
        }
        yield* sql`
          INSERT INTO projection_memory_chunk_embeddings (
            indexed_chunk_id, provider_id, model, dimensions, vector_blob,
            content_fingerprint, created_at, updated_at
          ) VALUES (
            ${input.indexedChunkId}, ${input.providerId}, ${input.model}, ${input.dimensions},
            ${input.vector}, ${input.contentFingerprint}, ${input.createdAt}, ${input.updatedAt}
          )
          ON CONFLICT (indexed_chunk_id, provider_id, model) DO UPDATE SET
            dimensions = excluded.dimensions,
            vector_blob = excluded.vector_blob,
            content_fingerprint = excluded.content_fingerprint,
            updated_at = excluded.updated_at
        `.pipe(sqlError("ProjectionMemoryRepository.saveChunkEmbedding:upsert"));
        yield* sql`
          UPDATE projection_memory_indexed_chunks SET
            embedding_status = 'embedded', embedding_provider = ${input.providerId},
            embedding_model = ${input.model}, embedding_dimensions = ${input.dimensions},
            updated_at = ${input.updatedAt}
          WHERE indexed_chunk_id = ${input.indexedChunkId}
        `.pipe(sqlError("ProjectionMemoryRepository.saveChunkEmbedding:updateChunk"));
      }),
    );

  const updateChunkEmbeddingStatus: ProjectionMemoryRepositoryShape["updateChunkEmbeddingStatus"] =
    (input) =>
      sql`
        UPDATE projection_memory_indexed_chunks SET
          embedding_status = ${input.status},
          embedding_provider = ${input.providerId},
          embedding_model = ${input.model},
          embedding_dimensions = ${input.dimensions},
          updated_at = ${input.updatedAt}
        WHERE indexed_chunk_id = ${input.indexedChunkId}
      `.pipe(
        sqlError("ProjectionMemoryRepository.updateChunkEmbeddingStatus:update"),
        Effect.asVoid,
      );

  const cosineSimilarity = (
    left: ReadonlyArray<number>,
    right: ReadonlyArray<number>,
  ): number | null => {
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = left[index] ?? 0;
      const rightValue = right[index] ?? 0;
      dot += leftValue * rightValue;
      leftMagnitude += leftValue * leftValue;
      rightMagnitude += rightValue * rightValue;
    }
    if (leftMagnitude === 0 || rightMagnitude === 0) return null;
    return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
  };

  const searchChunkEmbeddings: ProjectionMemoryRepositoryShape["searchChunkEmbeddings"] = (input) =>
    Effect.gen(function* () {
      if (
        input.dimensions <= 0 ||
        input.queryVector.length !== input.dimensions ||
        input.queryVector.some((component) => !Number.isFinite(component))
      ) {
        return yield* validation(
          "Semantic query vector must contain finite components matching its dimensions",
          "queryVector",
        );
      }
      const branchClause =
        input.branchName === null
          ? sql`source.branch_name IS NULL`
          : sql`(source.branch_name IS NULL OR source.branch_name = ${input.branchName})`;
      const pathClause =
        input.pathPrefix === null
          ? sql.literal("1=1")
          : sql`source.relative_path LIKE ${`${input.pathPrefix}%`}`;
      const rows = yield* sql<Record<string, unknown> & { readonly vectorBlob: Uint8Array }>`
        SELECT ${sql.unsafe(qualifiedChunkColumns)}, embedding.vector_blob AS "vectorBlob"
        FROM projection_memory_chunk_embeddings AS embedding
        JOIN projection_memory_indexed_chunks AS chunk
          ON chunk.indexed_chunk_id = embedding.indexed_chunk_id
        JOIN projection_memory_indexed_sources AS source
          ON source.indexed_source_id = chunk.indexed_source_id
        WHERE source.project_id = ${input.projectId}
          AND source.index_status = 'indexed'
          AND chunk.embedding_status = 'embedded'
          AND embedding.provider_id = ${input.providerId}
          AND embedding.model = ${input.model}
          AND embedding.dimensions = ${input.dimensions}
          AND chunk.embedding_provider = embedding.provider_id
          AND chunk.embedding_model = embedding.model
          AND chunk.embedding_dimensions = embedding.dimensions
          AND chunk.content_fingerprint = embedding.content_fingerprint
          AND ${branchClause}
          AND ${pathClause}
      `.pipe(sqlError("ProjectionMemoryRepository.searchChunkEmbeddings:query"));
      const candidates = yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const [hit] = yield* chunkRowsWithSources([row]);
          if (hit === undefined) return null;
          const vector = decodeMemoryEmbeddingVector(
            Uint8Array.from(row.vectorBlob),
            input.dimensions,
          );
          if (vector === null) return null;
          const similarity = cosineSimilarity(input.queryVector, vector);
          return similarity === null ? null : { chunk: hit.chunk, source: hit.source, similarity };
        }),
      );
      return candidates
        .filter((candidate) => candidate !== null)
        .sort(
          (left, right) =>
            right.similarity - left.similarity || left.chunk.id.localeCompare(right.chunk.id),
        )
        .slice(0, input.limit);
    });

  const saveIndexOperation: ProjectionMemoryRepositoryShape["saveIndexOperation"] = (operation) =>
    sql`
      INSERT INTO projection_memory_index_operations (
        memory_index_operation_id, project_id, operation_type, status, branch_name,
        commit_hash, processed_sources, changed_sources, skipped_sources, failed_sources,
        error_summary, requested_at, started_at, completed_at
      ) VALUES (
        ${operation.id}, ${operation.projectId}, ${operation.operationType}, ${operation.status},
        ${operation.branchName}, ${operation.commitHash}, ${operation.processedSources},
        ${operation.changedSources}, ${operation.skippedSources}, ${operation.failedSources},
        ${operation.errorSummary}, ${operation.requestedAt}, ${operation.startedAt},
        ${operation.completedAt}
      )
      ON CONFLICT (memory_index_operation_id) DO UPDATE SET
        status = excluded.status,
        branch_name = excluded.branch_name,
        commit_hash = excluded.commit_hash,
        processed_sources = excluded.processed_sources,
        changed_sources = excluded.changed_sources,
        skipped_sources = excluded.skipped_sources,
        failed_sources = excluded.failed_sources,
        error_summary = excluded.error_summary,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `.pipe(sqlError("ProjectionMemoryRepository.saveIndexOperation:query"), Effect.as(operation));
  const decodeOperationRows = (rows: ReadonlyArray<unknown>, operation: string) =>
    decodeRows(MemoryIndexOperation, rows, operation);
  const getIndexOperation: ProjectionMemoryRepositoryShape["getIndexOperation"] = (operationId) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(operationColumns)}
        FROM projection_memory_index_operations
        WHERE memory_index_operation_id = ${operationId}
      `.pipe(sqlError("ProjectionMemoryRepository.getIndexOperation:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(
          MemoryIndexOperation,
          rows[0],
          "ProjectionMemoryRepository.getIndexOperation:decode",
        ),
      );
    });
  const getCurrentIndexOperation: ProjectionMemoryRepositoryShape["getCurrentIndexOperation"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
          SELECT ${sql.unsafe(operationColumns)}
          FROM projection_memory_index_operations
          WHERE project_id = ${input.projectId} AND status IN ('queued', 'running')
          ORDER BY requested_at DESC LIMIT 1
        `.pipe(sqlError("ProjectionMemoryRepository.getCurrentIndexOperation:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(
          MemoryIndexOperation,
          rows[0],
          "ProjectionMemoryRepository.getCurrentIndexOperation:decode",
        ),
      );
    });
  const listIndexOperations: ProjectionMemoryRepositoryShape["listIndexOperations"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(operationColumns)}
        FROM projection_memory_index_operations
        WHERE project_id = ${input.projectId}
        ORDER BY requested_at DESC, memory_index_operation_id
        LIMIT ${input.limit} OFFSET ${input.offset}
      `.pipe(sqlError("ProjectionMemoryRepository.listIndexOperations:query"));
      return yield* decodeOperationRows(
        rows,
        "ProjectionMemoryRepository.listIndexOperations:decode",
      );
    });
  const recoverInterruptedIndexOperations: ProjectionMemoryRepositoryShape["recoverInterruptedIndexOperations"] =
    (input) =>
      transaction(
        "ProjectionMemoryRepository.recoverInterruptedIndexOperations",
        Effect.gen(function* () {
          yield* sql`
            UPDATE projection_memory_index_operations
            SET status = 'interrupted', completed_at = ${input.recoveredAt},
                error_summary = coalesce(error_summary, 'Interrupted by application restart')
            WHERE project_id = ${input.projectId} AND status IN ('queued', 'running')
          `.pipe(
            sqlError("ProjectionMemoryRepository.recoverInterruptedIndexOperations:operations"),
          );
          yield* sql`
            UPDATE projection_memory_indexed_sources
            SET index_status = 'queued', updated_at = ${input.recoveredAt},
                last_error = 'Indexing interrupted by application restart'
            WHERE project_id = ${input.projectId} AND index_status = 'indexing'
          `.pipe(sqlError("ProjectionMemoryRepository.recoverInterruptedIndexOperations:sources"));
          const rows = yield* sql<Record<string, unknown>>`
            SELECT ${sql.unsafe(operationColumns)}
            FROM projection_memory_index_operations
            WHERE project_id = ${input.projectId} AND status = 'interrupted'
              AND completed_at = ${input.recoveredAt}
            ORDER BY requested_at, memory_index_operation_id
          `.pipe(sqlError("ProjectionMemoryRepository.recoverInterruptedIndexOperations:list"));
          return yield* decodeOperationRows(
            rows,
            "ProjectionMemoryRepository.recoverInterruptedIndexOperations:decode",
          );
        }),
      );

  const saveRetrievalRecord: ProjectionMemoryRepositoryShape["saveRetrievalRecord"] = (record) =>
    sql`
      INSERT INTO projection_memory_retrieval_records (
        memory_retrieval_record_id, agent_run_id, thread_id, message_id, project_id,
        mission_id, task_id, branch_name, query, retrieval_mode, selected_memory_ids_json,
        selected_chunk_ids_json, excluded_candidate_count, token_estimate,
        ranking_metadata_json, status, error_summary, created_at
      ) VALUES (
        ${record.id}, ${record.agentRunId}, ${record.threadId}, ${record.messageId},
        ${record.projectId}, ${record.missionId}, ${record.taskId}, ${record.branchName},
        ${record.query}, ${record.retrievalMode}, ${JSON.stringify(record.selectedMemoryIds)},
        ${JSON.stringify(record.selectedChunkIds)}, ${record.excludedCandidateCount},
        ${record.tokenEstimate}, ${encodeUnknownJson(record.rankingMetadata)}, ${record.status},
        ${record.errorSummary}, ${record.createdAt}
      )
      ON CONFLICT (memory_retrieval_record_id) DO NOTHING
    `.pipe(sqlError("ProjectionMemoryRepository.saveRetrievalRecord:query"), Effect.as(record));
  const getRetrievalRecord: ProjectionMemoryRepositoryShape["getRetrievalRecord"] = (recordId) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(retrievalColumns)}
        FROM projection_memory_retrieval_records
        WHERE memory_retrieval_record_id = ${recordId}
      `.pipe(sqlError("ProjectionMemoryRepository.getRetrievalRecord:query"));
      if (rows[0] === undefined) return Option.none();
      return Option.some(
        yield* decodeRow(
          MemoryRetrievalRecordDbRow,
          rows[0],
          "ProjectionMemoryRepository.getRetrievalRecord:decode",
        ),
      );
    });
  const retrievalFilterClauses = (
    input: Parameters<ProjectionMemoryRepositoryShape["listRetrievalRecords"]>[0],
  ) => {
    const clauses = [sql`project_id = ${input.projectId}`];
    if (input.agentRunId !== null) clauses.push(sql`agent_run_id = ${input.agentRunId}`);
    if (input.threadId !== null) clauses.push(sql`thread_id = ${input.threadId}`);
    return clauses;
  };
  const listRetrievalRecords: ProjectionMemoryRepositoryShape["listRetrievalRecords"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT ${sql.unsafe(retrievalColumns)}
        FROM projection_memory_retrieval_records
        WHERE ${sql.and(retrievalFilterClauses(input))}
        ORDER BY created_at DESC, memory_retrieval_record_id
        LIMIT ${input.limit} OFFSET ${input.offset}
      `.pipe(sqlError("ProjectionMemoryRepository.listRetrievalRecords:query"));
      return yield* decodeRows(
        MemoryRetrievalRecordDbRow,
        rows,
        "ProjectionMemoryRepository.listRetrievalRecords:decode",
      );
    });
  const countRetrievalRecords: ProjectionMemoryRepositoryShape["countRetrievalRecords"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM projection_memory_retrieval_records
        WHERE ${sql.and(retrievalFilterClauses(input))}
      `.pipe(sqlError("ProjectionMemoryRepository.countRetrievalRecords:query"));
      return rows[0]?.count ?? 0;
    });

  const exportMemory: ProjectionMemoryRepositoryShape["exportMemory"] = (projectId) =>
    Effect.gen(function* () {
      const idRows = yield* sql<{ readonly id: string }>`
        SELECT memory_entry_id AS id
        FROM projection_memory_entries
        WHERE ${projectId === null ? sql`scope_type = 'user'` : sql`project_id = ${projectId}`}
        ORDER BY created_at, memory_entry_id
      `.pipe(sqlError("ProjectionMemoryRepository.exportMemory:entries"));
      const entries = yield* Effect.forEach(idRows, (row) =>
        requireDetail(MemoryEntryId.make(row.id)),
      );
      const proposals =
        projectId === null
          ? []
          : yield* listProposals({
              projectId,
              statuses: [],
              limit: 100_000,
              offset: 0,
            });
      const settings =
        projectId === null ? Option.none<MemorySettings>() : yield* getSettings(projectId);
      const bundle: MemoryExportBundle = {
        version: 1,
        exportedAt: yield* nowIso,
        projectId,
        entries,
        proposals,
        settings: Option.getOrNull(settings),
      };
      return bundle;
    });
  const importMemory: ProjectionMemoryRepositoryShape["importMemory"] = (input) =>
    transaction(
      "ProjectionMemoryRepository.importMemory",
      Effect.gen(function* () {
        const importedEntryIds: Array<MemoryEntryId> = [];
        const createdProposalIds: Array<MemoryProposalId> = [];
        let skippedCount = 0;
        for (const detail of input.bundle.entries) {
          const projectId =
            detail.entry.scopeType === "user"
              ? null
              : (input.targetProjectId ?? detail.entry.projectId);
          const sources = detail.sources.map(
            ({
              id: _id,
              memoryEntryId: _memoryEntryId,
              sourceStatus: _sourceStatus,
              createdAt: _createdAt,
              ...source
            }) => ({
              ...source,
              projectId:
                source.projectId === null ? null : (input.targetProjectId ?? source.projectId),
            }),
          );
          const createInput = {
            scopeType: detail.entry.scopeType,
            scopeId:
              detail.entry.scopeType === "project" && projectId !== null
                ? projectId
                : detail.entry.scopeId,
            projectId,
            branchName: detail.entry.branchName,
            missionId: input.targetProjectId === null ? detail.entry.missionId : null,
            taskId: input.targetProjectId === null ? detail.entry.taskId : null,
            type: detail.entry.type,
            title: detail.entry.title,
            content: detail.entry.content,
            structuredData: detail.entry.structuredData,
            trustLevel: detail.entry.trustLevel,
            confidence: detail.entry.confidence,
            creationMode: "proposed" as const,
            createdByType: "import" as const,
            createdById: input.importedBy,
            sources,
            pinned: detail.entry.pinned,
            expiresAt: detail.entry.expiresAt,
          };
          const key = duplicateKey(createInput);
          const duplicateRows = yield* sql<{ readonly id: string }>`
          SELECT memory_entry_id AS id FROM projection_memory_entries
          WHERE duplicate_key = ${key}
            AND status IN ('proposed', 'active', 'stale', 'disputed')
          LIMIT 1
        `.pipe(sqlError("ProjectionMemoryRepository.importMemory:duplicate"));
          if (duplicateRows[0] !== undefined) {
            skippedCount += 1;
            continue;
          }
          if (input.conflictPolicy === "propose") {
            const proposalProjectId = input.targetProjectId ?? detail.entry.projectId;
            if (proposalProjectId === null) {
              skippedCount += 1;
              continue;
            }
            const proposal = yield* createProposal({
              scopeType: detail.entry.scopeType,
              scopeId: createInput.scopeId,
              projectId: proposalProjectId,
              branchName: createInput.branchName,
              missionId: createInput.missionId,
              taskId: createInput.taskId,
              proposedType: createInput.type,
              proposedTitle: createInput.title,
              proposedContent: createInput.content,
              proposedStructuredData: createInput.structuredData,
              proposedTrustLevel: "unverified",
              confidence: createInput.confidence,
              extractionSource: "memory_import",
              sources: createInput.sources,
              expiresAt: createInput.expiresAt,
            });
            createdProposalIds.push(proposal.id);
            continue;
          }
          const created = yield* createEntry(createInput);
          if (input.conflictPolicy === "import_inactive") {
            yield* applyEntryAction({
              memoryEntryId: created.entry.id,
              action: "archive",
              reason: "Imported as inactive historical memory",
              actorType: "import",
              actorId: input.importedBy,
            });
          }
          importedEntryIds.push(created.entry.id);
        }
        if (input.bundle.settings !== null && input.targetProjectId !== null) {
          const timestamp = yield* nowIso;
          yield* saveSettings({
            ...input.bundle.settings,
            projectId: input.targetProjectId,
            lexicalOnly: true,
            semanticRetrievalEnabled: false,
            embeddingProviderKind: "none",
            embeddingProviderId: null,
            embeddingModel: null,
            embeddingDimensions: null,
            remoteCodeUploadAcceptedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        return { importedEntryIds, createdProposalIds, skippedCount };
      }),
    );

  return ProjectionMemoryRepository.of({
    createEntry,
    updateEntry,
    applyEntryAction,
    supersedeEntry,
    addSource,
    createRelation,
    getEntryDetail,
    getSource,
    listEntrySources,
    updateMemorySourceStatus,
    listRelations,
    listEntries,
    countEntries,
    searchEligibleEntries,
    createProposal,
    reviewProposal,
    getProposal: getProposalRecord,
    listProposals,
    countProposals,
    getSettings,
    getOrCreateSettings,
    saveSettings,
    updateSettings,
    upsertIndexedSource,
    getIndexedSource,
    findIndexedSource,
    listIndexedSources,
    countIndexedSources,
    updateIndexedSourceStatus,
    replaceIndexedChunks,
    listIndexedChunks,
    searchIndexedChunks,
    countIndexedChunks,
    getIndexStats,
    clearDerivedIndex,
    saveChunkEmbedding,
    updateChunkEmbeddingStatus,
    searchChunkEmbeddings,
    saveIndexOperation,
    getIndexOperation,
    getCurrentIndexOperation,
    listIndexOperations,
    recoverInterruptedIndexOperations,
    saveRetrievalRecord,
    getRetrievalRecord,
    listRetrievalRecords,
    countRetrievalRecords,
    exportMemory,
    importMemory,
  });
});

export const ProjectionMemoryRepositoryLive = Layer.effect(
  ProjectionMemoryRepository,
  makeProjectionMemoryRepository,
);
