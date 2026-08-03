import {
  VerificationEnvironmentReference,
  VerificationPlatform,
  VerificationTriggerMode,
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
  GetVerificationCheckDefinitionInput,
  GetVerificationGateInput,
  GetVerificationProfileInput,
  GetVerificationProjectSettingsInput,
  ListVerificationCheckDefinitionsInput,
  ListVerificationGatesInput,
  ListVerificationProfilesInput,
  ProjectionVerificationCheckDefinition,
  ProjectionVerificationConfigurationRepository,
  type ProjectionVerificationConfigurationRepositoryShape,
  ProjectionVerificationGate,
  ProjectionVerificationProfile,
  ProjectionVerificationProjectSettings,
} from "../Services/ProjectionVerificationConfiguration.ts";

const SettingsDbRow = ProjectionVerificationProjectSettings.mapFields(
  Struct.assign({
    automaticTaskVerificationEnabled: Schema.Number,
    automaticRepairEnabled: Schema.Number,
  }),
);
const ProfileDbRow = ProjectionVerificationProfile.mapFields(
  Struct.assign({
    isDefault: Schema.Number,
    triggerModes: Schema.fromJsonString(Schema.Array(VerificationTriggerMode)),
  }),
);
const GateDbRow = ProjectionVerificationGate.mapFields(
  Struct.assign({ required: Schema.Number, enabled: Schema.Number }),
);
const CheckDefinitionDbRow = ProjectionVerificationCheckDefinition.mapFields(
  Struct.assign({
    arguments: Schema.fromJsonString(Schema.Array(Schema.String)),
    requiresShell: Schema.Number,
    environmentOverrides: Schema.fromJsonString(Schema.Array(VerificationEnvironmentReference)),
    allowedExitCodes: Schema.fromJsonString(Schema.Array(Schema.Int)),
    continueOnFailure: Schema.Number,
    applicableFilePatterns: Schema.fromJsonString(Schema.Array(Schema.String)),
    excludedFilePatterns: Schema.fromJsonString(Schema.Array(Schema.String)),
    platforms: Schema.fromJsonString(Schema.Array(VerificationPlatform)),
    artifactPatterns: Schema.fromJsonString(Schema.Array(Schema.String)),
  }),
);

const toSettings = (row: typeof SettingsDbRow.Type): ProjectionVerificationProjectSettings => ({
  ...row,
  automaticTaskVerificationEnabled: row.automaticTaskVerificationEnabled === 1,
  automaticRepairEnabled: row.automaticRepairEnabled === 1,
});
const toProfile = (row: typeof ProfileDbRow.Type): ProjectionVerificationProfile => ({
  ...row,
  isDefault: row.isDefault === 1,
});
const toGate = (row: typeof GateDbRow.Type): ProjectionVerificationGate => ({
  ...row,
  required: row.required === 1,
  enabled: row.enabled === 1,
});
const toCheckDefinition = (
  row: typeof CheckDefinitionDbRow.Type,
): ProjectionVerificationCheckDefinition => ({
  ...row,
  requiresShell: row.requiresShell === 1,
  continueOnFailure: row.continueOnFailure === 1,
});

