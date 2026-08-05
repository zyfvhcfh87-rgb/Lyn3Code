import type { DeliveryWorkspaceSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DeliveryWorkspace } from "./DeliveryWorkspace";
import { MissionDeliverySection } from "./MissionDeliverySection";

const capturedAt = "2026-08-05T10:00:00.000Z";

function snapshot(
  overrides: Partial<Record<keyof DeliveryWorkspaceSnapshot, readonly unknown[] | string>> = {},
): DeliveryWorkspaceSnapshot {
  return {
    projectId: "project-1",
    policies: [],
    mergeReadinessAssessments: [],
    approvalRequests: [],
    approvalDecisions: [],
    mergeExecutions: [],
    releaseConfigurations: [],
    releasePlans: [],
    releaseArtifacts: [],
    deploymentEnvironments: [],
    deploymentPlans: [],
    deploymentExecutions: [],
    deploymentValidationRuns: [],
    rollbackPlans: [],
    rollbackExecutions: [],
    auditEntries: [],
    capturedAt,
    ...overrides,
  } as unknown as DeliveryWorkspaceSnapshot;
}

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    id: "assessment-1",
    projectId: "project-1",
    missionId: "mission-1",
    repositoryConnectionId: "repository-1",
    pullRequestRecordId: "pr-1",
    deliveryPolicyId: "policy-1",
    policyDigest: "policy-digest-1",
    headSha: "aaaaaaaa11111111",
    baseSha: "bbbbbbbb22222222",
    sourceCommit: "aaaaaaaa11111111",
    sourceFingerprint: "fingerprint-1",
    verificationRunId: "verification-1",
    result: "ready",
    states: {
      localVerification: "passed",
      remoteChecks: "passed",
      reviews: "passed",
      threads: "passed",
      mergeability: "passed",
      branchProtection: "passed",
      secretScan: "passed",
      deliveryWindow: "passed",
    },
    blockingReasons: [],
    warningReasons: [],
    evidenceSnapshot: {
      headSha: "aaaaaaaa11111111",
      baseSha: "bbbbbbbb22222222",
      strategy: "squash",
      requiredChecks: [],
      passedChecks: [],
      pendingChecks: [],
      failedChecks: [],
      approvals: 1,
      requiredApprovals: 1,
      changesRequested: false,
      unresolvedBlockingThreads: 0,
      branchProtectionObservedAt: capturedAt,
      localVerificationEvidence: ["verification-1"],
      secretScanEvidence: ["secret-scan-1"],
      deliveryWindowPolicyReference: null,
    },
    observedAt: capturedAt,
    expiresAt: null,
    invalidatedAt: null,
    ...overrides,
  };
}

function environment(overrides: Record<string, unknown> = {}) {
  return {
    id: "environment-1",
    projectId: "project-1",
    name: "Production",
    tier: "production",
    provider: "repository-script",
    externalRef: null,
    protected: true,
    requiresApproval: true,
    configurationDigest: "environment-digest-1",
    publicMetadata: {},
    createdAt: capturedAt,
    updatedAt: capturedAt,
    ...overrides,
  };
}

function deploymentPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "deployment-plan-1",
    projectId: "project-1",
    missionId: "mission-1",
    releasePlanId: null,
    deploymentEnvironmentId: "environment-1",
    deliveryPolicyId: "policy-1",
    planDigest: "deployment-plan-digest-1",
    sourceCommit: "aaaaaaaa11111111",
    strategy: "rolling",
    configuration: {},
    status: "approved",
    approvalRequestId: "approval-1",
    approvedAt: capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt,
    ...overrides,
  };
}

