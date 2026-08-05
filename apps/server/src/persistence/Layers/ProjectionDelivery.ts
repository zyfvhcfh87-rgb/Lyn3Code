import {
  ApprovalDecision,
  ApprovalRequest,
  DeliveryAuditEntry,
  DeliveryPolicy,
  DeploymentEnvironment,
  DeploymentExecution,
  DeploymentPlan,
  DeploymentValidationRun,
  MergeExecution,
  MergeReadinessAssessment,
  ReleaseArtifact,
  ReleaseConfiguration,
  ReleasePlan,
  RollbackExecution,
  RollbackPlan,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";

import { PersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionDeliveryRepository,
  type ProjectionDeliveryRepositoryShape,
} from "../Services/ProjectionDelivery.ts";

interface StoredRow {
  readonly recordJson: string;
}

interface ColumnPath {
  readonly column: string;
  readonly path: string;
}

interface EntityTable {
  readonly table: string;
  readonly primaryKey: string;
  readonly columns: ReadonlyArray<ColumnPath>;
  readonly immutable?: boolean;
}

const column = (columnName: string, path: string): ColumnPath => ({ column: columnName, path });

const tables = {
  policy: {
    table: "projection_delivery_policies",
    primaryKey: "delivery_policy_id",
    columns: [
      column("delivery_policy_id", "$.id"),
      column("project_id", "$.projectId"),
      column("name", "$.name"),
      column("description", "$.description"),
      column("is_default", "$.isDefault"),
      column("version", "$.version"),
      column("policy_digest", "$.policyDigest"),
      column("enabled", "$.enabled"),
      column("merge_policy_json", "$.mergePolicy"),
      column("release_policy_json", "$.releasePolicy"),
      column("deployment_policy_json", "$.deploymentPolicy"),
      column("rollback_policy_json", "$.rollbackPolicy"),
      column("created_at", "$.createdAt"),
      column("updated_at", "$.updatedAt"),
    ],
  },
  assessment: {
    table: "projection_delivery_merge_assessments",
    primaryKey: "merge_readiness_assessment_id",
    columns: [
      column("merge_readiness_assessment_id", "$.id"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("repository_connection_id", "$.repositoryConnectionId"),
      column("pull_request_record_id", "$.pullRequestRecordId"),
      column("delivery_policy_id", "$.deliveryPolicyId"),
      column("policy_digest", "$.policyDigest"),
      column("head_sha", "$.headSha"),
      column("base_sha", "$.baseSha"),
      column("source_commit", "$.sourceCommit"),
      column("source_fingerprint", "$.sourceFingerprint"),
      column("verification_run_id", "$.verificationRunId"),
      column("result", "$.result"),
      column("states_json", "$.states"),
      column("blocking_reasons_json", "$.blockingReasons"),
      column("warning_reasons_json", "$.warningReasons"),
      column("evidence_snapshot_json", "$.evidenceSnapshot"),
      column("observed_at", "$.observedAt"),
      column("expires_at", "$.expiresAt"),
      column("invalidated_at", "$.invalidatedAt"),
    ],
  },
  approvalRequest: {
    table: "projection_delivery_approval_requests",
    primaryKey: "approval_request_id",
    columns: [
      column("approval_request_id", "$.id"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("delivery_policy_id", "$.deliveryPolicyId"),
      column("approval_type", "$.approvalType"),
      column("target_type", "$.targetType"),
      column("target_id", "$.targetId"),
      column("plan_digest", "$.planDigest"),
      column("source_commit", "$.sourceCommit"),
      column("status", "$.status"),
      column("required_decision_count", "$.requiredDecisionCount"),
      column("policy_snapshot_json", "$.policySnapshot"),
      column("context_snapshot_json", "$.contextSnapshot"),
      column("requested_by", "$.requestedBy"),
      column("requested_at", "$.requestedAt"),
      column("resolved_at", "$.resolvedAt"),
      column("expires_at", "$.expiresAt"),
    ],
  },
  approvalDecision: {
    table: "projection_delivery_approval_decisions",
    primaryKey: "approval_decision_id",
    immutable: true,
    columns: [
      column("approval_decision_id", "$.id"),
      column("approval_request_id", "$.approvalRequestId"),
      column("actor_id", "$.actorId"),
      column("actor_type", "$.actorType"),
      column("decision", "$.decision"),
      column("reason", "$.reason"),
      column("plan_digest", "$.planDigest"),
      column("source_commit", "$.sourceCommit"),
      column("decided_at", "$.decidedAt"),
    ],
  },
  mergeExecution: {
    table: "projection_delivery_merge_executions",
    primaryKey: "merge_execution_id",
    columns: [
      column("merge_execution_id", "$.id"),
      column("idempotency_key", "$.idempotencyKey"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("repository_connection_id", "$.repositoryConnectionId"),
      column("pull_request_record_id", "$.pullRequestRecordId"),
      column("readiness_assessment_id", "$.readinessAssessmentId"),
      column("approval_request_id", "$.approvalRequestId"),
      column("delivery_policy_id", "$.deliveryPolicyId"),
      column("merge_strategy", "$.mergeStrategy"),
      column("expected_head_sha", "$.expectedHeadSha"),
      column("expected_base_sha", "$.expectedBaseSha"),
      column("source_commit", "$.sourceCommit"),
      column("status", "$.status"),
      column("remote_merge_sha", "$.remoteMergeSha"),
      column("error_code", "$.errorCode"),
      column("error_message", "$.errorMessage"),
      column("created_at", "$.createdAt"),
      column("started_at", "$.startedAt"),
      column("finished_at", "$.finishedAt"),
    ],
  },
  releaseConfiguration: {
    table: "projection_delivery_release_configurations",
    primaryKey: "release_configuration_id",
    columns: [
      column("release_configuration_id", "$.id"),
      column("project_id", "$.projectId"),
      column("name", "$.name"),
      column("provider", "$.provider"),
      column("repository", "$.repository"),
      column("release_channel", "$.releaseChannel"),
      column("tag_pattern", "$.tagPattern"),
      column("artifact_globs_json", "$.artifactGlobs"),
      column("version_strategy", "$.versionStrategy"),
      column("version_source", "$.versionSource"),
      column("changelog_mode", "$.changelogMode"),
      column("artifact_configuration_json", "$.artifactConfiguration"),
      column("github_release_enabled", "$.githubReleaseEnabled"),
      column("package_publishing_enabled", "$.packagePublishingEnabled"),
      column("enabled", "$.enabled"),
      column("version", "$.version"),
      column("configuration_digest", "$.configurationDigest"),
      column("public_metadata_json", "$.publicMetadata"),
      column("created_at", "$.createdAt"),
      column("updated_at", "$.updatedAt"),
    ],
  },
  releasePlan: {
    table: "projection_delivery_release_plans",
    primaryKey: "release_plan_id",
    columns: [
      column("release_plan_id", "$.id"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("release_configuration_id", "$.releaseConfigurationId"),
      column("delivery_policy_id", "$.deliveryPolicyId"),
      column("plan_digest", "$.planDigest"),
      column("source_commit", "$.sourceCommit"),
      column("version", "$.version"),
      column("tag_name", "$.tagName"),
      column("release_name", "$.releaseName"),
      column("source_branch", "$.sourceBranch"),
      column("change_summary", "$.changeSummary"),
      column("changelog_draft", "$.changelogDraft"),
      column("release_notes_draft", "$.releaseNotesDraft"),
      column("included_missions_json", "$.includedMissions"),
      column("included_pull_requests_json", "$.includedPullRequests"),
      column("artifact_plan_json", "$.artifactPlan"),
      column("publication_plan_json", "$.publicationPlan"),
      column("status", "$.status"),
      column("approval_request_id", "$.approvalRequestId"),
      column("approved_at", "$.approvedAt"),
      column("created_at", "$.createdAt"),
      column("updated_at", "$.updatedAt"),
      column("completed_at", "$.completedAt"),
    ],
  },
  releaseArtifact: {
    table: "projection_delivery_release_artifacts",
    primaryKey: "release_artifact_id",
    columns: [
      column("release_artifact_id", "$.id"),
      column("release_plan_id", "$.releasePlanId"),
      column("name", "$.name"),
      column("relative_path", "$.relativePath"),
      column("artifact_type", "$.artifactType"),
      column("checksum", "$.checksum"),
      column("size_bytes", "$.sizeBytes"),
      column("content_type", "$.contentType"),
      column("source_commit", "$.sourceCommit"),
      column("status", "$.status"),
      column("remote_url", "$.remoteUrl"),
      column("created_at", "$.createdAt"),
      column("published_at", "$.publishedAt"),
    ],
  },
  environment: {
    table: "projection_delivery_environments",
    primaryKey: "deployment_environment_id",
    columns: [
      column("deployment_environment_id", "$.id"),
      column("project_id", "$.projectId"),
      column("name", "$.name"),
      column("tier", "$.tier"),
      column("kind", "$.kind"),
      column("provider", "$.provider"),
      column("provider_type", "$.providerType"),
      column("provider_connection_reference", "$.providerConnectionReference"),
      column("external_ref", "$.externalRef"),
      column("status", "$.status"),
      column("protected", "$.protected"),
      column("requires_approval", "$.requiresApproval"),
      column("required_approval_count", "$.requiredApprovalCount"),
      column("configuration_digest", "$.configurationDigest"),
      column("public_metadata_json", "$.publicMetadata"),
      column("window_policy_json", "$.windowPolicy"),
      column("configuration_metadata_json", "$.configurationMetadata"),
      column("created_at", "$.createdAt"),
      column("updated_at", "$.updatedAt"),
    ],
  },
  deploymentPlan: {
    table: "projection_delivery_deployment_plans",
    primaryKey: "deployment_plan_id",
    columns: [
      column("deployment_plan_id", "$.id"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("release_plan_id", "$.releasePlanId"),
      column("deployment_environment_id", "$.deploymentEnvironmentId"),
      column("delivery_policy_id", "$.deliveryPolicyId"),
      column("plan_digest", "$.planDigest"),
      column("source_commit", "$.sourceCommit"),
      column("source_type", "$.sourceType"),
      column("source_reference", "$.sourceReference"),
      column("strategy", "$.strategy"),
      column("configuration_json", "$.configuration"),
      column("configuration_snapshot_json", "$.configurationSnapshot"),
      column("validation_profile_id", "$.validationProfileId"),
      column("rollback_plan_id", "$.rollbackPlanId"),
      column("status", "$.status"),
      column("approval_request_id", "$.approvalRequestId"),
      column("approved_at", "$.approvedAt"),
      column("created_at", "$.createdAt"),
      column("updated_at", "$.updatedAt"),
    ],
  },
  deploymentExecution: {
    table: "projection_delivery_deployment_executions",
    primaryKey: "deployment_execution_id",
    columns: [
      column("deployment_execution_id", "$.id"),
      column("deployment_plan_id", "$.deploymentPlanId"),
      column("idempotency_key", "$.idempotencyKey"),
      column("attempt_number", "$.attemptNumber"),
      column("source_commit", "$.sourceCommit"),
      column("status", "$.status"),
      column("provider_state_json", "$.providerState"),
      column("remote_execution_id", "$.remoteExecutionId"),
      column("endpoint", "$.endpoint"),
      column("deployment_url", "$.deploymentUrl"),
      column("log_reference", "$.logReference"),
      column("error_code", "$.errorCode"),
      column("error_message", "$.errorMessage"),
      column("created_at", "$.createdAt"),
      column("started_at", "$.startedAt"),
      column("finished_at", "$.finishedAt"),
    ],
  },
  validationRun: {
    table: "projection_delivery_validation_runs",
    primaryKey: "deployment_validation_run_id",
    columns: [
      column("deployment_validation_run_id", "$.id"),
      column("deployment_execution_id", "$.deploymentExecutionId"),
      column("kind", "$.kind"),
      column("status", "$.status"),
      column("result", "$.result"),
      column("source_commit", "$.sourceCommit"),
      column("evidence_json", "$.evidence"),
      column("error_message", "$.errorMessage"),
      column("created_at", "$.createdAt"),
      column("started_at", "$.startedAt"),
      column("finished_at", "$.finishedAt"),
    ],
  },
  rollbackPlan: {
    table: "projection_delivery_rollback_plans",
    primaryKey: "rollback_plan_id",
    columns: [
      column("rollback_plan_id", "$.id"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("deployment_execution_id", "$.deploymentExecutionId"),
      column("deployment_environment_id", "$.deploymentEnvironmentId"),
      column("delivery_policy_id", "$.deliveryPolicyId"),
      column("target_deployment_execution_id", "$.targetDeploymentExecutionId"),
      column("plan_digest", "$.planDigest"),
      column("source_commit", "$.sourceCommit"),
      column("restore_source_commit", "$.restoreSourceCommit"),
      column("rollback_type", "$.rollbackType"),
      column("target_reference", "$.targetReference"),
      column("reversibility", "$.reversibility"),
      column("requires_approval", "$.requiresApproval"),
      column("reason", "$.reason"),
      column("status", "$.status"),
      column("approval_request_id", "$.approvalRequestId"),
      column("approved_at", "$.approvedAt"),
      column("created_at", "$.createdAt"),
      column("updated_at", "$.updatedAt"),
    ],
  },
  rollbackExecution: {
    table: "projection_delivery_rollback_executions",
    primaryKey: "rollback_execution_id",
    columns: [
      column("rollback_execution_id", "$.id"),
      column("rollback_plan_id", "$.rollbackPlanId"),
      column("idempotency_key", "$.idempotencyKey"),
      column("source_commit", "$.sourceCommit"),
      column("status", "$.status"),
      column("remote_execution_id", "$.remoteExecutionId"),
      column("result_reference", "$.resultReference"),
      column("error_code", "$.errorCode"),
      column("error_message", "$.errorMessage"),
      column("created_at", "$.createdAt"),
      column("started_at", "$.startedAt"),
      column("finished_at", "$.finishedAt"),
    ],
  },
  auditEntry: {
    table: "projection_delivery_audit_entries",
    primaryKey: "delivery_audit_entry_id",
    immutable: true,
    columns: [
      column("delivery_audit_entry_id", "$.id"),
      column("project_id", "$.projectId"),
      column("mission_id", "$.missionId"),
      column("aggregate_type", "$.aggregateType"),
      column("aggregate_id", "$.aggregateId"),
      column("action", "$.action"),
      column("actor_type", "$.actorType"),
      column("actor_id", "$.actorId"),
      column("source_commit", "$.sourceCommit"),
      column("public_metadata_json", "$.publicMetadata"),
      column("occurred_at", "$.occurredAt"),
    ],
  },
} as const satisfies Record<string, EntityTable>;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));

  const decodeRows = <A>(
    schema: Schema.Codec<A, unknown, never, never>,
    rows: ReadonlyArray<StoredRow>,
    operation: string,
  ) =>
    Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(row.recordJson).pipe(
        Effect.mapError((error) => PersistenceDecodeError.fromSchemaError(operation, error)),
      ),
    );

  const readMany = <A>(
    schema: Schema.Codec<A, unknown, never, never>,
    rows: Effect.Effect<ReadonlyArray<StoredRow>, SqlError.SqlError>,
    operation: string,
  ) =>
    rows.pipe(
      sqlError(operation),
      Effect.flatMap((found) => decodeRows(schema, found, operation)),
    );

  const readOne = <A>(
    schema: Schema.Codec<A, unknown, never, never>,
    rows: Effect.Effect<ReadonlyArray<StoredRow>, SqlError.SqlError>,
    operation: string,
  ) =>
    readMany(schema, rows, operation).pipe(Effect.map((found) => Option.fromUndefinedOr(found[0])));

  const saveRecord = (definition: EntityTable, entity: unknown, operation: string) => {
    const recordJson = JSON.stringify(entity);
    const columnNames = definition.columns.map(({ column: name }) => name).join(", ");
    const extracted = definition.columns
      .map(({ path }) => `json_extract(record_json, '${path}')`)
      .join(", ");
    const conflict = definition.immutable
      ? "DO NOTHING"
      : `DO UPDATE SET record_json = excluded.record_json, ${definition.columns
          .filter(({ column: name }) => name !== definition.primaryKey)
          .map(({ column: name }) => `${name} = excluded.${name}`)
          .join(", ")}`;
    return sql`
      INSERT INTO ${sql.unsafe(definition.table)} (record_json, ${sql.unsafe(columnNames)})
      SELECT record_json, ${sql.unsafe(extracted)} FROM (SELECT ${recordJson} AS record_json)
      WHERE true
      ON CONFLICT (${sql.unsafe(definition.primaryKey)}) ${sql.unsafe(conflict)}
    `.pipe(sqlError(operation), Effect.asVoid);
  };

  const getRecord = <A>(
    definition: EntityTable,
    schema: Schema.Codec<A, unknown, never, never>,
    id: string,
    operation: string,
  ) =>
    readOne(
      schema,
      sql<StoredRow>`
    SELECT record_json AS recordJson FROM ${sql.unsafe(definition.table)}
    WHERE ${sql.unsafe(definition.primaryKey)} = ${id}
  `,
      operation,
    );

  const listRecords = <A>(
    definition: EntityTable,
    schema: Schema.Codec<A, unknown, never, never>,
    filterColumn: string,
    filterValue: string,
    orderColumn: string,
    operation: string,
  ) =>
    readMany(
      schema,
      sql<StoredRow>`
    SELECT record_json AS recordJson FROM ${sql.unsafe(definition.table)}
    WHERE ${sql.unsafe(filterColumn)} = ${filterValue}
    ORDER BY ${sql.unsafe(orderColumn)} DESC, ${sql.unsafe(definition.primaryKey)} ASC
  `,
      operation,
    );

  const listRecoverable = <A>(
    definition: EntityTable,
    schema: Schema.Codec<A, unknown, never, never>,
    statuses: ReadonlyArray<string>,
    orderColumn: string,
    operation: string,
  ) =>
    readMany(
      schema,
      sql<StoredRow>`
    SELECT record_json AS recordJson FROM ${sql.unsafe(definition.table)}
    WHERE ${sql.in("status", statuses)}
    ORDER BY ${sql.unsafe(orderColumn)} ASC, ${sql.unsafe(definition.primaryKey)} ASC
  `,
      operation,
    );

  const savePolicy: ProjectionDeliveryRepositoryShape["savePolicy"] = (entity) =>
    saveRecord(tables.policy, entity, "save delivery policy");
  const getPolicy: ProjectionDeliveryRepositoryShape["getPolicy"] = (id) =>
    getRecord(tables.policy, DeliveryPolicy, id, "get delivery policy");
  const listPolicies: ProjectionDeliveryRepositoryShape["listPolicies"] = (projectId) =>
    listRecords(
      tables.policy,
      DeliveryPolicy,
      "project_id",
      projectId,
      "updated_at",
      "list delivery policies",
    );
  const saveMergeReadinessAssessment: ProjectionDeliveryRepositoryShape["saveMergeReadinessAssessment"] =
    (entity) => saveRecord(tables.assessment, entity, "save merge readiness assessment");
  const getMergeReadinessAssessment: ProjectionDeliveryRepositoryShape["getMergeReadinessAssessment"] =
    (id) =>
      getRecord(tables.assessment, MergeReadinessAssessment, id, "get merge readiness assessment");
  const listMergeReadinessAssessments: ProjectionDeliveryRepositoryShape["listMergeReadinessAssessments"] =
    (projectId) =>
      listRecords(
        tables.assessment,
        MergeReadinessAssessment,
        "project_id",
        projectId,
        "observed_at",
        "list merge readiness assessments",
      );
  const saveApprovalRequest: ProjectionDeliveryRepositoryShape["saveApprovalRequest"] = (entity) =>
    saveRecord(tables.approvalRequest, entity, "save approval request");
  const getApprovalRequest: ProjectionDeliveryRepositoryShape["getApprovalRequest"] = (id) =>
    getRecord(tables.approvalRequest, ApprovalRequest, id, "get approval request");
  const listApprovalRequests: ProjectionDeliveryRepositoryShape["listApprovalRequests"] = (
    projectId,
  ) =>
    listRecords(
      tables.approvalRequest,
      ApprovalRequest,
      "project_id",
      projectId,
      "requested_at",
      "list approval requests",
    );
  const listApprovalDecisions: ProjectionDeliveryRepositoryShape["listApprovalDecisions"] = (
    requestId,
  ) =>
    listRecords(
      tables.approvalDecision,
      ApprovalDecision,
      "approval_request_id",
      requestId,
      "decided_at",
      "list approval decisions",
    );
  const saveMergeExecution: ProjectionDeliveryRepositoryShape["saveMergeExecution"] = (entity) =>
    saveRecord(tables.mergeExecution, entity, "save merge execution");
  const getMergeExecution: ProjectionDeliveryRepositoryShape["getMergeExecution"] = (id) =>
    getRecord(tables.mergeExecution, MergeExecution, id, "get merge execution");
  const listMergeExecutions: ProjectionDeliveryRepositoryShape["listMergeExecutions"] = (
    projectId,
  ) =>
    listRecords(
      tables.mergeExecution,
      MergeExecution,
      "project_id",
      projectId,
      "created_at",
      "list merge executions",
    );
  const listRecoverableMergeExecutions = () =>
    listRecoverable(
      tables.mergeExecution,
      MergeExecution,
      ["queued", "preparing", "running", "interrupted", "indeterminate"],
      "created_at",
      "list recoverable merge executions",
    );
  const saveReleaseConfiguration: ProjectionDeliveryRepositoryShape["saveReleaseConfiguration"] = (
    entity,
  ) => saveRecord(tables.releaseConfiguration, entity, "save release configuration");
  const getReleaseConfiguration: ProjectionDeliveryRepositoryShape["getReleaseConfiguration"] = (
    id,
  ) =>
    getRecord(tables.releaseConfiguration, ReleaseConfiguration, id, "get release configuration");
  const listReleaseConfigurations: ProjectionDeliveryRepositoryShape["listReleaseConfigurations"] =
    (projectId) =>
      listRecords(
        tables.releaseConfiguration,
        ReleaseConfiguration,
        "project_id",
        projectId,
        "updated_at",
        "list release configurations",
      );
  const saveReleasePlan: ProjectionDeliveryRepositoryShape["saveReleasePlan"] = (entity) =>
    saveRecord(tables.releasePlan, entity, "save release plan");
  const getReleasePlan: ProjectionDeliveryRepositoryShape["getReleasePlan"] = (id) =>
    getRecord(tables.releasePlan, ReleasePlan, id, "get release plan");
  const listReleasePlans: ProjectionDeliveryRepositoryShape["listReleasePlans"] = (projectId) =>
    listRecords(
      tables.releasePlan,
      ReleasePlan,
      "project_id",
      projectId,
      "created_at",
      "list release plans",
    );
  const listRecoverableReleasePlans = () =>
    listRecoverable(
      tables.releasePlan,
      ReleasePlan,
      ["executing"],
      "updated_at",
      "list recoverable release plans",
    );
  const saveReleaseArtifact: ProjectionDeliveryRepositoryShape["saveReleaseArtifact"] = (entity) =>
    saveRecord(tables.releaseArtifact, entity, "save release artifact");
  const getReleaseArtifact: ProjectionDeliveryRepositoryShape["getReleaseArtifact"] = (id) =>
    getRecord(tables.releaseArtifact, ReleaseArtifact, id, "get release artifact");
  const listReleaseArtifacts: ProjectionDeliveryRepositoryShape["listReleaseArtifacts"] = (
    planId,
  ) =>
    listRecords(
      tables.releaseArtifact,
      ReleaseArtifact,
      "release_plan_id",
      planId,
      "created_at",
      "list release artifacts",
    );
  const saveDeploymentEnvironment: ProjectionDeliveryRepositoryShape["saveDeploymentEnvironment"] =
    (entity) => saveRecord(tables.environment, entity, "save deployment environment");
  const getDeploymentEnvironment: ProjectionDeliveryRepositoryShape["getDeploymentEnvironment"] = (
    id,
  ) => getRecord(tables.environment, DeploymentEnvironment, id, "get deployment environment");
  const listDeploymentEnvironments: ProjectionDeliveryRepositoryShape["listDeploymentEnvironments"] =
    (projectId) =>
      listRecords(
        tables.environment,
        DeploymentEnvironment,
        "project_id",
        projectId,
        "updated_at",
        "list deployment environments",
      );
  const saveDeploymentPlan: ProjectionDeliveryRepositoryShape["saveDeploymentPlan"] = (entity) =>
    saveRecord(tables.deploymentPlan, entity, "save deployment plan");
  const getDeploymentPlan: ProjectionDeliveryRepositoryShape["getDeploymentPlan"] = (id) =>
    getRecord(tables.deploymentPlan, DeploymentPlan, id, "get deployment plan");
  const listDeploymentPlans: ProjectionDeliveryRepositoryShape["listDeploymentPlans"] = (
    projectId,
  ) =>
    listRecords(
      tables.deploymentPlan,
      DeploymentPlan,
      "project_id",
      projectId,
      "created_at",
      "list deployment plans",
    );
  const listRecoverableDeploymentPlans = () =>
    listRecoverable(
      tables.deploymentPlan,
      DeploymentPlan,
      ["pending_approval", "approved", "executing", "interrupted"],
      "updated_at",
      "list recoverable deployment plans",
    );
  const saveDeploymentExecution: ProjectionDeliveryRepositoryShape["saveDeploymentExecution"] = (
    entity,
  ) => saveRecord(tables.deploymentExecution, entity, "save deployment execution");
  const getDeploymentExecution: ProjectionDeliveryRepositoryShape["getDeploymentExecution"] = (
    id,
  ) => getRecord(tables.deploymentExecution, DeploymentExecution, id, "get deployment execution");
  const listDeploymentExecutions: ProjectionDeliveryRepositoryShape["listDeploymentExecutions"] = (
    planId,
  ) =>
    listRecords(
      tables.deploymentExecution,
      DeploymentExecution,
      "deployment_plan_id",
      planId,
      "created_at",
      "list deployment executions",
    );
  const listRecoverableDeploymentExecutions = () =>
    listRecoverable(
      tables.deploymentExecution,
      DeploymentExecution,
      ["queued", "preparing", "running", "validating", "interrupted", "indeterminate"],
      "created_at",
      "list recoverable deployment executions",
    );
  const saveDeploymentValidationRun: ProjectionDeliveryRepositoryShape["saveDeploymentValidationRun"] =
    (entity) => saveRecord(tables.validationRun, entity, "save deployment validation run");
  const getDeploymentValidationRun: ProjectionDeliveryRepositoryShape["getDeploymentValidationRun"] =
    (id) =>
      getRecord(tables.validationRun, DeploymentValidationRun, id, "get deployment validation run");
  const listDeploymentValidationRuns: ProjectionDeliveryRepositoryShape["listDeploymentValidationRuns"] =
    (executionId) =>
      listRecords(
        tables.validationRun,
        DeploymentValidationRun,
        "deployment_execution_id",
        executionId,
        "created_at",
        "list deployment validation runs",
      );
  const listRecoverableDeploymentValidationRuns = () =>
    listRecoverable(
      tables.validationRun,
      DeploymentValidationRun,
      ["pending", "running", "interrupted"],
      "created_at",
      "list recoverable deployment validation runs",
    );
  const saveRollbackPlan: ProjectionDeliveryRepositoryShape["saveRollbackPlan"] = (entity) =>
    saveRecord(tables.rollbackPlan, entity, "save rollback plan");
  const getRollbackPlan: ProjectionDeliveryRepositoryShape["getRollbackPlan"] = (id) =>
    getRecord(tables.rollbackPlan, RollbackPlan, id, "get rollback plan");
  const listRollbackPlans: ProjectionDeliveryRepositoryShape["listRollbackPlans"] = (projectId) =>
    listRecords(
      tables.rollbackPlan,
      RollbackPlan,
      "project_id",
      projectId,
      "created_at",
      "list rollback plans",
    );
  const listRecoverableRollbackPlans = () =>
    listRecoverable(
      tables.rollbackPlan,
      RollbackPlan,
      ["pending_approval", "approved", "executing", "interrupted"],
      "updated_at",
      "list recoverable rollback plans",
    );
  const saveRollbackExecution: ProjectionDeliveryRepositoryShape["saveRollbackExecution"] = (
    entity,
  ) => saveRecord(tables.rollbackExecution, entity, "save rollback execution");
  const getRollbackExecution: ProjectionDeliveryRepositoryShape["getRollbackExecution"] = (id) =>
    getRecord(tables.rollbackExecution, RollbackExecution, id, "get rollback execution");
  const listRollbackExecutions: ProjectionDeliveryRepositoryShape["listRollbackExecutions"] = (
    planId,
  ) =>
    listRecords(
      tables.rollbackExecution,
      RollbackExecution,
      "rollback_plan_id",
      planId,
      "created_at",
      "list rollback executions",
    );
  const listRecoverableRollbackExecutions = () =>
    listRecoverable(
      tables.rollbackExecution,
      RollbackExecution,
      ["queued", "preparing", "running", "validating", "interrupted", "indeterminate"],
      "created_at",
      "list recoverable rollback executions",
    );
  const appendAuditEntry: ProjectionDeliveryRepositoryShape["appendAuditEntry"] = (entity) =>
    saveRecord(tables.auditEntry, entity, "append delivery audit entry");
  const getAuditEntry: ProjectionDeliveryRepositoryShape["getAuditEntry"] = (id) =>
    getRecord(tables.auditEntry, DeliveryAuditEntry, id, "get delivery audit entry");
  const listAuditEntries: ProjectionDeliveryRepositoryShape["listAuditEntries"] = (projectId) =>
    listRecords(
      tables.auditEntry,
      DeliveryAuditEntry,
      "project_id",
      projectId,
      "occurred_at",
      "list delivery audit entries",
    );

  const recordApprovalDecision: ProjectionDeliveryRepositoryShape["recordApprovalDecision"] =
    Effect.fn("ProjectionDelivery.recordApprovalDecision")(function* (decision) {
      const effect = Effect.gen(function* () {
        const existing = yield* getRecord(
          tables.approvalDecision,
          ApprovalDecision,
          decision.id,
          "get existing approval decision",
        );
        if (Option.isNone(existing)) {
          yield* saveRecord(tables.approvalDecision, decision, "insert approval decision");
          const rejected = decision.decision !== "approve";
          yield* sql`
          UPDATE projection_delivery_approval_requests
          SET status = CASE
                WHEN ${rejected ? 1 : 0} = 1 THEN 'rejected'
                WHEN (SELECT COUNT(*) FROM projection_delivery_approval_decisions
                      WHERE approval_request_id = ${decision.approvalRequestId} AND decision = 'approve') >= required_decision_count
                  THEN 'approved'
                ELSE status
              END,
              resolved_at = CASE
                WHEN ${rejected ? 1 : 0} = 1 OR
                     (SELECT COUNT(*) FROM projection_delivery_approval_decisions
                      WHERE approval_request_id = ${decision.approvalRequestId} AND decision = 'approve') >= required_decision_count
                  THEN ${decision.decidedAt}
                ELSE resolved_at
              END,
              record_json = json_set(
                record_json,
                '$.status', CASE
                  WHEN ${rejected ? 1 : 0} = 1 THEN 'rejected'
                  WHEN (SELECT COUNT(*) FROM projection_delivery_approval_decisions
                        WHERE approval_request_id = ${decision.approvalRequestId} AND decision = 'approve') >= required_decision_count
                    THEN 'approved'
                  ELSE status
                END,
                '$.resolvedAt', CASE
                  WHEN ${rejected ? 1 : 0} = 1 OR
                       (SELECT COUNT(*) FROM projection_delivery_approval_decisions
                        WHERE approval_request_id = ${decision.approvalRequestId} AND decision = 'approve') >= required_decision_count
                    THEN ${decision.decidedAt}
                  ELSE resolved_at
                END
              )
          WHERE approval_request_id = ${decision.approvalRequestId} AND status = 'pending'
        `;
        } else if (
          existing.value.approvalRequestId !== decision.approvalRequestId ||
          existing.value.actorId !== decision.actorId ||
          existing.value.actorType !== decision.actorType ||
          existing.value.decision !== decision.decision ||
          existing.value.reason !== decision.reason ||
          existing.value.planDigest !== decision.planDigest ||
          existing.value.sourceCommit !== decision.sourceCommit ||
          existing.value.decidedAt !== decision.decidedAt
        ) {
          return yield* toPersistenceSqlError("record approval decision")(
            new Error("approval decision id already belongs to different immutable evidence"),
          );
        }
        const request = yield* getRecord(
          tables.approvalRequest,
          ApprovalRequest,
          decision.approvalRequestId,
          "get decided approval request",
        );
        if (Option.isNone(request)) {
          return yield* toPersistenceSqlError("record approval decision")(
            new Error("approval request not found"),
          );
        }
        const decisions = yield* listRecords(
          tables.approvalDecision,
          ApprovalDecision,
          "approval_request_id",
          decision.approvalRequestId,
          "decided_at",
          "list decided approval decisions",
        );
        return { request: request.value, decisions };
      });
      return yield* sql
        .withTransaction(effect)
        .pipe(sqlError("record approval decision transaction"));
    });

  const projectRows = <A>(
    schema: Schema.Codec<A, unknown, never, never>,
    query: Effect.Effect<ReadonlyArray<StoredRow>, SqlError.SqlError>,
    operation: string,
  ) => readMany(schema, query, operation);
  const getWorkspaceSnapshot: ProjectionDeliveryRepositoryShape["getWorkspaceSnapshot"] = Effect.fn(
    "ProjectionDelivery.getWorkspaceSnapshot",
  )(function* (projectId: ProjectId) {
    const policies = yield* listPolicies(projectId);
    const mergeReadinessAssessments = yield* listMergeReadinessAssessments(projectId);
    const approvalRequests = yield* listApprovalRequests(projectId);
    const approvalDecisions = yield* projectRows(
      ApprovalDecision,
      sql<StoredRow>`SELECT decision.record_json AS recordJson FROM projection_delivery_approval_decisions decision JOIN projection_delivery_approval_requests request ON request.approval_request_id = decision.approval_request_id WHERE request.project_id = ${projectId} ORDER BY decision.decided_at DESC`,
      "list workspace approval decisions",
    );
    const mergeExecutions = yield* listMergeExecutions(projectId);
    const releaseConfigurations = yield* listReleaseConfigurations(projectId);
    const releasePlans = yield* listReleasePlans(projectId);
    const releaseArtifacts = yield* projectRows(
      ReleaseArtifact,
      sql<StoredRow>`SELECT artifact.record_json AS recordJson FROM projection_delivery_release_artifacts artifact JOIN projection_delivery_release_plans plan ON plan.release_plan_id = artifact.release_plan_id WHERE plan.project_id = ${projectId} ORDER BY artifact.created_at DESC`,
      "list workspace release artifacts",
    );
    const deploymentEnvironments = yield* listDeploymentEnvironments(projectId);
    const deploymentPlans = yield* listDeploymentPlans(projectId);
    const deploymentExecutions = yield* projectRows(
      DeploymentExecution,
      sql<StoredRow>`SELECT execution.record_json AS recordJson FROM projection_delivery_deployment_executions execution JOIN projection_delivery_deployment_plans plan ON plan.deployment_plan_id = execution.deployment_plan_id WHERE plan.project_id = ${projectId} ORDER BY execution.created_at DESC`,
      "list workspace deployment executions",
    );
    const deploymentValidationRuns = yield* projectRows(
      DeploymentValidationRun,
      sql<StoredRow>`SELECT validation.record_json AS recordJson FROM projection_delivery_validation_runs validation JOIN projection_delivery_deployment_executions execution ON execution.deployment_execution_id = validation.deployment_execution_id JOIN projection_delivery_deployment_plans plan ON plan.deployment_plan_id = execution.deployment_plan_id WHERE plan.project_id = ${projectId} ORDER BY validation.created_at DESC`,
      "list workspace deployment validation runs",
    );
    const rollbackPlans = yield* listRollbackPlans(projectId);
    const rollbackExecutions = yield* projectRows(
      RollbackExecution,
      sql<StoredRow>`SELECT execution.record_json AS recordJson FROM projection_delivery_rollback_executions execution JOIN projection_delivery_rollback_plans plan ON plan.rollback_plan_id = execution.rollback_plan_id WHERE plan.project_id = ${projectId} ORDER BY execution.created_at DESC`,
      "list workspace rollback executions",
    );
    const auditEntries = yield* listAuditEntries(projectId);
    return {
      projectId,
      policies,
      mergeReadinessAssessments,
      approvalRequests,
      approvalDecisions,
      mergeExecutions,
      releaseConfigurations,
      releasePlans,
      releaseArtifacts,
      deploymentEnvironments,
      deploymentPlans,
      deploymentExecutions,
      deploymentValidationRuns,
      rollbackPlans,
      rollbackExecutions,
      auditEntries,
      capturedAt: DateTime.formatIso(yield* DateTime.now),
    };
  });

  return {
    savePolicy,
    getPolicy,
    listPolicies,
    saveMergeReadinessAssessment,
    getMergeReadinessAssessment,
    listMergeReadinessAssessments,
    saveApprovalRequest,
    getApprovalRequest,
    listApprovalRequests,
    listApprovalDecisions,
    recordApprovalDecision,
    saveMergeExecution,
    getMergeExecution,
    listMergeExecutions,
    listRecoverableMergeExecutions,
    saveReleaseConfiguration,
    getReleaseConfiguration,
    listReleaseConfigurations,
    saveReleasePlan,
    getReleasePlan,
    listReleasePlans,
    listRecoverableReleasePlans,
    saveReleaseArtifact,
    getReleaseArtifact,
    listReleaseArtifacts,
    saveDeploymentEnvironment,
    getDeploymentEnvironment,
    listDeploymentEnvironments,
    saveDeploymentPlan,
    getDeploymentPlan,
    listDeploymentPlans,
    listRecoverableDeploymentPlans,
    saveDeploymentExecution,
    getDeploymentExecution,
    listDeploymentExecutions,
    listRecoverableDeploymentExecutions,
    saveDeploymentValidationRun,
    getDeploymentValidationRun,
    listDeploymentValidationRuns,
    listRecoverableDeploymentValidationRuns,
    saveRollbackPlan,
    getRollbackPlan,
    listRollbackPlans,
    listRecoverableRollbackPlans,
    saveRollbackExecution,
    getRollbackExecution,
    listRollbackExecutions,
    listRecoverableRollbackExecutions,
    appendAuditEntry,
    getAuditEntry,
    listAuditEntries,
    getWorkspaceSnapshot,
  } satisfies ProjectionDeliveryRepositoryShape;
});

export const ProjectionDeliveryRepositoryLive = Layer.effect(ProjectionDeliveryRepository, make);
