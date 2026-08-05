import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ApprovalDecision,
  DeliveryListInput,
  DeliveryPolicy,
  DeliveryWorkspaceSnapshot,
  MergeReadinessAssessment,
} from "./delivery.ts";

const now = "2026-08-05T12:00:00.000Z";
const decodePolicy = Schema.decodeUnknownSync(DeliveryPolicy);
const decodeAssessment = Schema.decodeUnknownSync(MergeReadinessAssessment);
const decodeDecision = Schema.decodeUnknownSync(ApprovalDecision);
const decodeList = Schema.decodeUnknownSync(DeliveryListInput);
const decodeWorkspace = Schema.decodeUnknownSync(DeliveryWorkspaceSnapshot);

const policy = {
  id: "policy-1",
  projectId: "project-1",
  name: "protected-main",
  description: "Require current verification and review evidence.",
  isDefault: true,
  version: 1,
  policyDigest: "sha256:policy-1",
  enabled: true,
  mergePolicy: {
    requiredLocalVerificationProfiles: ["verification-profile-1"],
    requireCurrentVerificationFingerprint: true,
    requireRemoteChecks: true,
    requireBranchProtectionCompliance: true,
    requiredApprovalCount: 1,
    requiredReviewerTeams: ["maintainers"],
    requireResolvedThreads: true,
    allowDraftMerge: false,
    allowMergeWithWarnings: false,
    allowAutomaticMerge: false,
    allowedMergeStrategies: ["squash"],
    allowedTargetBranches: ["main"],
  },
  releasePolicy: {
    requiresApproval: true,
    requiredApprovalCount: 1,
    allowedChannels: ["stable"],
    deliveryWindows: [],
    freezeWindows: [],
  },
  deploymentPolicy: {
    requiresApproval: true,
    productionRequiresApproval: true,
    productionApprovalCount: 2,
    allowedStrategies: ["rolling", "canary"],
    deliveryWindows: [],
    freezeWindows: [],
  },
  rollbackPolicy: {
    requiresApproval: true,
    allowAutomaticRollback: false,
    maxAutomaticRollbacks: 0,
    destructiveCleanupRequiresApproval: true,
  },
  createdAt: now,
  updatedAt: now,
};

it("decodes conservative source-bound delivery policies and assessments", () => {
  const decodedPolicy = decodePolicy(policy);
  assert.strictEqual(decodedPolicy.policyDigest, "sha256:policy-1");

  const assessment = decodeAssessment({
    id: "assessment-1",
    projectId: "project-1",
    missionId: "mission-1",
    repositoryConnectionId: "repository-1",
    pullRequestRecordId: "pr-1",
    deliveryPolicyId: "policy-1",
    policyDigest: "sha256:policy-1",
    headSha: "abc123",
    baseSha: "def456",
    sourceCommit: "abc123",
    sourceFingerprint: "git:abc123:clean",
    verificationRunId: "verification-run-1",
    result: "blocked",
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
    blockingReasons: ["Checks are pending"],
    warningReasons: [],
    evidenceSnapshot: {
      headSha: "abc123",
      baseSha: "def456",
      strategy: "squash",
      requiredChecks: ["test"],
      passedChecks: [],
      pendingChecks: ["test"],
      failedChecks: [],
      approvals: 1,
      requiredApprovals: 1,
      changesRequested: false,
      unresolvedBlockingThreads: 0,
      branchProtectionObservedAt: now,
      localVerificationEvidence: ["verification-run-1"],
      secretScanEvidence: [],
      deliveryWindowPolicyReference: null,
    },
    observedAt: now,
    expiresAt: null,
    invalidatedAt: null,
  });
  assert.strictEqual(assessment.sourceCommit, assessment.headSha);
  assert.strictEqual(assessment.blockingReasons.length, 1);
});

it("requires immutable decisions to carry the approved digest and source commit", () => {
  const decision = decodeDecision({
    id: "decision-1",
    approvalRequestId: "approval-1",
    actorId: "maintainer@example.test",
    actorType: "user",
    decision: "approve",
    reason: "Reviewed the exact plan",
    planDigest: "sha256:plan-1",
    sourceCommit: "abc123",
    decidedAt: now,
  });
  assert.strictEqual(decision.planDigest, "sha256:plan-1");
  assert.throws(() => decodeDecision({ ...decision, sourceCommit: "" }));
  assert.throws(() => decodeDecision({ ...decision, decision: "abstain" }));
});

it("bounds delivery queries and decodes a complete empty workspace snapshot", () => {
  assert.strictEqual(decodeList({ projectId: "project-1", limit: 250, offset: 0 }).limit, 250);
  assert.throws(() => decodeList({ projectId: "project-1", limit: 251, offset: 0 }));

  const snapshot = decodeWorkspace({
    projectId: "project-1",
    policies: [policy],
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
    capturedAt: now,
  });
  assert.strictEqual(snapshot.projectId, "project-1");
  assert.strictEqual(snapshot.policies.length, 1);
});
