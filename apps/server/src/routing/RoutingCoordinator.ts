import {
  AgentRunId,
  ALL_AGENT_PERMISSIONS,
  AnalyticsAggregateId,
  CommandId,
  MissionTaskId,
  ModelProfileId,
  ProviderHealthRecordId,
  RoutedRunOutcomeId,
  RoutingCandidateRecordId,
  RoutingDecisionId,
  RoutingRpcError,
  TaskRoutingAssessmentId,
  ThreadId,
  type AgentPermissions,
  type AgentRunPurpose,
  type BudgetDecision,
  type ManagedWorktreeId,
  type MissionAgent,
  type ModelCapabilitySnapshot,
  type ModelProfile,
  type OrchestrationEvent,
  type OrchestrationMissionDetailSnapshot,
  type ProviderHealthRecord,
  type ProviderProfile,
  type ServerProvider,
  type RoutedRunOutcome,
  type RoutingAgentRoleKind,
  type RoutingDecision,
  type RoutingDecisionDetail,
  type RoutingHistoryInput,
  type RoutingHistoryPage,
  type RoutingManualPins,
  type RoutingOverride,
  type RoutingRefreshRegistryInput,
  type RoutingRegistrySnapshot,
  type RoutingSimulationInput,
  type RoutingSimulationResult,
  type RoutingStartMissionInput,
  type RoutingStartMissionResult,
  type RoutingTaskAssessmentDraft,
  type RoutingWorkspaceScope,
  type RoutingWorkspaceSnapshot,
  type RuntimeMode,
  type TaskRoutingAssessment,
  type VerificationRepairAttemptId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ProjectionAgentRunRepository } from "../persistence/Services/ProjectionAgentRuns.ts";
import { ProjectionRoutingRepository } from "../persistence/Services/ProjectionRouting.ts";
import { ProjectionUsageAnalyticsRepository } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkBudgetBeforeRun } from "../usage-analytics/UsageAnalyticsBudgetGuard.ts";
import { mapReasoningLevel } from "./ReasoningMapping.ts";
import {
  makeRoutingCancellationGuard,
  type RoutingCancellationNotice,
} from "./RoutingCancellationGuard.ts";
import {
  routeTask,
  simulateRouting,
  type ManualRoutingPin,
  type RoutingEngineCandidate,
  type RoutingEngineResult,
} from "./RoutingEngine.ts";
import { RoutingEventRecorder } from "./RoutingEventRecorder.ts";
import { refreshRoutingRegistry } from "./RoutingRegistry.ts";
import {
  assessTaskDeterministically,
  persistedAssessmentForRouting,
  type DeterministicTaskAssessment,
  type RoutingAssessmentForEngine,
} from "./TaskAssessment.ts";

const driverMetadata = new Map(
  BUILT_IN_DRIVERS.map((driver) => [driver.driverKind, driver.metadata]),
);

const rpcError = (reason: RoutingRpcError["reason"], message: string, retryable = false) =>
  new RoutingRpcError({ reason, message, retryable });

const persistenceError = () =>
  rpcError("persistence_error", "The routing workspace could not be persisted.", true);

const nextExpiry = (observedAt: string, milliseconds: number) =>
  DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(observedAt), { milliseconds }));

const stringRecordFlag = (record: Readonly<Record<string, unknown>>, key: string) =>
  record[key] === true;

const unique = <Value extends string>(values: Iterable<Value>) => [...new Set(values)].toSorted();

const assessDraft = (draft: RoutingTaskAssessmentDraft): DeterministicTaskAssessment => {
  const inferred = assessTaskDeterministically({
    roleKind: draft.roleKind,
    title: draft.title,
    description: draft.description,
    projectLanguages: draft.repositoryLanguages ?? [],
    affectedFiles: draft.affectedFiles ?? [],
    requiredTools: draft.requiredTools ?? [],
    writeAccessRequired: draft.writeAccessRequired,
    attachmentKinds: draft.attachmentKinds ?? [],
    estimatedMemoryTokens: draft.estimatedMemoryTokens ?? null,
    estimatedSourceTokens: draft.estimatedSourceTokens ?? null,
    predecessorHandoffTokens: draft.predecessorHandoffTokens ?? null,
    verificationFailureTokens: draft.verificationFailureTokens ?? null,
    expectedOutputTokens: draft.expectedOutputTokens ?? null,
    privacyClassification: draft.privacyClassification ?? "normal",
    visionRequired: draft.visionRequired ?? false,
    structuredOutputRequired: draft.structuredOutputRequired ?? false,
    architectureChange: draft.architectureChange ?? false,
    databaseMigration: draft.databaseMigration ?? false,
    securitySensitive: draft.securitySensitive ?? false,
    unknownRepositoryArea: draft.unknownRepositoryArea ?? false,
    crossPackageImpact: draft.crossPackageImpact ?? false,
    dependencyCount: draft.dependencyCount ?? 0,
    verificationBreadth: draft.verificationBreadth ?? "narrow",
  });
  const complexity = draft.complexity ?? inferred.complexity;
  return {
    ...inferred,
    taskType: draft.taskType ?? inferred.taskType,
    complexity: complexity === "unknown" ? inferred.complexity : complexity,
    requiredModelCapabilities: unique([
      ...inferred.requiredModelCapabilities,
      ...(draft.requiredCapabilities ?? []),
    ]),
    preferredModelCapabilities: unique([
      ...inferred.preferredModelCapabilities,
      ...(draft.preferredCapabilities ?? []),
    ]),
    recommendedReasoningLevel:
      complexity === "trivial" || complexity === "low"
        ? "low"
        : complexity === "high"
          ? "high"
          : complexity === "very_high"
            ? "extra_high"
            : "medium",
  };
};

const toAssessment = (input: {
  readonly id: TaskRoutingAssessment["id"];
  readonly taskId: TaskRoutingAssessment["taskId"];
  readonly version: number;
  readonly createdAt: string;
  readonly source: TaskRoutingAssessment["assessmentSource"];
  readonly assessment: DeterministicTaskAssessment;
}): TaskRoutingAssessment => ({
  id: input.id,
  taskId: input.taskId,
  agentRole: input.assessment.agentRole,
  taskType: input.assessment.taskType,
  complexity: input.assessment.complexity,
  requiredCapabilities: input.assessment.requiredModelCapabilities,
  preferredCapabilities: input.assessment.preferredModelCapabilities,
  estimatedContextTokens:
    input.assessment.estimatedContextTokens > 0 ? input.assessment.estimatedContextTokens : null,
  privacyClassification: input.assessment.privacyClassification,
  writeAccessRequired: input.assessment.writeAccessRequired,
  visionRequired: input.assessment.visionRequired,
  structuredOutputRequired: input.assessment.structuredOutputRequired,
  assessmentSource: input.source,
  assessmentExplanation: input.assessment.explanation,
  version: input.version,
  createdAt: input.createdAt,
  updatedAt: input.createdAt,
  supersededById: null,
});

export interface RoutingRunRequest {
  readonly missionId: RoutingStartMissionInput["missionId"];
  readonly taskId?: RoutingStartMissionInput["taskId"];
  readonly missionAgentId?: RoutingStartMissionInput["missionAgentId"];
  readonly runtimeMode: RuntimeMode;
  readonly purpose?: AgentRunPurpose;
  readonly pins?: RoutingManualPins;
  readonly requestedAt: string;
  readonly agentRunId?: AgentRunId;
  readonly threadId?: ThreadId;
  readonly worktreeId?: ManagedWorktreeId;
  readonly attemptNumber?: number;
  readonly permissions?: AgentPermissions;
  readonly writeCapable?: boolean;
  readonly repairAttemptId?: VerificationRepairAttemptId;
  readonly decisionType?: RoutingDecision["decisionType"];
  readonly commandType?: "mission.start" | "mission.retry";
  readonly automaticFallbackFromAgentRunId?: AgentRunId;
  readonly automaticStart?: boolean;
}

