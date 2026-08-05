import {
  AgentRunId,
  AnalyticsCurrency,
  BudgetOverrideId,
  BudgetPolicyId,
  MissionId,
  MissionTaskId,
  ModelProfileId,
  ProjectId,
  ProviderProfileId,
  type AnalyticsAlert,
  type BudgetEvent,
  type BudgetOverride,
  type BudgetPolicy,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { PersistenceSqlError } from "../persistence/Errors.ts";
import type { ProjectionUsageAnalyticsRepositoryShape } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { checkBudgetBeforeRun, type BudgetRunCheckInput } from "./UsageAnalyticsBudgetGuard.ts";

const now = "2026-08-04T10:00:00.000Z";
const projectId = ProjectId.make("project-1");
const missionId = MissionId.make("mission-1");
const taskId = MissionTaskId.make("task-1");
const providerProfileId = ProviderProfileId.make("codex-default");
const modelProfileId = ModelProfileId.make("codex-default:gpt-5");
const runId = AgentRunId.make("run-1");

const policy: BudgetPolicy = {
  id: BudgetPolicyId.make("budget-project"),
  scopeType: "project",
  scopeId: projectId,
  name: "Project tokens",
  currency: AnalyticsCurrency.make("USD"),
  periodType: "monthly",
  periodStart: null,
  periodEnd: null,
  softLimit: null,
  hardLimit: null,
  tokenLimit: 100,
  requestLimit: null,
  actionOnSoftLimit: "notify",
  actionOnHardLimit: "block_new_runs",
  conservativeWhenIncomplete: false,
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const input: BudgetRunCheckInput = {
  projectId,
  missionId,
  taskId,
  providerProfileId,
  modelProfileId,
  agentRoleId: null,
  estimatedTokens: 10,
  requestedAt: now,
  automaticFallback: false,
};

const repository = (
  overrides: ReadonlyArray<BudgetOverride> = [],
  policies: ReadonlyArray<BudgetPolicy> = [policy],
) => {
  const events: Array<BudgetEvent> = [];
  const alerts: Array<AnalyticsAlert> = [];
  const service = {
    getSettings: () => Effect.succeed(Option.none()),
    listBudgetPolicies: () => Effect.succeed(policies),
    listBudgetOverrides: () => Effect.succeed(overrides),
    queryUsageRecords: () =>
      Effect.succeed([
        {
          agentRunId: runId,
          state: "final",
          totalTokens: 95,
          requestCount: 1,
        },
      ]),
    queryCostRecords: () => Effect.succeed([]),
    queryRunPerformance: () => Effect.succeed([{ agentRunId: runId }]),
    upsertBudgetEvent: (event: BudgetEvent) => Effect.sync(() => void events.push(event)),
    upsertAlert: (alert: AnalyticsAlert) => Effect.sync(() => void alerts.push(alert)),
  } as unknown as ProjectionUsageAnalyticsRepositoryShape;
  return { service, events, alerts };
};

describe("UsageAnalyticsBudgetGuard", () => {
  it.effect("blocks a new run and persists deduplicated budget signals", () =>
    Effect.gen(function* () {
      const fixture = repository();
      const decision = yield* checkBudgetBeforeRun(fixture.service, input);

      expect(decision.allowed).toBe(false);
      expect(decision.blockingPolicyId).toBe(policy.id);
      expect(fixture.events).toHaveLength(1);
      expect(fixture.events[0]?.eventType).toBe("hard_limit_reached");
      expect(fixture.alerts[0]?.severity).toBe("critical");
    }),
  );

  it.effect("requires fallback-specific approval when an override excludes fallback", () => {
    const override: BudgetOverride = {
      id: BudgetOverrideId.make("override-1"),
      budgetPolicyId: policy.id,
      scopeType: "project",
      scopeId: projectId,
      currentValue: "95",
      thresholdValue: "100",
      reason: "Approve one manual run",
      actor: "maintainer",
      expiresAt: "2026-08-05T10:00:00.000Z",
      fallbackAllowed: false,
      createdAt: now,
      expiredAt: null,
    };
    return Effect.gen(function* () {
      const manual = repository([override]);
      const manualDecision = yield* checkBudgetBeforeRun(manual.service, input);
      expect(manualDecision.allowed).toBe(true);
      expect(manualDecision.overrideId).toBe(override.id);

      const fallback = repository([override]);
      const fallbackDecision = yield* checkBudgetBeforeRun(fallback.service, {
        ...input,
        automaticFallback: true,
      });
      expect(fallbackDecision.allowed).toBe(false);
      expect(fallbackDecision.overrideId).toBeNull();
    });
  });

  it.effect("keeps a specific hard limit when a broader inherited policy still allows work", () => {
    const broadPolicy: BudgetPolicy = {
      ...policy,
      id: BudgetPolicyId.make("budget-user"),
      scopeType: "user",
      scopeId: "current-user",
      name: "Global tokens",
      tokenLimit: 1_000,
    };
    return Effect.gen(function* () {
      const fixture = repository([], [broadPolicy, policy]);
      const decision = yield* checkBudgetBeforeRun(fixture.service, input);

      expect(decision.allowed).toBe(false);
      expect(decision.blockingPolicyId).toBe(policy.id);
      expect(decision.applicablePolicyIds).toEqual([broadPolicy.id, policy.id]);
    });
  });

  it.effect("fails open when analytics storage is unavailable", () => {
    const unavailable = {
      getSettings: () =>
        Effect.fail(
          new PersistenceSqlError({
            operation: "analytics budget test",
            detail: "database unavailable",
          }),
        ),
    } as unknown as ProjectionUsageAnalyticsRepositoryShape;
    return Effect.gen(function* () {
      const decision = yield* checkBudgetBeforeRun(unavailable, input);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain("temporarily unavailable");
    });
  });
});