describe("DeliveryWorkspace", () => {
  it("renders honest loading, error, and empty states", () => {
    const loading = renderToStaticMarkup(<DeliveryWorkspace state="loading" />);
    const error = renderToStaticMarkup(
      <DeliveryWorkspace state="error" error="Snapshot request failed." />,
    );
    const empty = renderToStaticMarkup(<DeliveryWorkspace state="ready" snapshot={snapshot()} />);

    expect(loading).toContain("Loading controlled delivery");
    expect(loading).toContain("No placeholder approvals or evidence are shown");
    expect(error).toContain("Controlled delivery unavailable");
    expect(error).toContain("Snapshot request failed");
    expect(empty).toContain("No controlled delivery configured");
  });

  it("keeps mission delivery hidden without data and exposes an honest loading fallback", () => {
    const absent = renderToStaticMarkup(<MissionDeliverySection />);
    const empty = renderToStaticMarkup(
      <MissionDeliverySection delivery={{ state: "ready", snapshot: snapshot() }} />,
    );
    const loading = renderToStaticMarkup(
      <MissionDeliverySection delivery={{ state: "loading" }} />,
    );

    expect(absent).toBe("");
    expect(empty).toBe("");
    expect(loading).toContain("Delivery");
    expect(loading).toContain("Loading controlled delivery");
  });

  it("shows stale source evidence, exact check blockers, freezes, connectivity, and reversibility", () => {
    const html = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        snapshot={snapshot({
          policies: [{ id: "policy-1" }],
          mergeReadinessAssessments: [
            readiness({
              result: "stale",
              headSha: "new-head-22222222",
              states: {
                localVerification: "passed",
                remoteChecks: "blocked",
                reviews: "passed",
                threads: "passed",
                mergeability: "passed",
                branchProtection: "passed",
                secretScan: "passed",
                deliveryWindow: "passed",
              },
              blockingReasons: [
                "Required CI check build is still pending.",
                "Required CI check test failed.",
              ],
              warningReasons: ["The source fingerprint is stale."],
              evidenceSnapshot: {
                ...readiness().evidenceSnapshot,
                headSha: "new-head-22222222",
                requiredChecks: ["build", "test"],
                pendingChecks: ["build"],
                failedChecks: ["test"],
              },
            }),
          ],
          deploymentEnvironments: [environment()],
          deploymentPlans: [
            deploymentPlan({
              configuration: {
                deliveryFreeze: "active",
                providerConnection: "disconnected",
                reversibility: "partial",
              },
            }),
          ],
        })}
      />,
    );

    expect(html).toContain("Assessment is stale");
    expect(html).toContain("Source head changed");
    expect(html).toContain("Required CI check build is still pending");
    expect(html).toContain("Required CI check test failed");
    expect(html).toContain("Lane: remoteChecks");
    expect(html).toContain("Delivery freeze is active");
    expect(html).toContain("Provider disconnected");
    expect(html).toContain("Only partially reversible");
    expect(html).toContain("Partial reversibility");
  });

  it("renders required, rejected, and expired approval states with exact reasons", () => {
    const required = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        snapshot={snapshot({
          policies: [{ id: "policy-1" }],
          mergeReadinessAssessments: [readiness()],
        })}
      />,
    );
    const resolved = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        snapshot={snapshot({
          policies: [{ id: "policy-1" }],
          approvalRequests: [
            {
              id: "approval-rejected",
              approvalType: "release",
              targetId: "release-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "rejected",
              requiredDecisionCount: 1,
              requestedAt: capturedAt,
              expiresAt: null,
            },
            {
              id: "approval-expired",
              approvalType: "deployment",
              targetId: "deployment-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "expired",
              requiredDecisionCount: 1,
              requestedAt: capturedAt,
              expiresAt: "2020-01-01T00:00:00.000Z",
            },
          ],
          approvalDecisions: [
            {
              id: "decision-1",
              approvalRequestId: "approval-rejected",
              actorId: "maintainer-1",
              decision: "reject",
              reason: "The release evidence is incomplete.",
              decidedAt: capturedAt,
            },
          ],
        })}
      />,
    );

    expect(required).toContain("Approval required");
    expect(resolved).toContain("Approval rejected");
    expect(resolved).toContain("The release evidence is incomplete");
    expect(resolved).toContain("Approval expired");
  });

  it("keeps deployment success separate from failed validation and unavailable rollback", () => {
    const html = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        snapshot={snapshot({
          policies: [{ id: "policy-1" }],
          deploymentEnvironments: [environment()],
          deploymentPlans: [deploymentPlan({ status: "completed" })],
          deploymentExecutions: [
            {
              id: "deployment-execution-1",
              deploymentPlanId: "deployment-plan-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "succeeded",
              createdAt: capturedAt,
            },
          ],
          deploymentValidationRuns: [
            {
              id: "validation-1",
              deploymentExecutionId: "deployment-execution-1",
              kind: "health-check",
              status: "failed",
              errorMessage: "The readiness endpoint returned 503.",
              evidence: {},
              createdAt: capturedAt,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Validation failed");
    expect(html).toContain("The readiness endpoint returned 503");
    expect(html).toContain("Rollback unavailable");
  });

  it("shows running rollback and guarded confirmation plus reason affordances", () => {
    const html = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        actions={{
          onAssessReadiness: () => undefined,
          onDecideApproval: () => undefined,
          onExecuteMerge: () => undefined,
          onExecuteRelease: () => undefined,
          onExecuteDeployment: () => undefined,
          onRunValidation: () => undefined,
          onCreateRollbackPlan: () => undefined,
          onExecuteRollback: () => undefined,
        }}
        snapshot={snapshot({
          policies: [{ id: "policy-1" }],
          mergeReadinessAssessments: [readiness()],
          approvalRequests: [
            {
              id: "approval-1",
              approvalType: "deployment",
              targetId: "deployment-plan-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "pending",
              requiredDecisionCount: 1,
              requestedAt: capturedAt,
              expiresAt: null,
            },
            {
              id: "approval-merge-1",
              approvalType: "merge",
              targetId: "assessment-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "approved",
              requiredDecisionCount: 1,
              requestedAt: capturedAt,
              expiresAt: null,
            },
          ],
          deploymentEnvironments: [environment()],
          deploymentPlans: [deploymentPlan()],
          rollbackPlans: [
            {
              id: "rollback-plan-1",
              deploymentEnvironmentId: "environment-1",
              restoreSourceCommit: "previous-commit-1",
              sourceCommit: "aaaaaaaa11111111",
              reason: "Health checks failed after deployment.",
              status: "executing",
              createdAt: capturedAt,
              updatedAt: capturedAt,
            },
          ],
          rollbackExecutions: [
            {
              id: "rollback-execution-1",
              rollbackPlanId: "rollback-plan-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "running",
              createdAt: capturedAt,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Rollback running");
    expect(html).toContain("Approve request");
    expect(html).toContain("Reject request");
    expect(html).toContain("Execute deployment");
    expect(html).toContain("Execute merge");
    expect(html).toContain("Reassess readiness");
    expect(html).toContain("Reason");
    expect(html).toContain("I confirm");
    expect(html).toContain("disabled");
  });

  it("offers guarded cancellation for an active deployment execution", () => {
    const html = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        actions={{ onCancelDeployment: () => undefined }}
        snapshot={snapshot({
          policies: [{ id: "policy-1" }],
          deploymentEnvironments: [environment()],
          deploymentPlans: [deploymentPlan({ status: "executing" })],
          deploymentExecutions: [
            {
              id: "deployment-execution-1",
              deploymentPlanId: "deployment-plan-1",
              sourceCommit: "aaaaaaaa11111111",
              status: "running",
              createdAt: capturedAt,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Cancel deployment");
    expect(html).toContain("Partial logs and provider evidence will be preserved");
    expect(html).toContain("Reason");
  });

  it("authors server-owned release and deployment proposals from configured choices", () => {
    const policy = {
      id: "policy-1",
      name: "Default delivery",
      enabled: true,
      isDefault: true,
      deploymentPolicy: { allowedStrategies: ["rolling", "provider_default"] },
    };
    const html = renderToStaticMarkup(
      <DeliveryWorkspace
        state="ready"
        actions={{
          onCreateReleasePlan: () => undefined,
          onCreateDeploymentPlan: () => undefined,
        }}
        snapshot={snapshot({
          policies: [policy],
          releaseConfigurations: [
            {
              id: "release-configuration-1",
              name: "Stable",
              enabled: true,
              versionStrategy: "manual",
              provider: "github",
              releaseChannel: "stable",
              publicMetadata: {},
            },
          ],
          deploymentEnvironments: [environment({ status: "active" })],
        })}
      />,
    );

    expect(html).toContain("Propose release plan");
    expect(html).toContain("Version bump");
    expect(html).toContain("passing full-profile verification");
    expect(html).toContain("Propose deployment plan");
    expect(html).toContain("Current verified commit");
    expect(html).toContain("server-computed digest");
  });
});
