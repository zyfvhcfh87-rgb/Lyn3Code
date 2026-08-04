import {
  type ModelCapabilitySnapshot,
  type ModelProfileId,
  type ProviderHealthRecord,
  type ProviderProfileId,
  type RoutingRegistrySnapshot,
  WS_METHODS,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export interface RoutingRegistryIndex {
  readonly capabilityByModelId: ReadonlyMap<ModelProfileId, ModelCapabilitySnapshot>;
  readonly healthByProviderId: ReadonlyMap<ProviderProfileId, ProviderHealthRecord>;
}

function isNewerCapabilitySnapshot(
  candidate: ModelCapabilitySnapshot,
  current: ModelCapabilitySnapshot,
): boolean {
  return (
    candidate.snapshotVersion > current.snapshotVersion ||
    (candidate.snapshotVersion === current.snapshotVersion &&
      candidate.capturedAt.localeCompare(current.capturedAt) > 0)
  );
}

/** Selects the immutable snapshot currently advertised for each model/provider. */
export function indexRoutingRegistry(snapshot: RoutingRegistrySnapshot): RoutingRegistryIndex {
  const capabilityByModelId = new Map<ModelProfileId, ModelCapabilitySnapshot>();
  for (const capability of snapshot.capabilitySnapshots) {
    const current = capabilityByModelId.get(capability.modelProfileId);
    if (current === undefined || isNewerCapabilitySnapshot(capability, current)) {
      capabilityByModelId.set(capability.modelProfileId, capability);
    }
  }

  const healthByProviderId = new Map<ProviderProfileId, ProviderHealthRecord>();
  for (const health of snapshot.health) {
    const current = healthByProviderId.get(health.providerProfileId);
    if (current === undefined || health.observedAt.localeCompare(current.observedAt) > 0) {
      healthByProviderId.set(health.providerProfileId, health);
    }
  }

  return { capabilityByModelId, healthByProviderId };
}

/** Keeps a saved pin visible even when registry discovery no longer returns it. */
export function includeUnavailableRoutingPin<Option extends { readonly value: string }>(
  options: ReadonlyArray<Option>,
  pinnedValue: string | null,
  makeUnavailable: (value: string) => Option,
): ReadonlyArray<Option> {
  if (pinnedValue === null || options.some((option) => option.value === pinnedValue)) {
    return options;
  }
  return [...options, makeUnavailable(pinnedValue)];
}

/** Routing reads are cached briefly; the workspace subscription carries live changes. */
export function createRoutingStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    registryAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "routing:registry",
      tag: WS_METHODS.routingGetRegistry,
      staleTimeMs: 10_000,
      refreshIntervalMs: 30_000,
    }),
    workspaceAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "routing:workspace",
      tag: WS_METHODS.routingGetWorkspace,
      staleTimeMs: 5_000,
    }),
    workspaceSubscriptionAtom: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "routing:workspace-subscription",
      tag: WS_METHODS.routingSubscribeWorkspace,
    }),
    decisionAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "routing:decision",
      tag: WS_METHODS.routingGetDecision,
      staleTimeMs: 60_000,
      idleTtlMs: 10 * 60_000,
    }),
    historyAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "routing:history",
      tag: WS_METHODS.routingListHistory,
      staleTimeMs: 10_000,
      idleTtlMs: 10 * 60_000,
    }),
  };
}

/** Mutations serialize per environment; submit-only simulation coalesces to the latest request. */
export function createRoutingCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialByEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  const latestSimulationByEnvironment = {
    mode: "latest" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  const refreshSingleFlight = {
    mode: "singleFlight" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  return {
    simulate: createEnvironmentRpcCommand(runtime, {
      label: "routing:simulate",
      tag: WS_METHODS.routingSimulate,
      scheduler,
      concurrency: latestSimulationByEnvironment,
    }),
    startMission: createEnvironmentRpcCommand(runtime, {
      label: "routing:start-mission",
      tag: WS_METHODS.routingStartMission,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    savePolicy: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-policy",
      tag: WS_METHODS.routingSavePolicy,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveRule: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-rule",
      tag: WS_METHODS.routingSaveRule,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveOverride: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-override",
      tag: WS_METHODS.routingSaveOverride,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    revokeOverride: createEnvironmentRpcCommand(runtime, {
      label: "routing:revoke-override",
      tag: WS_METHODS.routingRevokeOverride,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveAssessment: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-assessment",
      tag: WS_METHODS.routingSaveAssessment,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveProviderProfile: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-provider-profile",
      tag: WS_METHODS.routingSaveProviderProfile,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveModelProfile: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-model-profile",
      tag: WS_METHODS.routingSaveModelProfile,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    saveCapabilitySnapshot: createEnvironmentRpcCommand(runtime, {
      label: "routing:save-capability-snapshot",
      tag: WS_METHODS.routingSaveCapabilitySnapshot,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    refreshRegistry: createEnvironmentRpcCommand(runtime, {
      label: "routing:refresh-registry",
      tag: WS_METHODS.routingRefreshRegistry,
      scheduler,
      concurrency: refreshSingleFlight,
    }),
  };
}
