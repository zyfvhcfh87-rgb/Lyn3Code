import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Analytics reads are source-bound and refreshed by the workspace subscription. */
export function createAnalyticsStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    workspaceAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "analytics:workspace",
      tag: WS_METHODS.analyticsGetWorkspace,
      staleTimeMs: 5_000,
    }),
    runDetailAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "analytics:run-detail",
      tag: WS_METHODS.analyticsGetRunDetail,
      staleTimeMs: 10_000,
      idleTtlMs: 10 * 60_000,
    }),
    workspaceSubscriptionAtom: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "analytics:workspace-subscription",
      tag: WS_METHODS.analyticsSubscribeWorkspace,
    }),
  };
}

/** Analytics mutations serialize per environment so durable operations cannot race. */
export function createAnalyticsCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialByEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  return {
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "analytics:update-settings",
      tag: WS_METHODS.analyticsUpdateSettings,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveBudget: createEnvironmentRpcCommand(runtime, {
      label: "analytics:save-budget",
      tag: WS_METHODS.analyticsSaveBudget,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    savePricingSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "analytics:save-pricing-snapshot",
      tag: WS_METHODS.analyticsSavePricingSnapshot,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveSubscriptionAttributionRule: createEnvironmentRpcCommand(runtime, {
      label: "analytics:save-subscription-attribution-rule",
      tag: WS_METHODS.analyticsSaveSubscriptionAttributionRule,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveExchangeRateSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "analytics:save-exchange-rate-snapshot",
      tag: WS_METHODS.analyticsSaveExchangeRateSnapshot,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    acknowledgeBudgetEvent: createEnvironmentRpcCommand(runtime, {
      label: "analytics:acknowledge-budget-event",
      tag: WS_METHODS.analyticsAcknowledgeBudgetEvent,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createBudgetOverride: createEnvironmentRpcCommand(runtime, {
      label: "analytics:create-budget-override",
      tag: WS_METHODS.analyticsCreateBudgetOverride,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    acknowledgeAlert: createEnvironmentRpcCommand(runtime, {
      label: "analytics:acknowledge-alert",
      tag: WS_METHODS.analyticsAcknowledgeAlert,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveAnnotation: createEnvironmentRpcCommand(runtime, {
      label: "analytics:save-annotation",
      tag: WS_METHODS.analyticsSaveAnnotation,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    recordHumanDisposition: createEnvironmentRpcCommand(runtime, {
      label: "analytics:record-human-disposition",
      tag: WS_METHODS.analyticsRecordHumanDisposition,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createExport: createEnvironmentRpcCommand(runtime, {
      label: "analytics:create-export",
      tag: WS_METHODS.analyticsCreateExport,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    startRetention: createEnvironmentRpcCommand(runtime, {
      label: "analytics:start-retention",
      tag: WS_METHODS.analyticsStartRetention,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    rebuildAggregates: createEnvironmentRpcCommand(runtime, {
      label: "analytics:rebuild-aggregates",
      tag: WS_METHODS.analyticsRebuildAggregates,
      scheduler,
      concurrency: serialByEnvironment,
    }),
  };
}
