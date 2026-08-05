import {
  AgentRunId,
  CostRecordId,
  ModelProfileId,
  ProviderProfileId,
  RunPerformanceRecordId,
  ToolExecutionMetricId,
  UsageRecordId,
  isTerminalAgentRunStatus,
  type AgentRun,
  type AgentHandoff,
  type AnalyticsCurrency,
  type MemoryRetrievalRecord,
  type MissionAgent,
  type OrchestrationEvent,
  type PricingSource,
  type ProviderRuntimeEvent,
  type RunCompletionCategory,
  type TaskDependency,
  type ToolMetricCategory,
  type UsageRecord,
  type UsageSource,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionAgentRunRepository } from "../persistence/Services/ProjectionAgentRuns.ts";
import { ProjectionMissionRepository } from "../persistence/Services/ProjectionMissions.ts";
import { ProjectionMissionTeamRepository } from "../persistence/Services/ProjectionMissionTeams.ts";
import { ProjectionMemoryRepository } from "../persistence/Services/ProjectionMemory.ts";
import { ProjectionRoutingRepository } from "../persistence/Services/ProjectionRouting.ts";
import { ProjectionUsageAnalyticsRepository } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { forkParked } from "../serverActivation.ts";
import { buildFinalizedUsageCostRecord } from "./UsageAnalyticsCostFinalizer.ts";
import { UsageAnalyticsEventRecorder } from "./UsageAnalyticsEventRecorder.ts";
import { normalizeUsageSnapshot, type UsageNormalizationCursor } from "./UsageNormalizer.ts";

type AgentRunTerminalEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "agent_run.completed"
      | "agent_run.cancelled"
      | "agent_run.failed"
      | "agent_run.interrupted";
  }
>;

interface RunContext {
  readonly run: AgentRun;
  readonly projectId: ReturnType<typeof import("@t3tools/contracts").ProjectId.make>;
  readonly parentAgentRunId: AgentRunId | null;
}

interface MissionRunRelations {
  readonly runs: ReadonlyArray<AgentRun>;
  readonly missionAgents: ReadonlyArray<MissionAgent>;
  readonly taskDependencies: ReadonlyArray<TaskDependency>;
  readonly handoffs: ReadonlyArray<AgentHandoff>;
}

interface ModelIdentity {
  readonly providerProfileId: ReturnType<typeof ProviderProfileId.make>;
  readonly modelProfileId: ReturnType<typeof ModelProfileId.make>;
}

interface CostFinalizationSettings {
  readonly pricingSourcePriority: ReadonlyArray<PricingSource>;
  readonly defaultReportingCurrency: AnalyticsCurrency;
  readonly localComputeHourlyRate: string | null;
}

interface StreamedUsageEstimate {
  outputCharacterCount: number;
  reasoningCharacterCount: number;
  readonly eventIds: Set<string>;
}

export interface MemoryRetrievalSummary {
  readonly retrievalCount: number;
  readonly memoryTokenEstimate: number;
  readonly selectedMemoryCount: number;
  readonly sourceChunkCount: number;
  readonly retrievalFailureCount: number;
}

const DEFAULT_COST_FINALIZATION_SETTINGS: CostFinalizationSettings = {
  pricingSourcePriority: [
    "provider_reported",
    "official_catalog",
    "user_configured",
    "subscription_plan",
    "unknown",
  ],
  defaultReportingCurrency: "USD",
  localComputeHourlyRate: null,
};

const usageOccurredAt = (usage: UsageRecord): string =>
  usage.completedAt ?? usage.startedAt ?? usage.recordedAt;

const elapsedMilliseconds = (startedAt: string, completedAt: string): number | null => {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  return Number.isFinite(started) && Number.isFinite(completed)
    ? Math.max(0, completed - started)
    : null;
};

const modelIdentity = (run: AgentRun): ModelIdentity | null => {
  if (run.modelSelection === undefined || run.modelSelection === null) return null;
  return {
    providerProfileId: ProviderProfileId.make(run.providerInstanceId),
    modelProfileId: ModelProfileId.make(`${run.providerInstanceId}:${run.modelSelection.model}`),
  };
};

export const classifyRunCompletion = (event: AgentRunTerminalEvent): RunCompletionCategory => {
  if (event.type === "agent_run.completed") return "completed";
  if (event.type === "agent_run.cancelled") return "cancelled";
  if (event.type === "agent_run.interrupted") return "interrupted";
  switch (event.payload.runtimeErrorClass ?? "unknown") {
    case "provider_error":
      return "failed_provider";
    case "transport_error":
      return "failed_transport";
    case "permission_error":
      return "permission_blocked";
    case "validation_error":
      return "failed_source";
    case "unknown":
      return "unknown";
  }
};

export const recoveredRunCompletion = (status: AgentRun["status"]): RunCompletionCategory => {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "interrupted":
      return "interrupted";
    case "failed":
    case "starting":
    case "running":
    case "cancelling":
      return "unknown";
  }
};

