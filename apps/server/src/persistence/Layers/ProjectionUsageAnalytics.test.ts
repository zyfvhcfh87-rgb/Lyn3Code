import {
  AgentRunId,
  AnalyticsCurrency,
  AnalyticsExportId,
  AnalyticsRetentionOperationId,
  CostRecordId,
  HumanDispositionRecordId,
  ExchangeRateSnapshotId,
  MissionId,
  MissionOutcomeRecordId,
  MissionTaskId,
  ModelProfileId,
  PricingSnapshotId,
  ProjectId,
  ProviderProfileId,
  SubscriptionAttributionRule,
  SubscriptionAttributionRuleId,
  TaskOutcomeRecordId,
  UsageRecordId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionUsageAnalyticsRepository } from "../Services/ProjectionUsageAnalytics.ts";
import { ProjectionUsageAnalyticsRepositoryLive } from "./ProjectionUsageAnalytics.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { allocateSubscriptionCosts } from "../../usage-analytics/SubscriptionAttribution.ts";

const now = "2026-08-04T10:00:00.000Z";
const later = "2026-08-04T10:01:00.000Z";
const projectId = ProjectId.make("analytics-repository-project");
const missionId = MissionId.make("analytics-repository-mission");
const taskId = MissionTaskId.make("analytics-repository-task");
const agentRunId = AgentRunId.make("analytics-repository-run");
const providerId = ProviderProfileId.make("analytics-provider");
const modelId = ModelProfileId.make("analytics-model");

const persistenceLayer = SqlitePersistenceMemory;
const layer = it.layer(
  Layer.mergeAll(
    ProjectionUsageAnalyticsRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  ),
);

