import {
  VerificationEnvironmentSnapshot,
  VerificationExecutionPlan,
  VerificationFailureSnapshot,
  canTransitionVerificationCheckRun,
  canTransitionVerificationRepairAttempt,
  canTransitionVerificationRun,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError, VerificationProjectionValidationError } from "../Errors.ts";
import {
  GetVerificationCheckRunInput,
  GetVerificationRepairAttemptInput,
  GetVerificationRunInput,
  ListVerificationArtifactsInput,
  ListVerificationCheckRunsInput,
  ListVerificationDiagnosticsInput,
  ListVerificationRunsByProfileInput,
  ListVerificationRunsByProjectInput,
  ListVerificationRunsByTaskInput,
  ProjectionVerificationArtifact,
  ProjectionVerificationCheckRun,
  ProjectionVerificationDiagnostic,
  ProjectionVerificationOverride,
  ProjectionVerificationRepairAttempt,
  ProjectionVerificationRun,
  ProjectionVerificationRunRepository,
  type ProjectionVerificationRunRepositoryShape,
} from "../Services/ProjectionVerificationRuns.ts";

const RunDbRow = ProjectionVerificationRun.mapFields(
  Struct.assign({
    changedFilesSnapshot: Schema.fromJsonString(Schema.Array(Schema.String)),
    environmentSnapshot: Schema.fromJsonString(VerificationEnvironmentSnapshot),
    executionPlan: Schema.fromJsonString(VerificationExecutionPlan),
  }),
);
const CheckRunDbRow = ProjectionVerificationCheckRun.mapFields(
  Struct.assign({
    argumentsSnapshot: Schema.fromJsonString(Schema.Array(Schema.String)),
    timedOut: Schema.Number,
  }),
);
const ArtifactDbRow = ProjectionVerificationArtifact.mapFields(
  Struct.assign({
    metadata: Schema.fromJsonString(ProjectionVerificationArtifact.fields.metadata),
  }),
);
const RepairAttemptDbRow = ProjectionVerificationRepairAttempt.mapFields(
  Struct.assign({ failureSnapshot: Schema.fromJsonString(VerificationFailureSnapshot) }),
);
const encodeChangedFiles = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeEnvironmentSnapshot = Schema.encodeSync(
  Schema.fromJsonString(VerificationEnvironmentSnapshot),
);
const encodeExecutionPlan = Schema.encodeSync(Schema.fromJsonString(VerificationExecutionPlan));
const encodeArguments = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeFailureSnapshot = Schema.encodeSync(Schema.fromJsonString(VerificationFailureSnapshot));
const encodeArtifactMetadata = Schema.encodeSync(
  Schema.fromJsonString(ProjectionVerificationArtifact.fields.metadata),
);

const toCheckRun = (row: typeof CheckRunDbRow.Type): ProjectionVerificationCheckRun => ({
  ...row,
  timedOut: row.timedOut === 1,
});

