import type {
  ApprovalDecision,
  ApprovalRequest,
  DeliveryExecutionStatus,
  DeliveryPlanStatus,
} from "@t3tools/contracts";

export type DeliveryTransitionResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const planTransitions: Readonly<Record<DeliveryPlanStatus, ReadonlySet<DeliveryPlanStatus>>> = {
  draft: new Set(["pending_approval", "approved", "cancelled", "failed", "superseded"]),
  pending_approval: new Set(["approved", "cancelled", "failed", "superseded"]),
  approved: new Set(["executing", "cancelled", "failed", "superseded"]),
  executing: new Set(["completed", "cancelled", "failed", "interrupted"]),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  interrupted: new Set(["executing", "cancelled", "failed"]),
  superseded: new Set(),
};

const executionTransitions: Readonly<
  Record<DeliveryExecutionStatus, ReadonlySet<DeliveryExecutionStatus>>
> = {
  queued: new Set(["preparing", "cancelled", "failed", "interrupted"]),
  preparing: new Set(["running", "cancelled", "failed", "interrupted", "indeterminate"]),
  running: new Set([
    "validating",
    "succeeded",
    "failed",
    "cancelled",
    "interrupted",
    "indeterminate",
  ]),
  validating: new Set([
    "succeeded",
    "succeeded_with_warnings",
    "failed",
    "cancelled",
    "interrupted",
    "indeterminate",
  ]),
  succeeded: new Set(["rolled_back"]),
  succeeded_with_warnings: new Set(["rolled_back"]),
  failed: new Set(["rolled_back"]),
  cancelled: new Set(),
  interrupted: new Set([
    "preparing",
    "running",
    "validating",
    "failed",
    "cancelled",
    "indeterminate",
  ]),
  indeterminate: new Set([
    "running",
    "validating",
    "succeeded",
    "failed",
    "cancelled",
    "rolled_back",
  ]),
  rolled_back: new Set(),
};

const transition = <Status extends string>(
  transitions: Readonly<Record<Status, ReadonlySet<Status>>>,
  current: Status,
  next: Status,
): DeliveryTransitionResult =>
  current === next || transitions[current].has(next)
    ? { allowed: true }
    : { allowed: false, reason: `Transition from '${current}' to '${next}' is not allowed.` };

export const validatePlanTransition = (
  current: DeliveryPlanStatus,
  next: DeliveryPlanStatus,
): DeliveryTransitionResult => transition(planTransitions, current, next);

export const validateExecutionTransition = (
  current: DeliveryExecutionStatus,
  next: DeliveryExecutionStatus,
): DeliveryTransitionResult => transition(executionTransitions, current, next);

export const validateApprovalDecisionBinding = (input: {
  readonly request: ApprovalRequest;
  readonly decision: ApprovalDecision;
  readonly now: string;
}): DeliveryTransitionResult => {
  if (input.request.status !== "pending") {
    return { allowed: false, reason: "Only a pending approval request can receive a decision." };
  }
  if (input.request.id !== input.decision.approvalRequestId) {
    return { allowed: false, reason: "The decision references a different approval request." };
  }
  if (
    input.request.planDigest !== input.decision.planDigest ||
    input.request.sourceCommit !== input.decision.sourceCommit
  ) {
    return {
      allowed: false,
      reason: "The decision does not match the exact approved plan digest and source commit.",
    };
  }
  if (input.request.expiresAt !== null && input.request.expiresAt <= input.now) {
    return { allowed: false, reason: "The approval request expired before the decision." };
  }
  if (
    (input.request.approvalType === "production_deployment" ||
      input.request.approvalType === "rollback") &&
    (input.decision.reason ?? "").trim().length === 0
  ) {
    return {
      allowed: false,
      reason: "Production and rollback approval decisions require a reason.",
    };
  }
  return { allowed: true };
};

export const validateApprovedPlanMutation = (input: {
  readonly currentStatus: DeliveryPlanStatus;
  readonly currentDigest: string;
  readonly currentSourceCommit: string;
  readonly nextDigest: string;
  readonly nextSourceCommit: string;
}): DeliveryTransitionResult => {
  if (
    (input.currentStatus === "approved" ||
      input.currentStatus === "executing" ||
      input.currentStatus === "completed") &&
    (input.currentDigest !== input.nextDigest ||
      input.currentSourceCommit !== input.nextSourceCommit)
  ) {
    return {
      allowed: false,
      reason: "An approved plan is immutable; create a superseding plan and request new approval.",
    };
  }
  return { allowed: true };
};

export const approvalRequestIsCurrent = (input: {
  readonly request: ApprovalRequest;
  readonly approvalCount: number;
  readonly expectedPlanDigest: string;
  readonly expectedSourceCommit: string;
  readonly now: string;
}): boolean =>
  input.request.status === "approved" &&
  input.request.planDigest === input.expectedPlanDigest &&
  input.request.sourceCommit === input.expectedSourceCommit &&
  (input.request.expiresAt === null || input.request.expiresAt > input.now) &&
  input.approvalCount >= input.request.requiredDecisionCount;
