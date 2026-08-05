import type {
  AnalyticsCurrency,
  AnalyticsScopeType,
  BudgetAction,
  BudgetDecision,
  BudgetOverride,
  BudgetPolicy,
} from "@t3tools/contracts";

import { addDecimal, compareDecimal, type DecimalMoney } from "./DecimalMoney.ts";

export interface BudgetScope {
  readonly scopeType: AnalyticsScopeType;
  readonly scopeId: string;
}

export interface BudgetUsageSnapshot {
  /** One independently calculated total per currency. */
  readonly costs: ReadonlyArray<DecimalMoney>;
  /** True means an absent currency is known zero; false means it remains unknown. */
  readonly costComplete: boolean;
  readonly tokens: number | null;
  readonly requests: number | null;
}

export interface BudgetEvaluationInput {
  readonly policies: ReadonlyArray<BudgetPolicy>;
  readonly overrides: ReadonlyArray<BudgetOverride>;
  /** Broadest to narrowest scopes that own the proposed work. */
  readonly scopePath: ReadonlyArray<BudgetScope>;
  readonly current: BudgetUsageSnapshot;
  readonly proposed: BudgetUsageSnapshot;
  readonly workState: "new" | "running";
  readonly now: string;
}

interface PolicyEvaluation {
  readonly policy: BudgetPolicy;
  readonly hardReached: boolean;
  readonly softReached: boolean;
  readonly incomplete: boolean;
  readonly conservativeHardStop: boolean;
  readonly detail: string;
  readonly override: BudgetOverride | null;
}

const ACTION_RESTRICTIVENESS: Readonly<Record<BudgetAction, number>> = {
  informational: 0,
  notify: 1,
  require_approval: 2,
  pause_new_runs: 3,
  block_new_runs: 4,
};

const blocksNewWork = (action: BudgetAction): boolean =>
  action === "require_approval" || action === "pause_new_runs" || action === "block_new_runs";

const applicable = (
  policy: BudgetPolicy,
  path: ReadonlyArray<BudgetScope>,
  now: number,
): boolean => {
  const periodStart = policy.periodStart === null ? null : Date.parse(policy.periodStart);
  const periodEnd = policy.periodEnd === null ? null : Date.parse(policy.periodEnd);
  return (
    policy.enabled &&
    (periodStart === null || periodStart <= now) &&
    (periodEnd === null || now < periodEnd) &&
    path.some((scope) => scope.scopeType === policy.scopeType && scope.scopeId === policy.scopeId)
  );
};

