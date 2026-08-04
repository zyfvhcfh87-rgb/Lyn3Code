// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentRunId,
  AgentRoleRoutingProfileId,
  ALL_AGENT_PERMISSIONS,
  ModelCapabilitySnapshotId,
  ModelProfileId,
  MissionId,
  MissionTaskId,
  ProjectId,
  ProviderDriverKind,
  ProviderHealthRecordId,
  ProviderInstanceId,
  RoutedRunOutcomeId,
  RoutingCandidateRecordId,
  RoutingDecisionId,
  RoutingOverrideId,
  RoutingPolicyId,
  RoutingRuleId,
  TaskRoutingAssessmentId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlClientService from "effect/unstable/sql/SqlClient";

import { ProjectionRoutingRepository } from "../Services/ProjectionRouting.ts";
import { ProjectionAgentRunRepository } from "../Services/ProjectionAgentRuns.ts";
import { ProjectionAgentRunRepositoryLive } from "./ProjectionAgentRuns.ts";
import { ProjectionRoutingRepositoryLive } from "./ProjectionRouting.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";

const now = "2026-08-03T12:00:00.000Z";
const later = "2026-08-03T12:01:00.000Z";
const expires = "2026-08-03T13:00:00.000Z";
const projectId = ProjectId.make("routing-repository-project");
const missionId = MissionId.make("routing-repository-mission");
const taskId = MissionTaskId.make("routing-repository-task");
const providerId = ProviderInstanceId.make("codex-work");
const modelId = ModelProfileId.make("model-gpt-5-6");
const snapshotId = ModelCapabilitySnapshotId.make("snapshot-gpt-5-6-v1");
const policyId = RoutingPolicyId.make("routing-project-policy");
const assessmentOneId = TaskRoutingAssessmentId.make("routing-assessment-v1");
const assessmentTwoId = TaskRoutingAssessmentId.make("routing-assessment-v2");
const decisionId = RoutingDecisionId.make("routing-decision-applied");
const candidateId = RoutingCandidateRecordId.make("routing-candidate-gpt");
const agentRunId = AgentRunId.make("routing-agent-run");

function makeLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  return Layer.mergeAll(
    ProjectionRoutingRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionAgentRunRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  );
}

