import {
  AgentRoleRoutingProfile,
  ModelCapabilitySnapshot,
  ModelProfile,
  ProviderHealthRecord,
  ProviderProfile,
  RoutedRunOutcome,
  RoutingCandidateRecord,
  RoutingDecision,
  RoutingOverride,
  RoutingPolicy,
  RoutingRule,
  TaskRoutingAssessment,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ApplyRoutingDecisionInput,
  GetCapabilitySnapshotInput,
  GetLatestCapabilitySnapshotInput,
  GetModelProfileInput,
  GetProviderProfileInput,
  GetRoutedRunOutcomeInput,
  GetRoutingOverrideInput,
  GetRoutingDecisionByRunInput,
  GetRoutingDecisionInput,
  GetRoutingPolicyInput,
  GetTaskAssessmentByIdInput,
  GetTaskAssessmentInput,
  ListCapabilitySnapshotsInput,
  ListCurrentProviderHealthInput,
  ListModelProfilesInput,
  ListRecoverableRoutingDecisionsInput,
  ListRoleRoutingProfilesInput,
  ListRoutingDecisionHistoryInput,
  ListRoutingResolutionInput,
  ListRulesByPolicyIdsInput,
  MarkRoutingDecisionTerminalInput,
  ProjectionRoutingRepository,
  type ProjectionRoutingRepositoryShape,
  RevokeRoutingOverrideInput,
  SupersedeRoutingDecisionInput,
} from "../Services/ProjectionRouting.ts";