const runColumns = `
  verification_run_id AS "id", project_id AS "projectId", mission_id AS "missionId",
  task_id AS "taskId", worktree_id AS "worktreeId", agent_run_id AS "agentRunId",
  profile_id AS "profileId", requested_by AS "requestedBy", trigger,
  authorization_scope AS "authorizationScope",
  source_verification_run_id AS "sourceVerificationRunId", status,
  configuration_revision AS "configurationRevision",
  configuration_digest AS "configurationDigest", branch_name AS "branchName",
  commit_hash AS "commitHash", dirty_state_fingerprint AS "dirtyStateFingerprint",
  source_fingerprint AS "sourceFingerprint",
  changed_files_snapshot_json AS "changedFilesSnapshot",
  environment_snapshot_json AS "environmentSnapshot", execution_plan_json AS "executionPlan",
  started_at AS "startedAt", completed_at AS "completedAt", cancelled_at AS "cancelledAt",
  result, failure_summary AS "failureSummary", invalidated_at AS "invalidatedAt",
  invalidation_reason AS "invalidationReason", created_at AS "createdAt"
`;
const checkRunColumns = `
  verification_check_run_id AS "id", verification_run_id AS "verificationRunId",
  gate_id AS "gateId", check_definition_id AS "checkDefinitionId",
  name_snapshot AS "nameSnapshot", command_snapshot AS "commandSnapshot",
  arguments_snapshot_json AS "argumentsSnapshot",
  working_directory_snapshot AS "workingDirectorySnapshot",
  selection_reason AS "selectionReason", status, position, started_at AS "startedAt",
  completed_at AS "completedAt", exit_code AS "exitCode", signal,
  duration_milliseconds AS "durationMilliseconds", timed_out AS "timedOut", result,
  failure_category AS "failureCategory", summary, log_reference AS "logReference",
  created_at AS "createdAt"
`;
const diagnosticColumns = `
  verification_diagnostic_id AS "id", check_run_id AS "checkRunId", severity, category,
  message, file_path AS "filePath", line, column_number AS "column", code,
  raw_reference AS "rawReference", created_at AS "createdAt"
`;
const artifactColumns = `
  verification_artifact_id AS "id", verification_run_id AS "verificationRunId",
  check_run_id AS "checkRunId", type, name, path, mime_type AS "mimeType",
  size_bytes AS "sizeBytes", checksum, metadata_json AS "metadata", created_at AS "createdAt"
`;
const repairAttemptColumns = `
  verification_repair_attempt_id AS "id", verification_run_id AS "verificationRunId",
  task_id AS "taskId", agent_run_id AS "agentRunId", attempt_number AS "attemptNumber",
  failure_snapshot_json AS "failureSnapshot", status, started_at AS "startedAt",
  completed_at AS "completedAt", created_at AS "createdAt"
`;
const overrideColumns = `
  verification_override_id AS "id", project_id AS "projectId", mission_id AS "missionId",
  task_id AS "taskId", verification_run_id AS "verificationRunId",
  source_fingerprint AS "sourceFingerprint", reason, requested_by AS "requestedBy",
  created_at AS "createdAt", revoked_at AS "revokedAt"
`;

const expectedRunResult = (status: ProjectionVerificationRun["status"]) => {
  switch (status) {
    case "passed":
    case "passed_with_warnings":
    case "failed":
    case "cancelled":
    case "interrupted":
      return status;
    default:
      return null;
  }
};

const expectedCheckResult = (status: ProjectionVerificationCheckRun["status"]) =>
  status === "running" || status === "queued" ? null : status;

