import type { DeliveryWorkspaceSnapshot, MissionId } from "@t3tools/contracts";

/**
 * Narrows a project-wide delivery snapshot to a single mission.
 *
 * Delivery records are persisted per project, so a mission workspace that renders the raw snapshot
 * presents sibling missions' readiness, approvals, releases, and deployments as its own. Records
 * carrying a `missionId` are filtered by it, dependent records follow their surviving parent, and
 * project-level configuration is preserved because the proposal forms read it as their option
 * lists.
 *
 * Every collection is listed explicitly rather than spread, so a new collection on
 * `DeliveryWorkspaceSnapshot` fails to compile here until its scoping is decided.
 */
export function scopeDeliverySnapshotToMission(
  snapshot: DeliveryWorkspaceSnapshot,
  missionId: MissionId,
): DeliveryWorkspaceSnapshot {
  const mergeReadinessAssessments = snapshot.mergeReadinessAssessments.filter(
    (assessment) => assessment.missionId === missionId,
  );
  const approvalRequests = snapshot.approvalRequests.filter(
    (request) => request.missionId === missionId,
  );
  const releasePlans = snapshot.releasePlans.filter((plan) => plan.missionId === missionId);
  const deploymentPlans = snapshot.deploymentPlans.filter((plan) => plan.missionId === missionId);
  const rollbackPlans = snapshot.rollbackPlans.filter((plan) => plan.missionId === missionId);

  const approvalRequestIds = new Set(approvalRequests.map((request) => request.id));
  const releasePlanIds = new Set(releasePlans.map((plan) => plan.id));
  const deploymentPlanIds = new Set(deploymentPlans.map((plan) => plan.id));
  const rollbackPlanIds = new Set(rollbackPlans.map((plan) => plan.id));

  const deploymentExecutions = snapshot.deploymentExecutions.filter((execution) =>
    deploymentPlanIds.has(execution.deploymentPlanId),
  );
  const deploymentExecutionIds = new Set(deploymentExecutions.map((execution) => execution.id));

  return {
    projectId: snapshot.projectId,
    capturedAt: snapshot.capturedAt,

    // Project-level configuration. Filtering these would empty the proposal forms' option lists.
    policies: snapshot.policies,
    releaseConfigurations: snapshot.releaseConfigurations,
    deploymentEnvironments: snapshot.deploymentEnvironments,

    // Mission-scoped roots.
    mergeReadinessAssessments,
    approvalRequests,
    releasePlans,
    deploymentPlans,
    rollbackPlans,
    mergeExecutions: snapshot.mergeExecutions.filter(
      (execution) => execution.missionId === missionId,
    ),
    auditEntries: snapshot.auditEntries.filter((entry) => entry.missionId === missionId),

    // Dependent records, kept only where their parent survived.
    approvalDecisions: snapshot.approvalDecisions.filter((decision) =>
      approvalRequestIds.has(decision.approvalRequestId),
    ),
    releaseArtifacts: snapshot.releaseArtifacts.filter((artifact) =>
      releasePlanIds.has(artifact.releasePlanId),
    ),
    deploymentExecutions,
    deploymentValidationRuns: snapshot.deploymentValidationRuns.filter((run) =>
      deploymentExecutionIds.has(run.deploymentExecutionId),
    ),
    rollbackExecutions: snapshot.rollbackExecutions.filter((execution) =>
      rollbackPlanIds.has(execution.rollbackPlanId),
    ),
  };
}

/**
 * Whether a mission-scoped snapshot holds any delivery activity for that mission.
 *
 * Distinct from `deliverySnapshotIsEmpty`, which also counts project-level configuration: a policy
 * configured for the project does not mean this mission has begun delivery.
 */
/**
 * Whether the project has anything a mission could act on.
 *
 * These collections survive mission scoping and drive the release and deployment proposal forms, so
 * a mission with no delivery records of its own can still start its first one when they are present.
 */
export function deliveryConfigurationIsEmpty(snapshot: DeliveryWorkspaceSnapshot): boolean {
  return (
    snapshot.policies.length === 0 &&
    snapshot.releaseConfigurations.length === 0 &&
    snapshot.deploymentEnvironments.length === 0
  );
}

export function missionDeliveryIsEmpty(snapshot: DeliveryWorkspaceSnapshot): boolean {
  return (
    snapshot.mergeReadinessAssessments.length === 0 &&
    snapshot.approvalRequests.length === 0 &&
    snapshot.mergeExecutions.length === 0 &&
    snapshot.releasePlans.length === 0 &&
    snapshot.deploymentPlans.length === 0 &&
    snapshot.rollbackPlans.length === 0 &&
    snapshot.auditEntries.length === 0
  );
}
