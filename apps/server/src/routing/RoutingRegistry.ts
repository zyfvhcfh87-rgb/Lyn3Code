import {
  ModelCapabilitySnapshotId,
  ModelProfileId,
  type CapabilitySnapshotSource,
  type ModelCapabilitySnapshot,
  type ModelProfile,
  type ModelProfileStatus,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderProfile,
  type ProviderProfileStatus,
  type RoutingCapabilities,
  type RoutingCapabilityState,
  type RoutingContextLimits,
  type RoutingReasoningOptions,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectionRoutingRepository } from "../persistence/Services/ProjectionRouting.ts";
import type {
  ProviderDriverMetadata,
  ProviderHarnessCapabilities,
} from "../provider/ProviderDriver.ts";
import { listSupportedReasoningLevels } from "./ReasoningMapping.ts";

export interface NormalizedRoutingModel {
  readonly profile: ModelProfile;
  readonly capabilitySnapshot: ModelCapabilitySnapshot;
  readonly harnessCapabilities: ProviderHarnessCapabilities;
}

export interface NormalizedRoutingProvider {
  readonly profile: ProviderProfile;
  readonly harnessCapabilities: ProviderHarnessCapabilities;
  readonly maximumConcurrentSessions: number | null;
  readonly models: ReadonlyArray<NormalizedRoutingModel>;
}

export interface PreviousRoutingModel {
  readonly profile: ModelProfile;
  readonly capabilitySnapshot: ModelCapabilitySnapshot;
}

const unknownCapabilities = (): RoutingCapabilities => ({
  toolCalling: "unknown",
  structuredOutput: "unknown",
  visionInput: "unknown",
  audioInput: "unknown",
  fileInput: "unknown",
  streaming: "unknown",
  reasoningControl: "unknown",
  parallelToolCalls: "unknown",
  codeEditing: "unknown",
  longContext: "unknown",
  systemInstructions: "unknown",
  promptCaching: "unknown",
});

