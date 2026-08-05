import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createDeliveryStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    workspaceAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "delivery:workspace",
      tag: WS_METHODS.deliveryGetWorkspace,
      staleTimeMs: 5_000,
    }),
    workspaceSubscriptionAtom: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "delivery:workspace-subscription",
      tag: WS_METHODS.deliverySubscribeWorkspace,
    }),
  };
}

/** Serial execution prevents overlapping high-risk mutations in one environment. */
export function createDeliveryCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialByEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  const command = (label: string, tag: Parameters<typeof createEnvironmentRpcCommand>[1]["tag"]) =>
    createEnvironmentRpcCommand(runtime, {
      label,
      tag,
      scheduler,
      concurrency: serialByEnvironment,
    });

  return {
    savePolicy: command("delivery:save-policy", WS_METHODS.deliverySavePolicy),
    saveReleaseConfiguration: command(
      "delivery:save-release-configuration",
      WS_METHODS.deliverySaveReleaseConfiguration,
    ),
    saveDeploymentEnvironment: command(
      "delivery:save-deployment-environment",
      WS_METHODS.deliverySaveDeploymentEnvironment,
    ),
    assessMerge: command("delivery:assess-merge", WS_METHODS.deliveryAssessMerge),
    requestApproval: command("delivery:request-approval", WS_METHODS.deliveryRequestApproval),
    decideApproval: command("delivery:decide-approval", WS_METHODS.deliveryDecideApproval),
    executeMerge: command("delivery:execute-merge", WS_METHODS.deliveryExecuteMerge),
    proposeReleasePlan: command(
      "delivery:propose-release-plan",
      WS_METHODS.deliveryProposeReleasePlan,
    ),
    saveReleasePlan: command("delivery:save-release-plan", WS_METHODS.deliverySaveReleasePlan),
    publishRelease: command("delivery:publish-release", WS_METHODS.deliveryPublishRelease),
    proposeDeploymentPlan: command(
      "delivery:propose-deployment-plan",
      WS_METHODS.deliveryProposeDeploymentPlan,
    ),
    saveDeploymentPlan: command(
      "delivery:save-deployment-plan",
      WS_METHODS.deliverySaveDeploymentPlan,
    ),
    executeDeployment: command("delivery:execute-deployment", WS_METHODS.deliveryExecuteDeployment),
    cancelDeployment: command("delivery:cancel-deployment", WS_METHODS.deliveryCancelDeployment),
    saveRollbackPlan: command("delivery:save-rollback-plan", WS_METHODS.deliverySaveRollbackPlan),
    executeRollback: command("delivery:execute-rollback", WS_METHODS.deliveryExecuteRollback),
  };
}
