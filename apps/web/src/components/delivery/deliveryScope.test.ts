import type { DeliveryWorkspaceSnapshot, MissionId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { missionDeliveryIsEmpty, scopeDeliverySnapshotToMission } from "./deliveryScope";

const MISSION = "mission-1" as MissionId;
const OTHER_MISSION = "mission-2" as MissionId;

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
    capturedAt: "2026-08-05T10:00:00.000Z",
    ...overrides,
  } as unknown as DeliveryWorkspaceSnapshot;
}

describe("scopeDeliverySnapshotToMission", () => {
  it("drops mission-scoped records belonging to another mission", () => {
    const scoped = scopeDeliverySnapshotToMission(
      snapshot({
        mergeReadinessAssessments: [
          { id: "assessment-1", missionId: MISSION },
          { id: "assessment-2", missionId: OTHER_MISSION },
        ],
        approvalRequests: [
          { id: "approval-1", missionId: MISSION },
          { id: "approval-2", missionId: OTHER_MISSION },
        ],
        mergeExecutions: [{ id: "merge-1", missionId: OTHER_MISSION }],
        releasePlans: [{ id: "release-1", missionId: OTHER_MISSION }],
        deploymentPlans: [{ id: "deployment-1", missionId: MISSION }],
        rollbackPlans: [{ id: "rollback-1", missionId: OTHER_MISSION }],
        auditEntries: [
          { id: "audit-1", missionId: MISSION },
          { id: "audit-2", missionId: OTHER_MISSION },
        ],
      }),
      MISSION,
    );

    expect(scoped.mergeReadinessAssessments.map((item) => item.id)).toEqual(["assessment-1"]);
    expect(scoped.approvalRequests.map((item) => item.id)).toEqual(["approval-1"]);
    expect(scoped.mergeExecutions).toEqual([]);
    expect(scoped.releasePlans).toEqual([]);
    expect(scoped.deploymentPlans.map((item) => item.id)).toEqual(["deployment-1"]);
    expect(scoped.rollbackPlans).toEqual([]);
    expect(scoped.auditEntries.map((item) => item.id)).toEqual(["audit-1"]);
  });

  it("drops project-level records that belong to no mission", () => {
    const scoped = scopeDeliverySnapshotToMission(
      snapshot({
        mergeReadinessAssessments: [
          { id: "assessment-1", missionId: MISSION },
          { id: "assessment-unassigned", missionId: null },
        ],
      }),
      MISSION,
    );

    expect(scoped.mergeReadinessAssessments.map((item) => item.id)).toEqual(["assessment-1"]);
  });

  it("keeps dependent records only where their parent survived", () => {
    const scoped = scopeDeliverySnapshotToMission(
      snapshot({
        approvalRequests: [
          { id: "approval-1", missionId: MISSION },
          { id: "approval-2", missionId: OTHER_MISSION },
        ],
        approvalDecisions: [
          { id: "decision-1", approvalRequestId: "approval-1" },
          { id: "decision-2", approvalRequestId: "approval-2" },
        ],
        releasePlans: [
          { id: "release-1", missionId: MISSION },
          { id: "release-2", missionId: OTHER_MISSION },
        ],
        releaseArtifacts: [
          { id: "artifact-1", releasePlanId: "release-1" },
          { id: "artifact-2", releasePlanId: "release-2" },
        ],
        rollbackPlans: [{ id: "rollback-1", missionId: OTHER_MISSION }],
        rollbackExecutions: [{ id: "rollback-execution-1", rollbackPlanId: "rollback-1" }],
      }),
      MISSION,
    );

    expect(scoped.approvalDecisions.map((item) => item.id)).toEqual(["decision-1"]);
    expect(scoped.releaseArtifacts.map((item) => item.id)).toEqual(["artifact-1"]);
    expect(scoped.rollbackExecutions).toEqual([]);
  });

  it("cascades through deployment plan, execution, and validation run", () => {
    const scoped = scopeDeliverySnapshotToMission(
      snapshot({
        deploymentPlans: [
          { id: "deployment-1", missionId: MISSION },
          { id: "deployment-2", missionId: OTHER_MISSION },
        ],
        deploymentExecutions: [
          { id: "execution-1", deploymentPlanId: "deployment-1" },
          { id: "execution-2", deploymentPlanId: "deployment-2" },
        ],
        deploymentValidationRuns: [
          { id: "validation-1", deploymentExecutionId: "execution-1" },
          { id: "validation-2", deploymentExecutionId: "execution-2" },
        ],
      }),
      MISSION,
    );

    expect(scoped.deploymentExecutions.map((item) => item.id)).toEqual(["execution-1"]);
    expect(scoped.deploymentValidationRuns.map((item) => item.id)).toEqual(["validation-1"]);
  });

  it("preserves project-level configuration so proposal forms keep their options", () => {
    const scoped = scopeDeliverySnapshotToMission(
      snapshot({
        policies: [{ id: "policy-1" }],
        releaseConfigurations: [{ id: "release-configuration-1" }],
        deploymentEnvironments: [{ id: "environment-1" }],
      }),
      MISSION,
    );

    expect(scoped.policies.map((item) => item.id)).toEqual(["policy-1"]);
    expect(scoped.releaseConfigurations.map((item) => item.id)).toEqual([
      "release-configuration-1",
    ]);
    expect(scoped.deploymentEnvironments.map((item) => item.id)).toEqual(["environment-1"]);
  });

  it("returns a well-formed snapshot when the mission has no delivery records", () => {
    const scoped = scopeDeliverySnapshotToMission(
      snapshot({ mergeReadinessAssessments: [{ id: "assessment-1", missionId: OTHER_MISSION }] }),
      MISSION,
    );

    expect(scoped.projectId).toBe("project-1");
    expect(scoped.capturedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(scoped.mergeReadinessAssessments).toEqual([]);
  });
});

describe("missionDeliveryIsEmpty", () => {
  it("treats project configuration alone as no mission activity", () => {
    expect(
      missionDeliveryIsEmpty(
        snapshot({
          policies: [{ id: "policy-1" }],
          releaseConfigurations: [{ id: "release-configuration-1" }],
          deploymentEnvironments: [{ id: "environment-1" }],
        }),
      ),
    ).toBe(true);
  });

  it("reports activity when the mission holds any delivery record", () => {
    expect(missionDeliveryIsEmpty(snapshot({ approvalRequests: [{ id: "approval-1" }] }))).toBe(
      false,
    );
  });
});