const validationError = (operation: string, issue: string) =>
  new VerificationProjectionValidationError({ operation, issue });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const isValidationError = Schema.is(VerificationProjectionValidationError);
  const sqlError = (operation: string) =>
    Effect.mapError((cause) =>
      isValidationError(cause) ? cause : toPersistenceSqlError(operation)(cause),
    );

  const getRunRow = SqlSchema.findOneOption({
    Request: GetVerificationRunInput,
    Result: RunDbRow,
    execute: ({ verificationRunId }) => sql`
      SELECT ${sql.unsafe(runColumns)} FROM projection_verification_runs
      WHERE verification_run_id = ${verificationRunId}
    `,
  });
  const listRunsByProject = SqlSchema.findAll({
    Request: ListVerificationRunsByProjectInput,
    Result: RunDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${sql.unsafe(runColumns)} FROM projection_verification_runs
      WHERE project_id = ${projectId} ORDER BY created_at DESC, verification_run_id DESC
    `,
  });
  const listRunsByTask = SqlSchema.findAll({
    Request: ListVerificationRunsByTaskInput,
    Result: RunDbRow,
    execute: ({ taskId }) => sql`
      SELECT ${sql.unsafe(runColumns)} FROM projection_verification_runs
      WHERE task_id = ${taskId} ORDER BY created_at DESC, verification_run_id DESC
    `,
  });
  const listRunsByProfile = SqlSchema.findAll({
    Request: ListVerificationRunsByProfileInput,
    Result: RunDbRow,
    execute: ({ profileId }) => sql`
      SELECT ${sql.unsafe(runColumns)} FROM projection_verification_runs
      WHERE profile_id = ${profileId} ORDER BY created_at DESC, verification_run_id DESC
    `,
  });
  const listActiveRunsRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: RunDbRow,
    execute: () => sql`
      SELECT ${sql.unsafe(runColumns)} FROM projection_verification_runs
      WHERE status IN ('queued', 'preparing', 'running', 'cancelling')
      ORDER BY created_at ASC, verification_run_id ASC
    `,
  });

  const getCheckRunRow = SqlSchema.findOneOption({
    Request: GetVerificationCheckRunInput,
    Result: CheckRunDbRow,
    execute: ({ checkRunId }) => sql`
      SELECT ${sql.unsafe(checkRunColumns)} FROM projection_verification_check_runs
      WHERE verification_check_run_id = ${checkRunId}
    `,
  });
  const listCheckRunsRows = SqlSchema.findAll({
    Request: ListVerificationCheckRunsInput,
    Result: CheckRunDbRow,
    execute: ({ verificationRunId }) => sql`
      SELECT ${sql.unsafe(checkRunColumns)} FROM projection_verification_check_runs
      WHERE verification_run_id = ${verificationRunId}
      ORDER BY position ASC, verification_check_run_id ASC
    `,
  });
  const listDiagnosticRows = SqlSchema.findAll({
    Request: ListVerificationDiagnosticsInput,
    Result: ProjectionVerificationDiagnostic,
    execute: ({ checkRunId }) => sql`
      SELECT ${sql.unsafe(diagnosticColumns)} FROM projection_verification_diagnostics
      WHERE check_run_id = ${checkRunId}
      ORDER BY created_at ASC, verification_diagnostic_id ASC
    `,
  });
  const listArtifactRows = SqlSchema.findAll({
    Request: ListVerificationArtifactsInput,
    Result: ArtifactDbRow,
    execute: ({ verificationRunId }) => sql`
      SELECT ${sql.unsafe(artifactColumns)} FROM projection_verification_artifacts
      WHERE verification_run_id = ${verificationRunId}
      ORDER BY created_at ASC, verification_artifact_id ASC
    `,
  });
  const getRepairAttemptRow = SqlSchema.findOneOption({
    Request: GetVerificationRepairAttemptInput,
    Result: RepairAttemptDbRow,
    execute: ({ repairAttemptId }) => sql`
      SELECT ${sql.unsafe(repairAttemptColumns)} FROM projection_verification_repair_attempts
      WHERE verification_repair_attempt_id = ${repairAttemptId}
    `,
  });
  const listRepairAttemptRows = SqlSchema.findAll({
    Request: ListVerificationCheckRunsInput,
    Result: RepairAttemptDbRow,
    execute: ({ verificationRunId }) => sql`
      SELECT ${sql.unsafe(repairAttemptColumns)} FROM projection_verification_repair_attempts
      WHERE verification_run_id = ${verificationRunId}
      ORDER BY attempt_number ASC, verification_repair_attempt_id ASC
    `,
  });
  const listOverrideRows = SqlSchema.findAll({
    Request: ListVerificationRunsByTaskInput,
    Result: ProjectionVerificationOverride,
    execute: ({ taskId }) => sql`
      SELECT ${sql.unsafe(overrideColumns)} FROM projection_verification_overrides
      WHERE task_id = ${taskId} ORDER BY created_at DESC, verification_override_id DESC
    `,
  });

  const getRunById: ProjectionVerificationRunRepositoryShape["getRunById"] = (input) =>
    getRunRow(input).pipe(sqlError("VerificationRuns.getRunById"));

  const saveRun: ProjectionVerificationRunRepositoryShape["saveRun"] = (row) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* getRunById({ verificationRunId: row.id });
          if (Option.isNone(existing) && row.status !== "queued") {
            return yield* validationError("VerificationRuns.saveRun", "new runs must begin queued");
          }
          if (
            Option.isSome(existing) &&
            !canTransitionVerificationRun(existing.value.status, row.status)
          ) {
            return yield* validationError(
              "VerificationRuns.saveRun",
              `invalid run transition ${existing.value.status} -> ${row.status}`,
            );
          }
          const expected =
            row.status === "invalidated" ? row.result : expectedRunResult(row.status);
          if (row.result !== expected) {
            return yield* validationError(
              "VerificationRuns.saveRun",
              `status ${row.status} has inconsistent result`,
            );
          }
          if (
            row.status === "invalidated" &&
            (row.invalidatedAt === null || row.invalidationReason === null)
          ) {
            return yield* validationError(
              "VerificationRuns.saveRun",
              "invalidated runs require timestamp and reason",
            );
          }
          const encodedEvidence = yield* Effect.try({
            try: () => ({
              changedFiles: encodeChangedFiles(row.changedFilesSnapshot),
              environment: encodeEnvironmentSnapshot(row.environmentSnapshot),
              plan: encodeExecutionPlan(row.executionPlan),
            }),
            catch: (cause) =>
              validationError(
                "VerificationRuns.saveRun",
                `invalid execution evidence: ${String(cause)}`,
              ),
          });
          yield* sql`
          INSERT INTO projection_verification_runs (
            verification_run_id, project_id, mission_id, task_id, worktree_id, agent_run_id,
            profile_id, requested_by, trigger, authorization_scope,
            source_verification_run_id, status, configuration_revision,
            configuration_digest, branch_name, commit_hash, dirty_state_fingerprint,
            source_fingerprint, changed_files_snapshot_json, environment_snapshot_json,
            execution_plan_json, started_at, completed_at, cancelled_at, result, failure_summary,
            invalidated_at, invalidation_reason, created_at
          ) VALUES (
            ${row.id}, ${row.projectId}, ${row.missionId}, ${row.taskId}, ${row.worktreeId},
            ${row.agentRunId}, ${row.profileId}, ${row.requestedBy}, ${row.trigger},
            ${row.authorizationScope}, ${row.sourceVerificationRunId}, ${row.status},
            ${row.configurationRevision}, ${row.configurationDigest}, ${row.branchName},
            ${row.commitHash}, ${row.dirtyStateFingerprint}, ${row.sourceFingerprint},
            ${encodedEvidence.changedFiles}, ${encodedEvidence.environment}, ${encodedEvidence.plan},
            ${row.startedAt}, ${row.completedAt},
            ${row.cancelledAt}, ${row.result}, ${row.failureSummary}, ${row.invalidatedAt},
            ${row.invalidationReason}, ${row.createdAt}
          ) ON CONFLICT (verification_run_id) DO UPDATE SET
            status = excluded.status, started_at = excluded.started_at,
            completed_at = excluded.completed_at, cancelled_at = excluded.cancelled_at,
            result = excluded.result, failure_summary = excluded.failure_summary,
            invalidated_at = excluded.invalidated_at,
            invalidation_reason = excluded.invalidation_reason
        `;
        }),
      )
      .pipe(sqlError("VerificationRuns.saveRun:transaction"));

  const invalidateRun: ProjectionVerificationRunRepositoryShape["invalidateRun"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* getRunById(input);
          if (Option.isNone(existing)) {
            return yield* validationError(
              "VerificationRuns.invalidateRun",
              "verification run was not found",
            );
          }
          if (!canTransitionVerificationRun(existing.value.status, "invalidated")) {
            return yield* validationError(
              "VerificationRuns.invalidateRun",
              `run status ${existing.value.status} cannot be invalidated`,
            );
          }
          yield* sql`
          UPDATE projection_verification_runs SET status = 'invalidated',
            invalidated_at = ${input.invalidatedAt}, invalidation_reason = ${input.reason}
          WHERE verification_run_id = ${input.verificationRunId}
        `;
        }),
      )
      .pipe(sqlError("VerificationRuns.invalidateRun:transaction"));

  const getCheckRunById: ProjectionVerificationRunRepositoryShape["getCheckRunById"] = (input) =>
    getCheckRunRow(input).pipe(
      Effect.map(Option.map(toCheckRun)),
      sqlError("VerificationRuns.getCheckRunById"),
    );
  const saveCheckRun: ProjectionVerificationRunRepositoryShape["saveCheckRun"] = (row) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* getCheckRunById({ checkRunId: row.id });
          if (Option.isNone(existing) && row.status !== "queued") {
            return yield* validationError(
              "VerificationRuns.saveCheckRun",
              "new checks must begin queued",
            );
          }
          if (
            Option.isSome(existing) &&
            !canTransitionVerificationCheckRun(existing.value.status, row.status)
          ) {
            return yield* validationError(
              "VerificationRuns.saveCheckRun",
              `invalid check transition ${existing.value.status} -> ${row.status}`,
            );
          }
          if (row.result !== expectedCheckResult(row.status)) {
            return yield* validationError(
              "VerificationRuns.saveCheckRun",
              `status ${row.status} has inconsistent result`,
            );
          }
          yield* sql`
          INSERT INTO projection_verification_check_runs (
            verification_check_run_id, verification_run_id, gate_id, check_definition_id,
            name_snapshot, command_snapshot, arguments_snapshot_json,
            working_directory_snapshot, selection_reason, status, position, started_at,
            completed_at, exit_code, signal, duration_milliseconds, timed_out, result,
            failure_category, summary, log_reference, created_at
          ) VALUES (
            ${row.id}, ${row.verificationRunId}, ${row.gateId}, ${row.checkDefinitionId},
            ${row.nameSnapshot}, ${row.commandSnapshot}, ${encodeArguments(row.argumentsSnapshot)},
            ${row.workingDirectorySnapshot}, ${row.selectionReason}, ${row.status}, ${row.position},
            ${row.startedAt}, ${row.completedAt}, ${row.exitCode}, ${row.signal},
            ${row.durationMilliseconds}, ${row.timedOut ? 1 : 0}, ${row.result},
            ${row.failureCategory}, ${row.summary}, ${row.logReference}, ${row.createdAt}
          ) ON CONFLICT (verification_check_run_id) DO UPDATE SET
            status = excluded.status, started_at = excluded.started_at,
            completed_at = excluded.completed_at, exit_code = excluded.exit_code,
            signal = excluded.signal, duration_milliseconds = excluded.duration_milliseconds,
            timed_out = excluded.timed_out, result = excluded.result,
            failure_category = excluded.failure_category, summary = excluded.summary,
            log_reference = excluded.log_reference
        `;
        }),
      )
      .pipe(sqlError("VerificationRuns.saveCheckRun:transaction"));

  const saveRepairAttempt: ProjectionVerificationRunRepositoryShape["saveRepairAttempt"] = (row) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* getRepairAttemptRow({ repairAttemptId: row.id }).pipe(
            Effect.map(Option.map((value) => value)),
            sqlError("VerificationRuns.getRepairAttemptById"),
          );
          if (Option.isNone(existing) && row.status !== "queued") {
            return yield* validationError(
              "VerificationRuns.saveRepairAttempt",
              "new attempts must begin queued",
            );
          }
          if (
            Option.isSome(existing) &&
            !canTransitionVerificationRepairAttempt(existing.value.status, row.status)
          ) {
            return yield* validationError(
              "VerificationRuns.saveRepairAttempt",
              `invalid repair transition ${existing.value.status} -> ${row.status}`,
            );
          }
          yield* sql`
          INSERT INTO projection_verification_repair_attempts (
            verification_repair_attempt_id, verification_run_id, task_id, agent_run_id,
            attempt_number, failure_snapshot_json, status, started_at, completed_at, created_at
          ) VALUES (
            ${row.id}, ${row.verificationRunId}, ${row.taskId}, ${row.agentRunId},
            ${row.attemptNumber}, ${encodeFailureSnapshot(row.failureSnapshot)}, ${row.status},
            ${row.startedAt}, ${row.completedAt}, ${row.createdAt}
          ) ON CONFLICT (verification_repair_attempt_id) DO UPDATE SET
            agent_run_id = excluded.agent_run_id, status = excluded.status,
            started_at = excluded.started_at, completed_at = excluded.completed_at
        `;
        }),
      )
      .pipe(sqlError("VerificationRuns.saveRepairAttempt:transaction"));

  return {
    saveRun,
    getRunById,
    listRunsByProjectId: (input) =>
      listRunsByProject(input).pipe(sqlError("VerificationRuns.listRunsByProjectId")),
    listRunsByTaskId: (input) =>
      listRunsByTask(input).pipe(sqlError("VerificationRuns.listRunsByTaskId")),
    listRunsByProfileId: (input) =>
      listRunsByProfile(input).pipe(sqlError("VerificationRuns.listRunsByProfileId")),
    listActiveRuns: () =>
      listActiveRunsRows(undefined).pipe(sqlError("VerificationRuns.listActiveRuns")),
    invalidateRun,
    saveCheckRun,
    getCheckRunById,
    listCheckRunsByRunId: (input) =>
      listCheckRunsRows(input).pipe(
        Effect.map((rows) => rows.map(toCheckRun)),
        sqlError("VerificationRuns.listCheckRunsByRunId"),
      ),
    appendDiagnostic: (row) =>
      sql`
        INSERT INTO projection_verification_diagnostics (
          verification_diagnostic_id, check_run_id, severity, category, message, file_path,
          line, column_number, code, raw_reference, created_at
        ) VALUES (
          ${row.id}, ${row.checkRunId}, ${row.severity}, ${row.category}, ${row.message},
          ${row.filePath}, ${row.line}, ${row.column}, ${row.code}, ${row.rawReference},
          ${row.createdAt}
        ) ON CONFLICT (verification_diagnostic_id) DO NOTHING
      `.pipe(sqlError("VerificationRuns.appendDiagnostic"), Effect.asVoid),
    listDiagnosticsByCheckRunId: (input) =>
      listDiagnosticRows(input).pipe(sqlError("VerificationRuns.listDiagnosticsByCheckRunId")),
    appendArtifact: (row) =>
      sql`
        INSERT INTO projection_verification_artifacts (
          verification_artifact_id, verification_run_id, check_run_id, type, name, path,
          mime_type, size_bytes, checksum, metadata_json, created_at
        ) VALUES (
          ${row.id}, ${row.verificationRunId}, ${row.checkRunId}, ${row.type}, ${row.name},
          ${row.path}, ${row.mimeType}, ${row.sizeBytes}, ${row.checksum},
          ${encodeArtifactMetadata(row.metadata)}, ${row.createdAt}
        ) ON CONFLICT (verification_artifact_id) DO NOTHING
      `.pipe(sqlError("VerificationRuns.appendArtifact"), Effect.asVoid),
    listArtifactsByRunId: (input) =>
      listArtifactRows(input).pipe(sqlError("VerificationRuns.listArtifactsByRunId")),
    saveRepairAttempt,
    getRepairAttemptById: (input) =>
      getRepairAttemptRow(input).pipe(sqlError("VerificationRuns.getRepairAttemptById")),
    listRepairAttemptsByRunId: (input) =>
      listRepairAttemptRows(input).pipe(sqlError("VerificationRuns.listRepairAttemptsByRunId")),
    appendOverride: (row) =>
      sql`
        INSERT INTO projection_verification_overrides (
          verification_override_id, project_id, mission_id, task_id, verification_run_id,
          source_fingerprint, reason, requested_by, created_at, revoked_at
        ) VALUES (
          ${row.id}, ${row.projectId}, ${row.missionId}, ${row.taskId},
          ${row.verificationRunId}, ${row.sourceFingerprint}, ${row.reason},
          ${row.requestedBy}, ${row.createdAt}, ${row.revokedAt}
        ) ON CONFLICT (verification_override_id) DO NOTHING
      `.pipe(sqlError("VerificationRuns.appendOverride"), Effect.asVoid),
    listOverridesByTaskId: (input) =>
      listOverrideRows(input).pipe(sqlError("VerificationRuns.listOverridesByTaskId")),
    revokeOverride: (input) =>
      sql`
        UPDATE projection_verification_overrides SET revoked_at = ${input.revokedAt}
        WHERE verification_override_id = ${input.overrideId} AND revoked_at IS NULL
      `.pipe(sqlError("VerificationRuns.revokeOverride"), Effect.asVoid),
  } satisfies ProjectionVerificationRunRepositoryShape;
});

export const ProjectionVerificationRunRepositoryLive = Layer.effect(
  ProjectionVerificationRunRepository,
  make,
);
