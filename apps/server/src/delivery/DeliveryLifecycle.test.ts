import {
  ApprovalDecisionId,
  DeliveryApprovalRequestId,
  DeliveryPolicyId,
  MissionId,
  ProjectId,
  type ApprovalRequest,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  approvalRequestIsCurrent,
  validateApprovalDecisionBinding,
  validateApprovedPlanMutation,
  validateExecutionTransition,
  validatePlanTransition,
} from "./DeliveryLifecycle.ts";

const approval: ApprovalRequest = {
  id: DeliveryApprovalRequestId.make("approval-1"),
  projectId: ProjectId.make("project-1"),
  missionId: MissionId.make("mission-1"),
  deliveryPolicyId: DeliveryPolicyId.make("policy-1"),
  approvalType: "production_deployment",
  targetType: "deployment_plan",
  targetId: "plan-1",
  planDigest: "digest-1",
  sourceCommit: "abc123",
  status: "pending",
  requiredDecisionCount: 2,
  policySnapshot: {},
  contextSnapshot: {},
  requestedBy: "maintainer",
  requestedAt: "2026-08-05T09:00:00.000Z",
  resolvedAt: null,
  expiresAt: "2026-08-05T11:00:00.000Z",
};

describe("DeliveryLifecycle", () => {
  it("rejects unsafe plan and execution jumps", () => {
    expect(validatePlanTransition("draft", "completed").allowed).toBe(false);
    expect(validateExecutionTransition("queued", "succeeded").allowed).toBe(false);
    expect(validatePlanTransition("approved", "executing").allowed).toBe(true);
  });

  it("binds immutable approval decisions to the exact plan and source", () => {
    const result = validateApprovalDecisionBinding({
      request: approval,
      decision: {
        id: ApprovalDecisionId.make("decision-1"),
        approvalRequestId: approval.id,
        actorId: "reviewer",
        actorType: "user",
        decision: "approve",
        reason: "Approved for the protected production window.",
        planDigest: "changed-digest",
        sourceCommit: approval.sourceCommit,
        decidedAt: "2026-08-05T10:00:00.000Z",
      },
      now: "2026-08-05T10:00:00.000Z",
    });
    expect(result.allowed).toBe(false);
  });

  it("requires a new plan when approved source or configuration changes", () => {
    expect(
      validateApprovedPlanMutation({
        currentStatus: "approved",
        currentDigest: "digest-1",
        currentSourceCommit: "abc123",
        nextDigest: "digest-2",
        nextSourceCommit: "abc123",
      }).allowed,
    ).toBe(false);
  });

  it("recognizes only a complete current approval quorum", () => {
    expect(
      approvalRequestIsCurrent({
        request: { ...approval, status: "approved" },
        approvalCount: 2,
        expectedPlanDigest: approval.planDigest,
        expectedSourceCommit: approval.sourceCommit,
        now: "2026-08-05T10:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      approvalRequestIsCurrent({
        request: { ...approval, status: "approved" },
        approvalCount: 1,
        expectedPlanDigest: approval.planDigest,
        expectedSourceCommit: approval.sourceCommit,
        now: "2026-08-05T10:00:00.000Z",
      }),
    ).toBe(false);
  });
});