const ProviderProfileDbRow = ProviderProfile.mapFields(
  Struct.assign({
    isEnabled: Schema.Number,
    isLocal: Schema.Number,
    supportsModelDiscovery: Schema.Number,
    configurationMetadata: Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const ModelProfileDbRow = ModelProfile.mapFields(
  Struct.assign({
    isEnabled: Schema.Number,
    isDeprecated: Schema.Number,
    discoveredAutomatically: Schema.Number,
  }),
);
const CapabilitySnapshotDbRow = ModelCapabilitySnapshot.mapFields(
  Struct.assign({
    capabilities: Schema.fromJsonString(ModelCapabilitySnapshot.fields.capabilities),
    contextLimits: Schema.fromJsonString(ModelCapabilitySnapshot.fields.contextLimits),
    reasoningOptions: Schema.fromJsonString(ModelCapabilitySnapshot.fields.reasoningOptions),
    toolSupport: Schema.fromJsonString(ModelCapabilitySnapshot.fields.toolSupport),
    modalitySupport: Schema.fromJsonString(ModelCapabilitySnapshot.fields.modalitySupport),
    outputSupport: Schema.fromJsonString(ModelCapabilitySnapshot.fields.outputSupport),
    privacyMetadata: Schema.fromJsonString(ModelCapabilitySnapshot.fields.privacyMetadata),
  }),
);
const PolicyDbRow = RoutingPolicy.mapFields(Struct.assign({ isEnabled: Schema.Number }));
const RuleDbRow = RoutingRule.mapFields(
  Struct.assign({
    isEnabled: Schema.Number,
    conditions: Schema.fromJsonString(RoutingRule.fields.conditions),
    requirements: Schema.fromJsonString(RoutingRule.fields.requirements),
    preferences: Schema.fromJsonString(RoutingRule.fields.preferences),
    result: Schema.fromJsonString(RoutingRule.fields.result),
  }),
);
const RoleProfileDbRow = AgentRoleRoutingProfile.mapFields(
  Struct.assign({
    preferredCapabilities: Schema.fromJsonString(
      AgentRoleRoutingProfile.fields.preferredCapabilities,
    ),
    requiredCapabilities: Schema.fromJsonString(
      AgentRoleRoutingProfile.fields.requiredCapabilities,
    ),
    allowFallback: Schema.Number,
  }),
);
const AssessmentDbRow = TaskRoutingAssessment.mapFields(
  Struct.assign({
    requiredCapabilities: Schema.fromJsonString(TaskRoutingAssessment.fields.requiredCapabilities),
    preferredCapabilities: Schema.fromJsonString(
      TaskRoutingAssessment.fields.preferredCapabilities,
    ),
    writeAccessRequired: Schema.Number,
    visionRequired: Schema.Number,
    structuredOutputRequired: Schema.Number,
  }),
);
const DecisionDbRow = RoutingDecision.mapFields(
  Struct.assign({
    manualProviderPin: Schema.Number,
    manualModelPin: Schema.Number,
    manualReasoningPin: Schema.Number,
    fallbackPlan: Schema.fromJsonString(RoutingDecision.fields.fallbackPlan),
    candidateSummary: Schema.fromJsonString(RoutingDecision.fields.candidateSummary),
    constraintsSnapshot: Schema.fromJsonString(RoutingDecision.fields.constraintsSnapshot),
    policySnapshot: Schema.fromJsonString(RoutingDecision.fields.policySnapshot),
  }),
);
const CandidateDbRow = RoutingCandidateRecord.mapFields(
  Struct.assign({
    eligible: Schema.Number,
    rejectionReasons: Schema.fromJsonString(RoutingCandidateRecord.fields.rejectionReasons),
    preferenceReasons: Schema.fromJsonString(RoutingCandidateRecord.fields.preferenceReasons),
  }),
);
const OutcomeDbRow = RoutedRunOutcome.mapFields(
  Struct.assign({
    fallbackUsed: Schema.Number,
    interrupted: Schema.Number,
    userOverride: Schema.Number,
  }),
);

const toProviderProfile = (row: typeof ProviderProfileDbRow.Type): ProviderProfile => ({
  ...row,
  isEnabled: row.isEnabled === 1,
  isLocal: row.isLocal === 1,
  supportsModelDiscovery: row.supportsModelDiscovery === 1,
});
const toModelProfile = (row: typeof ModelProfileDbRow.Type): ModelProfile => ({
  ...row,
  isEnabled: row.isEnabled === 1,
  isDeprecated: row.isDeprecated === 1,
  discoveredAutomatically: row.discoveredAutomatically === 1,
});
const toPolicy = (row: typeof PolicyDbRow.Type): RoutingPolicy => ({
  ...row,
  isEnabled: row.isEnabled === 1,
});
const toRule = (row: typeof RuleDbRow.Type): RoutingRule => ({
  ...row,
  isEnabled: row.isEnabled === 1,
});
const toRoleProfile = (row: typeof RoleProfileDbRow.Type): AgentRoleRoutingProfile => ({
  ...row,
  allowFallback: row.allowFallback === 1,
});
const toAssessment = (row: typeof AssessmentDbRow.Type): TaskRoutingAssessment => ({
  ...row,
  writeAccessRequired: row.writeAccessRequired === 1,
  visionRequired: row.visionRequired === 1,
  structuredOutputRequired: row.structuredOutputRequired === 1,
});
const toDecision = (row: typeof DecisionDbRow.Type): RoutingDecision => ({
  ...row,
  manualProviderPin: row.manualProviderPin === 1,
  manualModelPin: row.manualModelPin === 1,
  manualReasoningPin: row.manualReasoningPin === 1,
});
const toCandidate = (row: typeof CandidateDbRow.Type): RoutingCandidateRecord => ({
  ...row,
  eligible: row.eligible === 1,
});
const toOutcome = (row: typeof OutcomeDbRow.Type): RoutedRunOutcome => ({
  ...row,
  fallbackUsed: row.fallbackUsed === 1,
  interrupted: row.interrupted === 1,
  userOverride: row.userOverride === 1,
});

const providerColumns = `
  provider_profile_id AS "id", provider_type AS "providerType", display_name AS "displayName",
  account_reference AS "accountReference", endpoint_class AS "endpointClass", status,
  is_enabled AS "isEnabled", is_local AS "isLocal",
  supports_model_discovery AS "supportsModelDiscovery",
  configuration_metadata_json AS "configurationMetadata", created_at AS "createdAt",
  updated_at AS "updatedAt", last_validated_at AS "lastValidatedAt"
`;
const modelColumns = `
  model_profile_id AS "id", provider_profile_id AS "providerProfileId",
  provider_model_id AS "providerModelId", display_name AS "displayName", family, version,
  release_channel AS "releaseChannel", status, is_enabled AS "isEnabled",
  is_deprecated AS "isDeprecated", discovered_automatically AS "discoveredAutomatically",
  maximum_concurrent_sessions AS "maximumConcurrentSessions",
  created_at AS "createdAt", updated_at AS "updatedAt", last_discovered_at AS "lastDiscoveredAt"
`;
const capabilityColumns = `
  capability_snapshot_id AS "id", model_profile_id AS "modelProfileId",
  snapshot_version AS "snapshotVersion", source, capabilities_json AS "capabilities",
  context_limits_json AS "contextLimits", reasoning_options_json AS "reasoningOptions",
  tool_support_json AS "toolSupport", modality_support_json AS "modalitySupport",
  output_support_json AS "outputSupport", privacy_metadata_json AS "privacyMetadata",
  captured_at AS "capturedAt", expires_at AS "expiresAt"
`;
const policyColumns = `
  routing_policy_id AS "id", scope_type AS "scopeType", scope_id AS "scopeId", name,
  description, priority, is_enabled AS "isEnabled",
  default_provider_profile_id AS "defaultProviderProfileId",
  default_model_profile_id AS "defaultModelProfileId",
  default_reasoning_level AS "defaultReasoningLevel", fallback_mode AS "fallbackMode",
  privacy_mode AS "privacyMode", budget_mode AS "budgetMode", created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const ruleColumns = `
  routing_rule_id AS "id", routing_policy_id AS "routingPolicyId", name, description,
  priority, is_enabled AS "isEnabled", conditions_json AS "conditions",
  requirements_json AS "requirements", preferences_json AS "preferences",
  result_json AS "result", created_at AS "createdAt", updated_at AS "updatedAt"
`;
const roleProfileColumns = `
  agent_role_routing_profile_id AS "id", project_id AS "projectId", role_kind AS "roleKind",
  routing_policy_id AS "routingPolicyId", preferred_capabilities_json AS "preferredCapabilities",
  required_capabilities_json AS "requiredCapabilities",
  default_reasoning_level AS "defaultReasoningLevel", allow_fallback AS "allowFallback",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;
const healthColumns = `
  provider_health_record_id AS "id", provider_profile_id AS "providerProfileId", status,
  latency_milliseconds AS "latencyMilliseconds", rate_limit_state AS "rateLimitState",
  error_category AS "errorCategory", observed_at AS "observedAt", expires_at AS "expiresAt"
`;
const overrideColumns = `
  routing_override_id AS "id", scope_type AS "scopeType", scope_id AS "scopeId",
  provider_profile_id AS "providerProfileId", model_profile_id AS "modelProfileId",
  reasoning_level AS "reasoningLevel", fallback_mode AS "fallbackMode",
  expires_at AS "expiresAt", reason, created_by AS "createdBy", created_at AS "createdAt",
  revoked_at AS "revokedAt"
`;
const assessmentColumns = `
  task_routing_assessment_id AS "id", task_id AS "taskId", agent_role AS "agentRole",
  task_type AS "taskType", complexity, required_capabilities_json AS "requiredCapabilities",
  preferred_capabilities_json AS "preferredCapabilities",
  estimated_context_tokens AS "estimatedContextTokens",
  privacy_classification AS "privacyClassification",
  write_access_required AS "writeAccessRequired", vision_required AS "visionRequired",
  structured_output_required AS "structuredOutputRequired",
  assessment_source AS "assessmentSource", assessment_explanation AS "assessmentExplanation",
  version, created_at AS "createdAt", updated_at AS "updatedAt",
  superseded_by_id AS "supersededById"
`;
const decisionColumns = `
  routing_decision_id AS "id", project_id AS "projectId", mission_id AS "missionId",
  task_id AS "taskId", mission_agent_id AS "missionAgentId", agent_run_id AS "agentRunId",
  assessment_id AS "assessmentId", decision_type AS "decisionType",
  selected_provider_profile_id AS "selectedProviderProfileId",
  selected_model_profile_id AS "selectedModelProfileId",
  selected_capability_snapshot_id AS "selectedCapabilitySnapshotId",
  selected_reasoning_level AS "selectedReasoningLevel",
  manual_provider_pin AS "manualProviderPin", manual_model_pin AS "manualModelPin",
  manual_reasoning_pin AS "manualReasoningPin", fallback_plan_json AS "fallbackPlan",
  candidate_summary_json AS "candidateSummary", selection_explanation AS "selectionExplanation",
  constraints_snapshot_json AS "constraintsSnapshot", policy_snapshot_json AS "policySnapshot",
  status, created_at AS "createdAt", applied_at AS "appliedAt", terminal_at AS "terminalAt",
  failure_summary AS "failureSummary", superseded_by_id AS "supersededById"
`;
const candidateColumns = `
  routing_candidate_record_id AS "id", routing_decision_id AS "routingDecisionId",
  provider_profile_id AS "providerProfileId", model_profile_id AS "modelProfileId", eligible,
  score, rejection_reasons_json AS "rejectionReasons",
  preference_reasons_json AS "preferenceReasons",
  capability_snapshot_id AS "capabilitySnapshotId", created_at AS "createdAt"
`;
const outcomeColumns = `
  routed_run_outcome_id AS "id", routing_decision_id AS "routingDecisionId",
  agent_run_id AS "agentRunId", task_type AS "taskType", complexity,
  provider_profile_id AS "providerProfileId", model_profile_id AS "modelProfileId",
  reasoning_level AS "reasoningLevel", completion_state AS "completionState",
  fallback_used AS "fallbackUsed", interrupted, verification_result AS "verificationResult",
  retry_count AS "retryCount", user_override AS "userOverride",
  human_disposition AS "humanDisposition", started_at AS "startedAt",
  completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));

  const upsertProviderRow = SqlSchema.void({
    Request: ProviderProfile,
    execute: (row) => sql`
      INSERT INTO projection_routing_provider_profiles (
        provider_profile_id, provider_type, display_name, account_reference, endpoint_class,
        status, is_enabled, is_local, supports_model_discovery, configuration_metadata_json,
        created_at, updated_at, last_validated_at
      ) VALUES (
        ${row.id}, ${row.providerType}, ${row.displayName}, ${row.accountReference},
        ${row.endpointClass}, ${row.status}, ${row.isEnabled ? 1 : 0}, ${row.isLocal ? 1 : 0},
        ${row.supportsModelDiscovery ? 1 : 0}, ${JSON.stringify(row.configurationMetadata)},
        ${row.createdAt}, ${row.updatedAt}, ${row.lastValidatedAt}
      ) ON CONFLICT (provider_profile_id) DO UPDATE SET
        provider_type = excluded.provider_type, display_name = excluded.display_name,
        account_reference = excluded.account_reference, endpoint_class = excluded.endpoint_class,
        status = excluded.status, is_enabled = excluded.is_enabled, is_local = excluded.is_local,
        supports_model_discovery = excluded.supports_model_discovery,
        configuration_metadata_json = excluded.configuration_metadata_json,
        updated_at = excluded.updated_at, last_validated_at = excluded.last_validated_at
    `,
  });
  const getProviderRow = SqlSchema.findOneOption({
    Request: GetProviderProfileInput,
    Result: ProviderProfileDbRow,
    execute: ({ providerProfileId }) => sql`
      SELECT ${sql.unsafe(providerColumns)} FROM projection_routing_provider_profiles
      WHERE provider_profile_id = ${providerProfileId}
    `,
  });
  const listProviderRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderProfileDbRow,
    execute: () => sql`
      SELECT ${sql.unsafe(providerColumns)} FROM projection_routing_provider_profiles
      ORDER BY display_name, provider_profile_id
    `,
  });

  const upsertModelRow = SqlSchema.void({
    Request: ModelProfile,
    execute: (row) => sql`
      INSERT INTO projection_routing_model_profiles (
        model_profile_id, provider_profile_id, provider_model_id, display_name, family, version,
        release_channel, status, is_enabled, is_deprecated, discovered_automatically,
        maximum_concurrent_sessions,
        created_at, updated_at, last_discovered_at
      ) VALUES (
        ${row.id}, ${row.providerProfileId}, ${row.providerModelId}, ${row.displayName},
        ${row.family}, ${row.version}, ${row.releaseChannel}, ${row.status},
        ${row.isEnabled ? 1 : 0}, ${row.isDeprecated ? 1 : 0},
        ${row.discoveredAutomatically ? 1 : 0}, ${row.maximumConcurrentSessions},
        ${row.createdAt}, ${row.updatedAt},
        ${row.lastDiscoveredAt}
      ) ON CONFLICT (model_profile_id) DO UPDATE SET
        provider_profile_id = excluded.provider_profile_id,
        provider_model_id = excluded.provider_model_id, display_name = excluded.display_name,
        family = excluded.family, version = excluded.version,
        release_channel = excluded.release_channel, status = excluded.status,
        is_enabled = excluded.is_enabled, is_deprecated = excluded.is_deprecated,
        discovered_automatically = excluded.discovered_automatically,
        maximum_concurrent_sessions = excluded.maximum_concurrent_sessions,
        updated_at = excluded.updated_at, last_discovered_at = excluded.last_discovered_at
    `,
  });
  const getModelRow = SqlSchema.findOneOption({
    Request: GetModelProfileInput,
    Result: ModelProfileDbRow,
    execute: ({ modelProfileId }) => sql`
      SELECT ${sql.unsafe(modelColumns)} FROM projection_routing_model_profiles
      WHERE model_profile_id = ${modelProfileId}
    `,
  });
  const listModelRows = SqlSchema.findAll({
    Request: ListModelProfilesInput,
    Result: ModelProfileDbRow,
    execute: ({ providerProfileId }) => sql`
      SELECT ${sql.unsafe(modelColumns)} FROM projection_routing_model_profiles
      WHERE ${providerProfileId} IS NULL OR provider_profile_id = ${providerProfileId}
      ORDER BY provider_profile_id, display_name, model_profile_id
    `,
  });

  const insertCapabilityRow = SqlSchema.void({
    Request: ModelCapabilitySnapshot,
    execute: (row) => sql`
      INSERT INTO projection_routing_model_capability_snapshots (
        capability_snapshot_id, model_profile_id, snapshot_version, source, capabilities_json,
        context_limits_json, reasoning_options_json, tool_support_json, modality_support_json,
        output_support_json, privacy_metadata_json, captured_at, expires_at
      ) VALUES (
        ${row.id}, ${row.modelProfileId}, ${row.snapshotVersion}, ${row.source},
        ${JSON.stringify(row.capabilities)}, ${JSON.stringify(row.contextLimits)},
        ${JSON.stringify(row.reasoningOptions)}, ${JSON.stringify(row.toolSupport)},
        ${JSON.stringify(row.modalitySupport)}, ${JSON.stringify(row.outputSupport)},
        ${JSON.stringify(row.privacyMetadata)}, ${row.capturedAt}, ${row.expiresAt}
      )
    `,
  });
  const getCapabilityRow = SqlSchema.findOneOption({
    Request: GetCapabilitySnapshotInput,
    Result: CapabilitySnapshotDbRow,
    execute: ({ capabilitySnapshotId }) => sql`
      SELECT ${sql.unsafe(capabilityColumns)}
      FROM projection_routing_model_capability_snapshots
      WHERE capability_snapshot_id = ${capabilitySnapshotId}
    `,
  });
  const getLatestCapabilityRow = SqlSchema.findOneOption({
    Request: GetLatestCapabilitySnapshotInput,
    Result: CapabilitySnapshotDbRow,
    execute: ({ modelProfileId, observedAt }) => sql`
      SELECT ${sql.unsafe(capabilityColumns)}
      FROM projection_routing_model_capability_snapshots
      WHERE model_profile_id = ${modelProfileId}
        AND (expires_at IS NULL OR expires_at > ${observedAt})
      ORDER BY snapshot_version DESC, captured_at DESC
      LIMIT 1
    `,
  });
  const listCapabilityRows = SqlSchema.findAll({
    Request: ListCapabilitySnapshotsInput,
    Result: CapabilitySnapshotDbRow,
    execute: ({ modelProfileId }) => sql`
      SELECT ${sql.unsafe(capabilityColumns)}
      FROM projection_routing_model_capability_snapshots
      WHERE model_profile_id = ${modelProfileId}
      ORDER BY snapshot_version DESC, captured_at DESC
    `,
  });
  const listAllCapabilityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: CapabilitySnapshotDbRow,
    execute: () => sql`
      SELECT ${sql.unsafe(capabilityColumns)}
      FROM projection_routing_model_capability_snapshots
      ORDER BY model_profile_id, snapshot_version DESC
    `,
  });

  const upsertPolicyRow = SqlSchema.void({
    Request: RoutingPolicy,
    execute: (row) => sql`
      INSERT INTO projection_routing_policies (
        routing_policy_id, scope_type, scope_id, name, description, priority, is_enabled,
        default_provider_profile_id, default_model_profile_id, default_reasoning_level,
        fallback_mode, privacy_mode, budget_mode, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.scopeType}, ${row.scopeId}, ${row.name}, ${row.description},
        ${row.priority}, ${row.isEnabled ? 1 : 0}, ${row.defaultProviderProfileId},
        ${row.defaultModelProfileId}, ${row.defaultReasoningLevel}, ${row.fallbackMode},
        ${row.privacyMode}, ${row.budgetMode}, ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (routing_policy_id) DO UPDATE SET
        scope_type = excluded.scope_type, scope_id = excluded.scope_id, name = excluded.name,
        description = excluded.description, priority = excluded.priority,
        is_enabled = excluded.is_enabled,
        default_provider_profile_id = excluded.default_provider_profile_id,
        default_model_profile_id = excluded.default_model_profile_id,
        default_reasoning_level = excluded.default_reasoning_level,
        fallback_mode = excluded.fallback_mode, privacy_mode = excluded.privacy_mode,
        budget_mode = excluded.budget_mode, updated_at = excluded.updated_at
    `,
  });
  const getPolicyRow = SqlSchema.findOneOption({
    Request: GetRoutingPolicyInput,
    Result: PolicyDbRow,
    execute: ({ routingPolicyId }) => sql`
      SELECT ${sql.unsafe(policyColumns)} FROM projection_routing_policies
      WHERE routing_policy_id = ${routingPolicyId}
    `,
  });
  const listActivePolicyRows = SqlSchema.findAll({
    Request: ListRoutingResolutionInput,
    Result: PolicyDbRow,
    execute: ({ projectId, missionId, taskId, roleKind }) => sql`
      SELECT ${sql.unsafe(policyColumns)} FROM projection_routing_policies
      WHERE is_enabled = 1 AND (
        scope_type IN ('global', 'user')
        OR (scope_type = 'agent_role' AND scope_id = ${roleKind})
        OR (scope_type = 'project' AND scope_id = ${projectId})
        OR (scope_type = 'mission' AND scope_id = ${missionId})
        OR (scope_type = 'task' AND scope_id = ${taskId})
      )
      ORDER BY CASE scope_type
        WHEN 'task' THEN 5 WHEN 'mission' THEN 4 WHEN 'project' THEN 3
        WHEN 'agent_role' THEN 2 WHEN 'user' THEN 1 ELSE 0 END DESC,
        priority DESC, updated_at DESC, routing_policy_id
    `,
  });
  const upsertRuleRow = SqlSchema.void({
    Request: RoutingRule,
    execute: (row) => sql`
      INSERT INTO projection_routing_rules (
        routing_rule_id, routing_policy_id, name, description, priority, is_enabled,
        conditions_json, requirements_json, preferences_json, result_json, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.routingPolicyId}, ${row.name}, ${row.description}, ${row.priority},
        ${row.isEnabled ? 1 : 0}, ${JSON.stringify(row.conditions)},
        ${JSON.stringify(row.requirements)}, ${JSON.stringify(row.preferences)},
        ${JSON.stringify(row.result)}, ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (routing_rule_id) DO UPDATE SET
        routing_policy_id = excluded.routing_policy_id, name = excluded.name,
        description = excluded.description, priority = excluded.priority,
        is_enabled = excluded.is_enabled, conditions_json = excluded.conditions_json,
        requirements_json = excluded.requirements_json,
        preferences_json = excluded.preferences_json, result_json = excluded.result_json,
        updated_at = excluded.updated_at
    `,
  });
  const listRulesByPolicyIds = (
    input: ListRulesByPolicyIdsInput,
  ): Effect.Effect<
    ReadonlyArray<RoutingRule>,
    import("../Errors.ts").ProjectionRepositoryError
  > => {
    if (input.routingPolicyIds.length === 0) return Effect.succeed([]);
    return sql<Record<string, unknown>>`
      SELECT ${sql.unsafe(ruleColumns)} FROM projection_routing_rules
      WHERE is_enabled = 1 AND ${sql.in("routing_policy_id", input.routingPolicyIds)}
      ORDER BY priority DESC, routing_rule_id
    `.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(RuleDbRow))),
      Effect.map((rows) => rows.map(toRule)),
      sqlError("ProjectionRouting.listRulesByPolicyIds"),
    );
  };

  const upsertRoleProfileRow = SqlSchema.void({
    Request: AgentRoleRoutingProfile,
    execute: (row) => sql`
      INSERT INTO projection_agent_role_routing_profiles (
        agent_role_routing_profile_id, project_id, role_kind, routing_policy_id,
        preferred_capabilities_json, required_capabilities_json, default_reasoning_level,
        allow_fallback, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.projectId}, ${row.roleKind}, ${row.routingPolicyId},
        ${JSON.stringify(row.preferredCapabilities)}, ${JSON.stringify(row.requiredCapabilities)},
        ${row.defaultReasoningLevel}, ${row.allowFallback ? 1 : 0}, ${row.createdAt}, ${row.updatedAt}
      ) ON CONFLICT (agent_role_routing_profile_id) DO UPDATE SET
        project_id = excluded.project_id, role_kind = excluded.role_kind,
        routing_policy_id = excluded.routing_policy_id,
        preferred_capabilities_json = excluded.preferred_capabilities_json,
        required_capabilities_json = excluded.required_capabilities_json,
        default_reasoning_level = excluded.default_reasoning_level,
        allow_fallback = excluded.allow_fallback, updated_at = excluded.updated_at
    `,
  });
  const listRoleProfileRows = SqlSchema.findAll({
    Request: ListRoleRoutingProfilesInput,
    Result: RoleProfileDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${sql.unsafe(roleProfileColumns)} FROM projection_agent_role_routing_profiles
      WHERE project_id IS NULL OR project_id = ${projectId}
      ORDER BY (project_id IS NOT NULL) DESC, role_kind, updated_at DESC
    `,
  });

  const insertHealthRow = SqlSchema.void({
    Request: ProviderHealthRecord,
    execute: (row) => sql`
      INSERT INTO projection_provider_health_records (
        provider_health_record_id, provider_profile_id, status, latency_milliseconds,
        rate_limit_state, error_category, observed_at, expires_at
      ) VALUES (
        ${row.id}, ${row.providerProfileId}, ${row.status}, ${row.latencyMilliseconds},
        ${row.rateLimitState}, ${row.errorCategory}, ${row.observedAt}, ${row.expiresAt}
      )
    `,
  });
  const listCurrentHealthRows = SqlSchema.findAll({
    Request: ListCurrentProviderHealthInput,
    Result: ProviderHealthRecord,
    execute: ({ observedAt }) => sql`
      SELECT ${sql.unsafe(healthColumns)} FROM projection_provider_health_records AS health
      WHERE health.expires_at > ${observedAt}
        AND NOT EXISTS (
          SELECT 1 FROM projection_provider_health_records AS newer
          WHERE newer.provider_profile_id = health.provider_profile_id
            AND newer.expires_at > ${observedAt}
            AND (
              newer.observed_at > health.observed_at
              OR (newer.observed_at = health.observed_at
                AND newer.provider_health_record_id > health.provider_health_record_id)
            )
        )
      ORDER BY provider_profile_id
    `,
  });

  const insertOverrideRow = SqlSchema.void({
    Request: RoutingOverride,
    execute: (row) => sql`
      INSERT INTO projection_routing_overrides (
        routing_override_id, scope_type, scope_id, provider_profile_id, model_profile_id,
        reasoning_level, fallback_mode, expires_at, reason, created_by, created_at, revoked_at
      ) VALUES (
        ${row.id}, ${row.scopeType}, ${row.scopeId}, ${row.providerProfileId},
        ${row.modelProfileId}, ${row.reasoningLevel}, ${row.fallbackMode}, ${row.expiresAt},
        ${row.reason}, ${row.createdBy}, ${row.createdAt}, ${row.revokedAt}
      )
    `,
  });
  const revokeOverrideRow = SqlSchema.void({
    Request: RevokeRoutingOverrideInput,
    execute: ({ routingOverrideId, revokedAt }) => sql`
      UPDATE projection_routing_overrides SET revoked_at = ${revokedAt}
      WHERE routing_override_id = ${routingOverrideId} AND revoked_at IS NULL
    `,
  });
  const getOverrideRow = SqlSchema.findOneOption({
    Request: GetRoutingOverrideInput,
    Result: RoutingOverride,
    execute: ({ routingOverrideId }) => sql`
      SELECT ${sql.unsafe(overrideColumns)} FROM projection_routing_overrides
      WHERE routing_override_id = ${routingOverrideId}
    `,
  });
  const listActiveOverrideRows = SqlSchema.findAll({
    Request: ListRoutingResolutionInput,
    Result: RoutingOverride,
    execute: ({ projectId, missionId, taskId, roleKind, observedAt }) => sql`
      SELECT ${sql.unsafe(overrideColumns)} FROM projection_routing_overrides
      WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${observedAt}) AND (
        scope_type IN ('global', 'user')
        OR (scope_type = 'agent_role' AND scope_id = ${roleKind})
        OR (scope_type = 'project' AND scope_id = ${projectId})
        OR (scope_type = 'mission' AND scope_id = ${missionId})
        OR (scope_type = 'task' AND scope_id = ${taskId})
      )
      ORDER BY CASE scope_type
        WHEN 'task' THEN 5 WHEN 'mission' THEN 4 WHEN 'project' THEN 3
        WHEN 'agent_role' THEN 2 WHEN 'user' THEN 1 ELSE 0 END DESC,
        created_at DESC, routing_override_id
    `,
  });
  const listWorkspaceActiveOverrideRows = SqlSchema.findAll({
    Request: ListRoutingResolutionInput,
    Result: RoutingOverride,
    execute: ({ projectId, missionId, taskId, roleKind, observedAt }) => sql`
      SELECT ${sql.unsafe(overrideColumns)} FROM projection_routing_overrides
      WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${observedAt}) AND (
        scope_type IN ('global', 'user')
        OR (scope_type = 'agent_role' AND scope_id = ${roleKind})
        OR (scope_type = 'project' AND scope_id = ${projectId})
        OR (scope_type = 'mission' AND scope_id = ${missionId})
        OR (scope_type = 'task' AND (
          scope_id = ${taskId}
          OR (
            ${taskId} IS NULL
            AND ${missionId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM projection_mission_tasks AS task
              WHERE task.task_id = projection_routing_overrides.scope_id
                AND task.mission_id = ${missionId}
            )
          )
        ))
      )
      ORDER BY CASE scope_type
        WHEN 'task' THEN 5 WHEN 'mission' THEN 4 WHEN 'project' THEN 3
        WHEN 'agent_role' THEN 2 WHEN 'user' THEN 1 ELSE 0 END DESC,
        created_at DESC, routing_override_id
    `,
  });

  const insertAssessmentRow = SqlSchema.void({
    Request: TaskRoutingAssessment,
    execute: (row) => sql`
      INSERT INTO projection_task_routing_assessments (
        task_routing_assessment_id, task_id, agent_role, task_type, complexity,
        required_capabilities_json, preferred_capabilities_json, estimated_context_tokens,
        privacy_classification, write_access_required, vision_required,
        structured_output_required, assessment_source, assessment_explanation, version,
        created_at, updated_at, superseded_by_id
      ) VALUES (
        ${row.id}, ${row.taskId}, ${row.agentRole}, ${row.taskType}, ${row.complexity},
        ${JSON.stringify(row.requiredCapabilities)}, ${JSON.stringify(row.preferredCapabilities)},
        ${row.estimatedContextTokens}, ${row.privacyClassification},
        ${row.writeAccessRequired ? 1 : 0}, ${row.visionRequired ? 1 : 0},
        ${row.structuredOutputRequired ? 1 : 0}, ${row.assessmentSource},
        ${row.assessmentExplanation}, ${row.version}, ${row.createdAt}, ${row.updatedAt},
        ${row.supersededById}
      )
    `,
  });
  const getAssessmentByIdRow = SqlSchema.findOneOption({
    Request: GetTaskAssessmentByIdInput,
    Result: AssessmentDbRow,
    execute: ({ assessmentId }) => sql`
      SELECT ${sql.unsafe(assessmentColumns)} FROM projection_task_routing_assessments
      WHERE task_routing_assessment_id = ${assessmentId}
    `,
  });
  const getLatestAssessmentRow = SqlSchema.findOneOption({
    Request: GetTaskAssessmentInput,
    Result: AssessmentDbRow,
    execute: ({ taskId }) => sql`
      SELECT ${sql.unsafe(assessmentColumns)} FROM projection_task_routing_assessments
      WHERE task_id = ${taskId} AND superseded_by_id IS NULL
      ORDER BY version DESC, created_at DESC LIMIT 1
    `,
  });
  const listAssessmentRows = SqlSchema.findAll({
    Request: GetTaskAssessmentInput,
    Result: AssessmentDbRow,
    execute: ({ taskId }) => sql`
      SELECT ${sql.unsafe(assessmentColumns)} FROM projection_task_routing_assessments
      WHERE task_id = ${taskId} ORDER BY version DESC, created_at DESC
    `,
  });

  const insertDecisionRow = SqlSchema.void({
    Request: RoutingDecision,
    execute: (row) => sql`
      INSERT INTO projection_routing_decisions (
        routing_decision_id, project_id, mission_id, task_id, mission_agent_id, agent_run_id,
        assessment_id, decision_type, selected_provider_profile_id, selected_model_profile_id,
        selected_capability_snapshot_id, selected_reasoning_level, manual_provider_pin,
        manual_model_pin, manual_reasoning_pin, fallback_plan_json, candidate_summary_json,
        selection_explanation, constraints_snapshot_json, policy_snapshot_json, status,
        created_at, applied_at, terminal_at, failure_summary, superseded_by_id
      ) VALUES (
        ${row.id}, ${row.projectId}, ${row.missionId}, ${row.taskId}, ${row.missionAgentId},
        ${row.agentRunId}, ${row.assessmentId}, ${row.decisionType},
        ${row.selectedProviderProfileId}, ${row.selectedModelProfileId},
        ${row.selectedCapabilitySnapshotId}, ${row.selectedReasoningLevel},
        ${row.manualProviderPin ? 1 : 0}, ${row.manualModelPin ? 1 : 0},
        ${row.manualReasoningPin ? 1 : 0}, ${JSON.stringify(row.fallbackPlan)},
        ${JSON.stringify(row.candidateSummary)}, ${row.selectionExplanation},
        ${JSON.stringify(row.constraintsSnapshot)}, ${JSON.stringify(row.policySnapshot)},
        ${row.status}, ${row.createdAt}, ${row.appliedAt}, ${row.terminalAt},
        ${row.failureSummary}, ${row.supersededById}
      )
    `,
  });
  const insertCandidateRow = SqlSchema.void({
    Request: RoutingCandidateRecord,
    execute: (row) => sql`
      INSERT INTO projection_routing_candidate_records (
        routing_candidate_record_id, routing_decision_id, provider_profile_id, model_profile_id,
        eligible, score, rejection_reasons_json, preference_reasons_json,
        capability_snapshot_id, created_at
      ) VALUES (
        ${row.id}, ${row.routingDecisionId}, ${row.providerProfileId}, ${row.modelProfileId},
        ${row.eligible ? 1 : 0}, ${row.score}, ${JSON.stringify(row.rejectionReasons)},
        ${JSON.stringify(row.preferenceReasons)}, ${row.capabilitySnapshotId}, ${row.createdAt}
      )
    `,
  });
  const getDecisionRow = SqlSchema.findOneOption({
    Request: GetRoutingDecisionInput,
    Result: DecisionDbRow,
    execute: ({ routingDecisionId }) => sql`
      SELECT ${sql.unsafe(decisionColumns)} FROM projection_routing_decisions
      WHERE routing_decision_id = ${routingDecisionId}
    `,
  });
  const getDecisionByRunRow = SqlSchema.findOneOption({
    Request: GetRoutingDecisionByRunInput,
    Result: DecisionDbRow,
    execute: ({ agentRunId }) => sql`
      SELECT ${sql.unsafe(decisionColumns)} FROM projection_routing_decisions
      WHERE agent_run_id = ${agentRunId}
    `,
  });
  const listCandidateRows = SqlSchema.findAll({
    Request: GetRoutingDecisionInput,
    Result: CandidateDbRow,
    execute: ({ routingDecisionId }) => sql`
      SELECT ${sql.unsafe(candidateColumns)} FROM projection_routing_candidate_records
      WHERE routing_decision_id = ${routingDecisionId}
      ORDER BY eligible DESC, score DESC, routing_candidate_record_id
    `,
  });
  const applyDecisionRow = SqlSchema.void({
    Request: ApplyRoutingDecisionInput,
    execute: ({ routingDecisionId, agentRunId, appliedAt }) => sql`
      UPDATE projection_routing_decisions
      SET status = 'applied', agent_run_id = ${agentRunId}, applied_at = ${appliedAt}
      WHERE routing_decision_id = ${routingDecisionId} AND status = 'planned'
    `,
  });
  const markDecisionTerminalRow = SqlSchema.void({
    Request: MarkRoutingDecisionTerminalInput,
    execute: ({ routingDecisionId, status, terminalAt, failureSummary }) => sql`
      UPDATE projection_routing_decisions
      SET status = ${status}, terminal_at = ${terminalAt}, failure_summary = ${failureSummary}
      WHERE routing_decision_id = ${routingDecisionId} AND status = 'planned'
    `,
  });
  const supersedeDecisionRow = SqlSchema.void({
    Request: SupersedeRoutingDecisionInput,
    execute: ({ routingDecisionId, supersededById, terminalAt }) => sql`
      UPDATE projection_routing_decisions
      SET status = 'superseded', superseded_by_id = ${supersededById}, terminal_at = ${terminalAt}
      WHERE routing_decision_id = ${routingDecisionId} AND status IN ('planned', 'applied')
    `,
  });
  const listDecisionHistoryRows = SqlSchema.findAll({
    Request: ListRoutingDecisionHistoryInput,
    Result: DecisionDbRow,
    execute: ({ projectId, missionId, taskId, limit, offset }) => sql`
      SELECT ${sql.unsafe(decisionColumns)} FROM projection_routing_decisions
      WHERE project_id = ${projectId}
        AND (${missionId} IS NULL OR mission_id = ${missionId})
        AND (${taskId} IS NULL OR task_id = ${taskId})
      ORDER BY created_at DESC, routing_decision_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  });
  const listRecoverableDecisionRows = SqlSchema.findAll({
    Request: ListRecoverableRoutingDecisionsInput,
    Result: DecisionDbRow,
    execute: ({ createdBefore, limit }) => sql`
      SELECT ${sql.unsafe(decisionColumns)} FROM projection_routing_decisions
      WHERE status = 'planned' AND created_at <= ${createdBefore}
      ORDER BY created_at, routing_decision_id LIMIT ${limit}
    `,
  });

  const upsertOutcomeRow = SqlSchema.void({
    Request: RoutedRunOutcome,
    execute: (row) => sql`
      INSERT INTO projection_routed_run_outcomes (
        routed_run_outcome_id, routing_decision_id, agent_run_id, task_type, complexity,
        provider_profile_id, model_profile_id, reasoning_level, completion_state,
        fallback_used, interrupted, verification_result, retry_count, user_override,
        human_disposition, started_at, completed_at, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.routingDecisionId}, ${row.agentRunId}, ${row.taskType}, ${row.complexity},
        ${row.providerProfileId}, ${row.modelProfileId}, ${row.reasoningLevel},
        ${row.completionState}, ${row.fallbackUsed ? 1 : 0}, ${row.interrupted ? 1 : 0},
        ${row.verificationResult}, ${row.retryCount}, ${row.userOverride ? 1 : 0},
        ${row.humanDisposition}, ${row.startedAt}, ${row.completedAt}, ${row.createdAt},
        ${row.updatedAt}
      ) ON CONFLICT (routed_run_outcome_id) DO UPDATE SET
        completion_state = excluded.completion_state, fallback_used = excluded.fallback_used,
        interrupted = excluded.interrupted, verification_result = excluded.verification_result,
        retry_count = excluded.retry_count, user_override = excluded.user_override,
        human_disposition = excluded.human_disposition, completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `,
  });
  const getOutcomeByRunRow = SqlSchema.findOneOption({
    Request: GetRoutedRunOutcomeInput,
    Result: OutcomeDbRow,
    execute: ({ agentRunId }) => sql`
      SELECT ${sql.unsafe(outcomeColumns)} FROM projection_routed_run_outcomes
      WHERE agent_run_id = ${agentRunId}
    `,
  });

  const getDecisionDetail = Effect.fn("ProjectionRouting.getDecisionDetail")(function* (
    decision: RoutingDecision,
  ) {
    const candidates = yield* listCandidateRows({ routingDecisionId: decision.id }).pipe(
      Effect.map((rows) => rows.map(toCandidate)),
      sqlError("ProjectionRouting.getDecisionDetail:candidates"),
    );
    return { decision, candidates } as const;
  });

  const upsertProviderProfile: ProjectionRoutingRepositoryShape["upsertProviderProfile"] = (row) =>
    upsertProviderRow(row).pipe(sqlError("ProjectionRouting.upsertProviderProfile"));
  const listProviderProfiles: ProjectionRoutingRepositoryShape["listProviderProfiles"] = () =>
    listProviderRows(undefined).pipe(
      Effect.map((rows) => rows.map(toProviderProfile)),
      sqlError("ProjectionRouting.listProviderProfiles"),
    );
  const listModelProfiles: ProjectionRoutingRepositoryShape["listModelProfiles"] = (input) =>
    listModelRows(input).pipe(
      Effect.map((rows) => rows.map(toModelProfile)),
      sqlError("ProjectionRouting.listModelProfiles"),
    );
  const listActivePolicies: ProjectionRoutingRepositoryShape["listActivePolicies"] = (input) =>
    listActivePolicyRows(input).pipe(
      Effect.map((rows) => rows.map(toPolicy)),
      sqlError("ProjectionRouting.listActivePolicies"),
    );
  const listRoleProfiles: ProjectionRoutingRepositoryShape["listRoleProfiles"] = (input) =>
    listRoleProfileRows(input).pipe(
      Effect.map((rows) => rows.map(toRoleProfile)),
      sqlError("ProjectionRouting.listRoleProfiles"),
    );
  const listCurrentProviderHealth: ProjectionRoutingRepositoryShape["listCurrentProviderHealth"] = (
    input,
  ) => listCurrentHealthRows(input).pipe(sqlError("ProjectionRouting.listCurrentProviderHealth"));
  const listActiveOverrides: ProjectionRoutingRepositoryShape["listActiveOverrides"] = (input) =>
    listActiveOverrideRows(input).pipe(sqlError("ProjectionRouting.listActiveOverrides"));
  const getLatestAssessment: ProjectionRoutingRepositoryShape["getLatestAssessment"] = (input) =>
    getLatestAssessmentRow(input).pipe(
      Effect.map(Option.map(toAssessment)),
      sqlError("ProjectionRouting.getLatestAssessment"),
    );
  const listAssessmentHistory: ProjectionRoutingRepositoryShape["listAssessmentHistory"] = (
    input,
  ) =>
    listAssessmentRows(input).pipe(
      Effect.map((rows) => rows.map(toAssessment)),
      sqlError("ProjectionRouting.listAssessmentHistory"),
    );
  const listDecisionHistory: ProjectionRoutingRepositoryShape["listDecisionHistory"] = (input) =>
    listDecisionHistoryRows(input).pipe(
      Effect.map((rows) => rows.map(toDecision)),
      sqlError("ProjectionRouting.listDecisionHistory"),
    );

  const saveAssessment: ProjectionRoutingRepositoryShape["saveAssessment"] = ({ assessment }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* insertAssessmentRow(assessment);
          yield* sql`
            UPDATE projection_task_routing_assessments
            SET superseded_by_id = ${assessment.id}, updated_at = ${assessment.updatedAt}
            WHERE task_id = ${assessment.taskId}
              AND task_routing_assessment_id <> ${assessment.id}
              AND superseded_by_id IS NULL
          `;
        }),
      )
      .pipe(sqlError("ProjectionRouting.saveAssessment"));

  const createDecision: ProjectionRoutingRepositoryShape["createDecision"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* insertDecisionRow(input.decision);
          yield* Effect.forEach(input.candidates, insertCandidateRow, {
            concurrency: 1,
            discard: true,
          });
        }),
      )
      .pipe(sqlError("ProjectionRouting.createDecision"));

  const getDecision: ProjectionRoutingRepositoryShape["getDecision"] = (input) =>
    getDecisionRow(input).pipe(
      Effect.map(Option.map(toDecision)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
          onSome: (decision) => getDecisionDetail(decision).pipe(Effect.map(Option.some)),
        }),
      ),
      sqlError("ProjectionRouting.getDecision"),
    );
  const getDecisionByRun: ProjectionRoutingRepositoryShape["getDecisionByRun"] = (input) =>
    getDecisionByRunRow(input).pipe(
      Effect.map(Option.map(toDecision)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
          onSome: (decision) => getDecisionDetail(decision).pipe(Effect.map(Option.some)),
        }),
      ),
      sqlError("ProjectionRouting.getDecisionByRun"),
    );

  const getWorkspace: ProjectionRoutingRepositoryShape["getWorkspace"] = (input) =>
    Effect.gen(function* () {
      const providers = yield* listProviderProfiles();
      const models = yield* listModelProfiles({ providerProfileId: null });
      const capabilitySnapshots = yield* listAllCapabilityRows(undefined).pipe(
        sqlError("ProjectionRouting.getWorkspace:capabilities"),
      );
      const policies = yield* listActivePolicies(input);
      const rules = yield* listRulesByPolicyIds({
        routingPolicyIds: policies.map((policy) => policy.id),
      });
      const roleProfiles = yield* listRoleProfiles({ projectId: input.projectId });
      const overrides = yield* listWorkspaceActiveOverrideRows(input).pipe(
        sqlError("ProjectionRouting.getWorkspace:overrides"),
      );
      const health = yield* listCurrentProviderHealth({ observedAt: input.observedAt });
      const assessmentRows = yield* sql<Record<string, unknown>>`
        SELECT assessment.*
        FROM (
          SELECT ${sql.unsafe(assessmentColumns)}
          FROM projection_task_routing_assessments
        ) AS assessment
        JOIN projection_mission_tasks AS task ON task.task_id = assessment."taskId"
        JOIN projection_missions AS mission ON mission.mission_id = task.mission_id
        WHERE mission.project_id = ${input.projectId}
          AND (${input.missionId} IS NULL OR mission.mission_id = ${input.missionId})
          AND (${input.taskId} IS NULL OR task.task_id = ${input.taskId})
        ORDER BY assessment."createdAt" DESC, assessment.id DESC
        LIMIT 500
      `.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AssessmentDbRow))),
        sqlError("ProjectionRouting.getWorkspace:assessments"),
      );
      const decisions = yield* listDecisionHistory({
        projectId: input.projectId,
        missionId: input.missionId,
        taskId: input.taskId,
        limit: 500,
        offset: 0,
      });
      const outcomeRows = yield* sql<Record<string, unknown>>`
        SELECT outcome.*
        FROM (
          SELECT ${sql.unsafe(outcomeColumns)}
          FROM projection_routed_run_outcomes
        ) AS outcome
        JOIN projection_routing_decisions AS decision
          ON decision.routing_decision_id = outcome."routingDecisionId"
        WHERE decision.project_id = ${input.projectId}
          AND (${input.missionId} IS NULL OR decision.mission_id = ${input.missionId})
          AND (${input.taskId} IS NULL OR decision.task_id = ${input.taskId})
        ORDER BY outcome."updatedAt" DESC, outcome.id DESC
        LIMIT 500
      `.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(OutcomeDbRow))),
        sqlError("ProjectionRouting.getWorkspace:outcomes"),
      );
      return {
        providers,
        models,
        capabilitySnapshots,
        policies,
        rules,
        roleProfiles,
        overrides,
        health,
        assessments: assessmentRows.map(toAssessment),
        decisions,
        outcomes: outcomeRows.map(toOutcome),
      };
    });

  return {
    upsertProviderProfile,
    getProviderProfile: (input) =>
      getProviderRow(input).pipe(
        Effect.map(Option.map(toProviderProfile)),
        sqlError("ProjectionRouting.getProviderProfile"),
      ),
    listProviderProfiles,
    upsertModelProfile: (row) =>
      upsertModelRow(row).pipe(sqlError("ProjectionRouting.upsertModelProfile")),
    getModelProfile: (input) =>
      getModelRow(input).pipe(
        Effect.map(Option.map(toModelProfile)),
        sqlError("ProjectionRouting.getModelProfile"),
      ),
    listModelProfiles,
    insertCapabilitySnapshot: (row) =>
      insertCapabilityRow(row).pipe(sqlError("ProjectionRouting.insertCapabilitySnapshot")),
    getCapabilitySnapshot: (input) =>
      getCapabilityRow(input).pipe(sqlError("ProjectionRouting.getCapabilitySnapshot")),
    getLatestCapabilitySnapshot: (input) =>
      getLatestCapabilityRow(input).pipe(sqlError("ProjectionRouting.getLatestCapabilitySnapshot")),
    listCapabilitySnapshots: (input) =>
      listCapabilityRows(input).pipe(sqlError("ProjectionRouting.listCapabilitySnapshots")),
    upsertPolicy: (row) => upsertPolicyRow(row).pipe(sqlError("ProjectionRouting.upsertPolicy")),
    getPolicy: (input) =>
      getPolicyRow(input).pipe(
        Effect.map(Option.map(toPolicy)),
        sqlError("ProjectionRouting.getPolicy"),
      ),
    listActivePolicies,
    upsertRule: (row) => upsertRuleRow(row).pipe(sqlError("ProjectionRouting.upsertRule")),
    listRulesByPolicyIds,
    upsertRoleProfile: (row) =>
      upsertRoleProfileRow(row).pipe(sqlError("ProjectionRouting.upsertRoleProfile")),
    listRoleProfiles,
    insertProviderHealth: (row) =>
      insertHealthRow(row).pipe(sqlError("ProjectionRouting.insertProviderHealth")),
    listCurrentProviderHealth,
    createOverride: (row) =>
      insertOverrideRow(row).pipe(sqlError("ProjectionRouting.createOverride")),
    getOverride: (input) => getOverrideRow(input).pipe(sqlError("ProjectionRouting.getOverride")),
    revokeOverride: (input) =>
      revokeOverrideRow(input).pipe(sqlError("ProjectionRouting.revokeOverride")),
    listActiveOverrides,
    saveAssessment,
    getAssessmentById: (input) =>
      getAssessmentByIdRow(input).pipe(
        Effect.map(Option.map(toAssessment)),
        sqlError("ProjectionRouting.getAssessmentById"),
      ),
    getLatestAssessment,
    listAssessmentHistory,
    createDecision,
    applyDecision: (input) =>
      applyDecisionRow(input).pipe(sqlError("ProjectionRouting.applyDecision")),
    markDecisionTerminal: (input) =>
      markDecisionTerminalRow(input).pipe(sqlError("ProjectionRouting.markDecisionTerminal")),
    supersedeDecision: (input) =>
      supersedeDecisionRow(input).pipe(sqlError("ProjectionRouting.supersedeDecision")),
    getDecision,
    getDecisionByRun,
    listDecisionHistory,
    listRecoverableDecisions: (input) =>
      listRecoverableDecisionRows(input).pipe(
        Effect.map((rows) => rows.map(toDecision)),
        sqlError("ProjectionRouting.listRecoverableDecisions"),
      ),
    getWorkspace,
    upsertOutcome: (row) => upsertOutcomeRow(row).pipe(sqlError("ProjectionRouting.upsertOutcome")),
    getOutcomeByRun: (input) =>
      getOutcomeByRunRow(input).pipe(
        Effect.map(Option.map(toOutcome)),
        sqlError("ProjectionRouting.getOutcomeByRun"),
      ),
  } satisfies ProjectionRoutingRepositoryShape;
});

export const ProjectionRoutingRepositoryLive = Layer.effect(ProjectionRoutingRepository, make);