const seedRun = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'Analytics', '/analytics', NULL, '[]', ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_missions (
      mission_id, project_id, title, description, status, created_at, updated_at,
      started_at, completed_at, cancelled_at
    ) VALUES (${missionId}, ${projectId}, 'Measure', '', 'running', ${now}, ${now}, ${now}, NULL, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_mission_tasks (
      task_id, mission_id, title, description, status, position, created_at, updated_at,
      started_at, completed_at
    ) VALUES (${taskId}, ${missionId}, 'Capture', '', 'running', 0, ${now}, ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_agent_runs (
      agent_run_id, mission_id, task_id, thread_id, provider, provider_instance_id,
      provider_session_id, status, created_at, updated_at, started_at, completed_at,
      error_summary
    ) VALUES (
      ${agentRunId}, ${missionId}, ${taskId}, 'analytics-thread', 'codex', 'analytics-provider',
      NULL, 'running', ${now}, ${now}, ${now}, NULL, NULL
    )
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_routing_provider_profiles (
      provider_profile_id, provider_type, display_name, endpoint_class, status,
      is_enabled, is_local, supports_model_discovery, configuration_metadata_json,
      created_at, updated_at
    ) VALUES (${providerId}, 'codex', 'Analytics Provider', 'official_cloud', 'available', 1, 0, 1, '{}', ${now}, ${now})
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_routing_model_profiles (
      model_profile_id, provider_profile_id, provider_model_id, display_name, status,
      is_enabled, is_deprecated, discovered_automatically, created_at, updated_at
    ) VALUES (${modelId}, ${providerId}, 'analytics-model', 'Analytics Model', 'available', 1, 0, 1, ${now}, ${now})
  `;
});

layer("usage analytics persistence repository", (it) => {
  it.effect("upserts usage idempotently, finalizes once, and preserves unknown nulls", () =>
    Effect.gen(function* () {
      yield* seedRun;
      const repository = yield* ProjectionUsageAnalyticsRepository;
      const sql = yield* SqlClient.SqlClient;
      const usage = {
        id: UsageRecordId.make("usage-one"),
        sourceEventId: "provider-event-one",
        sourceTurnId: null,
        projectId,
        missionId,
        taskId,
        agentRunId,
        parentAgentRunId: null,
        routingDecisionId: null,
        providerProfileId: ProviderProfileId.make("unregistered-provider"),
        modelProfileId: ModelProfileId.make("unregistered-model"),
        capabilitySnapshotId: null,
        providerRequestId: null,
        providerResponseId: null,
        usageSource: "unknown" as const,
        usageConfidence: "unknown" as const,
        state: "provisional" as const,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cachedInputTokens: null,
        cacheWriteTokens: null,
        cacheReadTokens: null,
        totalTokens: null,
        requestCount: 1,
        toolCallCount: null,
        providerRoundTripCount: null,
        startedAt: null,
        completedAt: null,
        recordedAt: now,
        reconciledAt: null,
      };

      yield* repository.upsertUsageRecord(usage);
      yield* repository.upsertUsageRecord({ ...usage, inputTokens: 12, totalTokens: 12 });
      assert.deepStrictEqual(
        yield* sql`SELECT count(*) AS count FROM projection_analytics_usage_records`,
        [{ count: 1 }],
      );
      yield* repository.finalizeUsageRecord({
        record: {
          ...usage,
          state: "final",
          usageSource: "provider_reported",
          usageConfidence: "confirmed",
          inputTokens: 12,
          totalTokens: 12,
          completedAt: later,
        },
      });
      yield* repository.upsertUsageRecord({ ...usage, inputTokens: 999, totalTokens: 999 });

      const stored = yield* repository.getUsageRecordBySource({
        sourceEventId: usage.sourceEventId,
      });
      assert.ok(Option.isSome(stored));
      assert.strictEqual(stored.value.state, "final");
      assert.strictEqual(stored.value.inputTokens, 12);
      assert.strictEqual(stored.value.outputTokens, null);
      assert.strictEqual(stored.value.toolCallCount, null);
      assert.strictEqual(stored.value.providerRoundTripCount, null);
      assert.strictEqual(stored.value.capabilitySnapshotId, null);
      assert.strictEqual(stored.value.modelProfileId, "unregistered-model");

      const taskOutcome = {
        id: TaskOutcomeRecordId.make("task-outcome-one"),
        taskId,
        missionId,
        status: "completed" as const,
        implementationCompleted: true,
        verificationResult: "passed" as const,
        integrationResult: "integrated" as const,
        humanDisposition: "not_reviewed" as const,
        reverted: false,
        firstPassVerification: true,
        repairAttemptCount: 0,
        agentRunCount: 1,
        totalWallClockDurationMilliseconds: null,
        totalActiveAgentDurationMilliseconds: null,
        createdAt: now,
        updatedAt: later,
        finalizedAt: later,
      };
      yield* repository.upsertTaskOutcome(taskOutcome);
      const inferredApproval = yield* Effect.exit(
        repository.upsertTaskOutcome({ ...taskOutcome, humanDisposition: "accepted" }),
      );
      assert.isTrue(Exit.isFailure(inferredApproval));

      const disposition = {
        id: HumanDispositionRecordId.make("human-disposition-one"),
        taskOutcomeRecordId: taskOutcome.id,
        taskId,
        missionId,
        disposition: "accepted" as const,
        actor: "maintainer@example.test",
        markedAt: later,
        reason: "Reviewed the verified implementation.",
        sourceFingerprint: "git:abc123",
        sourceChangedAfterDisposition: false,
        sourceChangedAt: null,
      };
      yield* repository.recordHumanDisposition(disposition);
      yield* repository.recordHumanDisposition(disposition);
      const dispositions = yield* repository.listHumanDispositions({
        taskId,
        limit: 20,
        offset: 0,
      });
      assert.strictEqual(dispositions.length, 1);
      assert.strictEqual(dispositions[0]?.actor, "maintainer@example.test");
      assert.strictEqual(dispositions[0]?.reason, "Reviewed the verified implementation.");
      assert.isFalse(dispositions[0]?.sourceChangedAfterDisposition ?? true);
      yield* repository.markHumanDispositionSourceChanged({
        humanDispositionRecordId: disposition.id,
        sourceChangedAt: "2026-08-04T10:02:00.000Z",
      });
      const latestDisposition = yield* repository.getLatestHumanDisposition({ taskId });
      assert.ok(Option.isSome(latestDisposition));
      assert.isTrue(latestDisposition.value.sourceChangedAfterDisposition);
      assert.strictEqual(latestDisposition.value.sourceChangedAt, "2026-08-04T10:02:00.000Z");

      const explicitlyReviewedOutcome = yield* repository.getTaskOutcome({ taskId });
      assert.ok(Option.isSome(explicitlyReviewedOutcome));
      assert.strictEqual(explicitlyReviewedOutcome.value.humanDisposition, "accepted");
      yield* repository.upsertTaskOutcome({
        ...taskOutcome,
        id: TaskOutcomeRecordId.make("replacement-task-outcome-id"),
        humanDisposition: "accepted",
      });
      const rebuiltExplicitlyReviewedOutcome = yield* repository.getTaskOutcome({ taskId });
      assert.ok(Option.isSome(rebuiltExplicitlyReviewedOutcome));
      assert.strictEqual(rebuiltExplicitlyReviewedOutcome.value.id, taskOutcome.id);
      assert.strictEqual(rebuiltExplicitlyReviewedOutcome.value.humanDisposition, "accepted");
      yield* repository.upsertMissionOutcome({
        id: MissionOutcomeRecordId.make("mission-outcome-one"),
        missionId,
        status: "completed",
        taskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        verifiedTaskCount: 1,
        integratedTaskCount: 1,
        pullRequestCreated: true,
        pullRequestMerged: false,
        humanDisposition: "accepted",
        startedAt: now,
        completedAt: later,
        createdAt: now,
        updatedAt: later,
      });
      const query = {
        filter: {
          dateRange: { from: null, to: null },
          projectId,
          missionId: null,
          taskId: null,
          agentRunId: null,
          providerProfileId: null,
          modelProfileId: null,
          agentRoleId: null,
          reasoningLevel: null,
          humanDisposition: "accepted" as const,
          subscriptionBacked: null,
        },
        limit: 20,
        offset: 0,
      };
      assert.deepStrictEqual(
        (yield* repository.queryTaskOutcomes(query)).map((row) => row.taskId),
        [taskId],
      );
      assert.deepStrictEqual(
        (yield* repository.queryMissionOutcomes(query)).map((row) => row.missionId),
        [missionId],
      );
    }),
  );

  it.effect("keeps pricing snapshots immutable and source-idempotent", () =>
    Effect.gen(function* () {
      yield* seedRun;
      const repository = yield* ProjectionUsageAnalyticsRepository;
      const pricing = {
        id: PricingSnapshotId.make("pricing-one"),
        providerProfileId: providerId,
        modelProfileId: modelId,
        currency: "USD" as const,
        pricingSource: "official_catalog" as const,
        pricingVersion: "2026-08",
        effectiveFrom: now,
        effectiveTo: null,
        inputTokenRate: "1.250000000000000001",
        outputTokenRate: null,
        reasoningTokenRate: null,
        cachedInputRate: null,
        cacheWriteRate: null,
        cacheReadRate: null,
        requestRate: null,
        toolRateMetadata: {},
        billingUnit: "per_million_tokens" as const,
        confidence: "confirmed" as const,
        metadata: { catalog: "official" },
        createdAt: now,
      };
      yield* repository.insertPricingSnapshot(pricing);
      yield* repository.insertPricingSnapshot({ ...pricing, inputTokenRate: "99" });
      const stored = yield* repository.getPricingSnapshot({ pricingSnapshotId: pricing.id });
      assert.ok(Option.isSome(stored));
      assert.strictEqual(stored.value.inputTokenRate, "1.250000000000000001");
      assert.deepStrictEqual(stored.value.metadata, { catalog: "official" });
    }),
  );

  it.effect("keeps restart cost finalization source-idempotent", () =>
    Effect.gen(function* () {
      yield* seedRun;
      const repository = yield* ProjectionUsageAnalyticsRepository;
      const sql = yield* SqlClient.SqlClient;
      const record = {
        id: CostRecordId.make("restart-finalized-cost"),
        sourceKey: "calculated-usage:restart-finalized-usage",
        usageRecordId: null,
        agentRunId,
        projectId,
        missionId,
        taskId,
        providerProfileId: providerId,
        modelProfileId: modelId,
        pricingSnapshotId: null,
        amount: "1.25",
        currency: AnalyticsCurrency.make("USD"),
        costType: "api_usage" as const,
        calculationMethod: "pricing_catalog_calculated" as const,
        confidence: "confirmed" as const,
        isEstimated: true,
        isSubscriptionBacked: false,
        calculationBreakdown: [],
        missingPricingDimensions: [],
        createdAt: later,
      };
      yield* repository.insertCostRecord(record);
      yield* repository.insertCostRecord({ ...record, amount: "99" });

      const stored = yield* repository.getCostRecord({ costRecordId: record.id });
      assert.ok(Option.isSome(stored));
      assert.strictEqual(stored.value.amount, "1.25");
      assert.deepStrictEqual(
        yield* sql`
          SELECT count(*) AS count FROM projection_analytics_cost_records
          WHERE source_key = ${record.sourceKey}
        `,
        [{ count: 1 }],
      );
    }),
  );

  it.effect(
    "revises closed-period subscription allocations without rewriting usage or history",
    () =>
      Effect.gen(function* () {
        yield* seedRun;
        const repository = yield* ProjectionUsageAnalyticsRepository;
        const sql = yield* SqlClient.SqlClient;
        const periodStart = "2026-07-01T00:00:00.000Z";
        const periodEnd = "2026-08-01T00:00:00.000Z";
        const allocatedAt = "2026-08-04T11:00:00.000Z";
        const rule = SubscriptionAttributionRule.make({
          id: SubscriptionAttributionRuleId.make("subscription-rule-july"),
          providerProfileId: providerId,
          modelProfileId: null,
          label: "July team plan",
          mode: "flat_monthly_by_runs",
          periodStart,
          periodEnd,
          currency: AnalyticsCurrency.make("USD"),
          monthlyAmount: "30",
          fixedInternalRate: null,
          fixedRateUnit: null,
          createdAt: periodStart,
        });
        yield* repository.insertSubscriptionAttributionRule(rule);
        yield* repository.insertSubscriptionAttributionRule({ ...rule, monthlyAmount: "99" });
        const storedRule = yield* repository.getSubscriptionAttributionRule({ ruleId: rule.id });
        assert.ok(Option.isSome(storedRule));
        assert.strictEqual(storedRule.value.monthlyAmount, "30");
        assert.deepStrictEqual(
          (yield* repository.listSubscriptionAttributionRules({
            providerProfileId: providerId,
            modelProfileId: null,
            periodStart,
            periodEnd,
            limit: 20,
            offset: 0,
          })).map(({ id }) => id),
          [rule.id],
        );

        const insertRun = (id: AgentRunId) => sql`
        INSERT OR IGNORE INTO projection_agent_runs (
          agent_run_id, mission_id, task_id, thread_id, provider, provider_instance_id,
          provider_session_id, status, created_at, updated_at, started_at, completed_at,
          error_summary
        ) VALUES (
          ${id}, ${missionId}, ${taskId}, ${`thread-${id}`}, 'codex', 'analytics-provider',
          NULL, 'completed', ${periodStart}, ${periodEnd}, ${periodStart}, ${periodEnd}, NULL
        )
      `;
        const secondRunId = AgentRunId.make("analytics-subscription-run-two");
        const thirdRunId = AgentRunId.make("analytics-subscription-run-three");
        yield* insertRun(secondRunId);
        yield* insertRun(thirdRunId);
        const subscriptionUsage = (id: string, runId: AgentRunId) => ({
          id: UsageRecordId.make(id),
          sourceEventId: `source-${id}`,
          sourceTurnId: null,
          projectId,
          missionId,
          taskId,
          agentRunId: runId,
          parentAgentRunId: null,
          routingDecisionId: null,
          providerProfileId: providerId,
          modelProfileId: modelId,
          capabilitySnapshotId: null,
          providerRequestId: null,
          providerResponseId: null,
          usageSource: "provider_reported" as const,
          usageConfidence: "confirmed" as const,
          state: "final" as const,
          inputTokens: 100,
          outputTokens: 100,
          reasoningTokens: null,
          cachedInputTokens: null,
          cacheWriteTokens: null,
          cacheReadTokens: null,
          totalTokens: 200,
          requestCount: 1,
          toolCallCount: null,
          providerRoundTripCount: 1,
          startedAt: "2026-07-15T00:00:00.000Z",
          completedAt: "2026-07-15T00:01:00.000Z",
          recordedAt: "2026-07-15T00:01:00.000Z",
          reconciledAt: null,
        });
        const firstUsage = subscriptionUsage("usage-subscription-one", agentRunId);
        const secondUsage = subscriptionUsage("usage-subscription-two", secondRunId);
        const thirdUsage = subscriptionUsage("usage-subscription-three", thirdRunId);
        yield* repository.upsertUsageRecord(firstUsage);
        yield* repository.upsertUsageRecord(secondUsage);

        const initial = allocateSubscriptionCosts({
          rule,
          configuredMode: rule.mode,
          usage: [firstUsage, secondUsage],
          performance: [],
          calculatedAt: allocatedAt,
        });
        assert.strictEqual(initial.status, "allocated");
        yield* repository.replaceSubscriptionAllocations({
          ruleId: rule.id,
          periodStart,
          periodEnd,
          revision: initial.revision,
          allocatedAt,
          records: initial.records,
        });
        const repeated = yield* repository.replaceSubscriptionAllocations({
          ruleId: rule.id,
          periodStart,
          periodEnd,
          revision: initial.revision,
          allocatedAt,
          records: initial.records,
        });
        assert.deepStrictEqual(repeated, { replacedCount: 2, activeCount: 2 });
        assert.deepStrictEqual(
          yield* sql`SELECT count(*) AS count FROM projection_analytics_subscription_allocation_entries`,
          [{ count: 2 }],
        );

        yield* repository.upsertUsageRecord(thirdUsage);
        const revised = allocateSubscriptionCosts({
          rule,
          configuredMode: rule.mode,
          usage: [firstUsage, secondUsage, thirdUsage],
          performance: [],
          calculatedAt: allocatedAt,
        });
        yield* repository.replaceSubscriptionAllocations({
          ruleId: rule.id,
          periodStart,
          periodEnd,
          revision: revised.revision,
          allocatedAt,
          records: revised.records,
        });
        const active = yield* repository.queryCostRecords({
          filter: {
            dateRange: { from: null, to: null },
            projectId,
            missionId: null,
            taskId: null,
            agentRunId: null,
            providerProfileId: providerId,
            modelProfileId: null,
            agentRoleId: null,
            reasoningLevel: null,
            humanDisposition: null,
            subscriptionBacked: true,
          },
          limit: 20,
          offset: 0,
        });
        assert.deepStrictEqual(active.map(({ amount }) => amount).sort(), ["10", "10", "10"]);
        assert.deepStrictEqual(
          yield* sql`SELECT count(*) AS count FROM projection_analytics_subscription_allocation_entries`,
          [{ count: 5 }],
        );
        assert.deepStrictEqual(
          yield* sql`SELECT count(*) AS count FROM projection_analytics_subscription_allocation_current`,
          [{ count: 3 }],
        );
        yield* repository.replaceSubscriptionAllocations({
          ruleId: rule.id,
          periodStart,
          periodEnd,
          revision: revised.revision,
          allocatedAt,
          records: [],
        });
        assert.deepStrictEqual(
          yield* sql`SELECT count(*) AS count FROM projection_analytics_subscription_allocation_current`,
          [{ count: 0 }],
        );
        assert.deepStrictEqual(
          yield* sql`SELECT count(*) AS count FROM projection_analytics_subscription_allocation_entries`,
          [{ count: 5 }],
        );
        const historicalCost = yield* repository.getCostRecord({
          costRecordId: initial.records[0]!.id,
        });
        assert.ok(Option.isSome(historicalCost));
        assert.strictEqual(historicalCost.value.amount, "15");
        const historyMutation = yield* Effect.exit(sql`
        UPDATE projection_analytics_subscription_allocation_entries
        SET revision = 'tampered' WHERE cost_record_id = ${initial.records[0]!.id}
      `);
        assert.isTrue(Exit.isFailure(historyMutation));
        yield* repository.replaceSubscriptionAllocations({
          ruleId: rule.id,
          periodStart,
          periodEnd,
          revision: revised.revision,
          allocatedAt,
          records: revised.records,
        });
        assert.deepStrictEqual(
          yield* sql`
          SELECT count(*) AS count FROM projection_analytics_usage_records
          WHERE usage_record_id IN (${firstUsage.id}, ${secondUsage.id}, ${thirdUsage.id})
        `,
          [{ count: 3 }],
        );
      }),
  );

  it.effect("lists immutable exchange-rate snapshots by pair and effective time", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionUsageAnalyticsRepository;
      const usd = AnalyticsCurrency.make("USD");
      const eur = AnalyticsCurrency.make("EUR");
      const oldRate = {
        id: ExchangeRateSnapshotId.make("exchange-usd-eur-old"),
        baseCurrency: usd,
        quoteCurrency: eur,
        rate: "0.9",
        source: "user_configured" as const,
        effectiveAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const newRate = {
        ...oldRate,
        id: ExchangeRateSnapshotId.make("exchange-usd-eur-new"),
        rate: "0.95",
        effectiveAt: "2026-02-01T00:00:00.000Z",
        createdAt: "2026-02-01T00:00:00.000Z",
      };
      yield* repository.insertExchangeRateSnapshot(oldRate);
      yield* repository.insertExchangeRateSnapshot(newRate);
      yield* repository.insertExchangeRateSnapshot({ ...oldRate, rate: "99" });
      assert.deepStrictEqual(
        (yield* repository.listExchangeRateSnapshots({
          baseCurrency: usd,
          quoteCurrency: eur,
          effectiveAt: "2026-01-15T00:00:00.000Z",
          limit: 20,
          offset: 0,
        })).map(({ id, rate }) => ({ id, rate })),
        [{ id: oldRate.id, rate: "0.9" }],
      );
      assert.deepStrictEqual(
        (yield* repository.listExchangeRateSnapshots({
          baseCurrency: usd,
          quoteCurrency: eur,
          effectiveAt: null,
          limit: 20,
          offset: 0,
        })).map(({ id }) => id),
        [newRate.id, oldRate.id],
      );
    }),
  );

  it.effect("recovers bounded queued and running operations and interrupts in-flight work", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionUsageAnalyticsRepository;
      yield* repository.saveExport({
        id: AnalyticsExportId.make("export-running"),
        format: "json",
        status: "running",
        filter: { project: "analytics-repository-project" },
        metricVersion: 1,
        relativeFilePath: null,
        rowCount: null,
        byteCount: null,
        errorCategory: null,
        requestedAt: now,
        startedAt: now,
        completedAt: null,
      });
      yield* repository.saveRetentionOperation({
        id: AnalyticsRetentionOperationId.make("retention-queued"),
        status: "queued",
        projectId: null,
        detailBefore: now,
        deletedUsageCount: 0,
        deletedToolMetricCount: 0,
        deletedExportCount: 0,
        errorCategory: null,
        requestedAt: now,
        startedAt: null,
        completedAt: null,
      });

      const recoverable = yield* repository.listRecoverableOperations({
        requestedBefore: later,
        limit: 20,
      });
      assert.deepStrictEqual(
        recoverable.exports.map((row) => row.id),
        ["export-running"],
      );
      assert.deepStrictEqual(
        recoverable.retentionOperations.map((row) => row.id),
        ["retention-queued"],
      );

      assert.deepStrictEqual(
        yield* repository.interruptRunningOperations({
          interruptedAt: later,
          errorCategory: "restart_recovery",
        }),
        { exportCount: 1, retentionOperationCount: 1 },
      );
      const afterRecovery = yield* repository.listRecoverableOperations({
        requestedBefore: later,
        limit: 20,
      });
      assert.deepStrictEqual(afterRecovery.exports, []);
      assert.deepStrictEqual(afterRecovery.retentionOperations, []);
    }),
  );

  it.effect("removes only the selected project's retained exports", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionUsageAnalyticsRepository;
      const selected = AnalyticsExportId.make("export-selected-project");
      const other = AnalyticsExportId.make("export-other-project");
      const completedExport = (id: typeof selected, filteredProjectId: string) => ({
        id,
        format: "json" as const,
        status: "completed" as const,
        filter: { projectId: filteredProjectId },
        metricVersion: 1,
        relativeFilePath: `analytics/exports/${id}.json`,
        rowCount: 1,
        byteCount: 2,
        errorCategory: null,
        requestedAt: now,
        startedAt: now,
        completedAt: now,
      });
      yield* repository.saveExport(completedExport(selected, projectId));
      yield* repository.saveExport(completedExport(other, "another-project"));

      const deleted = yield* repository.deleteDetailBefore({
        projectId,
        detailBefore: later,
      });
      assert.strictEqual(deleted.exportCount, 1);
      const remainingIds = new Set(
        (yield* repository.listExports({ status: null, limit: 20, offset: 0 })).map(({ id }) => id),
      );
      assert.strictEqual(remainingIds.has(selected), false);
      assert.strictEqual(remainingIds.has(other), true);
      assert.strictEqual(remainingIds.has(AnalyticsExportId.make("export-running")), true);
    }),
  );
});