const parseContextTokens = (value: string): number | null => {
  const normalized = value.trim().toLowerCase().replaceAll(",", "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.floor(amount * multiplier);
};

const providerStatus = (snapshot: ServerProvider): ProviderProfileStatus => {
  if (snapshot.availability === "unavailable") return "unsupported";
  if (!snapshot.enabled) return "disabled";
  if (snapshot.auth.status === "unauthenticated") return "authentication_required";
  if (!snapshot.installed) return "offline";
  switch (snapshot.status) {
    case "ready":
      return "available";
    case "warning":
      return "degraded";
    case "disabled":
      return "disabled";
    case "error":
      return "error";
  }
};

const modelStatus = (snapshot: ServerProvider, model: ServerProviderModel): ModelProfileStatus => {
  if (!snapshot.enabled) return "disabled";
  if (model.isLegacy === true) return "deprecated";
  if (snapshot.availability === "unavailable" || !snapshot.installed) return "unavailable";
  return snapshot.status === "ready" || snapshot.status === "warning" ? "available" : "unknown";
};

const modelId = (instanceId: ProviderInstanceId, providerModelId: string) =>
  ModelProfileId.make(`${instanceId}:${providerModelId}`);

const capabilitySnapshotId = (id: ModelProfile["id"], version: number) =>
  ModelCapabilitySnapshotId.make(`${id}:capabilities:${version}`);

const sourceFor = (
  model: ServerProviderModel,
  metadata: ProviderDriverMetadata,
): CapabilitySnapshotSource => (model.isCustom ? "unknown" : metadata.modelMetadataSource);

const contextLimitsFor = (model: ServerProviderModel): RoutingContextLimits => {
  const descriptor = model.capabilities?.optionDescriptors?.find(
    (candidate) => candidate.type === "select" && candidate.id === "contextWindow",
  );
  const values =
    descriptor?.type === "select"
      ? descriptor.options
          .map((option) => ({ option, tokens: parseContextTokens(option.id) }))
          .filter(
            (entry): entry is { readonly option: typeof entry.option; readonly tokens: number } =>
              entry.tokens !== null,
          )
      : [];
  const maximumInputTokens = values.reduce<number | null>(
    (maximum, entry) => (maximum === null ? entry.tokens : Math.max(maximum, entry.tokens)),
    null,
  );

  return {
    maximumInputTokens,
    maximumOutputTokens: null,
    recommendedWorkingContext:
      values.find((entry) => entry.option.isDefault === true)?.tokens ?? null,
    supportsAutomaticCompaction: "unknown",
  };
};

const reasoningOptionsFor = (model: ServerProviderModel): RoutingReasoningOptions => {
  const supportedLevels = listSupportedReasoningLevels(model.capabilities);
  return {
    supportedLevels: [...supportedLevels],
    defaultLevel: null,
    supportsDynamicReasoning: supportedLevels.length === 0 ? "unknown" : "supported",
  };
};

const capabilitySnapshotFor = (input: {
  readonly model: ServerProviderModel;
  readonly profile: ModelProfile;
  readonly metadata: ProviderDriverMetadata;
  readonly capturedAt: string;
  readonly previous?: ModelCapabilitySnapshot;
}): ModelCapabilitySnapshot => {
  // Discovery must not silently supersede capability facts the user corrected explicitly.
  if (input.previous?.source === "manual_override") return input.previous;

  const reasoningOptions = reasoningOptionsFor(input.model);
  const capabilities: RoutingCapabilities = {
    ...unknownCapabilities(),
    reasoningControl: reasoningOptions.supportedLevels.length === 0 ? "unknown" : "supported",
  };
  const source = sourceFor(input.model, input.metadata);
  const contextLimits = contextLimitsFor(input.model);
  const privacyMetadata = { executionLocality: input.metadata.executionLocality };
  if (
    input.previous !== undefined &&
    input.previous.source === source &&
    JSON.stringify(input.previous.capabilities) === JSON.stringify(capabilities) &&
    JSON.stringify(input.previous.contextLimits) === JSON.stringify(contextLimits) &&
    JSON.stringify(input.previous.reasoningOptions) === JSON.stringify(reasoningOptions) &&
    JSON.stringify(input.previous.privacyMetadata) === JSON.stringify(privacyMetadata)
  ) {
    return input.previous;
  }
  const snapshotVersion = (input.previous?.snapshotVersion ?? 0) + 1;

  return {
    id: capabilitySnapshotId(input.profile.id, snapshotVersion),
    modelProfileId: input.profile.id,
    snapshotVersion,
    source,
    capabilities,
    contextLimits,
    reasoningOptions,
    toolSupport: {},
    modalitySupport: {},
    outputSupport: {},
    privacyMetadata,
    capturedAt: input.capturedAt,
    expiresAt: null,
  };
};

const safeConfigurationMetadata = (metadata: ProviderDriverMetadata) => ({
  executionLocality: metadata.executionLocality,
  modelMetadataSource: metadata.modelMetadataSource,
  harnessCapabilities: {
    toolExecution: metadata.harnessCapabilities.toolExecution,
    codeEditing: metadata.harnessCapabilities.codeEditing,
    streaming: metadata.harnessCapabilities.streaming,
    structuredOutput: metadata.harnessCapabilities.structuredOutput,
    attachmentInput: metadata.harnessCapabilities.attachmentInput,
  },
  maximumConcurrentSessions: metadata.concurrency.maximumConcurrentSessions,
  concurrencySource: metadata.concurrency.source,
});

/**
 * Convert a live provider snapshot into routing-owned profiles.
 *
 * Only an explicit `local` driver declaration becomes `isLocal`; a
 * configurable endpoint stays remote/unapproved until configuration-aware
 * normalization can prove otherwise. No auth labels, email addresses, paths,
 * environment values, or opaque provider config cross this boundary.
 */
export const normalizeProviderSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly metadata: ProviderDriverMetadata;
  readonly previousProvider?: ProviderProfile;
  readonly previousModels?: ReadonlyArray<PreviousRoutingModel>;
}): NormalizedRoutingProvider => {
  const previousByProviderModelId = new Map(
    (input.previousModels ?? []).map((previous) => [previous.profile.providerModelId, previous]),
  );
  const profile: ProviderProfile = {
    id: input.snapshot.instanceId,
    providerType: input.snapshot.driver,
    displayName: input.snapshot.displayName ?? input.metadata.displayName,
    accountReference: null,
    endpointClass: input.metadata.endpointClass,
    status: providerStatus(input.snapshot),
    isEnabled: input.snapshot.enabled,
    isLocal: input.metadata.executionLocality === "local",
    supportsModelDiscovery: input.metadata.supportsModelDiscovery,
    configurationMetadata: safeConfigurationMetadata(input.metadata),
    createdAt: input.previousProvider?.createdAt ?? input.snapshot.checkedAt,
    updatedAt: input.snapshot.checkedAt,
    lastValidatedAt: input.snapshot.checkedAt,
  };

  const currentModels = input.snapshot.models.map((model): NormalizedRoutingModel => {
    const previous = previousByProviderModelId.get(model.slug);
    const modelProfile: ModelProfile = {
      id: previous?.profile.id ?? modelId(input.snapshot.instanceId, model.slug),
      providerProfileId: input.snapshot.instanceId,
      providerModelId: model.slug,
      displayName: model.name,
      family: null,
      version: null,
      releaseChannel: null,
      status: modelStatus(input.snapshot, model),
      isEnabled: previous?.profile.isEnabled ?? true,
      isDeprecated: model.isLegacy === true,
      discoveredAutomatically: input.metadata.supportsModelDiscovery && !model.isCustom,
      maximumConcurrentSessions: previous?.profile.maximumConcurrentSessions ?? null,
      createdAt: previous?.profile.createdAt ?? input.snapshot.checkedAt,
      updatedAt: input.snapshot.checkedAt,
      lastDiscoveredAt: input.metadata.supportsModelDiscovery ? input.snapshot.checkedAt : null,
    };
    return {
      profile: modelProfile,
      capabilitySnapshot: capabilitySnapshotFor({
        model,
        profile: modelProfile,
        metadata: input.metadata,
        capturedAt: input.snapshot.checkedAt,
        ...(previous === undefined ? {} : { previous: previous.capabilitySnapshot }),
      }),
      harnessCapabilities: input.metadata.harnessCapabilities,
    };
  });
  const currentIds = new Set(currentModels.map((model) => model.profile.providerModelId));
  const unavailableHistorical = (input.previousModels ?? [])
    .filter((previous) => !currentIds.has(previous.profile.providerModelId))
    .map(
      (previous): NormalizedRoutingModel => ({
        profile: {
          ...previous.profile,
          status: input.snapshot.enabled && previous.profile.isEnabled ? "unavailable" : "disabled",
          updatedAt: input.snapshot.checkedAt,
        },
        capabilitySnapshot: previous.capabilitySnapshot,
        harnessCapabilities: input.metadata.harnessCapabilities,
      }),
    );

  return {
    profile,
    harnessCapabilities: input.metadata.harnessCapabilities,
    maximumConcurrentSessions: input.metadata.concurrency.maximumConcurrentSessions,
    models: [...currentModels, ...unavailableHistorical].toSorted((left, right) =>
      left.profile.providerModelId.localeCompare(right.profile.providerModelId),
    ),
  };
};

