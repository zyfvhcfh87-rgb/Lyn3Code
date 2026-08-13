import type { DeliveryWorkspaceSnapshot } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { DeliveryApprovalsPanel } from "./DeliveryApprovalsPanel";
import type { DeliveryWorkspaceActions } from "./deliveryActions";
import { DeliveryDeploymentPanel } from "./DeliveryDeploymentPanel";
import { DeliveryHistoryPanel } from "./DeliveryHistoryPanel";
import { DeliveryNotice } from "./DeliveryPrimitives";
import { DeliveryReadinessPanel } from "./DeliveryReadinessPanel";
import { DeliveryReleasePlanPanel } from "./DeliveryReleasePlanPanel";
import { DeliveryStageOverview } from "./DeliveryStageOverview";

export type DeliveryWorkspaceProps =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly error: string }
  | { readonly state: "empty" }
  | {
      readonly state: "ready";
      readonly snapshot: DeliveryWorkspaceSnapshot;
      readonly actions?: DeliveryWorkspaceActions | undefined;
    };

/**
 * A delivery stage inside the mission workspace.
 *
 * Previously , which carries settings-page chrome - large headings, page gutters,
 * and the settings search registry - into a mission. This is the only place the delivery workspace
 * renders, so it matches the mission's own section rhythm instead.
 */
function DeliverySubsection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid gap-3">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function deliverySnapshotIsEmpty(snapshot: DeliveryWorkspaceSnapshot): boolean {
  return (
    snapshot.policies.length === 0 &&
    snapshot.mergeReadinessAssessments.length === 0 &&
    snapshot.approvalRequests.length === 0 &&
    snapshot.mergeExecutions.length === 0 &&
    snapshot.releaseConfigurations.length === 0 &&
    snapshot.releasePlans.length === 0 &&
    snapshot.releaseArtifacts.length === 0 &&
    snapshot.deploymentEnvironments.length === 0 &&
    snapshot.deploymentPlans.length === 0 &&
    snapshot.deploymentExecutions.length === 0 &&
    snapshot.deploymentValidationRuns.length === 0 &&
    snapshot.rollbackPlans.length === 0 &&
    snapshot.rollbackExecutions.length === 0 &&
    snapshot.auditEntries.length === 0
  );
}

export function DeliveryWorkspace(props: DeliveryWorkspaceProps) {
  if (props.state === "loading") {
    return (
      <DeliveryNotice title="Loading controlled delivery" tone="neutral" role="status">
        Waiting for a source-bound delivery snapshot. No placeholder approvals or evidence are
        shown.
      </DeliveryNotice>
    );
  }

  if (props.state === "error") {
    return (
      <DeliveryNotice title="Controlled delivery unavailable" tone="critical" role="alert">
        {props.error} No delivery state was inferred from missing data.
      </DeliveryNotice>
    );
  }

  if (props.state === "empty" || deliverySnapshotIsEmpty(props.snapshot)) {
    return (
      <DeliveryNotice title="No controlled delivery configured" tone="neutral" role="status">
        Configure a delivery policy and repository-backed release or deployment target before
        planning promotion.
      </DeliveryNotice>
    );
  }

  const { snapshot, actions } = props;

  return (
    <>
      <DeliverySubsection id="delivery-overview" title="Controlled delivery">
        <DeliveryStageOverview snapshot={snapshot} />
      </DeliverySubsection>

      <DeliverySubsection id="delivery-readiness" title="Readiness and evidence">
        <DeliveryReadinessPanel snapshot={snapshot} actions={actions} />
      </DeliverySubsection>

      <DeliverySubsection id="delivery-approvals" title="Approvals">
        <DeliveryApprovalsPanel snapshot={snapshot} actions={actions} />
      </DeliverySubsection>

      <DeliverySubsection id="delivery-release" title="Release planning">
        <DeliveryReleasePlanPanel snapshot={snapshot} actions={actions} />
      </DeliverySubsection>

      <DeliverySubsection id="delivery-deployment" title="Deployment, validation, and rollback">
        <DeliveryDeploymentPanel snapshot={snapshot} actions={actions} />
      </DeliverySubsection>

      <DeliverySubsection id="delivery-history" title="History">
        <DeliveryHistoryPanel snapshot={snapshot} />
      </DeliverySubsection>
    </>
  );
}
