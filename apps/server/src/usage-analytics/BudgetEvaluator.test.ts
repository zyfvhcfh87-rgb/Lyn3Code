import {
  AnalyticsCurrency,
  BudgetOverride,
  BudgetOverrideId,
  BudgetPolicy,
  BudgetPolicyId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { evaluateBudget, type BudgetEvaluationInput } from "./BudgetEvaluator.ts";

const now = "2026-01-15T00:00:00.000Z";
const usd = AnalyticsCurrency.make("USD");

const policy = (input: {
  readonly id: string;
  readonly scopeType: "user" | "project";
  readonly scopeId: string;
  readonly hardLimit: string;
  readonly action: "notify" | "block_new_runs";
  readonly conservative?: boolean;
}) =>
  BudgetPolicy.make({
    id: BudgetPolicyId.make(input.id),
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    name: input.id,
    currency: usd,
    periodType: "monthly",
    periodStart: null,
    periodEnd: null,
    softLimit: null,
    hardLimit: input.hardLimit,
    tokenLimit: null,
    requestLimit: null,
    actionOnSoftLimit: "notify",
    actionOnHardLimit: input.action,
    conservativeWhenIncomplete: input.conservative ?? false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

const baseInput = (policies: ReadonlyArray<BudgetPolicy>): BudgetEvaluationInput => ({
  policies,
  overrides: [],
  scopePath: [
    { scopeType: "user", scopeId: "user-1" },
    { scopeType: "project", scopeId: "project-1" },
  ],
  current: { costs: [{ currency: usd, amount: "90" }], costComplete: true, tokens: 0, requests: 0 },
  proposed: {
    costs: [{ currency: usd, amount: "20" }],
    costComplete: true,
    tokens: 0,
    requests: 0,
  },
  workState: "new",
  now,
});

describe("BudgetEvaluator", () => {
  it("inherits policies and applies the most restrictive reached hard action", () => {
    const userPolicy = policy({
      id: "budget-user",
      scopeType: "user",
      scopeId: "user-1",
      hardLimit: "100",
      action: "notify",
    });
    const projectPolicy = policy({
      id: "budget-project",
      scopeType: "project",
      scopeId: "project-1",
      hardLimit: "105",
      action: "block_new_runs",
    });

    const decision = evaluateBudget(baseInput([userPolicy, projectPolicy]));
    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe("block_new_runs");
    expect(decision.blockingPolicyId).toBe(projectPolicy.id);
    expect(decision.applicablePolicyIds).toEqual([userPolicy.id, projectPolicy.id]);
  });

  it("reports a hard limit but never stops already-running work", () => {
    const hard = policy({
      id: "budget-running",
      scopeType: "project",
      scopeId: "project-1",
      hardLimit: "100",
      action: "block_new_runs",
    });
    const decision = evaluateBudget({ ...baseInput([hard]), workState: "running" });

    expect(decision.allowed).toBe(true);
    expect(decision.action).toBe("informational");
    expect(decision.reason).toContain("Existing work may finish");
  });

  it("requires explicit approval when a soft threshold configures that action", () => {
    const approval = BudgetPolicy.make({
      ...policy({
        id: "budget-soft-approval",
        scopeType: "project",
        scopeId: "project-1",
        hardLimit: "500",
        action: "block_new_runs",
      }),
      softLimit: "100",
      actionOnSoftLimit: "require_approval",
    });
    const decision = evaluateBudget(baseInput([approval]));

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe("require_approval");
    expect(decision.blockingPolicyId).toBe(approval.id);
  });

  it("surfaces incomplete usage and conservatively protects new work", () => {
    const hard = policy({
      id: "budget-incomplete",
      scopeType: "project",
      scopeId: "project-1",
      hardLimit: "100",
      action: "block_new_runs",
      conservative: true,
    });
    const decision = evaluateBudget({
      ...baseInput([hard]),
      current: { costs: [], costComplete: false, tokens: null, requests: null },
      proposed: { costs: [], costComplete: false, tokens: null, requests: null },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.usageIncomplete).toBe(true);
    expect(decision.reason).toContain("incomplete");
  });

  it("does not let unrelated unknown cost block a token-only policy", () => {
    const tokenOnly = BudgetPolicy.make({
      ...policy({
        id: "budget-token-only",
        scopeType: "project",
        scopeId: "project-1",
        hardLimit: "100",
        action: "block_new_runs",
        conservative: true,
      }),
      hardLimit: null,
      tokenLimit: 1_000,
    });
    const decision = evaluateBudget({
      ...baseInput([tokenOnly]),
      current: { costs: [], costComplete: false, tokens: 100, requests: null },
      proposed: { costs: [], costComplete: false, tokens: 100, requests: null },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.usageIncomplete).toBe(false);
  });

  it("blocks when the current hard limit is already reached even if proposed cost is unknown", () => {
    const hard = policy({
      id: "budget-already-reached",
      scopeType: "project",
      scopeId: "project-1",
      hardLimit: "100",
      action: "block_new_runs",
    });
    const decision = evaluateBudget({
      ...baseInput([hard]),
      current: {
        costs: [{ currency: usd, amount: "100" }],
        costComplete: true,
        tokens: null,
        requests: null,
      },
      proposed: { costs: [], costComplete: false, tokens: null, requests: 1 },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockingPolicyId).toBe(hard.id);
    expect(decision.usageIncomplete).toBe(true);
  });

  it("does not add a different currency into a policy's total", () => {
    const hard = policy({
      id: "budget-currency",
      scopeType: "project",
      scopeId: "project-1",
      hardLimit: "50",
      action: "block_new_runs",
    });
    const eur = AnalyticsCurrency.make("EUR");
    const decision = evaluateBudget({
      ...baseInput([hard]),
      current: {
        costs: [{ currency: usd, amount: "10" }],
        costComplete: true,
        tokens: 0,
        requests: 0,
      },
      proposed: {
        costs: [{ currency: eur, amount: "100" }],
        costComplete: true,
        tokens: 0,
        requests: 0,
      },
    });

    expect(decision.allowed).toBe(true);
  });

  it("honors a current override for the reached policy", () => {
    const hard = policy({
      id: "budget-overridden",
      scopeType: "project",
      scopeId: "project-1",
      hardLimit: "100",
      action: "block_new_runs",
    });
    const override = BudgetOverride.make({
      id: BudgetOverrideId.make("override-budget"),
      budgetPolicyId: hard.id,
      scopeType: "project",
      scopeId: "project-1",
      currentValue: "90",
      thresholdValue: "100",
      reason: "Approved exception",
      actor: "maintainer",
      expiresAt: "2026-01-16T00:00:00.000Z",
      fallbackAllowed: false,
      createdAt: now,
      expiredAt: null,
    });
    const decision = evaluateBudget({ ...baseInput([hard]), overrides: [override] });

    expect(decision.allowed).toBe(true);
    expect(decision.overrideId).toBe(override.id);
  });
});
