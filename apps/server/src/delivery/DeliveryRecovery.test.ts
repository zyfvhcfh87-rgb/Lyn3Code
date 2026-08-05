import { DeploymentExecutionId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  decideDeploymentIdempotency,
  decideInterruptedDeliveryRecovery,
  evaluateAutomaticRollback,
} from "./DeliveryRecovery.ts";

const capabilities = {
  inspect: true,
  rollback: false,
  idempotentStart: false,
  idempotentRollback: false,
};

describe("DeliveryRecovery", () => {
  it("reconciles captured remote deployments and reruns only read-only validation", () => {
    expect(
      decideInterruptedDeliveryRecovery({
        stage: "deploy",
        capabilities,
        deploymentIdempotencyKey: "deploy-1",
        providerDeploymentId: "remote-1",
        providerDeploymentSucceeded: false,
        providerRollbackId: null,
      }),
    ).toEqual({ action: "inspect_deployment", providerDeploymentId: "remote-1" });
    expect(
      decideInterruptedDeliveryRecovery({
        stage: "validation",
        capabilities,
        deploymentIdempotencyKey: "deploy-1",
        providerDeploymentId: "remote-1",
        providerDeploymentSucceeded: true,
        providerRollbackId: null,
      }),
    ).toMatchObject({ action: "resume_validation" });
  });

  it("does not replay interrupted local or rollback side effects", () => {
    expect(
      decideInterruptedDeliveryRecovery({
        stage: "build",
        capabilities,
        deploymentIdempotencyKey: "deploy-1",
        providerDeploymentId: null,
        providerDeploymentSucceeded: false,
        providerRollbackId: null,
      }),
    ).toMatchObject({ action: "manual_retry" });
    expect(
      decideInterruptedDeliveryRecovery({
        stage: "rollback",
        capabilities,
        deploymentIdempotencyKey: "deploy-1",
        providerDeploymentId: "remote-1",
        providerDeploymentSucceeded: true,
        providerRollbackId: null,
      }),
    ).toMatchObject({ action: "manual_intervention" });
  });

  it("reuses matching idempotency keys and rejects fingerprint conflicts", () => {
    const existing = {
      key: "deploy-1",
      requestFingerprint: "fingerprint-a",
      executionId: DeploymentExecutionId.make("execution-1"),
    };
    expect(
      decideDeploymentIdempotency({
        requestedKey: "deploy-1",
        requestedFingerprint: "fingerprint-a",
        existing,
      }),
    ).toEqual({ action: "reuse", executionId: existing.executionId });
    expect(
      decideDeploymentIdempotency({
        requestedKey: "deploy-1",
        requestedFingerprint: "fingerprint-b",
        existing,
      }),
    ).toMatchObject({ action: "conflict" });
  });

  it("allows automatic rollback only when policy, capability, reversibility, and source all agree", () => {
    const safe = {
      policyAllowsAutomaticRollback: true,
      providerSupportsRollback: true,
      providerDeploymentSucceeded: true,
      validationFailed: true,
      rollbackPlanReversible: true,
      deployedSourceFingerprint: "source-a",
      rollbackPlanSourceFingerprint: "source-a",
      rollbackAlreadyStarted: false,
    };
    expect(evaluateAutomaticRollback(safe)).toEqual({ allowed: true, reasons: [] });
    expect(
      evaluateAutomaticRollback({
        ...safe,
        providerSupportsRollback: false,
        rollbackPlanSourceFingerprint: "source-b",
      }),
    ).toEqual({ allowed: false, reasons: ["provider_unsupported", "source_mismatch"] });
  });
});