const settingsColumns = `
  project_id AS "projectId",
  configuration_path AS "configurationPath",
  configuration_source AS "configurationSource",
  accepted_configuration_digest AS "acceptedConfigurationDigest",
  accepted_at AS "acceptedAt",
  accepted_by AS "acceptedBy",
  default_profile_id AS "defaultProfileId",
  pre_integration_profile_id AS "preIntegrationProfileId",
  automatic_task_verification_enabled AS "automaticTaskVerificationEnabled",
  maximum_repair_attempts AS "maximumRepairAttempts",
  automatic_repair_enabled AS "automaticRepairEnabled",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const profileColumns = `
  verification_profile_id AS "id",
  project_id AS "projectId",
  name,
  description,
  is_default AS "isDefault",
  trigger_modes_json AS "triggerModes",
  configuration_revision AS "configurationRevision",
  configuration_digest AS "configurationDigest",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const gateColumns = `
  verification_gate_id AS "id",
  profile_id AS "profileId",
  name,
  description,
  category,
  position,
  required,
  enabled,
  execution_mode AS "executionMode",
  failure_policy AS "failurePolicy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const checkColumns = `
  verification_check_definition_id AS "id",
  gate_id AS "gateId",
  name,
  command,
  arguments_json AS "arguments",
  requires_shell AS "requiresShell",
  working_directory AS "workingDirectory",
  environment_overrides_json AS "environmentOverrides",
  timeout_seconds AS "timeoutSeconds",
  allowed_exit_codes_json AS "allowedExitCodes",
  continue_on_failure AS "continueOnFailure",
  applicable_file_patterns_json AS "applicableFilePatterns",
  excluded_file_patterns_json AS "excludedFilePatterns",
  platforms_json AS "platforms",
  artifact_patterns_json AS "artifactPatterns",
  diagnostic_parser AS "diagnosticParser",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));

  const upsertSettingsRow = SqlSchema.void({
    Request: ProjectionVerificationProjectSettings,
    execute: (row) => sql`
      INSERT INTO projection_project_verification_settings (
        project_id, configuration_path, configuration_source, accepted_configuration_digest,
        accepted_at, accepted_by, default_profile_id, pre_integration_profile_id,
        automatic_task_verification_enabled, maximum_repair_attempts, automatic_repair_enabled,
        created_at, updated_at
      ) VALUES (
        ${row.projectId}, ${row.configurationPath}, ${row.configurationSource},
        ${row.acceptedConfigurationDigest}, ${row.acceptedAt}, ${row.acceptedBy},
        ${row.defaultProfileId}, ${row.preIntegrationProfileId},
        ${row.automaticTaskVerificationEnabled ? 1 : 0}, ${row.maximumRepairAttempts},
        ${row.automaticRepairEnabled ? 1 : 0}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (project_id) DO UPDATE SET
        configuration_path = excluded.configuration_path,
        configuration_source = excluded.configuration_source,
        accepted_configuration_digest = excluded.accepted_configuration_digest,
        accepted_at = excluded.accepted_at,
        accepted_by = excluded.accepted_by,
        default_profile_id = excluded.default_profile_id,
        pre_integration_profile_id = excluded.pre_integration_profile_id,
        automatic_task_verification_enabled = excluded.automatic_task_verification_enabled,
        maximum_repair_attempts = excluded.maximum_repair_attempts,
        automatic_repair_enabled = excluded.automatic_repair_enabled,
        updated_at = excluded.updated_at
    `,
  });
  const getSettingsRow = SqlSchema.findOneOption({
    Request: GetVerificationProjectSettingsInput,
    Result: SettingsDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${sql.unsafe(settingsColumns)}
      FROM projection_project_verification_settings
      WHERE project_id = ${projectId}
    `,
  });
  const upsertProfileRow = SqlSchema.void({
    Request: ProjectionVerificationProfile,
    execute: (row) => sql`
      INSERT INTO projection_verification_profiles (
        verification_profile_id, project_id, name, description, is_default, trigger_modes_json,
        configuration_revision, configuration_digest, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.projectId}, ${row.name}, ${row.description}, ${row.isDefault ? 1 : 0},
        ${JSON.stringify(row.triggerModes)}, ${row.configurationRevision},
        ${row.configurationDigest}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (verification_profile_id) DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        description = excluded.description,
        is_default = excluded.is_default,
        trigger_modes_json = excluded.trigger_modes_json,
        configuration_revision = excluded.configuration_revision,
        configuration_digest = excluded.configuration_digest,
        updated_at = excluded.updated_at
    `,
  });
  const getProfileRow = SqlSchema.findOneOption({
    Request: GetVerificationProfileInput,
    Result: ProfileDbRow,
    execute: ({ profileId }) => sql`
      SELECT ${sql.unsafe(profileColumns)} FROM projection_verification_profiles
      WHERE verification_profile_id = ${profileId}
    `,
  });
  const listProfileRows = SqlSchema.findAll({
    Request: ListVerificationProfilesInput,
    Result: ProfileDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${sql.unsafe(profileColumns)} FROM projection_verification_profiles
      WHERE project_id = ${projectId}
      ORDER BY is_default DESC, name ASC, verification_profile_id ASC
    `,
  });
  const upsertGateRow = SqlSchema.void({
    Request: ProjectionVerificationGate,
    execute: (row) => sql`
      INSERT INTO projection_verification_gates (
        verification_gate_id, profile_id, name, description, category, position, required,
        enabled, execution_mode, failure_policy, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.profileId}, ${row.name}, ${row.description}, ${row.category},
        ${row.position}, ${row.required ? 1 : 0}, ${row.enabled ? 1 : 0},
        ${row.executionMode}, ${row.failurePolicy}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (verification_gate_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        position = excluded.position,
        required = excluded.required,
        enabled = excluded.enabled,
        execution_mode = excluded.execution_mode,
        failure_policy = excluded.failure_policy,
        updated_at = excluded.updated_at
    `,
  });
  const getGateRow = SqlSchema.findOneOption({
    Request: GetVerificationGateInput,
    Result: GateDbRow,
    execute: ({ gateId }) => sql`
      SELECT ${sql.unsafe(gateColumns)} FROM projection_verification_gates
      WHERE verification_gate_id = ${gateId}
    `,
  });
  const listGateRows = SqlSchema.findAll({
    Request: ListVerificationGatesInput,
    Result: GateDbRow,
    execute: ({ profileId }) => sql`
      SELECT ${sql.unsafe(gateColumns)} FROM projection_verification_gates
      WHERE profile_id = ${profileId}
      ORDER BY position ASC, verification_gate_id ASC
    `,
  });
  const upsertCheckRow = SqlSchema.void({
    Request: ProjectionVerificationCheckDefinition,
    execute: (row) => sql`
      INSERT INTO projection_verification_check_definitions (
        verification_check_definition_id, gate_id, name, command, arguments_json,
        requires_shell, working_directory, environment_overrides_json, timeout_seconds,
        allowed_exit_codes_json, continue_on_failure, applicable_file_patterns_json,
        excluded_file_patterns_json, platforms_json, artifact_patterns_json, diagnostic_parser,
        created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.gateId}, ${row.name}, ${row.command}, ${JSON.stringify(row.arguments)},
        ${row.requiresShell ? 1 : 0}, ${row.workingDirectory},
        ${JSON.stringify(row.environmentOverrides)}, ${row.timeoutSeconds},
        ${JSON.stringify(row.allowedExitCodes)}, ${row.continueOnFailure ? 1 : 0},
        ${JSON.stringify(row.applicableFilePatterns)}, ${JSON.stringify(row.excludedFilePatterns)},
        ${JSON.stringify(row.platforms)}, ${JSON.stringify(row.artifactPatterns)},
        ${row.diagnosticParser}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (verification_check_definition_id) DO UPDATE SET
        gate_id = excluded.gate_id,
        name = excluded.name,
        command = excluded.command,
        arguments_json = excluded.arguments_json,
        requires_shell = excluded.requires_shell,
        working_directory = excluded.working_directory,
        environment_overrides_json = excluded.environment_overrides_json,
        timeout_seconds = excluded.timeout_seconds,
        allowed_exit_codes_json = excluded.allowed_exit_codes_json,
        continue_on_failure = excluded.continue_on_failure,
        applicable_file_patterns_json = excluded.applicable_file_patterns_json,
        excluded_file_patterns_json = excluded.excluded_file_patterns_json,
        platforms_json = excluded.platforms_json,
        artifact_patterns_json = excluded.artifact_patterns_json,
        diagnostic_parser = excluded.diagnostic_parser,
        updated_at = excluded.updated_at
    `,
  });
  const getCheckRow = SqlSchema.findOneOption({
    Request: GetVerificationCheckDefinitionInput,
    Result: CheckDefinitionDbRow,
    execute: ({ checkDefinitionId }) => sql`
      SELECT ${sql.unsafe(checkColumns)} FROM projection_verification_check_definitions
      WHERE verification_check_definition_id = ${checkDefinitionId}
    `,
  });
  const listCheckRows = SqlSchema.findAll({
    Request: ListVerificationCheckDefinitionsInput,
    Result: CheckDefinitionDbRow,
    execute: ({ gateId }) => sql`
      SELECT ${sql.unsafe(checkColumns)} FROM projection_verification_check_definitions
      WHERE gate_id = ${gateId}
      ORDER BY created_at ASC, verification_check_definition_id ASC
    `,
  });

  const upsertProfile = (row: ProjectionVerificationProfile) =>
    upsertProfileRow(row).pipe(sqlError("VerificationConfiguration.upsertProfile"));
  const upsertGate = (row: ProjectionVerificationGate) =>
    upsertGateRow(row).pipe(sqlError("VerificationConfiguration.upsertGate"));
  const upsertCheckDefinition = (row: ProjectionVerificationCheckDefinition) =>
    upsertCheckRow(row).pipe(sqlError("VerificationConfiguration.upsertCheckDefinition"));

  const saveProfileGraph: ProjectionVerificationConfigurationRepositoryShape["saveProfileGraph"] = (
    input,
  ) => {
    const gateIds = new Set(input.gates.map((gate) => gate.id));
    const invalidGate = input.gates.find((gate) => gate.profileId !== input.profile.id);
    const invalidCheck = input.checks.find((check) => !gateIds.has(check.gateId));
    if (invalidGate !== undefined || invalidCheck !== undefined) {
      return Effect.fail(
        new VerificationProjectionValidationError({
          operation: "VerificationConfiguration.saveProfileGraph",
          issue:
            invalidGate !== undefined
              ? `gate ${invalidGate.id} belongs to another profile`
              : `check ${invalidCheck!.id} refers to a gate outside the profile graph`,
        }),
      );
    }
    return sql
      .withTransaction(
        Effect.gen(function* () {
          yield* upsertProfile(input.profile);
          yield* Effect.forEach(input.gates, upsertGate, { concurrency: 1, discard: true });
          yield* Effect.forEach(input.checks, upsertCheckDefinition, {
            concurrency: 1,
            discard: true,
          });
        }),
      )
      .pipe(sqlError("VerificationConfiguration.saveProfileGraph:transaction"));
  };

  return {
    upsertProjectSettings: (row) =>
      upsertSettingsRow(row).pipe(sqlError("VerificationConfiguration.upsertProjectSettings")),
    getProjectSettings: (input) =>
      getSettingsRow(input).pipe(
        Effect.map(Option.map(toSettings)),
        sqlError("VerificationConfiguration.getProjectSettings"),
      ),
    upsertProfile,
    getProfileById: (input) =>
      getProfileRow(input).pipe(
        Effect.map(Option.map(toProfile)),
        sqlError("VerificationConfiguration.getProfileById"),
      ),
    listProfilesByProjectId: (input) =>
      listProfileRows(input).pipe(
        Effect.map((rows) => rows.map(toProfile)),
        sqlError("VerificationConfiguration.listProfilesByProjectId"),
      ),
    upsertGate,
    getGateById: (input) =>
      getGateRow(input).pipe(
        Effect.map(Option.map(toGate)),
        sqlError("VerificationConfiguration.getGateById"),
      ),
    listGatesByProfileId: (input) =>
      listGateRows(input).pipe(
        Effect.map((rows) => rows.map(toGate)),
        sqlError("VerificationConfiguration.listGatesByProfileId"),
      ),
    upsertCheckDefinition,
    getCheckDefinitionById: (input) =>
      getCheckRow(input).pipe(
        Effect.map(Option.map(toCheckDefinition)),
        sqlError("VerificationConfiguration.getCheckDefinitionById"),
      ),
    listCheckDefinitionsByGateId: (input) =>
      listCheckRows(input).pipe(
        Effect.map((rows) => rows.map(toCheckDefinition)),
        sqlError("VerificationConfiguration.listCheckDefinitionsByGateId"),
      ),
    saveProfileGraph,
  } satisfies ProjectionVerificationConfigurationRepositoryShape;
});

export const ProjectionVerificationConfigurationRepositoryLive = Layer.effect(
  ProjectionVerificationConfigurationRepository,
  make,
);