const seedMission = Effect.gen(function* () {
  const sql = yield* SqlClientService.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'Routing', '/routing', NULL, '[]', ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_missions (
      mission_id, project_id, title, description, status, created_at, updated_at,
      started_at, completed_at, cancelled_at
    ) VALUES (${missionId}, ${projectId}, 'Route', '', 'running', ${now}, ${now}, ${now}, NULL, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_mission_tasks (
      task_id, mission_id, title, description, status, position, created_at, updated_at,
      started_at, completed_at
    ) VALUES (${taskId}, ${missionId}, 'Choose model', '', 'running', 0, ${now}, ${now}, ${now}, NULL)
  `;
});

const provider = {
  id: providerId,
  providerType: ProviderDriverKind.make("codex"),
  displayName: "Codex Work",
  accountReference: null,
  endpointClass: "official_cloud" as const,
  status: "available" as const,
  isEnabled: true,
  isLocal: false,
  supportsModelDiscovery: true,
  configurationMetadata: { region: "eu" },
  createdAt: now,
  updatedAt: now,
  lastValidatedAt: now,
};
const model = {
  id: modelId,
  providerProfileId: providerId,
  providerModelId: "gpt-5.6",
  displayName: "GPT 5.6",
  family: "gpt",
  version: null,
  releaseChannel: null,
  status: "available" as const,
  isEnabled: true,
  isDeprecated: false,
  discoveredAutomatically: true,
  maximumConcurrentSessions: null,
  createdAt: now,
  updatedAt: now,
  lastDiscoveredAt: now,
};
const snapshot = {
  id: snapshotId,
  modelProfileId: modelId,
  snapshotVersion: 1,
  source: "provider_reported" as const,
  capabilities: {
    toolCalling: "supported" as const,
    structuredOutput: "supported" as const,
    visionInput: "unknown" as const,
    audioInput: "unsupported" as const,
    fileInput: "supported" as const,
    streaming: "supported" as const,
    reasoningControl: "supported" as const,
    parallelToolCalls: "unknown" as const,
    codeEditing: "supported" as const,
    longContext: "supported" as const,
    systemInstructions: "supported" as const,
    promptCaching: "unknown" as const,
  },
  contextLimits: {
    maximumInputTokens: 128_000,
    maximumOutputTokens: null,
    recommendedWorkingContext: 96_000,
    supportsAutomaticCompaction: "unknown" as const,
  },
  reasoningOptions: {
    supportedLevels: ["medium", "high"] as const,
    defaultLevel: "medium" as const,
    supportsDynamicReasoning: "supported" as const,
  },
  toolSupport: { repository_search: "supported" as const },
  modalitySupport: { image: "unknown" as const },
  outputSupport: { json: "supported" as const },
  privacyMetadata: { trainingUse: "unknown" },
  capturedAt: now,
  expiresAt: null,
};
const policy = {
  id: policyId,
  scopeType: "project" as const,
  scopeId: projectId,
  name: "Project default",
  description: "",
  priority: 10,
  isEnabled: true,
  defaultProviderProfileId: providerId,
  defaultModelProfileId: modelId,
  defaultReasoningLevel: "high" as const,
  fallbackMode: "same_provider" as const,
  privacyMode: "remote_allowed" as const,
  budgetMode: "balanced" as const,
  createdAt: now,
  updatedAt: now,
};
const assessmentOne = {
  id: assessmentOneId,
  taskId,
  agentRole: "implementer" as const,
  taskType: "implementation" as const,
  complexity: "medium" as const,
  requiredCapabilities: ["code_editing"] as const,
  preferredCapabilities: ["structured_output"] as const,
  estimatedContextTokens: 48_000,
  privacyClassification: "normal" as const,
  writeAccessRequired: true,
  visionRequired: false,
  structuredOutputRequired: true,
  assessmentSource: "inferred" as const,
  assessmentExplanation: "Implementation task.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  supersededById: null,
};
const assessmentTwo = {
  ...assessmentOne,
  id: assessmentTwoId,
  complexity: "high" as const,
  assessmentSource: "manual" as const,
  assessmentExplanation: "Maintainer corrected the complexity.",
  version: 2,
  createdAt: later,
  updatedAt: later,
};
const constraintsSnapshot = {
  requiredCapabilities: ["code_editing"] as const,
  preferredCapabilities: ["structured_output"] as const,
  requiredTools: ["repository_search"],
  requiredModalities: [],
  minimumContextTokens: 48_000,
  maximumContextTarget: 96_000,
  privacyClassification: "normal" as const,
  localOnly: false,
  maximumRetries: 1,
  contextStrategy: "full",
  estimatedContextTokens: 48_000,
};
const decision = {
  id: decisionId,
  projectId,
  missionId,
  taskId,
  missionAgentId: null,
  agentRunId: null,
  assessmentId: assessmentTwoId,
  decisionType: "automatic" as const,
  selectedProviderProfileId: providerId,
  selectedModelProfileId: modelId,
  selectedCapabilitySnapshotId: snapshotId,
  selectedReasoningLevel: "high" as const,
  manualProviderPin: false,
  manualModelPin: false,
  manualReasoningPin: false,
  fallbackPlan: [],
  candidateSummary: {
    consideredCount: 1,
    eligibleCount: 1,
    persistedCandidateIds: [candidateId],
    truncated: false,
  },
  selectionExplanation: "Only eligible project model.",
  constraintsSnapshot,
  policySnapshot: {
    policyIds: [policyId],
    overrideIds: [],
    effectiveFallbackMode: "same_provider" as const,
    effectivePrivacyMode: "remote_allowed" as const,
    effectiveBudgetMode: "balanced" as const,
  },
  status: "planned" as const,
  createdAt: now,
  appliedAt: null,
  terminalAt: null,
  failureSummary: null,
  supersededById: null,
};
const candidate = {
  id: candidateId,
  routingDecisionId: decisionId,
  providerProfileId: providerId,
  modelProfileId: modelId,
  eligible: true,
  score: 0.95,
  rejectionReasons: [],
  preferenceReasons: ["project default"],
  capabilitySnapshotId: snapshotId,
  createdAt: now,
};

const layer = it.layer(makeLayer(SqlitePersistenceMemory));

layer("routing persistence repository", (it) => {
  it.effect("persists scoped registries, history, decisions, outcomes, and recovery state", () =>
    Effect.gen(function* () {
      yield* seedMission;
      const repository = yield* ProjectionRoutingRepository;
      const runs = yield* ProjectionAgentRunRepository;

      yield* repository.upsertProviderProfile(provider);
      yield* repository.upsertModelProfile(model);
      yield* repository.insertCapabilitySnapshot(snapshot);
      yield* repository.upsertPolicy(policy);
      yield* repository.upsertRule({
        id: RoutingRuleId.make("routing-rule-implementation"),
        routingPolicyId: policyId,
        name: "Implementation",
        description: "",
        priority: 10,
        isEnabled: true,
        conditions: {
          taskTypes: ["implementation"],
          agentRoles: ["implementer"],
          complexities: [],
          repositoryLanguages: [],
          changedFilePatterns: [],
          requiredModalities: [],
          requiredTools: [],
          minimumContextTokens: null,
          privacyClassifications: [],
          missionStatuses: [],
          verificationFailureCategories: [],
          providerStatuses: [],
          rateLimitStates: [],
          manualPinState: "any",
        },
        requirements: {
          requiredProviderProfileIds: [],
          excludedProviderProfileIds: [],
          requiredModelProfileIds: [],
          excludedModelProfileIds: [],
          minimumCapabilities: ["code_editing"],
          reasoningLevel: "high",
          maximumContextTarget: 96_000,
          fallbackChain: [],
          maximumRetries: 1,
        },
        preferences: {
          preferredProviderProfileIds: [providerId],
          preferredModelProfileIds: [modelId],
          preferredCapabilities: [],
          preferLocal: false,
          preferLowLatency: false,
          preferLowCost: false,
        },
        result: {
          providerProfileId: providerId,
          modelProfileId: modelId,
          reasoningLevel: "high",
          fallbackMode: "same_provider",
          allowDeprecatedModel: false,
        },
        createdAt: now,
        updatedAt: now,
      });
      yield* repository.upsertRoleProfile({
        id: AgentRoleRoutingProfileId.make("routing-role-implementer"),
        projectId,
        roleKind: "implementer",
        routingPolicyId: policyId,
        preferredCapabilities: ["structured_output"],
        requiredCapabilities: ["code_editing"],
        defaultReasoningLevel: "high",
        allowFallback: true,
        createdAt: now,
        updatedAt: now,
      });
      yield* repository.insertProviderHealth({
        id: ProviderHealthRecordId.make("health-codex-work"),
        providerProfileId: providerId,
        status: "available",
        latencyMilliseconds: 150,
        rateLimitState: "clear",
        errorCategory: null,
        observedAt: now,
        expiresAt: expires,
      });
      const overrideId = RoutingOverrideId.make("override-project-high");
      yield* repository.createOverride({
        id: overrideId,
        scopeType: "project",
        scopeId: projectId,
        providerProfileId: providerId,
        modelProfileId: modelId,
        reasoningLevel: "high",
        fallbackMode: null,
        expiresAt: expires,
        reason: "Architecture task",
        createdBy: "maintainer",
        createdAt: now,
        revokedAt: null,
      });
      const taskOverrideId = RoutingOverrideId.make("override-task-pinned");
      yield* repository.createOverride({
        id: taskOverrideId,
        scopeType: "task",
        scopeId: taskId,
        providerProfileId: providerId,
        modelProfileId: modelId,
        reasoningLevel: "medium",
        fallbackMode: "none",
        expiresAt: null,
        reason: "Keep the task pin visible in its mission workspace",
        createdBy: "maintainer",
        createdAt: now,
        revokedAt: null,
      });

      yield* repository.saveAssessment({ assessment: assessmentOne });
      yield* repository.saveAssessment({ assessment: assessmentTwo });
      const latestAssessment = yield* repository.getLatestAssessment({ taskId });
      assert.ok(Option.isSome(latestAssessment));
      assert.strictEqual(latestAssessment.value.id, assessmentTwoId);
      const history = yield* repository.listAssessmentHistory({ taskId });
      assert.deepStrictEqual(
        history.map((item) => item.id),
        [assessmentTwoId, assessmentOneId],
      );
      assert.strictEqual(history[1]?.supersededById, assessmentTwoId);

      yield* repository.createDecision({ decision, candidates: [candidate] });
      const recoverable = yield* repository.listRecoverableDecisions({
        createdBefore: later,
        limit: 20,
      });
      assert.deepStrictEqual(
        recoverable.map((item) => item.id),
        [decisionId],
      );

      yield* runs.upsert({
        id: agentRunId,
        missionId,
        taskId,
        threadId: ThreadId.make("routing-thread"),
        provider: "codex",
        providerInstanceId: providerId,
        providerSessionId: null,
        status: "starting",
        createdAt: later,
        updatedAt: later,
        startedAt: later,
        completedAt: null,
        errorSummary: null,
        missionAgentId: null,
        worktreeId: null,
        attemptNumber: 1,
        permissions: ALL_AGENT_PERMISSIONS,
        writeCapable: true,
        purpose: "implementation",
        repairAttemptId: null,
        routingDecisionId: decisionId,
        modelSelection: { instanceId: providerId, model: "gpt-5.6" },
        reasoningLevel: "high",
      });
      const storedDecision = yield* repository.getDecisionByRun({ agentRunId });
      assert.ok(Option.isSome(storedDecision));
      assert.strictEqual(storedDecision.value.decision.status, "applied");
      assert.deepStrictEqual(
        storedDecision.value.candidates.map((item) => item.id),
        [candidateId],
      );

      yield* repository.upsertOutcome({
        id: RoutedRunOutcomeId.make("outcome-routing-run"),
        routingDecisionId: decisionId,
        agentRunId,
        taskType: "implementation",
        complexity: "high",
        providerProfileId: providerId,
        modelProfileId: modelId,
        reasoningLevel: "high",
        completionState: "running",
        fallbackUsed: false,
        interrupted: false,
        verificationResult: "not_run",
        retryCount: 0,
        userOverride: false,
        humanDisposition: null,
        startedAt: later,
        completedAt: null,
        createdAt: later,
        updatedAt: later,
      });
      const outcome = yield* repository.getOutcomeByRun({ agentRunId });
      assert.ok(Option.isSome(outcome));
      assert.strictEqual(outcome.value.completionState, "running");

      const workspace = yield* repository.getWorkspace({
        projectId,
        missionId,
        taskId,
        roleKind: "implementer",
        observedAt: later,
      });
      assert.strictEqual(workspace.providers.length, 1);
      assert.strictEqual(workspace.models.length, 1);
      assert.strictEqual(workspace.capabilitySnapshots.length, 1);
      assert.strictEqual(workspace.policies.length, 2);
      assert.isTrue(
        workspace.policies.some((entry) => entry.id === "routing-policy:balanced-default"),
      );
      assert.strictEqual(workspace.rules.length, 1);
      assert.strictEqual(workspace.assessments.length, 2);
      assert.strictEqual(workspace.decisions.length, 1);
      assert.strictEqual(workspace.outcomes.length, 1);
      const missionWorkspace = yield* repository.getWorkspace({
        projectId,
        missionId,
        taskId: null,
        roleKind: null,
        observedAt: later,
      });
      assert.ok(missionWorkspace.overrides.some((item) => item.id === taskOverrideId));

      yield* repository.revokeOverride({ routingOverrideId: overrideId, revokedAt: later });
      const revokedOverride = yield* repository.getOverride({ routingOverrideId: overrideId });
      assert.ok(Option.isSome(revokedOverride));
      assert.strictEqual(revokedOverride.value.revokedAt, later);
      assert.deepStrictEqual(
        (yield* repository.listActiveOverrides({
          projectId,
          missionId,
          taskId,
          roleKind: "implementer",
          observedAt: later,
        })).map((item) => item.id),
        [taskOverrideId],
      );
      yield* repository.revokeOverride({ routingOverrideId: taskOverrideId, revokedAt: later });
      assert.deepStrictEqual(
        yield* repository.listActiveOverrides({
          projectId,
          missionId,
          taskId,
          roleKind: "implementer",
          observedAt: later,
        }),
        [],
      );
    }),
  );
});

describe("routing persistence restart recovery", () => {
  it.effect("reloads planned decisions and immutable candidate evidence after reopen", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-routing-"))),
      (tempDir) =>
        Effect.gen(function* () {
          const dbPath = NodePath.join(tempDir, "state.sqlite");
          yield* Effect.gen(function* () {
            yield* seedMission;
            const repository = yield* ProjectionRoutingRepository;
            yield* repository.upsertProviderProfile(provider);
            yield* repository.upsertModelProfile(model);
            yield* repository.insertCapabilitySnapshot(snapshot);
            yield* repository.saveAssessment({ assessment: assessmentOne });
            yield* repository.saveAssessment({ assessment: assessmentTwo });
            yield* repository.createDecision({ decision, candidates: [candidate] });
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));

          yield* Effect.gen(function* () {
            const repository = yield* ProjectionRoutingRepository;
            const recoverable = yield* repository.listRecoverableDecisions({
              createdBefore: later,
              limit: 20,
            });
            assert.deepStrictEqual(
              recoverable.map((item) => item.id),
              [decisionId],
            );
            const detail = yield* repository.getDecision({ routingDecisionId: decisionId });
            assert.ok(Option.isSome(detail));
            assert.strictEqual(detail.value.decision.status, "planned");
            assert.deepStrictEqual(
              detail.value.candidates.map((item) => item.id),
              [candidateId],
            );
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));
        }),
      (tempDir) => Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