export const normalizeProviderCatalog = (input: {
  readonly snapshots: ReadonlyArray<ServerProvider>;
  readonly metadataByDriver: ReadonlyMap<ProviderDriverKind, ProviderDriverMetadata>;
  readonly previousProviders?: ReadonlyMap<ProviderInstanceId, ProviderProfile>;
  readonly previousModelsByProvider?: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<PreviousRoutingModel>
  >;
}): ReadonlyArray<NormalizedRoutingProvider> =>
  input.snapshots
    .flatMap((snapshot) => {
      const metadata = input.metadataByDriver.get(snapshot.driver);
      const previousProvider = input.previousProviders?.get(snapshot.instanceId);
      const previousModels = input.previousModelsByProvider?.get(snapshot.instanceId);
      return metadata === undefined
        ? []
        : [
            normalizeProviderSnapshot({
              snapshot,
              metadata,
              ...(previousProvider === undefined ? {} : { previousProvider }),
              ...(previousModels === undefined ? {} : { previousModels }),
            }),
          ];
    })
    .toSorted((left, right) => left.profile.id.localeCompare(right.profile.id));

export const capabilityState = (value: boolean | null | undefined): RoutingCapabilityState =>
  value === true ? "supported" : value === false ? "unsupported" : "unknown";

/**
 * Refresh routing profiles through the projection repository. Missing models
 * are loaded before normalization and therefore remain visible as unavailable;
 * unchanged capability facts reuse the existing immutable snapshot.
 */
export const refreshRoutingRegistry = Effect.fn("RoutingRegistry.refresh")(function* (input: {
  readonly snapshots: ReadonlyArray<ServerProvider>;
  readonly metadataByDriver: ReadonlyMap<ProviderDriverKind, ProviderDriverMetadata>;
  readonly observedAt: string;
}) {
  const repository = yield* ProjectionRoutingRepository;
  const previousProviders = yield* repository.listProviderProfiles();
  const previousModelGroups = yield* Effect.forEach(
    previousProviders,
    (provider) =>
      Effect.gen(function* () {
        const profiles = yield* repository.listModelProfiles({
          providerProfileId: provider.id,
        });
        const models = yield* Effect.forEach(
          profiles,
          (profile) =>
            Effect.gen(function* () {
              const snapshot = yield* repository.getLatestCapabilitySnapshot({
                modelProfileId: profile.id,
                observedAt: input.observedAt,
              });
              return Option.isSome(snapshot)
                ? [{ profile, capabilitySnapshot: snapshot.value } satisfies PreviousRoutingModel]
                : [];
            }),
          { concurrency: 1 },
        );
        return [provider.id, models.flat()] as const;
      }),
    { concurrency: 1 },
  );
  const previousModelsByProvider = new Map(previousModelGroups);
  const previousProvidersById = new Map(
    previousProviders.map((provider) => [provider.id, provider] as const),
  );
  const catalog = normalizeProviderCatalog({
    snapshots: input.snapshots,
    metadataByDriver: input.metadataByDriver,
    previousProviders: previousProvidersById,
    previousModelsByProvider,
  });

  yield* Effect.forEach(
    catalog,
    (provider) =>
      Effect.gen(function* () {
        yield* repository.upsertProviderProfile(provider.profile);
        const previousSnapshots = new Map(
          (previousModelsByProvider.get(provider.profile.id) ?? []).map(
            (model) => [model.profile.id, model.capabilitySnapshot] as const,
          ),
        );
        yield* Effect.forEach(
          provider.models,
          (model) =>
            Effect.gen(function* () {
              yield* repository.upsertModelProfile(model.profile);
              if (previousSnapshots.get(model.profile.id)?.id !== model.capabilitySnapshot.id) {
                yield* repository.insertCapabilitySnapshot(model.capabilitySnapshot);
              }
            }),
          { concurrency: 1 },
        );
      }),
    { concurrency: 1 },
  );

  return catalog;
});
