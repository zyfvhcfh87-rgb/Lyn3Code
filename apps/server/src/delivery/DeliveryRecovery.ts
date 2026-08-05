import type { DeploymentExecution, RollbackExecution } from "@t3tools/contracts";

export type InterruptedDeliveryStage = "merge" | "build" | "deploy" | "validation" | "rollback";

export interface DeliveryRecoveryCapabilities {
  readonly inspect: boolean;
  readonly rollback: boolean;
  readonly idempotentStart: boolean;
  readonly idempotentRollback: boolean;
}

export type DeliveryRecoveryDecision =
  | { readonly action: "manual_retry"; readonly reason: string }
  | { readonly action: "inspect_deployment"; readonly providerDeploymentId: string }
  | { readonly action: "resume_validation"; readonly reason: string }
  | { readonly action: "resume_idempotent_deployment"; readonly idempotencyKey: string }
  | { readonly action: "inspect_rollback"; readonly providerRollbackId: string }
  | { readonly action: "manual_intervention"; readonly reason: string };

export const decideInterruptedDeliveryRecovery = (input: {
  readonly stage: InterruptedDeliveryStage;
  readonly capabilities: DeliveryRecoveryCapabilities;
  readonly deploymentIdempotencyKey: string;
  readonly providerDeploymentId: string | null;
  readonly providerDeploymentSucceeded: boolean;
  readonly providerRollbackId: string | null;
}): DeliveryRecoveryDecision => {
  if (input.stage === "merge" || input.stage === "build") {
    return {
      action: "manual_retry",
      reason: `${input.stage} state cannot be assumed reversible or complete after interruption.`,
    };
  }
  if (input.stage === "validation") {
    return input.providerDeploymentSucceeded
      ? { action: "resume_validation", reason: "Validation is bounded and read-only." }
      : {
          action: "manual_intervention",
          reason: "Provider success was not proven before validation.",
        };
  }
  if (input.stage === "rollback") {
    return input.providerRollbackId !== null && input.capabilities.inspect
      ? { action: "inspect_rollback", providerRollbackId: input.providerRollbackId }
      : {
          action: "manual_intervention",
          reason: "Interrupted rollback must not be issued again without provider reconciliation.",
        };
  }
  if (input.providerDeploymentId !== null && input.capabilities.inspect) {
    return { action: "inspect_deployment", providerDeploymentId: input.providerDeploymentId };
  }
  if (input.providerDeploymentId === null && input.capabilities.idempotentStart) {
    return {
      action: "resume_idempotent_deployment",
      idempotencyKey: input.deploymentIdempotencyKey,
    };
  }
  return {
    action: "manual_intervention",
    reason: "Deployment outcome is unknown and the adapter cannot reconcile it safely.",
  };
};

export type IdempotencyDecision =
  | { readonly action: "start" }
  | { readonly action: "reuse"; readonly executionId: string }
  | { readonly action: "conflict"; readonly reason: string };

export const decideDeploymentIdempotency = (input: {
  readonly requestedKey: string;
  readonly requestedFingerprint: string;
  readonly existing: {
    readonly key: string;
    readonly requestFingerprint: string;
    readonly executionId: DeploymentExecution["id"];
  } | null;
}): IdempotencyDecision => {
  if (input.existing === null || input.existing.key !== input.requestedKey)
    return { action: "start" };
  if (input.existing.requestFingerprint !== input.requestedFingerprint) {
    return {
      action: "conflict",
      reason: "An idempotency key cannot identify two different deployment requests.",
    };
  }
  return { action: "reuse", executionId: input.existing.executionId };
};

export interface AutomaticRollbackDecision {
  readonly allowed: boolean;
  readonly reasons: ReadonlyArray<
    | "policy_disallows"
    | "provider_unsupported"
    | "provider_not_succeeded"
    | "validation_not_failed"
    | "plan_not_reversible"
    | "source_mismatch"
    | "rollback_already_started"
  >;
}

export const evaluateAutomaticRollback = (input: {
  readonly policyAllowsAutomaticRollback: boolean;
  readonly providerSupportsRollback: boolean;
  readonly providerDeploymentSucceeded: boolean;
  readonly validationFailed: boolean;
  readonly rollbackPlanReversible: boolean;
  readonly deployedSourceFingerprint: string;
  readonly rollbackPlanSourceFingerprint: string;
  readonly rollbackAlreadyStarted: boolean;
  readonly rollbackExecutionStatus?: RollbackExecution["status"];
}): AutomaticRollbackDecision => {
  const reasons: Array<AutomaticRollbackDecision["reasons"][number]> = [];
  if (!input.policyAllowsAutomaticRollback) reasons.push("policy_disallows");
  if (!input.providerSupportsRollback) reasons.push("provider_unsupported");
  if (!input.providerDeploymentSucceeded) reasons.push("provider_not_succeeded");
  if (!input.validationFailed) reasons.push("validation_not_failed");
  if (!input.rollbackPlanReversible) reasons.push("plan_not_reversible");
  if (input.deployedSourceFingerprint !== input.rollbackPlanSourceFingerprint) {
    reasons.push("source_mismatch");
  }
  if (input.rollbackAlreadyStarted || input.rollbackExecutionStatus !== undefined) {
    reasons.push("rollback_already_started");
  }
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons) });
};
