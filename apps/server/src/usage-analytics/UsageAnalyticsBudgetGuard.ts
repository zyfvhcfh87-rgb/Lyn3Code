import {
  AgentRoleId,
  AnalyticsAlertId,
  BudgetEventId,
  type AnalyticsFilter,
  type BudgetAction,
  type BudgetDecision,
  type BudgetPolicy,
  type MissionId,
  type MissionTaskId,
  type ModelProfileId,
  type ProjectId,
  type ProviderProfileId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionUsageAnalyticsRepositoryShape } from "../persistence/Services/ProjectionUsageAnalytics.ts";
import { addDecimal, compareDecimal } from "./DecimalMoney.ts";
import { evaluateBudget, type BudgetScope, type BudgetUsageSnapshot } from "./BudgetEvaluator.ts";

const PAGE_SIZE = 500;
const MAX_OFFSET = 100_000;
const ACTION_RESTRICTIVENESS: Readonly<Record<BudgetAction, number>> = {
  informational: 0,
  notify: 1,
  require_approval: 2,
  pause_new_runs: 3,
  block_new_runs: 4,
};

export interface BudgetRunCheckInput {
  readonly projectId: ProjectId;
  readonly missionId: MissionId;
  readonly taskId: MissionTaskId;
  readonly providerProfileId: ProviderProfileId;
  readonly modelProfileId: ModelProfileId;
  readonly agentRoleId: string | null;
  readonly estimatedTokens: number | null;
  readonly requestedAt: string;
  readonly automaticFallback: boolean;
}

interface PolicyEvaluation {
  readonly policy: BudgetPolicy;
  readonly current: BudgetUsageSnapshot;
  readonly decision: BudgetDecision;
}

const noPolicyDecision = (reason: string): BudgetDecision => ({
  allowed: true,
  action: "informational",
  reason,
  applicablePolicyIds: [],
  blockingPolicyId: null,
  overrideId: null,
  usageIncomplete: false,
  estimatedProposedAmount: null,
  currency: null,
});

const scopePathFor = (input: BudgetRunCheckInput): ReadonlyArray<BudgetScope> => [
  { scopeType: "user", scopeId: "current-user" },
  { scopeType: "provider", scopeId: input.providerProfileId },
  { scopeType: "model", scopeId: input.modelProfileId },
  { scopeType: "project", scopeId: input.projectId },
  { scopeType: "mission", scopeId: input.missionId },
  { scopeType: "task", scopeId: input.taskId },
  ...(input.agentRoleId === null
    ? []
    : [{ scopeType: "agent_role" as const, scopeId: input.agentRoleId }]),
];

const policyApplies = (policy: BudgetPolicy, scopePath: ReadonlyArray<BudgetScope>, now: number) =>
  policy.enabled &&
  (policy.periodStart === null || Date.parse(policy.periodStart) <= now) &&
  (policy.periodEnd === null || now < Date.parse(policy.periodEnd)) &&
  scopePath.some(
    ({ scopeType, scopeId }) => scopeType === policy.scopeType && scopeId === policy.scopeId,
  );

const filterForPolicy = (policy: BudgetPolicy, input: BudgetRunCheckInput): AnalyticsFilter => {
  const scope = policy.scopeType;
  return {
    dateRange: { from: policy.periodStart, to: policy.periodEnd },
    projectId: scope === "project" ? input.projectId : null,
    missionId: scope === "mission" ? input.missionId : null,
    taskId: scope === "task" ? input.taskId : null,
    agentRunId: null,
    providerProfileId: scope === "provider" ? input.providerProfileId : null,
    modelProfileId: scope === "model" ? input.modelProfileId : null,
    agentRoleId:
      scope === "agent_role" && input.agentRoleId !== null
        ? AgentRoleId.make(input.agentRoleId)
        : null,
    reasoningLevel: null,
    humanDisposition: null,
    subscriptionBacked: null,
  };
};

const collectPages = <Row, Error>(
  load: (offset: number) => Effect.Effect<ReadonlyArray<Row>, Error>,
) =>
  Effect.gen(function* () {
    const rows: Array<Row> = [];
    let offset = 0;
    let truncated = false;
    while (offset <= MAX_OFFSET) {
      const page = yield* load(offset);
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      if (offset === MAX_OFFSET) {
        truncated = true;
        break;
      }
      offset = Math.min(MAX_OFFSET, offset + PAGE_SIZE);
    }
    return { rows, truncated } as const;
  });

const safeIntegerSum = (values: ReadonlyArray<number>): number =>
  values.reduce((sum, value) => Math.min(Number.MAX_SAFE_INTEGER, sum + value), 0);

