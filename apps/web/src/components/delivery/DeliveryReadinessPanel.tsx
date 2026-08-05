import type { DeliveryPublicMetadata, DeliveryWorkspaceSnapshot } from "@t3tools/contracts";

import { DeliveryActionForm } from "./DeliveryActionForm";
import type { DeliveryWorkspaceActions } from "./deliveryActions";
import {
  DeliveryCard,
  DeliveryEmpty,
  DeliveryFact,
  DeliveryNotice,
  DeliveryStatusBadge,
} from "./DeliveryPrimitives";
import { formatDeliveryTime, latestBy, metadataHas, shortIdentifier } from "./deliveryPresentation";

function publicMetadata(snapshot: DeliveryWorkspaceSnapshot): readonly DeliveryPublicMetadata[] {
  return [
    ...snapshot.releaseConfigurations.map((item) => item.publicMetadata),
    ...snapshot.deploymentEnvironments.map((item) => item.publicMetadata),
    ...snapshot.deploymentPlans.map((item) => item.configuration),
    ...snapshot.deploymentValidationRuns.map((item) => item.evidence),
    ...snapshot.auditEntries.map((item) => item.publicMetadata),
  ];
}

export function DeliveryReadinessPanel({
  snapshot,
  actions,
}: {
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const assessment = latestBy(snapshot.mergeReadinessAssessments, (item) => item.observedAt);
  const metadata = publicMetadata(snapshot);
  const frozen = metadata.some((item) => metadataHas(item, /freeze/i, /true|active|frozen/i));
  const disconnected = metadata.some((item) =>
    metadataHas(item, /provider|connection|connected/i, /false|offline|disconnected|unavailable/i),
  );
  const partial = metadata.some((item) =>
    metadataHas(item, /revers|rollback/i, /partial|limited/i),
  );

  if (!assessment) {
    return (
      <DeliveryCard title="Readiness, blockers, and evidence">
        <div className="space-y-3">
          <DeliveryEmpty>No merge-readiness assessment has been recorded.</DeliveryEmpty>
          {actions?.onAssessReadiness ? (
            <DeliveryActionForm
              actionLabel="Assess readiness"
              confirmationLabel="I confirm that the current project source should be assessed."
              onConfirm={(reason) =>
                actions.onAssessReadiness?.({ targetId: String(snapshot.projectId), reason })
              }
            />
          ) : null}
        </div>
      </DeliveryCard>
    );
  }

  const isExpired = assessment.expiresAt ? Date.parse(assessment.expiresAt) <= Date.now() : false;
  const headChanged =
    assessment.evidenceSnapshot.headSha !== assessment.headSha ||
    assessment.headSha !== assessment.sourceCommit ||
    assessment.invalidatedAt !== null;
  const blockedLanes = Object.entries(assessment.states).filter(([, state]) => state === "blocked");
  const pendingChecks = assessment.evidenceSnapshot.pendingChecks;
  const failedChecks = assessment.evidenceSnapshot.failedChecks;
  const mergeApproval = latestBy(
    snapshot.approvalRequests.filter(
      (request) =>
        request.approvalType === "merge" && request.sourceCommit === assessment.sourceCommit,
    ),
    (request) => request.requestedAt,
  );

  return (
    <DeliveryCard
      title="Readiness, blockers, and evidence"
      description="Assessment conclusions apply only to the recorded source fingerprint."
      action={<DeliveryStatusBadge status={assessment.result} />}
    >
      <div className="space-y-3">
        {assessment.result === "stale" || isExpired || assessment.invalidatedAt ? (
          <DeliveryNotice title="Assessment is stale" tone="warning" role="alert">
            Reassess the current source before approving or executing delivery.
          </DeliveryNotice>
        ) : null}
        {headChanged ? (
          <DeliveryNotice title="Source head changed" tone="critical" role="alert">
            Assessed head {shortIdentifier(assessment.headSha)} does not match source commit{" "}
            {shortIdentifier(assessment.sourceCommit)}.
          </DeliveryNotice>
        ) : null}
        {pendingChecks.length > 0 ? (
          <DeliveryNotice title="Required checks pending" tone="warning" role="alert">
            {pendingChecks.join(", ")}
          </DeliveryNotice>
        ) : null}
        {failedChecks.length > 0 ? (
          <DeliveryNotice title="Required checks failed" tone="critical" role="alert">
            {failedChecks.join(", ")}
          </DeliveryNotice>
        ) : null}
        {frozen ? (
          <DeliveryNotice title="Delivery freeze is active" tone="critical" role="alert">
            Recorded delivery metadata blocks promotion until the freeze is lifted.
          </DeliveryNotice>
        ) : null}
        {disconnected ? (
          <DeliveryNotice title="Provider disconnected" tone="critical" role="alert">
            Reconnect and reassess provider state before execution.
          </DeliveryNotice>
        ) : null}
        {partial ? (
          <DeliveryNotice title="Only partially reversible" tone="warning">
            The recorded plan cannot automatically restore every affected resource.
          </DeliveryNotice>
        ) : null}

        <div>
          <h3 className="text-xs font-semibold">Exact blockers</h3>
          {assessment.blockingReasons.length === 0 ? (
            <DeliveryEmpty>No blockers were recorded by this assessment.</DeliveryEmpty>
          ) : (
            <ul className="mt-2 space-y-2">
              {assessment.blockingReasons.map((reason, index) => (
                <li
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
                  key={reason}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <DeliveryStatusBadge status="blocker" tone="critical" />
                    {blockedLanes[index] ? (
                      <span className="text-[11px] text-muted-foreground">
                        Lane: {blockedLanes[index]?.[0]}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed">{reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold">Warnings</h3>
          {assessment.warningReasons.length === 0 &&
          assessment.result !== "stale" &&
          !isExpired &&
          !partial ? (
            <DeliveryEmpty>No warnings are recorded for the current assessment.</DeliveryEmpty>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {assessment.warningReasons.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {assessment.result === "stale" || isExpired ? (
                <li>The assessment is no longer current.</li>
              ) : null}
              {partial ? <li>Deployment metadata reports partial reversibility.</li> : null}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold">Evidence</h3>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <DeliveryFact label="Source" value={shortIdentifier(assessment.sourceCommit)} mono />
            <DeliveryFact label="Head" value={shortIdentifier(assessment.headSha)} mono />
            <DeliveryFact label="Base" value={shortIdentifier(assessment.baseSha)} mono />
            <DeliveryFact
              label="Fingerprint"
              value={shortIdentifier(assessment.sourceFingerprint)}
              mono
            />
            <DeliveryFact
              label="Verification run"
              value={shortIdentifier(assessment.verificationRunId)}
              mono
            />
            <DeliveryFact label="Observed" value={formatDeliveryTime(assessment.observedAt)} />
          </dl>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 p-3 text-xs">
              <p className="font-semibold">Required checks</p>
              <p className="mt-1 text-muted-foreground">
                Passed: {assessment.evidenceSnapshot.passedChecks.join(", ") || "None"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Pending: {pendingChecks.join(", ") || "None"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Failed: {failedChecks.join(", ") || "None"}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-xs">
              <p className="font-semibold">Review evidence</p>
              <p className="mt-1 text-muted-foreground">
                Approvals: {assessment.evidenceSnapshot.approvals}/
                {assessment.evidenceSnapshot.requiredApprovals}
              </p>
              <p className="mt-1 text-muted-foreground">
                Blocking threads: {assessment.evidenceSnapshot.unresolvedBlockingThreads}
              </p>
            </div>
          </div>
        </div>

        {actions?.onAssessReadiness ? (
          <DeliveryActionForm
            actionLabel="Reassess readiness"
            confirmationLabel={`I confirm that source ${shortIdentifier(assessment.sourceCommit)} should be reassessed.`}
            onConfirm={(reason) =>
              actions.onAssessReadiness?.({ targetId: String(assessment.id), reason })
            }
          />
        ) : null}
        {(assessment.result === "ready" || assessment.result === "ready_with_warnings") &&
        mergeApproval?.status === "approved" &&
        actions?.onExecuteMerge ? (
          <DeliveryActionForm
            actionLabel="Execute merge"
            confirmationLabel={`I confirm merge of the approved source ${shortIdentifier(assessment.sourceCommit)}.`}
            onConfirm={(reason) =>
              actions.onExecuteMerge?.({ targetId: String(assessment.id), reason })
            }
          />
        ) : null}
      </div>
    </DeliveryCard>
  );
}
