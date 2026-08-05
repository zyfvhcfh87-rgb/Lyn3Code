import type { ApprovalRequest, DeliveryWorkspaceSnapshot } from "@t3tools/contracts";

import { DeliveryActionForm } from "./DeliveryActionForm";
import type { DeliveryWorkspaceActions } from "./deliveryActions";
import {
  DeliveryCard,
  DeliveryEmpty,
  DeliveryNotice,
  DeliveryStatusBadge,
} from "./DeliveryPrimitives";
import { formatDeliveryTime, latestBy, shortIdentifier } from "./deliveryPresentation";

function ApprovalActions({
  request,
  actions,
}: {
  request: ApprovalRequest;
  actions: DeliveryWorkspaceActions;
}) {
  if (request.status !== "pending" || !actions.onDecideApproval) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      <DeliveryActionForm
        actionLabel="Approve request"
        confirmationLabel={`I approve the exact ${request.approvalType} target and source shown above.`}
        onConfirm={(reason) =>
          actions.onDecideApproval?.({
            targetId: String(request.id),
            decision: "approve",
            reason,
          })
        }
      />
      <DeliveryActionForm
        actionLabel="Reject request"
        confirmationLabel={`I confirm that this ${request.approvalType} request should be rejected.`}
        destructive
        onConfirm={(reason) =>
          actions.onDecideApproval?.({
            targetId: String(request.id),
            decision: "reject",
            reason,
          })
        }
      />
    </div>
  );
}

export function DeliveryApprovalsPanel({
  snapshot,
  actions,
}: {
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const requests = [...snapshot.approvalRequests].sort(
    (left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt),
  );
  const latestAssessment = latestBy(snapshot.mergeReadinessAssessments, (item) => item.observedAt);

  return (
    <DeliveryCard
      title="Human approvals"
      description="Decisions are bound to the exact plan digest and source commit."
    >
      <div className="space-y-3">
        {requests.length === 0 ? (
          <>
            <DeliveryNotice title="Approval required" tone="warning">
              Human approval is the default before merge, release, deployment, or rollback.
            </DeliveryNotice>
            {actions?.onRequestApproval && latestAssessment ? (
              <DeliveryActionForm
                actionLabel="Request approval"
                confirmationLabel="I confirm that the assessed source and evidence are ready for human review."
                onConfirm={(reason) =>
                  actions.onRequestApproval?.({ targetId: String(latestAssessment.id), reason })
                }
              />
            ) : null}
          </>
        ) : (
          requests.slice(0, 8).map((request) => {
            const decisions = snapshot.approvalDecisions.filter(
              (decision) => decision.approvalRequestId === request.id,
            );
            const latestDecision = latestBy(decisions, (decision) => decision.decidedAt);
            const expired =
              request.status === "expired" ||
              (request.expiresAt ? Date.parse(request.expiresAt) <= Date.now() : false);
            const rejected = request.status === "rejected" || latestDecision?.decision === "reject";

            return (
              <article className="rounded-xl border p-3" key={request.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold capitalize">
                      {request.approvalType} approval
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {shortIdentifier(request.targetId)} · {shortIdentifier(request.sourceCommit)}
                    </p>
                  </div>
                  <DeliveryStatusBadge
                    status={expired ? "expired" : rejected ? "rejected" : request.status}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {decisions.length}/{request.requiredDecisionCount} decisions · requested{" "}
                  {formatDeliveryTime(request.requestedAt)}
                </p>
                {rejected ? (
                  <DeliveryNotice title="Approval rejected" tone="critical" role="alert">
                    {latestDecision?.reason ?? "No rejection reason was recorded."}
                  </DeliveryNotice>
                ) : null}
                {expired ? (
                  <DeliveryNotice title="Approval expired" tone="warning" role="alert">
                    Request a new source-bound approval before execution.
                  </DeliveryNotice>
                ) : null}
                {actions ? <ApprovalActions request={request} actions={actions} /> : null}
              </article>
            );
          })
        )}
        {requests.length > 8 ? (
          <DeliveryEmpty>
            {requests.length - 8} older requests remain in delivery history.
          </DeliveryEmpty>
        ) : null}
      </div>
    </DeliveryCard>
  );
}