export const toolMetricCategory = (
  itemType: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.completed" }
  >["payload"]["itemType"],
): ToolMetricCategory | null => {
  switch (itemType) {
    case "command_execution":
      return "command";
    case "file_change":
      return "file_write";
    case "web_search":
      return "repository_search";
    case "image_view":
      return "custom";
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return "custom";
    default:
      return null;
  }
};

export const usageSourceForProvider = (provider: ProviderRuntimeEvent["provider"]): UsageSource =>
  provider === "codex" || provider === "claude" ? "provider_reported" : "adapter_calculated";

/** Converts an imprecise provider number into the decimal wire format without exponent notation. */
export const providerCostDecimal = (value: number): string | null => {
  if (!Number.isFinite(value) || value < 0) return null;
  const fixed = value.toFixed(18);
  return fixed.replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, "").replace(/\.$/, "");
};

export const countNewProviderRequest = (seen: Set<string>, requestKey: string): 0 | 1 => {
  if (seen.has(requestKey)) return 0;
  seen.add(requestKey);
  return 1;
};

/**
 * A deliberately coarse fallback for adapters that expose streamed text but no token metadata.
 * It is only stored with `context_estimated` / low confidence; the source text never leaves memory.
 */
export const estimateTokensFromCharacterCount = (characterCount: number): number | null =>
  characterCount <= 0 ? null : Math.ceil(characterCount / 4);

export const summarizeMemoryRetrievals = (
  records: ReadonlyArray<MemoryRetrievalRecord>,
): MemoryRetrievalSummary => ({
  retrievalCount: records.length,
  memoryTokenEstimate: records.reduce((sum, record) => sum + record.tokenEstimate, 0),
  selectedMemoryCount: records.reduce((sum, record) => sum + record.selectedMemoryIds.length, 0),
  sourceChunkCount: records.reduce((sum, record) => sum + record.selectedChunkIds.length, 0),
  retrievalFailureCount: records.filter(
    ({ status }) => status === "failed" || status === "unavailable",
  ).length,
});

/**
 * Resolves the durable run tree from mission-team semantics. Directed handoffs are authoritative;
 * otherwise a non-coordinator run belongs to the latest eligible coordinator run. Direct task
 * dependencies narrow coordinator candidates when the mission has more than one coordinator run.
 */
export const deriveParentAgentRunId = (input: {
  readonly run: AgentRun;
  readonly relations: MissionRunRelations;
}): AgentRunId | null => {
  const { run, relations } = input;
  if (run.missionAgentId === null) return null;

  const runsById = new Map(relations.runs.map((candidate) => [candidate.id, candidate]));
  const eligible = (candidate: AgentRun): boolean =>
    candidate.id !== run.id &&
    candidate.missionId === run.missionId &&
    candidate.startedAt.localeCompare(run.startedAt) <= 0;
  const latest = (candidates: ReadonlyArray<AgentRun>): AgentRunId | null =>
    candidates.toSorted(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id),
    )[0]?.id ?? null;

  const directedHandoffRuns = relations.handoffs.flatMap((handoff) => {
    if (handoff.missionId !== run.missionId || handoff.toMissionAgentId !== run.missionAgentId) {
      return [];
    }
    const candidate = runsById.get(handoff.agentRunId);
    return candidate !== undefined && eligible(candidate) ? [candidate] : [];
  });
  const directedParent = latest(directedHandoffRuns);
  if (directedParent !== null) return directedParent;

  const runAgent = relations.missionAgents.find(({ id }) => id === run.missionAgentId);
  if (runAgent === undefined || runAgent.roleKind === "coordinator") return null;
  const coordinatorAgentIds = new Set(
    relations.missionAgents
      .filter(({ roleKind }) => roleKind === "coordinator")
      .map(({ id }) => id),
  );
  const coordinatorRuns = relations.runs.filter(
    (candidate) =>
      candidate.missionAgentId !== null &&
      coordinatorAgentIds.has(candidate.missionAgentId) &&
      eligible(candidate),
  );
  const dependencyTaskIds = new Set(
    run.taskId === null
      ? []
      : relations.taskDependencies
          .filter(({ missionId, taskId }) => missionId === run.missionId && taskId === run.taskId)
          .map(({ dependsOnTaskId }) => dependsOnTaskId),
  );
  const dependencyCoordinators = coordinatorRuns.filter(
    ({ taskId }) => taskId !== null && dependencyTaskIds.has(taskId),
  );
  return latest(dependencyCoordinators.length > 0 ? dependencyCoordinators : coordinatorRuns);
};

export const UsageAnalyticsLifecycleLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const analytics = yield* ProjectionUsageAnalyticsRepository;
    const agentRuns = yield* ProjectionAgentRunRepository;
    const missionTeams = yield* ProjectionMissionTeamRepository;
    const missions = yield* ProjectionMissionRepository;
    const memory = yield* ProjectionMemoryRepository;
    const routing = yield* ProjectionRoutingRepository;
    const providers = yield* ProviderService;
    const orchestration = yield* OrchestrationEngineService;
    const audit = yield* UsageAnalyticsEventRecorder;

    const usageCursorByThread = new Map<string, UsageNormalizationCursor>();
    const usageRequestKeysByThread = new Map<string, Set<string>>();
    const firstOutputByThread = new Map<string, string>();
    const streamedUsageEstimateByThread = new Map<string, StreamedUsageEstimate>();
    const contextReductionByThread = new Set<string>();
    const toolStartedAt = new Map<string, string>();
    const runContextByThread = new Map<string, RunContext>();

    const collectionEnabled = analytics
      .getSettings()
      .pipe(Effect.map(Option.match({ onNone: () => true, onSome: ({ enabled }) => enabled })));

    const loadMissionRunRelations = (
      missionId: AgentRun["missionId"],
      knownRuns?: ReadonlyArray<AgentRun>,
    ) =>
      Effect.all(
        {
          runs:
            knownRuns === undefined
              ? agentRuns.listByMissionId({ missionId })
              : Effect.succeed(knownRuns),
          missionAgents: missionTeams.listMissionAgentsByMissionId({ missionId }),
          taskDependencies: missionTeams.listTaskDependenciesByMissionId({ missionId }),
          handoffs: missionTeams.listAgentHandoffsByMissionId({ missionId }),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("analytics run parentage unavailable; recording a root run", {
            missionId,
            cause: Cause.pretty(cause),
          }).pipe(
            Effect.as({
              runs: knownRuns ?? [],
              missionAgents: [],
              taskDependencies: [],
              handoffs: [],
            } satisfies MissionRunRelations),
          ),
        ),
      );

    const contextForRun = (
      run: AgentRun,
      projectId: RunContext["projectId"],
      knownRelations?: MissionRunRelations,
    ) =>
      Effect.gen(function* () {
        const relations = knownRelations ?? (yield* loadMissionRunRelations(run.missionId));
        return {
          run,
          projectId,
          parentAgentRunId: deriveParentAgentRunId({ run, relations }),
        } satisfies RunContext;
      });

    const contextForThread = (threadId: AgentRun["threadId"]) =>
      Effect.gen(function* () {
        const cached = runContextByThread.get(threadId);
        if (cached !== undefined) return cached;
        const run = Option.getOrNull(yield* agentRuns.getByThreadId({ threadId }));
        if (run === null) return null;
        const mission = Option.getOrNull(yield* missions.getById({ missionId: run.missionId }));
        if (mission === null) return null;
        const context = yield* contextForRun(run, mission.projectId);
        runContextByThread.set(threadId, context);
        return context;
      });

    const recordAudit = (
      eventType: Parameters<typeof audit.record>[0]["eventType"],
      recordType: string,
      recordId: string,
      context: RunContext,
      detail: string | null = null,
    ) =>
      audit
        .record({
          eventType,
          aggregateId: `analytics:${context.projectId}`,
          payload: {
            recordType,
            recordId,
            projectId: context.projectId,
            missionId: context.run.missionId,
            taskId: context.run.taskId,
            agentRunId: context.run.id,
            usageRecordId: recordType === "usage_record" ? UsageRecordId.make(recordId) : null,
            costRecordId: recordType === "cost_record" ? CostRecordId.make(recordId) : null,
            budgetPolicyId: null,
            exportId: null,
            retentionOperationId: null,
            humanDispositionRecordId: null,
            detail,
          },
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("analytics audit reference could not be recorded", {
              eventType,
              recordId,
              cause: Cause.pretty(cause),
            }),
          ),
          Effect.asVoid,
        );

    const costFinalizationSettings = analytics.getSettings().pipe(
      Effect.map(
        Option.match({
          onNone: () => DEFAULT_COST_FINALIZATION_SETTINGS,
          onSome: (settings): CostFinalizationSettings => ({
            pricingSourcePriority: settings.pricingSourcePriority,
            defaultReportingCurrency: settings.defaultReportingCurrency,
            localComputeHourlyRate: settings.localComputeHourlyRate,
          }),
        }),
      ),
    );

    const finalizeUsageCost = (
      usage: UsageRecord,
      context: RunContext | null,
      settings: CostFinalizationSettings,
      activeDurationMilliseconds: number | null,
    ) =>
      Effect.gen(function* () {
        if (usage.state !== "final" && usage.state !== "reconciled") return;
        const pricingSnapshots = yield* analytics.listPricingSnapshots({
          providerProfileId: usage.providerProfileId,
          modelProfileId: usage.modelProfileId,
          currency: null,
          effectiveAt: usageOccurredAt(usage),
          limit: 500,
          offset: 0,
        });
        const providerProfile = Option.getOrNull(
          yield* routing.getProviderProfile({ providerProfileId: usage.providerProfileId }),
        );
        const record = buildFinalizedUsageCostRecord({
          usage,
          pricingSnapshots,
          pricingSourcePriority: settings.pricingSourcePriority,
          defaultReportingCurrency: settings.defaultReportingCurrency,
          localComputeHourlyRate: settings.localComputeHourlyRate,
          isLocalProvider: providerProfile?.isLocal === true,
          activeDurationMilliseconds,
        });
        if (record === null) return;
        const existing = yield* analytics.getCostRecord({ costRecordId: record.id });
        if (Option.isSome(existing)) return;
        yield* analytics.insertCostRecord(record);
        if (context !== null) {
          yield* recordAudit("analytics.cost_calculated", "cost_record", record.id, context);
        }
      });

    const finalizeUsageCostsForRun = (context: RunContext, completedAt: string) =>
      Effect.gen(function* () {
        const [settings, performance, records] = yield* Effect.all([
          costFinalizationSettings,
          analytics.getRunPerformance({ agentRunId: context.run.id }),
          analytics.queryUsageRecords({
            filter: {
              dateRange: { from: null, to: null },
              projectId: context.projectId,
              missionId: context.run.missionId,
              taskId: context.run.taskId,
              agentRunId: context.run.id,
              providerProfileId: null,
              modelProfileId: null,
              agentRoleId: null,
              reasoningLevel: null,
              humanDisposition: null,
              subscriptionBacked: null,
            },
            limit: 500,
            offset: 0,
          }),
        ]);
        const activeDurationMilliseconds =
          Option.getOrNull(performance)?.activeDurationMilliseconds ??
          elapsedMilliseconds(context.run.startedAt, completedAt);
        yield* Effect.forEach(
          records,
          (usage) => finalizeUsageCost(usage, context, settings, activeDurationMilliseconds),
          { discard: true },
        );
      });

    const captureUsage = (
      event: Extract<ProviderRuntimeEvent, { type: "thread.token-usage.updated" }>,
      context: RunContext,
    ) =>
      Effect.gen(function* () {
        const existing = yield* analytics.getUsageRecordBySource({
          sourceEventId: event.eventId,
        });
        if (Option.isSome(existing)) return;

        const source = usageSourceForProvider(event.provider);
        const providerRequestKey = event.turnId ?? event.providerRefs?.providerRequestId;
        const observationKey = providerRequestKey ?? event.eventId;
        const requestKeys = usageRequestKeysByThread.get(event.threadId) ?? new Set<string>();
        usageRequestKeysByThread.set(event.threadId, requestKeys);
        const normalized = normalizeUsageSnapshot({
          snapshot: event.payload.usage,
          previous: usageCursorByThread.get(event.threadId) ?? null,
          source,
          observationKey,
        });
        usageCursorByThread.set(event.threadId, normalized.cursor);
        if (normalized.duplicate) return;
        const requestCount =
          providerRequestKey === undefined
            ? null
            : countNewProviderRequest(requestKeys, providerRequestKey);

        const identity = modelIdentity(context.run);
        const providerProfileId =
          identity?.providerProfileId ?? ProviderProfileId.make(context.run.providerInstanceId);
        const modelProfileId =
          identity?.modelProfileId ??
          ModelProfileId.make(`${context.run.providerInstanceId}:unknown`);
        const id = UsageRecordId.make(`usage:${event.eventId}`);
        yield* analytics.upsertUsageRecord({
          id,
          sourceEventId: event.eventId,
          sourceTurnId: event.turnId ?? null,
          projectId: context.projectId,
          missionId: context.run.missionId,
          taskId: context.run.taskId,
          agentRunId: context.run.id,
          parentAgentRunId: context.parentAgentRunId,
          routingDecisionId: context.run.routingDecisionId ?? null,
          providerProfileId,
          modelProfileId,
          capabilitySnapshotId: null,
          providerRequestId: event.providerRefs?.providerRequestId ?? null,
          providerResponseId: event.providerRefs?.providerTurnId ?? null,
          usageSource: normalized.usage.usageSource,
          usageConfidence: normalized.usage.usageConfidence,
          state: source === "unknown" ? "unknown" : "provisional",
          inputTokens: normalized.usage.inputTokens,
          outputTokens: normalized.usage.outputTokens,
          reasoningTokens: normalized.usage.reasoningTokens,
          cachedInputTokens: normalized.usage.cachedInputTokens,
          cacheWriteTokens: normalized.usage.cacheWriteTokens,
          cacheReadTokens: normalized.usage.cacheReadTokens,
          totalTokens: normalized.usage.totalTokens,
          requestCount,
          toolCallCount: normalized.usage.toolCallCount,
          providerRoundTripCount: null,
          startedAt: context.run.startedAt,
          completedAt: null,
          recordedAt: event.createdAt,
          reconciledAt: normalized.usage.state === "reconciled" ? event.createdAt : null,
        });
        yield* recordAudit("analytics.usage_recorded", "usage_record", id, context);
      });

    const captureProviderCost = (
      event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
      context: RunContext,
    ) =>
      Effect.gen(function* () {
        if (event.payload.totalCostUsd === undefined) return;
        const amount = providerCostDecimal(event.payload.totalCostUsd);
        if (amount === null) return;
        const identity = modelIdentity(context.run) ?? {
          providerProfileId: ProviderProfileId.make(context.run.providerInstanceId),
          modelProfileId: ModelProfileId.make(`${context.run.providerInstanceId}:unknown`),
        };
        const id = CostRecordId.make(`provider-cost:${event.eventId}`);
        const existing = yield* analytics.getCostRecord({ costRecordId: id });
        if (Option.isSome(existing)) return;
        yield* analytics.insertCostRecord({
          id,
          sourceKey: `provider:${event.eventId}`,
          usageRecordId: null,
          agentRunId: context.run.id,
          projectId: context.projectId,
          missionId: context.run.missionId,
          taskId: context.run.taskId,
          providerProfileId: identity.providerProfileId,
          modelProfileId: identity.modelProfileId,
          pricingSnapshotId: null,
          amount,
          currency: "USD",
          costType: "provider_reported",
          calculationMethod: "provider_reported",
          confidence: "confirmed",
          isEstimated: false,
          isSubscriptionBacked: false,
          calculationBreakdown: [],
          missingPricingDimensions: [],
          createdAt: event.createdAt,
        });
        yield* recordAudit("analytics.provider_cost_received", "cost_record", id, context);
      });

    const captureTool = (
      event: Extract<ProviderRuntimeEvent, { type: "item.started" | "item.completed" }>,
      context: RunContext,
    ) =>
      Effect.gen(function* () {
        const category = toolMetricCategory(event.payload.itemType);
        if (category === null) return;
        const providerItemId = event.itemId ?? null;
        const stableKey = `${event.threadId}:${providerItemId ?? event.eventId}`;
        const existingStartedAt = toolStartedAt.get(stableKey);
        const startedAt = existingStartedAt ?? event.createdAt;
        if (event.type === "item.started") toolStartedAt.set(stableKey, event.createdAt);
        const completed = event.type === "item.completed";
        const failed = event.payload.status === "failed";
        const declined = event.payload.status === "declined";
        yield* analytics.upsertToolMetric({
          id: ToolExecutionMetricId.make(`tool:${stableKey}`),
          sourceEventId: event.eventId,
          providerItemId,
          agentRunId: context.run.id,
          taskId: context.run.taskId,
          toolCategory: category,
          toolName: (event.payload.title ?? event.payload.itemType).slice(0, 256),
          status: !completed ? "running" : failed ? "failed" : declined ? "denied" : "completed",
          startedAt,
          completedAt: completed ? event.createdAt : null,
          durationMilliseconds: completed ? elapsedMilliseconds(startedAt, event.createdAt) : null,
          inputSize: null,
          outputSize: null,
          errorCategory: failed ? "provider_tool_failure" : null,
          retryCount: 0,
          createdAt: startedAt,
          updatedAt: event.createdAt,
        });
        if (completed) toolStartedAt.delete(stableKey);
      });

    const handleProviderEvent = (event: ProviderRuntimeEvent) =>
      Effect.gen(function* () {
        if (!(yield* collectionEnabled)) return;
        if (
          event.type !== "thread.token-usage.updated" &&
          event.type !== "turn.completed" &&
          event.type !== "item.started" &&
          event.type !== "item.completed" &&
          event.type !== "content.delta"
        ) {
          return;
        }
        const context = yield* contextForThread(event.threadId);
        if (context === null) return;
        if (event.type === "content.delta") {
          const isOutput =
            event.payload.streamKind === "assistant_text" ||
            event.payload.streamKind === "plan_text";
          const isReasoning = event.payload.streamKind === "reasoning_text";
          if (!isOutput && !isReasoning) return;
          if (!firstOutputByThread.has(event.threadId)) {
            firstOutputByThread.set(event.threadId, event.createdAt);
          }
          const estimate = streamedUsageEstimateByThread.get(event.threadId) ?? {
            outputCharacterCount: 0,
            reasoningCharacterCount: 0,
            eventIds: new Set<string>(),
          };
          streamedUsageEstimateByThread.set(event.threadId, estimate);
          if (estimate.eventIds.has(event.eventId)) return;
          estimate.eventIds.add(event.eventId);
          if (isReasoning) {
            estimate.reasoningCharacterCount += event.payload.delta.length;
          } else {
            estimate.outputCharacterCount += event.payload.delta.length;
          }
          return;
        }
        if (event.type === "thread.token-usage.updated") {
          yield* captureUsage(event, context);
        } else if (event.type === "turn.completed") {
          yield* captureProviderCost(event, context);
        } else {
          if (event.payload.itemType === "context_compaction") {
            contextReductionByThread.add(event.threadId);
          }
          yield* captureTool(event, context);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("analytics provider capture failed without affecting the run", {
                eventType: event.type,
                eventId: event.eventId,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    const ensureUnknownUsage = (context: RunContext, completedAt: string) =>
      Effect.gen(function* () {
        const records = yield* analytics.queryUsageRecords({
          filter: {
            dateRange: { from: null, to: null },
            projectId: context.projectId,
            missionId: context.run.missionId,
            taskId: context.run.taskId,
            agentRunId: context.run.id,
            providerProfileId: null,
            modelProfileId: null,
            agentRoleId: null,
            reasoningLevel: null,
            humanDisposition: null,
            subscriptionBacked: null,
          },
          limit: 500,
          offset: 0,
        });
        if (records.length === 0) {
          const identity = modelIdentity(context.run);
          const estimate = streamedUsageEstimateByThread.get(context.run.threadId);
          const outputTokens = estimateTokensFromCharacterCount(
            estimate?.outputCharacterCount ?? 0,
          );
          const reasoningTokens = estimateTokensFromCharacterCount(
            estimate?.reasoningCharacterCount ?? 0,
          );
          const hasEstimate = outputTokens !== null || reasoningTokens !== null;
          const id = UsageRecordId.make(
            hasEstimate ? `usage:estimate:${context.run.id}` : `usage:unknown:${context.run.id}`,
          );
          yield* analytics.upsertUsageRecord({
            id,
            sourceEventId: hasEstimate
              ? `agent-run-terminal-estimate:${context.run.id}`
              : `agent-run-terminal:${context.run.id}`,
            sourceTurnId: null,
            projectId: context.projectId,
            missionId: context.run.missionId,
            taskId: context.run.taskId,
            agentRunId: context.run.id,
            parentAgentRunId: context.parentAgentRunId,
            routingDecisionId: context.run.routingDecisionId ?? null,
            providerProfileId:
              identity?.providerProfileId ?? ProviderProfileId.make(context.run.providerInstanceId),
            modelProfileId:
              identity?.modelProfileId ??
              ModelProfileId.make(`${context.run.providerInstanceId}:unknown`),
            capabilitySnapshotId: null,
            providerRequestId: null,
            providerResponseId: null,
            usageSource: hasEstimate ? "context_estimated" : "unknown",
            usageConfidence: hasEstimate ? "low" : "unknown",
            state: hasEstimate ? "final" : "unknown",
            inputTokens: null,
            outputTokens,
            reasoningTokens,
            cachedInputTokens: null,
            cacheWriteTokens: null,
            cacheReadTokens: null,
            totalTokens: null,
            requestCount: null,
            toolCallCount: null,
            providerRoundTripCount: null,
            startedAt: context.run.startedAt,
            completedAt,
            recordedAt: completedAt,
            reconciledAt: null,
          });
          yield* recordAudit(
            hasEstimate ? "analytics.usage_recorded" : "analytics.usage_unknown",
            "usage_record",
            id,
            context,
          );
          return;
        }
        yield* Effect.forEach(
          records.filter(({ state }) => state === "provisional"),
          (record) =>
            analytics
              .finalizeUsageRecord({
                record: {
                  ...record,
                  state: "final",
                  completedAt,
                  reconciledAt: completedAt,
                },
              })
              .pipe(
                Effect.andThen(
                  recordAudit("analytics.usage_reconciled", "usage_record", record.id, context),
                ),
              ),
          { discard: true },
        );
      });

    const finalizePerformance = (input: {
      readonly context: RunContext;
      readonly completedAt: string;
      readonly completionCategory: RunCompletionCategory;
      readonly cancelledBy: string | null;
    }) =>
      Effect.gen(function* () {
        const { context } = input;
        const run = context.run;
        const identity = modelIdentity(run);
        if (identity === null) return null;
        const [routingOutcomeOption, routingDecisionOption, memoryRecords] = yield* Effect.all(
          [
            routing.getOutcomeByRun({ agentRunId: run.id }),
            routing.getDecisionByRun({ agentRunId: run.id }),
            memory.listRetrievalRecords({
              projectId: context.projectId,
              agentRunId: run.id,
              threadId: null,
              limit: 500,
              offset: 0,
            }),
          ],
          { concurrency: "unbounded" },
        );
        const routingOutcome = Option.getOrNull(routingOutcomeOption);
        const routingDecision = Option.getOrNull(routingDecisionOption);
        const memorySummary = summarizeMemoryRetrievals(memoryRecords);
        const firstOutputAt = firstOutputByThread.get(run.threadId) ?? null;
        const toolMetrics = yield* analytics.queryToolMetrics({
          filter: {
            dateRange: { from: null, to: null },
            projectId: null,
            missionId: run.missionId,
            taskId: run.taskId,
            agentRunId: run.id,
            providerProfileId: null,
            modelProfileId: null,
            agentRoleId: null,
            reasoningLevel: null,
            humanDisposition: null,
            subscriptionBacked: null,
          },
          limit: 500,
          offset: 0,
        });
        const completedAt = input.completedAt;
        yield* analytics.finalizeRunPerformance({
          id: RunPerformanceRecordId.make(`performance:${run.id}`),
          agentRunId: run.id,
          taskId: run.taskId,
          missionId: run.missionId,
          providerProfileId: identity.providerProfileId,
          modelProfileId: identity.modelProfileId,
          reasoningLevel: run.reasoningLevel ?? null,
          queuedDurationMilliseconds: elapsedMilliseconds(run.createdAt, run.startedAt),
          startupDurationMilliseconds:
            firstOutputAt === null ? null : elapsedMilliseconds(run.startedAt, firstOutputAt),
          firstOutputLatencyMilliseconds:
            firstOutputAt === null ? null : elapsedMilliseconds(run.startedAt, firstOutputAt),
          activeDurationMilliseconds: elapsedMilliseconds(run.startedAt, completedAt),
          wallClockDurationMilliseconds: elapsedMilliseconds(run.createdAt, completedAt),
          status: "finalized",
          completionCategory: input.completionCategory,
          fallbackCount: routingOutcome?.fallbackUsed === true ? 1 : 0,
          providerRetryCount: routingOutcome?.retryCount ?? 0,
          toolFailureCount: toolMetrics.filter(({ status }) => status === "failed").length,
          contextReductionApplied:
            contextReductionByThread.has(run.threadId) ||
            routingDecision?.decision.constraintsSnapshot.optionalContextTokenBudget === 0,
          cancelledBy: input.cancelledBy,
          createdAt: run.createdAt,
          updatedAt: completedAt,
          finalizedAt: completedAt,
        });
        firstOutputByThread.delete(run.threadId);
        contextReductionByThread.delete(run.threadId);
        return [
          `memoryRetrievals=${memorySummary.retrievalCount}`,
          `memoryTokenEstimate=${memorySummary.memoryTokenEstimate}`,
          `selectedMemories=${memorySummary.selectedMemoryCount}`,
          `sourceChunks=${memorySummary.sourceChunkCount}`,
          `memoryRetrievalFailures=${memorySummary.retrievalFailureCount}`,
        ].join(";");
      });

    const handleOrchestrationEvent = (event: OrchestrationEvent) =>
      Effect.gen(function* () {
        if (!(yield* collectionEnabled)) return;
        if (event.type === "agent_run.started") {
          const run = event.payload.run;
          const identity = modelIdentity(run);
          if (identity === null) return;
          yield* analytics.upsertRunPerformance({
            id: RunPerformanceRecordId.make(`performance:${run.id}`),
            agentRunId: run.id,
            taskId: run.taskId,
            missionId: run.missionId,
            providerProfileId: identity.providerProfileId,
            modelProfileId: identity.modelProfileId,
            reasoningLevel: run.reasoningLevel ?? null,
            queuedDurationMilliseconds: elapsedMilliseconds(run.createdAt, run.startedAt),
            startupDurationMilliseconds: null,
            firstOutputLatencyMilliseconds: null,
            activeDurationMilliseconds: null,
            wallClockDurationMilliseconds: null,
            status: "running",
            completionCategory: "unknown",
            fallbackCount: 0,
            providerRetryCount: 0,
            toolFailureCount: 0,
            contextReductionApplied: false,
            cancelledBy: null,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            finalizedAt: null,
          });
          return;
        }
        if (
          event.type !== "agent_run.completed" &&
          event.type !== "agent_run.cancelled" &&
          event.type !== "agent_run.failed" &&
          event.type !== "agent_run.interrupted"
        ) {
          return;
        }
        const run = Option.getOrNull(
          yield* agentRuns.getById({ agentRunId: event.payload.agentRunId }),
        );
        if (run === null) return;
        const mission = Option.getOrNull(yield* missions.getById({ missionId: run.missionId }));
        if (mission === null) return;
        const context = yield* contextForRun(run, mission.projectId);
        yield* ensureUnknownUsage(context, event.payload.occurredAt);
        const performanceDetail = yield* finalizePerformance({
          context,
          completedAt: event.payload.occurredAt,
          completionCategory: classifyRunCompletion(event),
          cancelledBy: event.type === "agent_run.cancelled" ? "mission_or_user" : null,
        });
        usageCursorByThread.delete(run.threadId);
        usageRequestKeysByThread.delete(run.threadId);
        streamedUsageEstimateByThread.delete(run.threadId);
        runContextByThread.delete(run.threadId);
        yield* finalizeUsageCostsForRun(context, event.payload.occurredAt).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("analytics cost finalization failed without affecting the run", {
              agentRunId: run.id,
              cause: Cause.pretty(cause),
            }),
          ),
        );
        yield* recordAudit(
          "analytics.run_performance_finalized",
          "run_performance",
          `performance:${run.id}`,
          context,
          performanceDetail,
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("analytics finalization failed without affecting orchestration", {
                eventType: event.type,
                eventId: event.eventId,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    const recoverTerminalRunFinalization = Effect.gen(function* () {
      if (!(yield* collectionEnabled)) return;
      const existingMissions = yield* missions.listAll();
      yield* Effect.forEach(
        existingMissions,
        (mission) =>
          Effect.gen(function* () {
            const runs = yield* agentRuns.listByMissionId({ missionId: mission.id });
            const relations = yield* loadMissionRunRelations(mission.id, runs);
            yield* Effect.forEach(
              runs.filter(
                (run) => isTerminalAgentRunStatus(run.status) && run.completedAt !== null,
              ),
              (run) =>
                Effect.gen(function* () {
                  if (run.completedAt === null) return;
                  const context = yield* contextForRun(run, mission.projectId, relations);
                  yield* ensureUnknownUsage(context, run.completedAt);
                  const existing = Option.getOrNull(
                    yield* analytics.getRunPerformance({ agentRunId: run.id }),
                  );
                  if (existing?.status !== "finalized") {
                    const performanceDetail = yield* finalizePerformance({
                      context,
                      completedAt: run.completedAt,
                      completionCategory: recoveredRunCompletion(run.status),
                      cancelledBy: run.status === "cancelled" ? "mission_or_user" : null,
                    });
                    yield* recordAudit(
                      "analytics.run_performance_finalized",
                      "run_performance",
                      `performance:${run.id}`,
                      context,
                      performanceDetail,
                    );
                  }
                  yield* finalizeUsageCostsForRun(context, run.completedAt);
                }).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("analytics restart recovery skipped one terminal run", {
                      agentRunId: run.id,
                      cause: Cause.pretty(cause),
                    }),
                  ),
                ),
              { concurrency: 4, discard: true },
            );
          }),
        { concurrency: 2, discard: true },
      );
    });

    const recoverUsageCostFinalization = Effect.gen(function* () {
      const settings = yield* costFinalizationSettings;
      const pageSize = 500;
      let offset = 0;
      while (offset <= 100_000) {
        const records = yield* analytics.listUsageRecords({
          projectId: null,
          recordedFrom: null,
          recordedTo: null,
          limit: pageSize,
          offset,
        });
        yield* Effect.forEach(
          records,
          (storedUsage) =>
            Effect.gen(function* () {
              const run = Option.getOrNull(
                yield* agentRuns.getById({ agentRunId: storedUsage.agentRunId }),
              );
              let usage = storedUsage;
              if (usage.state === "provisional") {
                if (
                  run === null ||
                  !isTerminalAgentRunStatus(run.status) ||
                  run.completedAt === null
                ) {
                  return;
                }
                usage = {
                  ...usage,
                  state: "final",
                  completedAt: run.completedAt,
                  reconciledAt: run.completedAt,
                };
                yield* analytics.finalizeUsageRecord({ record: usage });
              }
              if (usage.state !== "final" && usage.state !== "reconciled") return;

              const mission =
                run === null
                  ? null
                  : Option.getOrNull(yield* missions.getById({ missionId: run.missionId }));
              const context =
                run === null || mission === null
                  ? null
                  : ({
                      run,
                      projectId: mission.projectId,
                      parentAgentRunId: usage.parentAgentRunId,
                    } satisfies RunContext);
              const performance = Option.getOrNull(
                yield* analytics.getRunPerformance({ agentRunId: usage.agentRunId }),
              );
              const activeDurationMilliseconds =
                performance?.activeDurationMilliseconds ??
                (run?.completedAt === null || run?.completedAt === undefined
                  ? null
                  : elapsedMilliseconds(run.startedAt, run.completedAt));
              yield* finalizeUsageCost(usage, context, settings, activeDurationMilliseconds);
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("analytics usage cost recovery skipped one record", {
                  usageRecordId: storedUsage.id,
                  cause: Cause.pretty(cause),
                }),
              ),
            ),
          { discard: true },
        );
        if (records.length < pageSize) break;
        offset += pageSize;
      }
    });

    const interruptedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    yield* analytics
      .interruptRunningOperations({
        interruptedAt,
        errorCategory: "server_restart",
      })
      .pipe(
        Effect.tap((counts) =>
          counts.exportCount > 0 || counts.retentionOperationCount > 0
            ? Effect.logInfo("analytics restart recovery interrupted incomplete operations", counts)
            : Effect.void,
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("analytics restart recovery could not inspect operations", {
            cause: Cause.pretty(cause),
          }),
        ),
      );
    yield* recoverUsageCostFinalization.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("analytics restart recovery could not finalize usage costs", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* recoverTerminalRunFinalization.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("analytics restart recovery could not finalize terminal runs", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* forkParked(Stream.runForEach(providers.streamEvents, handleProviderEvent));
    yield* forkParked(
      Stream.runForEach(orchestration.streamDomainEvents, handleOrchestrationEvent),
    );
  }),
);