export interface RoutingCoordinatorShape {
  readonly getRegistry: () => Effect.Effect<RoutingRegistrySnapshot, RoutingRpcError>;
  readonly refreshRegistry: (
    input: RoutingRefreshRegistryInput,
  ) => Effect.Effect<RoutingRegistrySnapshot, RoutingRpcError>;
  readonly getWorkspace: (
    input: RoutingWorkspaceScope,
  ) => Effect.Effect<RoutingWorkspaceSnapshot, RoutingRpcError>;
  readonly streamWorkspace: (
    input: RoutingWorkspaceScope,
  ) => Stream.Stream<RoutingWorkspaceSnapshot, RoutingRpcError>;
  readonly getDecision: (
    routingDecisionId: RoutingDecisionId,
  ) => Effect.Effect<RoutingDecisionDetail, RoutingRpcError>;
  readonly listHistory: (
    input: RoutingHistoryInput,
  ) => Effect.Effect<RoutingHistoryPage, RoutingRpcError>;
  readonly simulate: (
    input: RoutingSimulationInput,
  ) => Effect.Effect<RoutingSimulationResult, RoutingRpcError>;
  readonly startMission: (
    input: RoutingStartMissionInput,
  ) => Effect.Effect<RoutingStartMissionResult, RoutingRpcError>;
  readonly routeAndStart: (
    input: RoutingRunRequest,
  ) => Effect.Effect<RoutingStartMissionResult, RoutingRpcError>;
  readonly savePolicy: (
    policy: RoutingWorkspaceSnapshot["policies"][number],
  ) => Effect.Effect<RoutingWorkspaceSnapshot["policies"][number], RoutingRpcError>;
  readonly saveRule: (
    rule: RoutingWorkspaceSnapshot["rules"][number],
  ) => Effect.Effect<RoutingWorkspaceSnapshot["rules"][number], RoutingRpcError>;
  readonly saveOverride: (
    override: RoutingOverride,
  ) => Effect.Effect<RoutingOverride, RoutingRpcError>;
  readonly revokeOverride: (
    overrideId: RoutingOverride["id"],
    revokedAt: string,
  ) => Effect.Effect<RoutingOverride, RoutingRpcError>;
  readonly saveAssessment: (
    assessment: TaskRoutingAssessment,
  ) => Effect.Effect<TaskRoutingAssessment, RoutingRpcError>;
  readonly saveProviderProfile: (
    provider: ProviderProfile,
  ) => Effect.Effect<ProviderProfile, RoutingRpcError>;
  readonly saveModelProfile: (model: ModelProfile) => Effect.Effect<ModelProfile, RoutingRpcError>;
  readonly saveCapabilitySnapshot: (
    snapshot: ModelCapabilitySnapshot,
  ) => Effect.Effect<ModelCapabilitySnapshot, RoutingRpcError>;
  readonly recordRunOutcome: (
    event: Extract<
      OrchestrationEvent,
      {
        type:
          | "agent_run.completed"
          | "agent_run.cancelled"
          | "agent_run.failed"
          | "agent_run.interrupted";
      }
    >,
  ) => Effect.Effect<void, RoutingRpcError>;
  readonly noteCancellation: (event: RoutingCancellationNotice) => Effect.Effect<void>;
  readonly fallbackAfterTransportFailure: (
    agentRunId: AgentRunId,
    occurredAt: string,
  ) => Effect.Effect<void, RoutingRpcError>;
  readonly recover: Effect.Effect<void, never>;
}

export class RoutingCoordinator extends Context.Service<
  RoutingCoordinator,
  RoutingCoordinatorShape
>()("t3/routing/RoutingCoordinator") {}

