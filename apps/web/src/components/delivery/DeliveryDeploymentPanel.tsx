import type {
  DeliveryPublicMetadata,
  DeliveryWorkspaceSnapshot,
  DeploymentPlan,
  RollbackPlan,
} from "@t3tools/contracts";

import { DeliveryActionForm } from "./DeliveryActionForm";
import { DeploymentPlanProposalForm } from "./DeliveryPlanProposalForms";
import type { DeliveryWorkspaceActions } from "./deliveryActions";
import {
  DeliveryCard,
  DeliveryEmpty,
  DeliveryFact,
  DeliveryNotice,
  DeliveryStatusBadge,
} from "./DeliveryPrimitives";
import { formatDeliveryTime, latestBy, metadataHas, shortIdentifier } from "./deliveryPresentation";

function metadataSignals(metadata: DeliveryPublicMetadata) {
  return {
    disconnected: metadataHas(
      metadata,
      /provider|connection|connected/i,
      /false|offline|disconnected|unavailable/i,
    ),
    frozen: metadataHas(metadata, /freeze/i, /true|active|frozen/i),
    partial: metadataHas(metadata, /revers|rollback/i, /partial|limited/i),
    rollbackUnavailable: metadataHas(
      metadata,
      /rollback.*available|revers/i,
      /false|none|unavailable/i,
    ),
  };
}