const loadCurrentUsage = (
  repository: ProjectionUsageAnalyticsRepositoryShape,
  policy: BudgetPolicy,
  input: BudgetRunCheckInput,
) =>
  Effect.gen(function* () {
    const filter = filterForPolicy(policy, input);
    const [usagePage, costPage, performancePage] = yield* Effect.all(
      [
        collectPages((offset) =>
          repository.queryUsageRecords({ filter, limit: PAGE_SIZE, offset }),
        ),
        collectPages((offset) => repository.queryCostRecords({ filter, limit: PAGE_SIZE, offset })),
        collectPages((offset) =>
          repository.queryRunPerformance({ filter, limit: PAGE_SIZE, offset }),
        ),
      ] as const,
      { concurrency: 3 },
    );
    const runIds = new Set([
      ...usagePage.rows.map(({ agentRunId }) => agentRunId),
      ...performancePage.rows.map(({ agentRunId }) => agentRunId),
    ]);
    const knownUsage = usagePage.rows.filter(
      ({ state, totalTokens }) => state !== "unknown" && totalTokens !== null,
    );
    const knownRequests = usagePage.rows.filter(
      ({ state, requestCount }) => state !== "unknown" && requestCount !== null,
    );
    const knownTokenRuns = new Set(knownUsage.map(({ agentRunId }) => agentRunId));
    const knownRequestRuns = new Set(knownRequests.map(({ agentRunId }) => agentRunId));
    const costs = costPage.rows.filter(
      ({ currency, amount }) => currency === policy.currency && amount !== null,
    );
    const knownCostRuns = new Set(costs.map(({ agentRunId }) => agentRunId));
    const paginationTruncated =
      usagePage.truncated || costPage.truncated || performancePage.truncated;
    const everyRunKnown = (known: ReadonlySet<string>) =>
      !paginationTruncated && [...runIds].every((agentRunId) => known.has(agentRunId));
    return {
      costs:
        costs.length === 0
          ? []
          : [
              {
                currency: policy.currency,
                amount: costs.map(({ amount }) => amount!).reduce(addDecimal),
              },
            ],
      costComplete: everyRunKnown(knownCostRuns),
      tokens: everyRunKnown(knownTokenRuns)
        ? safeIntegerSum(knownUsage.map(({ totalTokens }) => totalTokens!))
        : null,
      requests: everyRunKnown(knownRequestRuns)
        ? safeIntegerSum(knownRequests.map(({ requestCount }) => requestCount!))
        : null,
    } satisfies BudgetUsageSnapshot;
  });

const combineDecisions = (evaluations: ReadonlyArray<PolicyEvaluation>): BudgetDecision => {
  const ordered = evaluations.toSorted(
    (left, right) =>
      Number(left.decision.allowed) - Number(right.decision.allowed) ||
      ACTION_RESTRICTIVENESS[right.decision.action] -
        ACTION_RESTRICTIVENESS[left.decision.action] ||
      left.policy.id.localeCompare(right.policy.id),
  );
  const selected = ordered[0];
  if (selected === undefined) return noPolicyDecision("No enabled budget policy applies.");
  return {
    ...selected.decision,
    applicablePolicyIds: evaluations.map(({ policy }) => policy.id),
    usageIncomplete: evaluations.some(({ decision }) => decision.usageIncomplete),
  };
};

const currentValueFor = ({ policy, current }: PolicyEvaluation): string => {
  if (policy.hardLimit !== null || policy.softLimit !== null) {
    const matching = current.costs.filter(({ currency }) => currency === policy.currency);
    return matching.length === 0 ? "0" : matching.map(({ amount }) => amount).reduce(addDecimal);
  }
  if (policy.tokenLimit !== null) return String(current.tokens ?? 0);
  return String(current.requests ?? 0);
};

const thresholdFor = ({ policy, decision }: PolicyEvaluation): string => {
  if (decision.allowed && policy.softLimit !== null) return policy.softLimit;
  if (policy.hardLimit !== null) return policy.hardLimit;
  if (policy.tokenLimit !== null) return String(policy.tokenLimit);
  return String(policy.requestLimit ?? 0);
};

const boundedKey = (value: string) => value.slice(0, 500);

