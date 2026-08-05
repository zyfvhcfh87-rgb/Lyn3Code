import { describe, expect, it } from "@effect/vitest";

import {
  evaluateDeliveryPolicy,
  type DeliveryPolicyDefinition,
} from "./DeliveryPolicyEvaluator.ts";

const policy: DeliveryPolicyDefinition = {
  defaultApproval: "manual",
  allowedStrategies: ["standard", "provider_default"],
  windows: [{ daysOfWeek: [1], startMinuteUtc: 9 * 60, endMinuteUtc: 17 * 60 }],
  freezes: [
    {
      startsAt: "2026-08-10T12:00:00.000Z",
      endsAt: "2026-08-10T13:00:00.000Z",
      reason: "Incident freeze",
      environments: ["production"],
    },
  ],
  rules: [
    {
      environments: ["preview"],
      approval: "none",
      allowedStrategies: ["provider_default"],
    },
  ],
};

describe("DeliveryPolicyEvaluator", () => {
  it("enforces approval, UTC delivery windows, and allowed strategies", () => {
    const evaluation = evaluateDeliveryPolicy({
      policy,
      environment: "production",
      strategy: "canary",
      now: "2026-08-10T10:00:00.000Z",
      approvalGranted: false,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reasons).toEqual(["approval_required", "strategy_not_allowed"]);
    expect(evaluation.withinDeliveryWindow).toBe(true);
  });

  it("makes active freezes authoritative even with approval", () => {
    const evaluation = evaluateDeliveryPolicy({
      policy,
      environment: "production",
      strategy: "standard",
      now: "2026-08-10T12:30:00.000Z",
      approvalGranted: true,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reasons).toEqual(["delivery_frozen"]);
    expect(evaluation.activeFreeze?.reason).toBe("Incident freeze");
  });

  it("applies environment defaults without weakening the strategy allowlist", () => {
    const evaluation = evaluateDeliveryPolicy({
      policy,
      environment: "preview",
      strategy: "standard",
      now: "2026-08-10T10:00:00.000Z",
      approvalGranted: false,
    });

    expect(evaluation.approval).toBe("none");
    expect(evaluation.reasons).toEqual(["strategy_not_allowed"]);
  });
});