export const make = Effect.gen(function* () {
  const repository = yield* ProjectionRoutingRepository;
  const runRepository = yield* ProjectionAgentRunRepository;
  const analyticsRepository = yield* ProjectionUsageAnalyticsRepository;
  const providerRegistry = yield* ProviderRegistry;
  const snapshots = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const events = yield* RoutingEventRecorder;
  const crypto = yield* Crypto.Crypto;
  const changes = yield* PubSub.unbounded<{ readonly projectId: string | null }>();
  const cancellationGuard = makeRoutingCancellationGuard();

  const uuid = () => crypto.randomUUIDv4.pipe(Effect.orDie);
  const now = () => DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const persist = <Value, Error>(effect: Effect.Effect<Value, Error>) =>
    effect.pipe(Effect.mapError(persistenceError));
  const publish = (projectId: string | null) =>
    PubSub.publish(changes, { projectId }).pipe(Effect.asVoid);

  const recordBudgetDecision = (input: {
    readonly decision: BudgetDecision;
    readonly projectId: RoutingWorkspaceScope["projectId"];
    readonly missionId: NonNullable<RoutingWorkspaceScope["missionId"]>;
    readonly taskId: NonNullable<RoutingWorkspaceScope["taskId"]>;
    readonly agentRunId: AgentRunId | null;
    readonly occurredAt: string;
  }) =>
    Effect.gen(function* () {
      if (input.decision.action === "informational") return;
      const budgetPolicyId =
        input.decision.blockingPolicyId ?? input.decision.applicablePolicyIds[0];
      if (budgetPolicyId === undefined) return;
      yield* engine.dispatch({
        type: "analytics.event.record",
        commandId: CommandId.make(yield* uuid()),
        aggregateId: AnalyticsAggregateId.make(`analytics:budget:${input.missionId}`),
        eventType:
          input.decision.allowed || input.decision.reason.startsWith("Soft cost limit reached")
            ? "analytics.budget_soft_limit_reached"
            : "analytics.budget_hard_limit_reached",
        payload: {
          recordType: "budget_decision",
          recordId: `${budgetPolicyId}:${input.missionId}:${input.taskId}`,
          projectId: input.projectId,
          missionId: input.missionId,
          taskId: input.taskId,
          agentRunId: input.agentRunId,
          usageRecordId: null,
          costRecordId: null,
          humanDispositionRecordId: null,
          budgetPolicyId,
          exportId: null,
          retentionOperationId: null,
          detail: input.decision.reason.slice(0, 1_000),
        },
        occurredAt: input.occurredAt,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("budget decision audit failed without affecting run dispatch", {
          missionId: input.missionId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const record = (input: Parameters<typeof events.record>[0]) =>
    events.record(input).pipe(
      Effect.asVoid,
      Effect.mapError(() =>
        rpcError("orchestration_error", "The routing audit event could not be recorded.", true),
      ),
    );

  const noteCancellation: RoutingCoordinatorShape["noteCancellation"] = (event) =>
    Effect.sync(() => cancellationGuard.note(event));

  const automaticFallbackWasCancelled = (input: RoutingRunRequest) =>
    input.automaticFallbackFromAgentRunId !== undefined &&
    cancellationGuard.includes({
      missionId: input.missionId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      agentRunId: input.automaticFallbackFromAgentRunId,
    });

  const syncProviderCatalog = Effect.fn("RoutingCoordinator.syncProviderCatalog")(function* (
    liveProviders: ReadonlyArray<ServerProvider>,
  ) {
    const observedAt = yield* now();
    const beforeProviders = yield* persist(repository.listProviderProfiles());
    const beforeModels = yield* persist(repository.listModelProfiles({ providerProfileId: null }));
    const beforeCapabilityIds = new Set(
      (yield* Effect.forEach(
        beforeModels,
        (model) =>
          persist(
            repository.listCapabilitySnapshots({
              modelProfileId: model.id,
            }),
          ),
        { concurrency: 1 },
      ))
        .flat()
        .map((snapshot) => snapshot.id),
    );
    const normalized = yield* refreshRoutingRegistry({
      snapshots: liveProviders,
      metadataByDriver: driverMetadata,
      observedAt,
    }).pipe(
      Effect.provideService(ProjectionRoutingRepository, repository),
      Effect.mapError(persistenceError),
    );
    const previousProviderIds = new Set(beforeProviders.map((provider) => provider.id));
    const previousModelIds = new Set(beforeModels.map((model) => model.id));

    for (const provider of normalized) {
      yield* record({
        eventType: previousProviderIds.has(provider.profile.id)
          ? "routing.provider_updated"
          : "routing.provider_registered",
        aggregateId: provider.profile.id,
        providerProfileId: provider.profile.id,
        summary: `Provider registry synchronized with status ${provider.profile.status}.`,
      });
      const health: ProviderHealthRecord = {
        id: ProviderHealthRecordId.make(`${provider.profile.id}:health:${observedAt}`),
        providerProfileId: provider.profile.id,
        status: provider.profile.status,
        latencyMilliseconds: null,
        rateLimitState: "unknown",
        errorCategory: provider.profile.status === "error" ? "provider_snapshot_error" : null,
        observedAt,
        expiresAt: nextExpiry(observedAt, 10 * 60 * 1_000),
      };
      yield* persist(repository.insertProviderHealth(health));
      yield* record({
        eventType: "routing.provider_health_changed",
        aggregateId: provider.profile.id,
        providerProfileId: provider.profile.id,
        summary: `Provider health is ${provider.profile.status}.`,
      });
      for (const model of provider.models) {
        if (!previousModelIds.has(model.profile.id)) {
          yield* record({
            eventType: "routing.model_discovered",
            aggregateId: model.profile.id,
            providerProfileId: provider.profile.id,
            modelProfileId: model.profile.id,
            summary: `Model ${model.profile.displayName} was discovered.`,
          });
        }
        if (!beforeCapabilityIds.has(model.capabilitySnapshot.id)) {
          yield* record({
            eventType: "routing.capability_snapshot_created",
            aggregateId: model.capabilitySnapshot.id,
            providerProfileId: provider.profile.id,
            modelProfileId: model.profile.id,
            summary: `Capability snapshot ${model.capabilitySnapshot.snapshotVersion} was recorded from ${model.capabilitySnapshot.source}.`,
          });
        }
      }
    }
    yield* publish(null);
    return normalized;
  });

  const synchronize = Effect.fn("RoutingCoordinator.synchronize")(function* (
    refresh: boolean,
    providerProfileId?: ProviderProfile["id"] | null,
  ) {
    const providers = refresh
      ? providerProfileId === undefined || providerProfileId === null
        ? yield* providerRegistry.refresh()
        : yield* providerRegistry.refreshInstance(providerProfileId)
      : yield* providerRegistry.getProviders;
    yield* syncProviderCatalog(providers);
  });

  const loadRegistry = Effect.fn("RoutingCoordinator.loadRegistry")(function* () {
    const refreshedAt = yield* now();
    const providers = yield* persist(repository.listProviderProfiles());
    const models = yield* persist(repository.listModelProfiles({ providerProfileId: null }));
    const capabilitySnapshots = (yield* Effect.forEach(
      models,
      (model) =>
        persist(
          repository.getLatestCapabilitySnapshot({
            modelProfileId: model.id,
            observedAt: refreshedAt,
          }),
        ),
      { concurrency: 1 },
    )).flatMap(Option.toArray);
    const health = yield* persist(
      repository.listCurrentProviderHealth({ observedAt: refreshedAt }),
    );
    return { providers, models, capabilitySnapshots, health, refreshedAt };
  });

  const getRegistry: RoutingCoordinatorShape["getRegistry"] = Effect.fn(
    "RoutingCoordinator.getRegistry",
  )(function* () {
    yield* synchronize(false);
    return yield* loadRegistry();
  });

  const refreshRegistry: RoutingCoordinatorShape["refreshRegistry"] = Effect.fn(
    "RoutingCoordinator.refreshRegistry",
  )(function* (input) {
    yield* synchronize(true, input.providerProfileId);
    return yield* loadRegistry();
  });

  const resolutionInput = Effect.fn("RoutingCoordinator.resolutionInput")(function* (
    input: RoutingWorkspaceScope,
  ) {
    const observedAt = yield* now();
    let roleKind: MissionAgent["roleKind"] | null = null;
    if (input.missionId !== undefined && input.missionId !== null) {
      const detail =
        snapshots.getMissionDetailSnapshot === undefined
          ? Option.none<OrchestrationMissionDetailSnapshot>()
          : yield* persist(snapshots.getMissionDetailSnapshot(input.missionId));
      if (
        Option.isSome(detail) &&
        input.missionAgentId !== undefined &&
        input.missionAgentId !== null
      ) {
        roleKind =
          detail.value.missionAgents.find((agent) => agent.id === input.missionAgentId)?.roleKind ??
          null;
      }
    }
    return {
      projectId: input.projectId,
      missionId: input.missionId ?? null,
      taskId: input.taskId ?? null,
      roleKind,
      observedAt,
    };
  });

  const getWorkspace: RoutingCoordinatorShape["getWorkspace"] = Effect.fn(
    "RoutingCoordinator.getWorkspace",
  )(function* (input) {
    const query = yield* resolutionInput(input);
    const workspace = yield* persist(repository.getWorkspace(query));
    return {
      scope: input,
      policies: workspace.policies,
      rules: workspace.rules,
      roleProfiles: workspace.roleProfiles,
      overrides: workspace.overrides,
      assessments: workspace.assessments,
      decisions: workspace.decisions,
      outcomes: workspace.outcomes,
      refreshedAt: query.observedAt,
    };
  });

  const streamWorkspace: RoutingCoordinatorShape["streamWorkspace"] = (input) =>
    Stream.concat(
      Stream.fromEffect(getWorkspace(input)),
      Stream.fromPubSub(changes).pipe(
        Stream.filter(
          (change) => change.projectId === null || change.projectId === input.projectId,
        ),
        Stream.mapEffect(() => getWorkspace(input)),
      ),
    );

  const getDecision: RoutingCoordinatorShape["getDecision"] = Effect.fn(
    "RoutingCoordinator.getDecision",
  )(function* (routingDecisionId) {
    const detail = yield* persist(repository.getDecision({ routingDecisionId }));
    if (Option.isNone(detail)) {
      return yield* Effect.fail(rpcError("not_found", "The routing decision does not exist."));
    }
    const outcome =
      detail.value.decision.agentRunId === null
        ? Option.none<RoutedRunOutcome>()
        : yield* persist(
            repository.getOutcomeByRun({ agentRunId: detail.value.decision.agentRunId }),
          );
    return {
      decision: detail.value.decision,
      candidates: detail.value.candidates,
      outcome: Option.getOrNull(outcome),
    };
  });

  const listHistory: RoutingCoordinatorShape["listHistory"] = Effect.fn(
    "RoutingCoordinator.listHistory",
  )(function* (input) {
    const limit = Math.min(200, input.limit ?? 50);
    const offset = input.cursor ?? 0;
    const decisions = yield* persist(
      repository.listDecisionHistory({
        projectId: input.projectId,
        missionId: input.missionId ?? null,
        taskId: input.taskId ?? null,
        limit: limit + 1,
        offset,
      }),
    );
    const page = decisions.slice(0, limit);
    const hasMore = decisions.length > limit;
    return { decisions: page, nextCursor: hasMore ? offset + limit : null, hasMore };
  });

  const buildCandidates = Effect.fn("RoutingCoordinator.buildCandidates")(function* (input: {
    readonly projectId: RoutingWorkspaceScope["projectId"];
    readonly missionId: RoutingWorkspaceScope["missionId"];
    readonly taskId: RoutingWorkspaceScope["taskId"];
    readonly roleKind: RoutingAgentRoleKind;
    readonly observedAt: string;
  }) {
    const workspace = yield* persist(
      repository.getWorkspace({
        projectId: input.projectId,
        missionId: input.missionId ?? null,
        taskId: input.taskId ?? null,
        roleKind: input.roleKind,
        observedAt: input.observedAt,
      }),
    );
    const latestCapabilities = new Map<ModelProfileId, ModelCapabilitySnapshot>();
    for (const snapshot of workspace.capabilitySnapshots) {
      const current = latestCapabilities.get(snapshot.modelProfileId);
      if (
        current === undefined ||
        snapshot.snapshotVersion > current.snapshotVersion ||
        (snapshot.snapshotVersion === current.snapshotVersion &&
          snapshot.capturedAt > current.capturedAt)
      ) {
        latestCapabilities.set(snapshot.modelProfileId, snapshot);
      }
    }
    const health = new Map(workspace.health.map((record) => [record.providerProfileId, record]));
    const providers = new Map(workspace.providers.map((provider) => [provider.id, provider]));
    const activeRuns = yield* persist(runRepository.listActive());
    const activeByProvider = new Map<string, number>();
    const activeByModel = new Map<string, number>();
    for (const run of activeRuns) {
      activeByProvider.set(
        run.providerInstanceId,
        (activeByProvider.get(run.providerInstanceId) ?? 0) + 1,
      );
      if (run.modelSelection !== null && run.modelSelection !== undefined) {
        const activeModelId = `${run.providerInstanceId}:${run.modelSelection.model}`;
        activeByModel.set(activeModelId, (activeByModel.get(activeModelId) ?? 0) + 1);
      }
    }
    const candidates: Array<RoutingEngineCandidate> = [];
    for (const model of workspace.models) {
      const provider = providers.get(model.providerProfileId);
      const capabilitySnapshot = latestCapabilities.get(model.id);
      if (provider === undefined || capabilitySnapshot === undefined) continue;
      const metadata = driverMetadata.get(provider.providerType);
      const maximumSessions =
        typeof provider.configurationMetadata.maximumConcurrentSessions === "number"
          ? provider.configurationMetadata.maximumConcurrentSessions
          : (metadata?.concurrency.maximumConcurrentSessions ?? null);
      candidates.push({
        provider,
        model,
        capabilitySnapshot,
        providerHealth: health.get(provider.id) ?? null,
        harnessCapabilities: metadata?.harnessCapabilities ?? {
          toolExecution: "unknown",
          codeEditing: "unknown",
          streaming: "unknown",
          structuredOutput: "unknown",
          attachmentInput: "unknown",
        },
        approvedRemote:
          provider.isLocal || stringRecordFlag(provider.configurationMetadata, "approvedRemote"),
        concurrency: {
          providerActiveSessions: activeByProvider.get(provider.id) ?? 0,
          providerMaximumSessions: maximumSessions,
          modelActiveSessions: activeByModel.get(model.id) ?? 0,
          modelMaximumSessions: model.maximumConcurrentSessions,
        },
      });
    }
    return { workspace, candidates };
  });

  const engineInput = Effect.fn("RoutingCoordinator.engineInput")(function* (input: {
    readonly assessment: RoutingAssessmentForEngine;
    readonly projectId: RoutingWorkspaceScope["projectId"];
    readonly missionId: RoutingWorkspaceScope["missionId"];
    readonly taskId: RoutingWorkspaceScope["taskId"];
    readonly roleKind: RoutingAgentRoleKind;
    readonly pins?: RoutingManualPins;
    readonly observedAt: string;
  }) {
    const { workspace, candidates } = yield* buildCandidates(input);
    const currentPin: ManualRoutingPin | null =
      input.pins === undefined
        ? null
        : {
            ...(input.pins.providerProfileId === undefined
              ? {}
              : { providerProfileId: input.pins.providerProfileId }),
            ...(input.pins.modelProfileId === undefined
              ? {}
              : { modelProfileId: input.pins.modelProfileId }),
            ...(input.pins.reasoningLevel === undefined
              ? {}
              : { reasoningLevel: input.pins.reasoningLevel }),
            ...(input.pins.fallbackMode === undefined
              ? {}
              : { fallbackMode: input.pins.fallbackMode }),
            allowFallback:
              input.pins.fallbackMode !== undefined &&
              input.pins.fallbackMode !== null &&
              input.pins.fallbackMode !== "none",
          };
    return {
      workspace,
      engineInput: {
        assessment: input.assessment,
        scope: {
          projectId: input.projectId,
          missionId: input.missionId ?? null,
          taskId: input.taskId ?? null,
        },
        candidates,
        policies: workspace.policies,
        rules: workspace.rules,
        overrides: workspace.overrides,
        roleProfiles: workspace.roleProfiles,
        currentPin,
        now: input.observedAt,
        maximumFallbackSteps: 2,
      },
    };
  });

  const simulationAssessment = Effect.fn("RoutingCoordinator.simulationAssessment")(function* (
    input: RoutingSimulationInput,
  ) {
    const inferred = assessDraft(input.assessment);
    return toAssessment({
      id: TaskRoutingAssessmentId.make(`simulation:${yield* uuid()}`),
      taskId: input.taskId ?? MissionTaskId.make(`simulation:${yield* uuid()}`),
      version: 1,
      createdAt: input.now ?? (yield* now()),
      source: "system",
      assessment: inferred,
    });
  });

  const simulate: RoutingCoordinatorShape["simulate"] = Effect.fn("RoutingCoordinator.simulate")(
    function* (input) {
      yield* synchronize(false);
      const assessment = yield* simulationAssessment(input);
      const observedAt = input.now ?? (yield* now());
      const prepared = yield* engineInput({
        assessment: persistedAssessmentForRouting(assessment),
        projectId: input.projectId,
        missionId: input.missionId,
        taskId: input.taskId,
        roleKind: assessment.agentRole,
        ...(input.pins === undefined ? {} : { pins: input.pins }),
        observedAt,
      });
      const result = simulateRouting(prepared.engineInput);
      yield* record({
        eventType: "routing.simulation_completed",
        aggregateId: assessment.id,
        projectId: input.projectId,
        missionId: input.missionId ?? null,
        taskId: input.taskId ?? null,
        assessmentId: assessment.id,
        providerProfileId: result.selected?.candidate.provider.id ?? null,
        modelProfileId: result.selected?.candidate.model.id ?? null,
        summary: result.explanation,
      });
      return {
        selectedProviderProfileId: result.selected?.candidate.provider.id ?? null,
        selectedModelProfileId: result.selected?.candidate.model.id ?? null,
        selectedReasoningLevel: result.selected?.selectedReasoningLevel ?? null,
        candidates: result.evaluations.map((evaluation) => ({
          providerProfileId: evaluation.candidate.provider.id,
          modelProfileId: evaluation.candidate.model.id,
          eligible: evaluation.eligible,
          score: evaluation.score,
          rejectionReasons: evaluation.rejectionReasons,
          preferenceReasons: evaluation.preferenceReasons,
          staleCapabilitySnapshot: evaluation.rejectionReasons.includes(
            "capability_snapshot_stale",
          ),
        })),
        explanation: result.explanation,
        contextCompatible:
          result.status === "selected" ||
          !result.evaluations.some((evaluation) =>
            evaluation.rejectionReasons.some((reason) => reason.includes("context")),
          ),
        contextStrategy: result.status === "selected" ? "direct" : "incompatible",
        assessment,
      };
    },
  );

  const loadMission = Effect.fn("RoutingCoordinator.loadMission")(function* (
    missionId: RoutingRunRequest["missionId"],
  ) {
    if (snapshots.getMissionDetailSnapshot === undefined) {
      return yield* Effect.fail(
        rpcError("orchestration_error", "Mission routing is unavailable in this runtime.", true),
      );
    }
    const detail = yield* persist(snapshots.getMissionDetailSnapshot(missionId));
    if (Option.isNone(detail)) {
      return yield* Effect.fail(rpcError("not_found", "The mission does not exist."));
    }
    return detail.value;
  });

  const selectTask = (
    detail: OrchestrationMissionDetailSnapshot,
    taskId: RoutingRunRequest["taskId"],
  ) =>
    taskId === undefined
      ? detail.tasks
          .filter((task) => task.status === "ready" || task.status === "backlog")
          .toSorted(
            (left, right) => left.position - right.position || left.id.localeCompare(right.id),
          )[0]
      : detail.tasks.find((task) => task.id === taskId);

  const resolveAssessment = Effect.fn("RoutingCoordinator.resolveAssessment")(function* (input: {
    readonly detail: OrchestrationMissionDetailSnapshot;
    readonly task: OrchestrationMissionDetailSnapshot["tasks"][number];
    readonly agent: MissionAgent | undefined;
    readonly requestedAt: string;
    readonly writeCapable: boolean;
    readonly purpose: AgentRunPurpose;
  }) {
    const latest = yield* persist(repository.getLatestAssessment({ taskId: input.task.id }));
    if (
      Option.isSome(latest) &&
      (latest.value.assessmentSource === "manual" || latest.value.updatedAt >= input.task.updatedAt)
    ) {
      return latest.value;
    }
    const predecessorHandoffTokens = Math.ceil(
      input.detail.agentHandoffs
        .filter((handoff) => handoff.taskId !== input.task.id)
        .reduce((length, handoff) => length + handoff.summary.length, 0) / 4,
    );
    const inferred = assessTaskDeterministically({
      roleKind: input.agent?.roleKind ?? "implementer",
      title: input.task.title,
      description: input.task.description,
      writeAccessRequired: input.writeCapable,
      predecessorHandoffTokens,
      verificationFailureTokens: input.purpose === "verification_repair" ? 2_000 : 0,
      dependencyCount: input.detail.taskDependencies.filter(
        (dependency) => dependency.taskId === input.task.id,
      ).length,
      verificationBreadth: input.purpose === "verification_repair" ? "focused" : "narrow",
      securitySensitive: /\b(security|credential|secret|auth)\b/iu.test(
        `${input.task.title}\n${input.task.description}`,
      ),
      databaseMigration: /\b(migration|schema change|database)\b/iu.test(
        `${input.task.title}\n${input.task.description}`,
      ),
      architectureChange: /\b(architecture|system design)\b/iu.test(
        `${input.task.title}\n${input.task.description}`,
      ),
    });
    const assessment = toAssessment({
      id: TaskRoutingAssessmentId.make(yield* uuid()),
      taskId: input.task.id,
      version: Option.isSome(latest) ? latest.value.version + 1 : 1,
      createdAt: input.requestedAt,
      source: "inferred",
      assessment: inferred,
    });
    yield* persist(repository.saveAssessment({ assessment }));
    yield* record({
      eventType: Option.isSome(latest)
        ? "routing.assessment_updated"
        : "routing.assessment_created",
      aggregateId: assessment.id,
      projectId: input.detail.mission.projectId,
      missionId: input.detail.mission.id,
      taskId: input.task.id,
      assessmentId: assessment.id,
      summary: assessment.assessmentExplanation,
    });
    yield* publish(input.detail.mission.projectId);
    return assessment;
  });

  const routeFailure = (result: RoutingEngineResult) => {
    const reasons = result.evaluations.flatMap((evaluation) => evaluation.rejectionReasons);
    if (result.status === "conflict") {
      return rpcError("invalid_policy", result.explanation);
    }
    if (reasons.some((reason) => reason.includes("privacy"))) {
      return rpcError("privacy_violation", result.explanation);
    }
    if (reasons.some((reason) => reason.includes("context"))) {
      return rpcError("context_incompatible", result.explanation);
    }
    if (reasons.some((reason) => reason.includes("concurrency"))) {
      return rpcError("concurrency_exhausted", result.explanation, true);
    }
    if (reasons.some((reason) => reason.includes("pin"))) {
      return rpcError("incompatible_pin", result.explanation);
    }
    if (reasons.some((reason) => reason.includes("health") || reason.includes("provider"))) {
      return rpcError("provider_unavailable", result.explanation, true);
    }
    return rpcError("no_eligible_candidate", result.explanation);
  };

  const routeAndStart: RoutingCoordinatorShape["routeAndStart"] = Effect.fn(
    "RoutingCoordinator.routeAndStart",
  )(function* (input) {
    if (automaticFallbackWasCancelled(input)) {
      return yield* Effect.fail(
        rpcError("cancelled", "Automatic fallback stopped because cancellation was requested."),
      );
    }
    yield* synchronize(false);
    const detail = yield* loadMission(input.missionId);
    const task = selectTask(detail, input.taskId);
    if (task === undefined) {
      return yield* Effect.fail(
        rpcError("invalid_scope", "The mission has no actionable task to route."),
      );
    }
    if (automaticFallbackWasCancelled({ ...input, taskId: task.id })) {
      return yield* Effect.fail(
        rpcError("cancelled", "Automatic fallback stopped because cancellation was requested."),
      );
    }
    const agentId = input.missionAgentId ?? task.assignedMissionAgentId ?? undefined;
    const agent =
      agentId === undefined
        ? undefined
        : detail.missionAgents.find((candidate) => candidate.id === agentId);
    if (agentId !== undefined && agent === undefined) {
      return yield* Effect.fail(
        rpcError("invalid_scope", "The assigned mission agent is missing."),
      );
    }
    const permissions = input.permissions ?? agent?.permissions ?? ALL_AGENT_PERMISSIONS;
    const writeCapable =
      input.writeCapable ??
      (permissions.includes("write_files") || permissions.includes("create_commits"));
    const purpose = input.purpose ?? "implementation";
    const assessment = yield* resolveAssessment({
      detail,
      task,
      agent,
      requestedAt: input.requestedAt,
      writeCapable,
      purpose,
    });
    const agentModel =
      agent?.model === null || agent?.model === undefined
        ? null
        : ModelProfileId.make(`${agent.providerInstanceId}:${agent.model}`);
    const pins: RoutingManualPins | undefined =
      input.pins !== undefined
        ? input.pins
        : agent === undefined
          ? undefined
          : {
              providerProfileId: agent.providerInstanceId,
              modelProfileId: agentModel,
              reasoningLevel:
                agent.reasoningLevel === "low" ||
                agent.reasoningLevel === "medium" ||
                agent.reasoningLevel === "high" ||
                agent.reasoningLevel === "extra_high"
                  ? agent.reasoningLevel
                  : null,
            };
    const prepared = yield* engineInput({
      assessment: persistedAssessmentForRouting(assessment),
      projectId: detail.mission.projectId,
      missionId: detail.mission.id,
      taskId: task.id,
      roleKind: assessment.agentRole,
      ...(pins === undefined ? {} : { pins }),
      observedAt: input.requestedAt,
    });
    yield* record({
      eventType: "routing.decision_requested",
      aggregateId: task.id,
      projectId: detail.mission.projectId,
      missionId: detail.mission.id,
      taskId: task.id,
      assessmentId: assessment.id,
      summary: `Routing requested for ${assessment.taskType} at ${assessment.complexity} complexity.`,
    });
    const result = routeTask(prepared.engineInput);
    if (result.status !== "selected" || result.selected === null) {
      const failure = routeFailure(result);
      yield* record({
        eventType:
          failure.reason === "context_incompatible"
            ? "routing.context_incompatible"
            : "routing.no_eligible_candidate",
        aggregateId: task.id,
        projectId: detail.mission.projectId,
        missionId: detail.mission.id,
        taskId: task.id,
        assessmentId: assessment.id,
        summary: result.explanation,
      });
      return yield* Effect.fail(failure);
    }
    const selected = result.selected;
    const liveProviders = yield* providerRegistry.getProviders;
    const liveProvider = liveProviders.find(
      (provider) => provider.instanceId === selected.candidate.provider.id,
    );
    const liveModel = liveProvider?.models.find(
      (model) => model.slug === selected.candidate.model.providerModelId,
    );
    if (liveProvider === undefined || liveModel === undefined) {
      return yield* Effect.fail(
        rpcError(
          "provider_unavailable",
          "The selected provider model is no longer available.",
          true,
        ),
      );
    }
    const reasoning = mapReasoningLevel({
      level: selected.selectedReasoningLevel,
      capabilities: liveModel.capabilities,
    });
    if (!reasoning.supported) {
      return yield* Effect.fail(
        rpcError("no_eligible_candidate", reasoning.reason ?? "Reasoning control is incompatible."),
      );
    }
    const requiredContextTokens = assessment.estimatedContextTokens ?? 0;
    const hardContextLimit =
      selected.candidate.capabilitySnapshot.contextLimits.maximumInputTokens!;
    const preferredContextLimit =
      selected.candidate.capabilitySnapshot.contextLimits.recommendedWorkingContext ??
      hardContextLimit;
    const contextTarget = Math.min(
      hardContextLimit,
      Math.max(requiredContextTokens, preferredContextLimit),
    );
    const optionalContextTokenBudget = Math.max(0, contextTarget - requiredContextTokens);
    const contextStrategy =
      optionalContextTokenBudget === 0 ? "required_context_only" : "bounded_optional_retrieval";
    if (automaticFallbackWasCancelled({ ...input, taskId: task.id })) {
      return yield* Effect.fail(
        rpcError("cancelled", "Automatic fallback stopped because cancellation was requested."),
      );
    }
    const budgetDecision = yield* checkBudgetBeforeRun(analyticsRepository, {
      projectId: detail.mission.projectId,
      missionId: detail.mission.id,
      taskId: task.id,
      providerProfileId: selected.candidate.provider.id,
      modelProfileId: selected.candidate.model.id,
      agentRoleId: agent?.roleId ?? null,
      estimatedTokens: assessment.estimatedContextTokens,
      requestedAt: input.requestedAt,
      automaticFallback: input.automaticFallbackFromAgentRunId !== undefined,
    });
    yield* recordBudgetDecision({
      decision: budgetDecision,
      projectId: detail.mission.projectId,
      missionId: detail.mission.id,
      taskId: task.id,
      agentRunId: input.agentRunId ?? null,
      occurredAt: input.requestedAt,
    });
    if (!budgetDecision.allowed) {
      if (budgetDecision.action === "pause_new_runs" && input.automaticStart === true) {
        yield* engine
          .dispatch({
            type: "mission.scheduler.pause",
            commandId: CommandId.make(
              `analytics-budget:${detail.mission.id}:${budgetDecision.blockingPolicyId ?? "unknown"}:pause`,
            ),
            missionId: detail.mission.id,
            requestedAt: input.requestedAt,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("budget policy blocked a run but scheduler pause failed", {
                missionId: detail.mission.id,
                cause: Cause.pretty(cause),
              }),
            ),
          );
      }
      return yield* Effect.fail(
        rpcError(
          "budget_restricted",
          `${budgetDecision.reason} Create a time-limited budget override to approve this work.`,
        ),
      );
    }
    const routingDecisionId = RoutingDecisionId.make(yield* uuid());
    const agentRunId = input.agentRunId ?? AgentRunId.make(yield* uuid());
    const threadId = input.threadId ?? ThreadId.make(`${agentRunId}:thread`);
    const candidateRecords = result.evaluations.slice(0, 64).map((evaluation, index) => ({
      id: RoutingCandidateRecordId.make(`${routingDecisionId}:candidate:${index + 1}`),
      routingDecisionId,
      providerProfileId: evaluation.candidate.provider.id,
      modelProfileId: evaluation.candidate.model.id,
      eligible: evaluation.eligible,
      score: evaluation.score,
      rejectionReasons: evaluation.rejectionReasons,
      preferenceReasons: evaluation.preferenceReasons,
      capabilitySnapshotId: evaluation.candidate.capabilitySnapshot.id,
      createdAt: input.requestedAt,
    }));
    const explicitPins = input.pins;
    const decision: RoutingDecision = {
      id: routingDecisionId,
      projectId: detail.mission.projectId,
      missionId: detail.mission.id,
      taskId: task.id,
      missionAgentId: agent?.id ?? null,
      agentRunId: null,
      assessmentId: assessment.id,
      decisionType:
        input.decisionType ??
        (explicitPins !== undefined
          ? "manual"
          : result.effectivePolicy.manualModelPin || result.effectivePolicy.manualProviderPin
            ? "policy_pinned"
            : "automatic"),
      selectedProviderProfileId: selected.candidate.provider.id,
      selectedModelProfileId: selected.candidate.model.id,
      selectedCapabilitySnapshotId: selected.candidate.capabilitySnapshot.id,
      selectedReasoningLevel: selected.selectedReasoningLevel,
      manualProviderPin:
        explicitPins?.providerProfileId !== undefined && explicitPins.providerProfileId !== null,
      manualModelPin:
        explicitPins?.modelProfileId !== undefined && explicitPins.modelProfileId !== null,
      manualReasoningPin: explicitPins?.reasoningLevel !== undefined,
      fallbackPlan: result.fallbackPlan.slice(0, 2),
      candidateSummary: {
        consideredCount: result.evaluations.length,
        eligibleCount: result.evaluations.filter((evaluation) => evaluation.eligible).length,
        persistedCandidateIds: candidateRecords.map((candidate) => candidate.id),
        truncated: result.evaluations.length > candidateRecords.length,
      },
      selectionExplanation: result.explanation,
      constraintsSnapshot: {
        requiredCapabilities: assessment.requiredCapabilities,
        preferredCapabilities: assessment.preferredCapabilities,
        requiredTools: prepared.engineInput.assessment.requiredTools,
        requiredModalities: prepared.engineInput.assessment.requiredModalities,
        minimumContextTokens: assessment.estimatedContextTokens,
        maximumContextTarget: contextTarget,
        privacyClassification: assessment.privacyClassification,
        localOnly: assessment.privacyClassification === "local_only",
        maximumRetries: result.effectivePolicy.maximumRetries,
        contextStrategy,
        estimatedContextTokens: assessment.estimatedContextTokens,
        optionalContextTokenBudget,
      },
      policySnapshot: {
        policyIds: result.effectivePolicy.policyIds,
        overrideIds: result.effectivePolicy.overrideIds,
        effectiveFallbackMode: result.effectivePolicy.fallbackMode,
        effectivePrivacyMode: result.effectivePolicy.privacyMode,
        effectiveBudgetMode: result.effectivePolicy.budgetMode,
      },
      status: "planned",
      createdAt: input.requestedAt,
      appliedAt: null,
      terminalAt: null,
      failureSummary: null,
      supersededById: null,
    };
    yield* persist(repository.createDecision({ decision, candidates: candidateRecords }));
    yield* record({
      eventType: "routing.decision_created",
      aggregateId: routingDecisionId,
      projectId: decision.projectId,
      missionId: decision.missionId,
      taskId: decision.taskId,
      routingDecisionId,
      assessmentId: assessment.id,
      providerProfileId: decision.selectedProviderProfileId,
      modelProfileId: decision.selectedModelProfileId,
      summary: decision.selectionExplanation,
    });
    if (requiredContextTokens >= preferredContextLimit) {
      yield* record({
        eventType: "routing.context_reduction_applied",
        aggregateId: routingDecisionId,
        projectId: decision.projectId,
        missionId: decision.missionId,
        taskId: decision.taskId,
        routingDecisionId,
        summary:
          "Required task context consumed the preferred working window; optional memory and source retrieval was reduced without truncating the task.",
      });
    }
    if (automaticFallbackWasCancelled({ ...input, taskId: task.id })) {
      yield* persist(
        repository.markDecisionTerminal({
          routingDecisionId,
          status: "failed",
          terminalAt: input.requestedAt,
          failureSummary: "Automatic fallback stopped because cancellation was requested.",
        }),
      );
      yield* record({
        eventType: "routing.fallback_cancelled",
        aggregateId: routingDecisionId,
        projectId: decision.projectId,
        missionId: decision.missionId,
        taskId: decision.taskId,
        routingDecisionId,
        summary: "Cancellation arrived before the fallback run was dispatched.",
      });
      return yield* Effect.fail(
        rpcError("cancelled", "Automatic fallback stopped because cancellation was requested."),
      );
    }
    const dispatchStart = engine
      .dispatch({
        type: input.commandType ?? "mission.start",
        commandId: CommandId.make(`routing:${routingDecisionId}:start`),
        missionId: detail.mission.id,
        taskId: task.id,
        agentRunId,
        threadId,
        providerInstanceId: selected.candidate.provider.id,
        modelSelection: {
          instanceId: selected.candidate.provider.id,
          model: selected.candidate.model.providerModelId,
          ...(reasoning.providerSelections.length > 0
            ? { options: reasoning.providerSelections }
            : {}),
        },
        runtimeMode: input.runtimeMode,
        ...(agent === undefined ? {} : { missionAgentId: agent.id }),
        ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
        ...(input.attemptNumber === undefined ? {} : { attemptNumber: input.attemptNumber }),
        permissions,
        writeCapable,
        purpose,
        ...(input.repairAttemptId === undefined ? {} : { repairAttemptId: input.repairAttemptId }),
        routingDecisionId,
        ...(selected.selectedReasoningLevel === null
          ? {}
          : { reasoningLevel: selected.selectedReasoningLevel }),
        createdAt: input.requestedAt,
      })
      .pipe(
        Effect.mapError(() =>
          rpcError("orchestration_error", "The routed mission run could not be started.", true),
        ),
      );
    yield* dispatchStart.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* persist(
            repository.markDecisionTerminal({
              routingDecisionId,
              status: "failed",
              terminalAt: input.requestedAt,
              failureSummary: error.message,
            }),
          );
          yield* record({
            eventType: "routing.decision_failed",
            aggregateId: routingDecisionId,
            projectId: decision.projectId,
            missionId: decision.missionId,
            taskId: decision.taskId,
            routingDecisionId,
            summary: error.message,
          });
          return yield* Effect.fail(error);
        }),
      ),
    );
    const cancelledAfterDispatch = automaticFallbackWasCancelled({ ...input, taskId: task.id });
    if (cancelledAfterDispatch) {
      yield* engine
        .dispatch({
          type: "mission.agent-run.cancel",
          commandId: CommandId.make(`routing:${routingDecisionId}:cancel`),
          missionId: detail.mission.id,
          agentRunId,
          cancelledAt: input.requestedAt,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("routed fallback cancellation could not be dispatched", {
              routingDecisionId,
              agentRunId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      yield* record({
        eventType: "routing.fallback_cancelled",
        aggregateId: routingDecisionId,
        projectId: decision.projectId,
        missionId: decision.missionId,
        taskId: decision.taskId,
        routingDecisionId,
        summary:
          "Cancellation arrived as the fallback run was dispatched; cancellation followed immediately.",
      });
    }
    yield* record({
      eventType: "routing.decision_applied",
      aggregateId: routingDecisionId,
      projectId: decision.projectId,
      missionId: decision.missionId,
      taskId: decision.taskId,
      routingDecisionId,
      assessmentId: assessment.id,
      providerProfileId: decision.selectedProviderProfileId,
      modelProfileId: decision.selectedModelProfileId,
      summary: `Decision applied to agent run ${agentRunId}.`,
    });
    yield* publish(detail.mission.projectId);
    const applied = yield* persist(repository.getDecision({ routingDecisionId }));
    if (Option.isNone(applied)) {
      return yield* Effect.fail(persistenceError());
    }
    return { routingDecisionId, agentRunId, threadId, decision: applied.value.decision };
  });

  const startMission: RoutingCoordinatorShape["startMission"] = (input) =>
    routeAndStart({
      missionId: input.missionId,
      runtimeMode: input.runtimeMode,
      requestedAt: input.requestedAt,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.missionAgentId === undefined ? {} : { missionAgentId: input.missionAgentId }),
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      ...(input.pins === undefined ? {} : { pins: input.pins }),
    });

  const savePolicy: RoutingCoordinatorShape["savePolicy"] = Effect.fn(
    "RoutingCoordinator.savePolicy",
  )(function* (policy) {
    const existing = yield* persist(repository.getPolicy({ routingPolicyId: policy.id }));
    yield* persist(repository.upsertPolicy(policy));
    yield* record({
      eventType: Option.isSome(existing) ? "routing.policy_updated" : "routing.policy_created",
      aggregateId: policy.id,
      summary: `Routing policy ${policy.name} was saved.`,
    });
    yield* publish(policy.scopeType === "project" ? policy.scopeId : null);
    return policy;
  });

  const saveRule: RoutingCoordinatorShape["saveRule"] = Effect.fn("RoutingCoordinator.saveRule")(
    function* (rule) {
      const policy = yield* persist(
        repository.getPolicy({ routingPolicyId: rule.routingPolicyId }),
      );
      if (Option.isNone(policy)) {
        return yield* Effect.fail(
          rpcError("invalid_policy", "The routing rule policy is missing."),
        );
      }
      yield* persist(repository.upsertRule(rule));
      yield* record({
        eventType: "routing.policy_updated",
        aggregateId: rule.routingPolicyId,
        summary: `Routing rule ${rule.name} was saved.`,
      });
      yield* publish(policy.value.scopeType === "project" ? policy.value.scopeId : null);
      return rule;
    },
  );

  const saveOverride: RoutingCoordinatorShape["saveOverride"] = Effect.fn(
    "RoutingCoordinator.saveOverride",
  )(function* (override) {
    yield* persist(repository.createOverride(override));
    yield* record({
      eventType: "routing.manual_override_created",
      aggregateId: override.id,
      overrideId: override.id,
      providerProfileId: override.providerProfileId,
      modelProfileId: override.modelProfileId,
      summary: override.reason,
    });
    yield* publish(override.scopeType === "project" ? override.scopeId : null);
    return override;
  });

  const revokeOverride: RoutingCoordinatorShape["revokeOverride"] = Effect.fn(
    "RoutingCoordinator.revokeOverride",
  )(function* (overrideId, revokedAt) {
    const current = yield* persist(repository.getOverride({ routingOverrideId: overrideId }));
    if (Option.isNone(current)) {
      return yield* Effect.fail(rpcError("not_found", "The routing override does not exist."));
    }
    yield* persist(repository.revokeOverride({ routingOverrideId: overrideId, revokedAt }));
    const revoked = { ...current.value, revokedAt };
    yield* record({
      eventType: "routing.manual_override_revoked",
      aggregateId: overrideId,
      overrideId,
      summary: current.value.reason,
    });
    yield* publish(current.value.scopeType === "project" ? current.value.scopeId : null);
    return revoked;
  });

  const saveAssessment: RoutingCoordinatorShape["saveAssessment"] = Effect.fn(
    "RoutingCoordinator.saveAssessment",
  )(function* (assessment) {
    const latest = yield* persist(repository.getLatestAssessment({ taskId: assessment.taskId }));
    if (Option.isSome(latest) && assessment.version !== latest.value.version + 1) {
      return yield* Effect.fail(
        rpcError("invalid_scope", "Task assessments are immutable and must use the next version."),
      );
    }
    yield* persist(repository.saveAssessment({ assessment }));
    yield* record({
      eventType: Option.isSome(latest)
        ? "routing.assessment_updated"
        : "routing.assessment_created",
      aggregateId: assessment.id,
      taskId: assessment.taskId,
      assessmentId: assessment.id,
      summary: assessment.assessmentExplanation,
    });
    yield* publish(null);
    return assessment;
  });

  const saveProviderProfile: RoutingCoordinatorShape["saveProviderProfile"] = Effect.fn(
    "RoutingCoordinator.saveProviderProfile",
  )(function* (provider) {
    const existing = yield* persist(
      repository.getProviderProfile({ providerProfileId: provider.id }),
    );
    if (Option.isNone(existing)) {
      return yield* Effect.fail(rpcError("not_found", "The provider profile does not exist."));
    }
    yield* persist(repository.upsertProviderProfile(provider));
    yield* record({
      eventType: provider.isEnabled ? "routing.provider_enabled" : "routing.provider_disabled",
      aggregateId: provider.id,
      providerProfileId: provider.id,
      summary: `${provider.displayName} was ${provider.isEnabled ? "enabled" : "disabled"} for routing.`,
    });
    yield* publish(null);
    return provider;
  });

  const saveModelProfile: RoutingCoordinatorShape["saveModelProfile"] = Effect.fn(
    "RoutingCoordinator.saveModelProfile",
  )(function* (model) {
    const existing = yield* persist(repository.getModelProfile({ modelProfileId: model.id }));
    if (Option.isNone(existing)) {
      return yield* Effect.fail(rpcError("not_found", "The model profile does not exist."));
    }
    yield* persist(repository.upsertModelProfile(model));
    yield* record({
      eventType: model.isDeprecated
        ? "routing.model_deprecated"
        : model.isEnabled
          ? "routing.model_enabled"
          : "routing.model_disabled",
      aggregateId: model.id,
      providerProfileId: model.providerProfileId,
      modelProfileId: model.id,
      summary: `${model.displayName} routing metadata was updated.`,
    });
    yield* publish(null);
    return model;
  });

  const saveCapabilitySnapshot: RoutingCoordinatorShape["saveCapabilitySnapshot"] = Effect.fn(
    "RoutingCoordinator.saveCapabilitySnapshot",
  )(function* (snapshot) {
    if (snapshot.source !== "manual_override") {
      return yield* Effect.fail(
        rpcError(
          "invalid_scope",
          "Manual capability corrections require manual_override provenance.",
        ),
      );
    }
    const model = yield* persist(
      repository.getModelProfile({ modelProfileId: snapshot.modelProfileId }),
    );
    if (Option.isNone(model)) {
      return yield* Effect.fail(rpcError("not_found", "The corrected model does not exist."));
    }
    const latest = yield* persist(
      repository.getLatestCapabilitySnapshot({
        modelProfileId: snapshot.modelProfileId,
        observedAt: snapshot.capturedAt,
      }),
    );
    if (Option.isSome(latest) && snapshot.snapshotVersion !== latest.value.snapshotVersion + 1) {
      return yield* Effect.fail(
        rpcError(
          "invalid_scope",
          "Capability corrections are immutable and must use the next version.",
        ),
      );
    }
    yield* persist(repository.insertCapabilitySnapshot(snapshot));
    yield* record({
      eventType: "routing.capability_snapshot_created",
      aggregateId: snapshot.id,
      providerProfileId: model.value.providerProfileId,
      modelProfileId: snapshot.modelProfileId,
      summary: `Manual capability snapshot ${snapshot.snapshotVersion} was recorded.`,
    });
    yield* publish(null);
    return snapshot;
  });

  const recordRunOutcome: RoutingCoordinatorShape["recordRunOutcome"] = Effect.fn(
    "RoutingCoordinator.recordRunOutcome",
  )(function* (event) {
    const decisionDetail = yield* persist(
      repository.getDecisionByRun({ agentRunId: event.payload.agentRunId }),
    );
    if (Option.isNone(decisionDetail)) return;
    const decision = decisionDetail.value.decision;
    const assessment = yield* persist(
      repository.getAssessmentById({ assessmentId: decision.assessmentId }),
    );
    const run = yield* persist(runRepository.getById({ agentRunId: event.payload.agentRunId }));
    if (Option.isNone(assessment) || Option.isNone(run)) return;
    const existing = yield* persist(
      repository.getOutcomeByRun({ agentRunId: event.payload.agentRunId }),
    );
    const history = yield* persist(
      repository.listDecisionHistory({
        projectId: decision.projectId,
        missionId: decision.missionId,
        taskId: decision.taskId,
        limit: 100,
        offset: 0,
      }),
    );
    const completionState =
      event.type === "agent_run.completed"
        ? "completed"
        : event.type === "agent_run.cancelled"
          ? "cancelled"
          : event.type === "agent_run.interrupted"
            ? "interrupted"
            : "failed";
    const outcome: RoutedRunOutcome = {
      id: Option.isSome(existing)
        ? existing.value.id
        : RoutedRunOutcomeId.make(`routing-outcome:${event.payload.agentRunId}`),
      routingDecisionId: decision.id,
      agentRunId: event.payload.agentRunId,
      taskType: assessment.value.taskType,
      complexity: assessment.value.complexity,
      providerProfileId: decision.selectedProviderProfileId,
      modelProfileId: decision.selectedModelProfileId,
      reasoningLevel: decision.selectedReasoningLevel,
      completionState,
      fallbackUsed: decision.decisionType === "fallback" || decision.decisionType === "retry",
      interrupted: event.type === "agent_run.interrupted",
      verificationResult: "not_run",
      retryCount: history.filter(
        (entry) => entry.decisionType === "fallback" || entry.decisionType === "retry",
      ).length,
      userOverride:
        decision.manualProviderPin || decision.manualModelPin || decision.manualReasoningPin,
      humanDisposition: null,
      startedAt: run.value.startedAt,
      completedAt: event.payload.occurredAt,
      createdAt: Option.isSome(existing) ? existing.value.createdAt : event.payload.occurredAt,
      updatedAt: event.payload.occurredAt,
    };
    yield* persist(repository.upsertOutcome(outcome));
    if (event.type === "agent_run.failed") {
      yield* record({
        eventType: "routing.decision_failed",
        aggregateId: decision.id,
        projectId: decision.projectId,
        missionId: decision.missionId,
        taskId: decision.taskId,
        routingDecisionId: decision.id,
        providerProfileId: decision.selectedProviderProfileId,
        modelProfileId: decision.selectedModelProfileId,
        summary: event.payload.errorSummary ?? "The routed run failed.",
      });
    }
    yield* publish(decision.projectId);
  });

  const fallbackAfterTransportFailure: RoutingCoordinatorShape["fallbackAfterTransportFailure"] =
    Effect.fn("RoutingCoordinator.fallbackAfterTransportFailure")(
      function* (agentRunId, occurredAt) {
        const current = yield* persist(repository.getDecisionByRun({ agentRunId }));
        if (Option.isNone(current)) return;
        const decision = current.value.decision;
        const run = yield* persist(runRepository.getById({ agentRunId }));
        if (
          Option.isNone(run) ||
          decision.missionId === null ||
          decision.taskId === null ||
          decision.fallbackPlan.length === 0
        ) {
          yield* record({
            eventType: "routing.fallback_exhausted",
            aggregateId: decision.id,
            projectId: decision.projectId,
            missionId: decision.missionId,
            taskId: decision.taskId,
            routingDecisionId: decision.id,
            summary: "No bounded fallback candidate remained after a transport failure.",
          });
          return;
        }
        if (
          cancellationGuard.includes({
            missionId: decision.missionId,
            taskId: decision.taskId,
            agentRunId,
          })
        ) {
          yield* record({
            eventType: "routing.fallback_cancelled",
            aggregateId: decision.id,
            projectId: decision.projectId,
            missionId: decision.missionId,
            taskId: decision.taskId,
            routingDecisionId: decision.id,
            summary: "Automatic fallback was suppressed because cancellation was requested.",
          });
          return;
        }
        const history = yield* persist(
          repository.listDecisionHistory({
            projectId: decision.projectId,
            missionId: decision.missionId,
            taskId: decision.taskId,
            limit: 100,
            offset: 0,
          }),
        );
        const fallbackAttempts = history.filter(
          (entry) => entry.decisionType === "fallback" || entry.decisionType === "retry",
        ).length;
        if (fallbackAttempts >= 2) {
          yield* record({
            eventType: "routing.fallback_exhausted",
            aggregateId: decision.id,
            projectId: decision.projectId,
            missionId: decision.missionId,
            taskId: decision.taskId,
            routingDecisionId: decision.id,
            summary: "The maximum of two automatic fallback attempts was reached.",
          });
          return;
        }
        const step = decision.fallbackPlan[0]!;
        yield* record({
          eventType: "routing.fallback_started",
          aggregateId: decision.id,
          projectId: decision.projectId,
          missionId: decision.missionId,
          taskId: decision.taskId,
          routingDecisionId: decision.id,
          providerProfileId: step.providerProfileId,
          modelProfileId: step.modelProfileId,
          summary: step.reason,
        });
        const next = yield* routeAndStart({
          missionId: decision.missionId,
          taskId: decision.taskId,
          ...(run.value.missionAgentId === null
            ? {}
            : { missionAgentId: run.value.missionAgentId }),
          runtimeMode: run.value.writeCapable ? "auto-accept-edits" : "approval-required",
          purpose: run.value.purpose ?? "implementation",
          pins: {
            providerProfileId: step.providerProfileId,
            modelProfileId: step.modelProfileId,
            reasoningLevel: step.reasoningLevel,
            fallbackMode: decision.policySnapshot.effectiveFallbackMode,
          },
          requestedAt: occurredAt,
          ...(run.value.worktreeId === null ? {} : { worktreeId: run.value.worktreeId }),
          attemptNumber: run.value.attemptNumber + 1,
          permissions: run.value.permissions,
          writeCapable: run.value.writeCapable,
          ...(run.value.repairAttemptId === undefined || run.value.repairAttemptId === null
            ? {}
            : { repairAttemptId: run.value.repairAttemptId }),
          decisionType:
            step.providerProfileId === decision.selectedProviderProfileId &&
            step.modelProfileId === decision.selectedModelProfileId
              ? "retry"
              : "fallback",
          commandType: "mission.retry",
          automaticFallbackFromAgentRunId: agentRunId,
        }).pipe(
          Effect.catch((error) =>
            record({
              eventType:
                error.reason === "cancelled"
                  ? "routing.fallback_cancelled"
                  : "routing.fallback_exhausted",
              aggregateId: decision.id,
              projectId: decision.projectId,
              missionId: decision.missionId,
              taskId: decision.taskId,
              routingDecisionId: decision.id,
              summary:
                error.reason === "cancelled"
                  ? error.message
                  : `Fallback candidate was no longer eligible: ${error.message}`,
            }).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
        yield* persist(
          repository.supersedeDecision({
            routingDecisionId: decision.id,
            supersededById: next.routingDecisionId,
            terminalAt: occurredAt,
          }),
        );
        yield* record({
          eventType: "routing.decision_superseded",
          aggregateId: decision.id,
          projectId: decision.projectId,
          missionId: decision.missionId,
          taskId: decision.taskId,
          routingDecisionId: decision.id,
          summary: `Superseded by fallback decision ${next.routingDecisionId}.`,
        });
        yield* record({
          eventType: "routing.fallback_candidate_selected",
          aggregateId: next.routingDecisionId,
          projectId: decision.projectId,
          missionId: decision.missionId,
          taskId: decision.taskId,
          routingDecisionId: next.routingDecisionId,
          providerProfileId: next.decision.selectedProviderProfileId,
          modelProfileId: next.decision.selectedModelProfileId,
          summary: next.decision.selectionExplanation,
        });
        yield* publish(decision.projectId);
      },
    );

  const recover = Effect.gen(function* () {
    const recoveredAt = yield* now();
    const pending = yield* repository.listRecoverableDecisions({
      createdBefore: recoveredAt,
      limit: 500,
    });
    yield* Effect.forEach(
      pending,
      (decision) =>
        Effect.gen(function* () {
          yield* repository.markDecisionTerminal({
            routingDecisionId: decision.id,
            status: "failed",
            terminalAt: recoveredAt,
            failureSummary: "Server restart interrupted the route-before-launch transaction.",
          });
          yield* events.record({
            eventType: "routing.decision_failed",
            aggregateId: decision.id,
            projectId: decision.projectId,
            missionId: decision.missionId,
            taskId: decision.taskId,
            routingDecisionId: decision.id,
            summary:
              "Restart recovery failed the orphaned planned decision without launching work.",
          });
        }),
      { concurrency: 1, discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("routing restart recovery failed", { cause: String(cause) }),
    ),
  );

  return RoutingCoordinator.of({
    getRegistry,
    refreshRegistry,
    getWorkspace,
    streamWorkspace,
    getDecision,
    listHistory,
    simulate,
    startMission,
    routeAndStart,
    savePolicy,
    saveRule,
    saveOverride,
    revokeOverride,
    saveAssessment,
    saveProviderProfile,
    saveModelProfile,
    saveCapabilitySnapshot,
    recordRunOutcome,
    noteCancellation,
    fallbackAfterTransportFailure,
    recover,
  });
});

export const layer = Layer.effect(RoutingCoordinator, make);