const persistSignals = (
  repository: ProjectionUsageAnalyticsRepositoryShape,
  evaluation: PolicyEvaluation,
  requestedAt: string,
) => {
  const { decision, policy } = evaluation;
  if (decision.action === "informational" && !decision.usageIncomplete) return Effect.void;
  const eventType = !decision.allowed
    ? decision.reason.startsWith("Soft cost limit reached")
      ? "soft_limit_reached"
      : "hard_limit_reached"
    : decision.usageIncomplete
      ? "usage_data_incomplete"
      : "soft_limit_reached";
  const periodKey = `${policy.periodStart ?? "open"}:${policy.periodEnd ?? "open"}`;
  const deduplicationKey = boundedKey(`${policy.id}:${eventType}:${periodKey}`);
  const alertKey = boundedKey(`alert:${deduplicationKey}`);
  const currentValue = currentValueFor(evaluation);
  const thresholdValue = thresholdFor(evaluation);
  const severity = decision.allowed ? "warning" : "critical";
  return Effect.all(
    [
      repository.upsertBudgetEvent({
        id: BudgetEventId.make(`budget-event:${deduplicationKey}`),
        deduplicationKey,
        budgetPolicyId: policy.id,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        eventType,
        currentValue,
        thresholdValue,
        currency: policy.hardLimit === null && policy.softLimit === null ? null : policy.currency,
        createdAt: requestedAt,
        acknowledgedAt: null,
      }),
      repository.upsertAlert({
        id: AnalyticsAlertId.make(`analytics-alert:${deduplicationKey}`),
        deduplicationKey: alertKey,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        category: "budget",
        severity,
        title: decision.allowed ? `Budget warning: ${policy.name}` : `Budget stopped new work`,
        detail: decision.reason,
        status: "active",
        createdAt: requestedAt,
        acknowledgedAt: null,
        resolvedAt: null,
      }),
    ],
    { discard: true },
  );
};

/**
 * Checks inherited budgets immediately before dispatch. Any analytics failure is
 * fail-open and logged: collection and policy storage must never make the agent
 * runtime unavailable. Conservative policies can still intentionally stop new
 * work when their recorded data is incomplete.
 */
export const checkBudgetBeforeRun = (
  repository: ProjectionUsageAnalyticsRepositoryShape,
  input: BudgetRunCheckInput,
): Effect.Effect<BudgetDecision> =>
  Effect.gen(function* () {
    const settings = yield* repository.getSettings();
    if (Option.isSome(settings) && !settings.value.enabled) {
      return noPolicyDecision("Usage analytics and budget enforcement are disabled.");
    }
    const scopePath = scopePathFor(input);
    const now = Date.parse(input.requestedAt);
    const policyPage = yield* collectPages((offset) =>
      repository.listBudgetPolicies({
        scopeType: null,
        scopeId: null,
        limit: PAGE_SIZE,
        offset,
      }),
    );
    const policies = policyPage.rows.filter((policy) => policyApplies(policy, scopePath, now));
    if (policies.length === 0) return noPolicyDecision("No enabled budget policy applies.");
    const overridePage = yield* collectPages((offset) =>
      repository.listBudgetOverrides({
        scopeType: null,
        scopeId: null,
        limit: PAGE_SIZE,
        offset,
      }),
    );
    const overrides = overridePage.rows.filter(
      (override) => !input.automaticFallback || override.fallbackAllowed,
    );
    const evaluations = yield* Effect.forEach(
      policies,
      (policy) =>
        Effect.gen(function* () {
          const current = yield* loadCurrentUsage(repository, policy, input);
          const proposed: BudgetUsageSnapshot = {
            costs: [{ currency: policy.currency, amount: "0" }],
            costComplete: false,
            tokens: input.estimatedTokens,
            requests: 1,
          };
          return {
            policy,
            current,
            decision: evaluateBudget({
              policies: [policy],
              overrides,
              scopePath,
              current,
              proposed,
              workState: "new",
              now: input.requestedAt,
            }),
          } satisfies PolicyEvaluation;
        }),
      { concurrency: 4 },
    );
    yield* Effect.forEach(
      evaluations,
      (evaluation) => persistSignals(repository, evaluation, input.requestedAt),
      { concurrency: 4, discard: true },
    );
    return combineDecisions(evaluations);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("usage analytics budget check failed open", { cause }).pipe(
        Effect.as(
          noPolicyDecision(
            "Budget data is temporarily unavailable; the run is allowed because analytics cannot gate runtime availability.",
          ),
        ),
      ),
    ),
  );

export const isHardLimitAlreadyReached = (
  policy: BudgetPolicy,
  snapshot: BudgetUsageSnapshot,
): boolean => {
  if (policy.hardLimit !== null) {
    const cost = snapshot.costs.find(({ currency }) => currency === policy.currency);
    if (cost !== undefined && compareDecimal(cost.amount, policy.hardLimit) >= 0) return true;
  }
  return (
    (policy.tokenLimit !== null &&
      snapshot.tokens !== null &&
      snapshot.tokens >= policy.tokenLimit) ||
    (policy.requestLimit !== null &&
      snapshot.requests !== null &&
      snapshot.requests >= policy.requestLimit)
  );
};