function DeploymentPlanRow({
  plan,
  snapshot,
  actions,
}: {
  plan: DeploymentPlan;
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const environment = snapshot.deploymentEnvironments.find(
    (item) => item.id === plan.deploymentEnvironmentId,
  );
  const executions = snapshot.deploymentExecutions.filter(
    (item) => item.deploymentPlanId === plan.id,
  );
  const execution = latestBy(executions, (item) => item.createdAt);
  const validation = execution
    ? latestBy(
        snapshot.deploymentValidationRuns.filter(
          (item) => item.deploymentExecutionId === execution.id,
        ),
        (item) => item.createdAt,
      )
    : undefined;
  const signals = metadataSignals(plan.configuration);
  const cancellable =
    execution !== undefined &&
    ["queued", "preparing", "running", "validating", "indeterminate"].includes(execution.status);

  return (
    <article className="rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">
            {environment?.name ?? "Unknown environment"} · {plan.strategy}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {shortIdentifier(plan.sourceCommit)} · plan {shortIdentifier(plan.id)}
          </p>
        </div>
        <DeliveryStatusBadge status={execution?.status ?? plan.status} />
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <DeliveryFact label="Tier" value={environment?.tier ?? "Unknown"} />
        <DeliveryFact label="Provider" value={environment?.provider ?? "Unknown"} />
        <DeliveryFact label="Updated" value={formatDeliveryTime(plan.updatedAt)} />
      </dl>
      <div className="mt-3 space-y-2">
        {signals.frozen ? (
          <DeliveryNotice title="Delivery freeze is active" tone="critical" role="alert">
            This plan must not execute while the recorded freeze remains active.
          </DeliveryNotice>
        ) : null}
        {signals.disconnected ? (
          <DeliveryNotice title="Provider disconnected" tone="critical" role="alert">
            Reconnect and reconcile provider state before execution.
          </DeliveryNotice>
        ) : null}
        {signals.partial ? (
          <DeliveryNotice title="Partial reversibility" tone="warning">
            Automatic rollback cannot restore every affected resource.
          </DeliveryNotice>
        ) : null}
        {signals.rollbackUnavailable ? (
          <DeliveryNotice title="Rollback unavailable" tone="critical" role="alert">
            No safe automatic rollback is recorded for this deployment plan.
          </DeliveryNotice>
        ) : null}
        {validation ? (
          <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Validation · {validation.kind}</span>
              <DeliveryStatusBadge status={validation.status} />
            </div>
            {validation.status === "failed" ? (
              <p className="mt-2 text-destructive-foreground" role="alert">
                Validation failed: {validation.errorMessage ?? "No error detail was recorded."}
              </p>
            ) : null}
          </div>
        ) : execution?.status === "succeeded" ? (
          <DeliveryNotice title="Validation required" tone="warning">
            Deployment completed, but no post-deployment validation is recorded.
          </DeliveryNotice>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {plan.status === "approved" && !execution && actions?.onExecuteDeployment ? (
          <DeliveryActionForm
            actionLabel="Execute deployment"
            confirmationLabel={`I confirm deployment to ${environment?.name ?? "this environment"} from source ${shortIdentifier(plan.sourceCommit)}.`}
            onConfirm={(reason) =>
              actions.onExecuteDeployment?.({ targetId: String(plan.id), reason })
            }
          />
        ) : null}
        {cancellable && execution && actions?.onCancelDeployment ? (
          <DeliveryActionForm
            actionLabel="Cancel deployment"
            confirmationLabel={`I confirm cancellation of execution ${shortIdentifier(execution.id)}. Partial logs and provider evidence will be preserved.`}
            destructive
            onConfirm={(reason) =>
              actions.onCancelDeployment?.({ targetId: String(execution.id), reason })
            }
          />
        ) : null}
        {execution?.status === "succeeded" && actions?.onRunValidation ? (
          <DeliveryActionForm
            actionLabel="Run validation"
            confirmationLabel="I confirm that post-deployment validation should run against this exact execution."
            onConfirm={(reason) =>
              actions.onRunValidation?.({ targetId: String(execution.id), reason })
            }
          />
        ) : null}
        {validation?.status === "failed" && actions?.onCreateRollbackPlan ? (
          <DeliveryActionForm
            actionLabel="Create rollback plan"
            confirmationLabel="I confirm that this failed validation should be evaluated for explicit rollback."
            destructive
            onConfirm={(reason) =>
              actions.onCreateRollbackPlan?.({ targetId: String(execution?.id ?? plan.id), reason })
            }
          />
        ) : null}
      </div>
    </article>
  );
}

function RollbackPlanRow({
  plan,
  snapshot,
  actions,
}: {
  plan: RollbackPlan;
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const environment = snapshot.deploymentEnvironments.find(
    (item) => item.id === plan.deploymentEnvironmentId,
  );
  const execution = latestBy(
    snapshot.rollbackExecutions.filter((item) => item.rollbackPlanId === plan.id),
    (item) => item.createdAt,
  );
  const running = execution && ["queued", "preparing", "running"].includes(execution.status);

  return (
    <article className="rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{environment?.name ?? "Unknown environment"}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Restore {shortIdentifier(plan.restoreSourceCommit)}
          </p>
        </div>
        <DeliveryStatusBadge status={execution?.status ?? plan.status} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Reason: {plan.reason}</p>
      {running ? (
        <div className="mt-3">
          <DeliveryNotice title="Rollback running" tone="warning" role="status">
            Reconcile this execution before starting any other recovery operation.
          </DeliveryNotice>
        </div>
      ) : null}
      {plan.status === "approved" && !execution && actions?.onExecuteRollback ? (
        <div className="mt-3">
          <DeliveryActionForm
            actionLabel="Execute rollback"
            confirmationLabel={`I confirm rollback of ${environment?.name ?? "this environment"} to source ${shortIdentifier(plan.restoreSourceCommit)}.`}
            destructive
            onConfirm={(reason) =>
              actions.onExecuteRollback?.({ targetId: String(plan.id), reason })
            }
          />
        </div>
      ) : null}
    </article>
  );
}

export function DeliveryDeploymentPanel({
  snapshot,
  actions,
}: {
  snapshot: DeliveryWorkspaceSnapshot;
  actions?: DeliveryWorkspaceActions | undefined;
}) {
  const deploymentPlans = [...snapshot.deploymentPlans].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  const rollbackPlans = [...snapshot.rollbackPlans].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  const failedValidation = snapshot.deploymentValidationRuns.some((run) => run.status === "failed");

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <DeliveryCard
        title="Deployment and validation"
        description="Execution and post-deployment health are separate evidence states."
      >
        <div className="space-y-3">
          {deploymentPlans.length === 0 ? (
            <DeliveryEmpty>No deployment plan exists for this project.</DeliveryEmpty>
          ) : (
            deploymentPlans
              .slice(0, 5)
              .map((plan) => (
                <DeploymentPlanRow
                  key={plan.id}
                  plan={plan}
                  snapshot={snapshot}
                  actions={actions}
                />
              ))
          )}
          {actions?.onCreateDeploymentPlan ? (
            <DeploymentPlanProposalForm
              snapshot={snapshot}
              onSubmit={actions.onCreateDeploymentPlan}
            />
          ) : null}
        </div>
      </DeliveryCard>
      <DeliveryCard
        title="Rollback"
        description="Rollback is a separately planned, approved, executed, and validated operation."
      >
        <div className="space-y-3">
          {rollbackPlans.length === 0 ? (
            failedValidation ? (
              <DeliveryNotice title="Rollback unavailable" tone="critical" role="alert">
                Validation failed, but no rollback plan or safe recovery target is recorded.
              </DeliveryNotice>
            ) : (
              <DeliveryEmpty>No rollback plan is recorded.</DeliveryEmpty>
            )
          ) : (
            rollbackPlans
              .slice(0, 5)
              .map((plan) => (
                <RollbackPlanRow key={plan.id} plan={plan} snapshot={snapshot} actions={actions} />
              ))
          )}
        </div>
      </DeliveryCard>
    </div>
  );
}