const activeOverride = (
  policy: BudgetPolicy,
  overrides: ReadonlyArray<BudgetOverride>,
  path: ReadonlyArray<BudgetScope>,
  now: number,
): BudgetOverride | null =>
  overrides
    .filter(
      (override) =>
        override.budgetPolicyId === policy.id &&
        override.expiredAt === null &&
        Date.parse(override.expiresAt) > now &&
        path.some(
          (scope) => scope.scopeType === override.scopeType && scope.scopeId === override.scopeId,
        ),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;

const amountFor = (
  usage: BudgetUsageSnapshot,
  currency: AnalyticsCurrency,
): { readonly amount: string | null; readonly incomplete: boolean } => {
  const matching = usage.costs.filter((cost) => cost.currency === currency);
  if (matching.length === 0) {
    return usage.costComplete
      ? { amount: "0", incomplete: false }
      : { amount: null, incomplete: true };
  }
  return {
    amount: matching.map(({ amount }) => amount).reduce(addDecimal),
    incomplete: !usage.costComplete,
  };
};

const thresholdReached = (
  limit: string | null,
  current: string | null,
  proposed: string | null,
): { readonly reached: boolean; readonly incomplete: boolean } => {
  if (limit === null) return { reached: false, incomplete: false };
  if (current !== null && compareDecimal(current, limit) >= 0) {
    return { reached: true, incomplete: proposed === null };
  }
  if (current === null || proposed === null) return { reached: false, incomplete: true };
  return { reached: compareDecimal(addDecimal(current, proposed), limit) >= 0, incomplete: false };
};

const integerThresholdReached = (
  limit: number | null,
  current: number | null,
  proposed: number | null,
): { readonly reached: boolean; readonly incomplete: boolean } => {
  if (limit === null) return { reached: false, incomplete: false };
  if (current !== null && current >= limit) {
    return { reached: true, incomplete: proposed === null };
  }
  if (current === null || proposed === null) return { reached: false, incomplete: true };
  return { reached: proposed >= limit || current >= limit - proposed, incomplete: false };
};

const evaluatePolicy = (
  policy: BudgetPolicy,
  input: BudgetEvaluationInput,
  now: number,
): PolicyEvaluation => {
  const currentAmount = amountFor(input.current, policy.currency);
  const proposedAmount = amountFor(input.proposed, policy.currency);
  const hardAmount = thresholdReached(
    policy.hardLimit,
    currentAmount.amount,
    proposedAmount.amount,
  );
  const softAmount = thresholdReached(
    policy.softLimit,
    currentAmount.amount,
    proposedAmount.amount,
  );
  const hardTokens = integerThresholdReached(
    policy.tokenLimit,
    input.current.tokens,
    input.proposed.tokens,
  );
  const hardRequests = integerThresholdReached(
    policy.requestLimit,
    input.current.requests,
    input.proposed.requests,
  );
  const hardReached = hardAmount.reached || hardTokens.reached || hardRequests.reached;
  const hasCostLimit = policy.hardLimit !== null || policy.softLimit !== null;
  const incomplete =
    (hasCostLimit &&
      (currentAmount.incomplete ||
        proposedAmount.incomplete ||
        hardAmount.incomplete ||
        softAmount.incomplete)) ||
    (policy.tokenLimit !== null && hardTokens.incomplete) ||
    (policy.requestLimit !== null && hardRequests.incomplete);
  const hasHardLimit =
    policy.hardLimit !== null || policy.tokenLimit !== null || policy.requestLimit !== null;
  const conservativeHardStop =
    incomplete && policy.conservativeWhenIncomplete && hasHardLimit && !hardReached;
  const reachedDimensions = [
    hardAmount.reached ? "cost" : null,
    hardTokens.reached ? "tokens" : null,
    hardRequests.reached ? "requests" : null,
  ].filter((value): value is string => value !== null);

  return {
    policy,
    hardReached,
    softReached: softAmount.reached,
    incomplete,
    conservativeHardStop,
    detail:
      reachedDimensions.length > 0
        ? `Hard ${reachedDimensions.join(", ")} limit reached for ${policy.name}.`
        : conservativeHardStop
          ? `Usage is incomplete for conservative hard policy ${policy.name}.`
          : softAmount.reached
            ? `Soft cost limit reached for ${policy.name}.`
            : `Policy ${policy.name} remains within known limits.`,
    override: activeOverride(policy, input.overrides, input.scopePath, now),
  };
};

const byMostRestrictiveAction =
  (actionFor: (evaluation: PolicyEvaluation) => BudgetAction) =>
  (left: PolicyEvaluation, right: PolicyEvaluation): number =>
    ACTION_RESTRICTIVENESS[actionFor(right)] - ACTION_RESTRICTIVENESS[actionFor(left)] ||
    left.policy.id.localeCompare(right.policy.id);

const proposedMoney = (
  usage: BudgetUsageSnapshot,
): { readonly amount: string | null; readonly currency: AnalyticsCurrency | null } => {
  if (usage.costs.length !== 1) return { amount: null, currency: null };
  if (!usage.costComplete) return { amount: null, currency: usage.costs[0]!.currency };
  return { amount: usage.costs[0]!.amount, currency: usage.costs[0]!.currency };
};

/**
 * Evaluates every inherited policy, then selects the most restrictive applicable
 * hard action. Hard stops affect only new work; an already-running run is allowed
 * to finish while the decision still reports the reached policy and data quality.
 */
export const evaluateBudget = (input: BudgetEvaluationInput): BudgetDecision => {
  const now = Date.parse(input.now);
  const policies = input.policies
    .filter((policy) => applicable(policy, input.scopePath, now))
    .toSorted((left, right) => {
      const position = (policy: BudgetPolicy) =>
        input.scopePath.findIndex(
          (scope) => scope.scopeType === policy.scopeType && scope.scopeId === policy.scopeId,
        );
      return position(left) - position(right) || left.id.localeCompare(right.id);
    });
  const evaluations = policies.map((policy) => evaluatePolicy(policy, input, now));
  const usageIncomplete = evaluations.some(({ incomplete }) => incomplete);
  const proposed = proposedMoney(input.proposed);
  const hardCandidates = evaluations
    .filter(
      ({ hardReached, conservativeHardStop, override }) =>
        (hardReached || conservativeHardStop) && override === null,
    )
    .toSorted(byMostRestrictiveAction(({ policy }) => policy.actionOnHardLimit));
  const hard = hardCandidates[0] ?? null;
  if (hard !== null) {
    const configuredAction = hard.policy.actionOnHardLimit;
    const allowed = input.workState === "running" || !blocksNewWork(configuredAction);
    return {
      allowed,
      action: input.workState === "running" ? "informational" : configuredAction,
      reason:
        input.workState === "running"
          ? `${hard.detail} Existing work may finish; the hard policy applies only to new work.`
          : hard.detail,
      applicablePolicyIds: policies.map(({ id }) => id),
      blockingPolicyId: allowed ? null : hard.policy.id,
      overrideId: null,
      usageIncomplete,
      estimatedProposedAmount: proposed.amount,
      currency: proposed.currency,
    };
  }

  const soft =
    evaluations
      .filter(({ softReached, override }) => softReached && override === null)
      .toSorted(byMostRestrictiveAction(({ policy }) => policy.actionOnSoftLimit))[0] ?? null;
  const appliedOverride =
    evaluations.find(
      ({ hardReached, conservativeHardStop, override }) =>
        (hardReached || conservativeHardStop) && override !== null,
    )?.override ?? null;
  if (soft !== null) {
    const configuredAction = soft.policy.actionOnSoftLimit;
    const allowed = input.workState === "running" || !blocksNewWork(configuredAction);
    return {
      allowed,
      action: input.workState === "running" ? "informational" : configuredAction,
      reason:
        input.workState === "running"
          ? `${soft.detail} Existing work may finish; the soft policy applies only to new work.`
          : soft.detail,
      applicablePolicyIds: policies.map(({ id }) => id),
      blockingPolicyId: allowed ? null : soft.policy.id,
      overrideId: appliedOverride?.id ?? null,
      usageIncomplete,
      estimatedProposedAmount: proposed.amount,
      currency: proposed.currency,
    };
  }

  return {
    allowed: true,
    action: appliedOverride === null ? "informational" : "notify",
    reason:
      appliedOverride === null
        ? policies.length === 0
          ? "No enabled budget policy applies to this scope."
          : "All applicable budget policies remain within known limits."
        : "A current budget override permits this new work.",
    applicablePolicyIds: policies.map(({ id }) => id),
    blockingPolicyId: null,
    overrideId: appliedOverride?.id ?? null,
    usageIncomplete,
    estimatedProposedAmount: proposed.amount,
    currency: proposed.currency,
  };
};
