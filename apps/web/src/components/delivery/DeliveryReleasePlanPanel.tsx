import type { DeliveryWorkspaceSnapshot, ReleasePlan } from "@t3tools/contracts";

import { DeliveryActionForm } from "./DeliveryActionForm";
import { ReleasePlanProposalForm } from "./DeliveryPlanProposalForms";
import type { DeliveryWorkspaceActions } from "./deliveryActions";
import {
  DeliveryCard,
  DeliveryEmpty,
  DeliveryFact,
  DeliveryStatusBadge,
} from "./DeliveryPrimitives";
import { formatDeliveryTime, shortIdentifier } from "./deliveryPresentation";

function ReleasePlanRow({
  plan,
  snapshot,
  actions,
}: {
  plan: ReleasePlan;
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const configuration = snapshot.releaseConfigurations.find(
    (item) => item.id === plan.releaseConfigurationId,
  );
  const artifacts = snapshot.releaseArtifacts.filter((item) => item.releasePlanId === plan.id);

  return (
    <article className="rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{plan.releaseName}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {plan.version} · {plan.tagName} · {shortIdentifier(plan.sourceCommit)}
          </p>
        </div>
        <DeliveryStatusBadge status={plan.status} />
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <DeliveryFact label="Provider" value={configuration?.provider ?? "Not configured"} />
        <DeliveryFact label="Channel" value={configuration?.releaseChannel ?? "Not configured"} />
        <DeliveryFact label="Updated" value={formatDeliveryTime(plan.updatedAt)} />
      </dl>
      <div className="mt-3">
        <p className="text-xs font-semibold">Artifacts</p>
        {artifacts.length === 0 ? (
          <DeliveryEmpty>No artifacts are recorded for this release plan.</DeliveryEmpty>
        ) : (
          <ul className="mt-2 space-y-1.5 text-xs">
            {artifacts.map((artifact) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2"
                key={artifact.id}
              >
                <span className="min-w-0 truncate font-mono">{artifact.relativePath}</span>
                <span className="flex items-center gap-2">
                  {artifact.checksum ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {shortIdentifier(artifact.checksum)}
                    </span>
                  ) : null}
                  <DeliveryStatusBadge status={artifact.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {plan.status === "approved" && actions?.onExecuteRelease ? (
        <div className="mt-3">
          <DeliveryActionForm
            actionLabel="Execute release"
            confirmationLabel={`I confirm release ${plan.version} from source ${shortIdentifier(plan.sourceCommit)}.`}
            onConfirm={(reason) =>
              actions.onExecuteRelease?.({ targetId: String(plan.id), reason })
            }
          />
        </div>
      ) : null}
    </article>
  );
}

export function DeliveryReleasePlanPanel({
  snapshot,
  actions,
}: {
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const plans = [...snapshot.releasePlans].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  return (
    <DeliveryCard
      title="Release plans"
      description="A release records immutable source and artifacts; it does not deploy them."
    >
      <div className="space-y-3">
        {plans.length === 0 ? (
          <DeliveryEmpty>No release plan exists for this project.</DeliveryEmpty>
        ) : (
          plans
            .slice(0, 5)
            .map((plan) => (
              <ReleasePlanRow key={plan.id} plan={plan} snapshot={snapshot} actions={actions} />
            ))
        )}
        {actions?.onCreateReleasePlan ? (
          <ReleasePlanProposalForm snapshot={snapshot} onSubmit={actions.onCreateReleasePlan} />
        ) : null}
      </div>
    </DeliveryCard>
  );
}
