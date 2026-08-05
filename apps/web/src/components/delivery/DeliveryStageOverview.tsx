import type { DeliveryWorkspaceSnapshot } from "@t3tools/contracts";

import { DeliveryCard, DeliveryFact, DeliveryStatusBadge } from "./DeliveryPrimitives";
import { formatDeliveryTime, latestBy, shortIdentifier } from "./deliveryPresentation";

export function DeliveryStageOverview({ snapshot }: { snapshot: DeliveryWorkspaceSnapshot }) {
  const readiness = latestBy(snapshot.mergeReadinessAssessments, (item) => item.observedAt);
  const merge = latestBy(snapshot.mergeExecutions, (item) => item.createdAt);
  const release = latestBy(snapshot.releasePlans, (item) => item.updatedAt);
  const deploymentPlan = latestBy(snapshot.deploymentPlans, (item) => item.updatedAt);
  const deployment = latestBy(snapshot.deploymentExecutions, (item) => item.createdAt);
  const rollbackPlan = latestBy(snapshot.rollbackPlans, (item) => item.updatedAt);
  const rollback = latestBy(snapshot.rollbackExecutions, (item) => item.createdAt);

  const stages = [
    {
      name: "Merge",
      status: merge?.status ?? readiness?.result ?? "not_assessed",
      detail: readiness ? `Source ${shortIdentifier(readiness.sourceCommit)}` : "No assessment",
    },
    {
      name: "Release",
      status: release?.status ?? "not_planned",
      detail: release ? `${release.version} · ${release.tagName}` : "No release plan",
    },
    {
      name: "Deploy",
      status: deployment?.status ?? deploymentPlan?.status ?? "not_planned",
      detail: deploymentPlan ? `Strategy: ${deploymentPlan.strategy}` : "No deployment plan",
    },
    {
      name: "Rollback",
      status: rollback?.status ?? rollbackPlan?.status ?? "unavailable",
      detail: rollbackPlan
        ? `Restore ${shortIdentifier(rollbackPlan.restoreSourceCommit)}`
        : "No rollback plan",
    },
  ];

  return (
    <DeliveryCard
      title="Delivery stages"
      description={`Snapshot captured ${formatDeliveryTime(snapshot.capturedAt)}`}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage) => (
          <div className="rounded-xl border bg-muted/20 px-3 py-3" key={stage.name}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{stage.name}</p>
              <DeliveryStatusBadge status={stage.status} />
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground">{stage.detail}</p>
          </div>
        ))}
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <DeliveryFact label="Policies" value={snapshot.policies.length.toLocaleString()} />
        <DeliveryFact label="Approvals" value={snapshot.approvalRequests.length.toLocaleString()} />
        <DeliveryFact label="Audit entries" value={snapshot.auditEntries.length.toLocaleString()} />
      </dl>
    </DeliveryCard>
  );
}
