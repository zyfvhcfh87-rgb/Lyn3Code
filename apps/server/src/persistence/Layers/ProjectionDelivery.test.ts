import {
  ApprovalDecisionId,
  DeliveryApprovalRequestId,
  DeliveryPolicyId,
  ProjectId,
  ReleaseConfigurationId,
  ReleasePlanId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionDeliveryRepository } from "../Services/ProjectionDelivery.ts";
import { ProjectionDeliveryRepositoryLive } from "./ProjectionDelivery.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const now = "2026-08-05T12:00:00.000Z";
const later = "2026-08-05T12:01:00.000Z";
const projectId = ProjectId.make("delivery-repository-project");
const policyId = DeliveryPolicyId.make("delivery-repository-policy");
const requestId = DeliveryApprovalRequestId.make("delivery-repository-approval");

const persistenceLayer = SqlitePersistenceMemory;
const layer = it.layer(
  Layer.mergeAll(
    ProjectionDeliveryRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  ),
);

const seedProject = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'Delivery', '/delivery', NULL, '[]', ${now}, ${now}, NULL)
  `;
});

const policy = {
  id: policyId,
  projectId,
  name: "protected-main",
  description: "Exact-source merge, release, deployment, and rollback controls.",
  isDefault: true,
  version: 1,
  policyDigest: "sha256:policy-v1",
  enabled: true,
  mergePolicy: {
    requiredLocalVerificationProfiles: [],
    requireCurrentVerificationFingerprint: true,
    requireRemoteChecks: true,
    requireBranchProtectionCompliance: true,
    requiredApprovalCount: 2,
    requiredReviewerTeams: ["maintainers"],
    requireResolvedThreads: true,
    allowDraftMerge: false,
    allowMergeWithWarnings: false,
    allowAutomaticMerge: false,
    allowedMergeStrategies: ["squash" as const],
    allowedTargetBranches: ["main"],
  },
  releasePolicy: {
    requiresApproval: true,
    requiredApprovalCount: 2,
    allowedChannels: ["stable"],
    deliveryWindows: [],
    freezeWindows: [],
  },
  deploymentPolicy: {
    requiresApproval: true,
    productionRequiresApproval: true,
    productionApprovalCount: 2,
    allowedStrategies: ["rolling" as const],
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

layer("ProjectionDeliveryRepository", (it) => {
  it.effect("round-trips typed policies and workspace snapshots", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionDeliveryRepository;
      yield* repository.savePolicy(policy);

      const found = yield* repository.getPolicy(policyId);
      assert.isTrue(Option.isSome(found));
      if (Option.isSome(found)) {
        assert.strictEqual(found.value.mergePolicy.requiredReviewerTeams[0], "maintainers");
      }
      assert.strictEqual((yield* repository.listPolicies(projectId)).length, 1);
      const snapshot = yield* repository.getWorkspaceSnapshot(projectId);
      assert.strictEqual(snapshot.policies.length, 1);
      assert.strictEqual(snapshot.approvalRequests.length, 0);
    }),
  );

  it.effect("records approval decisions atomically and idempotently", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionDeliveryRepository;
      yield* repository.savePolicy(policy);
      yield* repository.saveApprovalRequest({
        id: requestId,
        projectId,
        missionId: null,
        deliveryPolicyId: policyId,
        approvalType: "production_deployment",
        targetType: "deployment_plan",
        targetId: "deployment-plan-1",
        planDigest: "sha256:deployment-plan-1",
        sourceCommit: "abc123",
        status: "pending",
        requiredDecisionCount: 2,
        policySnapshot: { policyDigest: "sha256:policy-v1" },
        contextSnapshot: { environment: "production" },
        requestedBy: "release-manager",
        requestedAt: now,
        resolvedAt: null,
        expiresAt: null,
      });

      const first = {
        id: ApprovalDecisionId.make("delivery-decision-1"),
        approvalRequestId: requestId,
        actorId: "maintainer-1",
        actorType: "user" as const,
        decision: "approve" as const,
        reason: "Reviewed exact source",
        planDigest: "sha256:deployment-plan-1",
        sourceCommit: "abc123",
        decidedAt: now,
      };
      const pending = yield* repository.recordApprovalDecision(first);
      assert.strictEqual(pending.request.status, "pending");
      assert.strictEqual(pending.decisions.length, 1);

      const second = {
        ...first,
        id: ApprovalDecisionId.make("delivery-decision-2"),
        actorId: "maintainer-2",
        decidedAt: later,
      };
      const approved = yield* repository.recordApprovalDecision(second);
      assert.strictEqual(approved.request.status, "approved");
      assert.strictEqual(approved.request.resolvedAt, later);
      assert.strictEqual(approved.decisions.length, 2);

      const repeated = yield* repository.recordApprovalDecision(second);
      assert.strictEqual(repeated.request.status, "approved");
      assert.strictEqual(repeated.decisions.length, 2);
    }),
  );

  it.effect("recovers only release plans whose publication was executing", () =>
    Effect.gen(function* () {
      yield* seedProject;
      const repository = yield* ProjectionDeliveryRepository;
      yield* repository.savePolicy(policy);
      const releaseConfigurationId = ReleaseConfigurationId.make("delivery-release-configuration");
      yield* repository.saveReleaseConfiguration({
        id: releaseConfigurationId,
        projectId,
        name: "Stable",
        provider: "github",
        repository: "example/repository",
        releaseChannel: "stable",
        tagPattern: "v{version}",
        artifactGlobs: [],
        versionStrategy: "manual",
        versionSource: "manual",
        changelogMode: "generated",
        artifactConfiguration: {},
        githubReleaseEnabled: true,
        packagePublishingEnabled: false,
        enabled: true,
        version: 1,
        configurationDigest: "configuration-digest",
        publicMetadata: {},
        createdAt: now,
        updatedAt: now,
      });
      const releasePlan = {
        id: ReleasePlanId.make("delivery-release-approved"),
        projectId,
        missionId: null,
        releaseConfigurationId,
        deliveryPolicyId: policyId,
        planDigest: "approved-digest",
        sourceCommit: "abc123",
        version: "1.0.0",
        tagName: "v1.0.0",
        releaseName: "Stable 1.0.0",
        sourceBranch: "main",
        changeSummary: "Release summary",
        changelogDraft: "- Change",
        releaseNotesDraft: "Release notes",
        includedMissions: [],
        includedPullRequests: [],
        artifactPlan: {},
        publicationPlan: {},
        status: "approved" as const,
        approvalRequestId: null,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      yield* repository.saveReleasePlan(releasePlan);
      yield* repository.saveReleasePlan({
        ...releasePlan,
        id: ReleasePlanId.make("delivery-release-executing"),
        planDigest: "executing-digest",
        version: "1.0.1",
        tagName: "v1.0.1",
        releaseName: "Stable 1.0.1",
        status: "executing",
      });

      const recoverable = yield* repository.listRecoverableReleasePlans();
      assert.deepStrictEqual(
        recoverable.map((plan) => plan.id),
        [ReleasePlanId.make("delivery-release-executing")],
      );
    }),
  );
});
