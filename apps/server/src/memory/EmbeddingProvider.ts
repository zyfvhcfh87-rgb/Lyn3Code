import type { EmbeddingProviderKind, IsoDateTime } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const EmbeddingInputKind = Schema.Literals(["query", "source"]);
export type EmbeddingInputKind = typeof EmbeddingInputKind.Type;

export interface EmbeddingProviderMetadata {
  readonly id: string;
  readonly kind: Exclude<EmbeddingProviderKind, "none">;
  readonly model: string;
  readonly dimensions: number;
  readonly sendsContentRemotely: boolean;
  readonly remoteContentDescription: string | null;
  readonly remoteCodeUploadAcceptedAt: IsoDateTime | null;
}

export interface EmbeddingRequest {
  readonly kind: EmbeddingInputKind;
  readonly texts: ReadonlyArray<string>;
}

export interface EmbeddingExecutorResponse {
  readonly model: string;
  readonly dimensions: number;
  readonly vectors: ReadonlyArray<ReadonlyArray<number>>;
}

export class EmbeddingProviderError extends Schema.TaggedErrorClass<EmbeddingProviderError>()(
  "EmbeddingProviderError",
  {
    reason: Schema.Literals([
      "invalid_configuration",
      "privacy_consent_required",
      "invalid_request",
      "provider_failed",
      "model_mismatch",
      "dimension_mismatch",
      "invalid_vector",
    ]),
    message: Schema.String,
  },
) {}

export type EmbeddingExecutor = (
  request: EmbeddingRequest,
) => Effect.Effect<EmbeddingExecutorResponse, EmbeddingProviderError>;

export interface ConfiguredEmbeddingProvider {
  readonly metadata: EmbeddingProviderMetadata;
  readonly embed: (
    request: EmbeddingRequest,
  ) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbeddingProviderError>;
}

export interface EmbeddingProviderShape {
  readonly configured: Option.Option<ConfiguredEmbeddingProvider>;
}

export class EmbeddingProvider extends Context.Service<EmbeddingProvider, EmbeddingProviderShape>()(
  "t3/memory/EmbeddingProvider",
) {}

const configurationError = (message: string) =>
  new EmbeddingProviderError({ reason: "invalid_configuration", message });

const requestError = (message: string) =>
  new EmbeddingProviderError({ reason: "invalid_request", message });

const validateMetadata = (
  metadata: EmbeddingProviderMetadata,
): Effect.Effect<void, EmbeddingProviderError> => {
  if (metadata.id.trim().length === 0) {
    return Effect.fail(configurationError("Embedding provider id must not be empty"));
  }
  if (metadata.model.trim().length === 0) {
    return Effect.fail(configurationError("Embedding model must not be empty"));
  }
  if (!Number.isSafeInteger(metadata.dimensions) || metadata.dimensions <= 0) {
    return Effect.fail(configurationError("Embedding dimensions must be a positive integer"));
  }
  if (metadata.kind === "local" && metadata.sendsContentRemotely) {
    return Effect.fail(
      configurationError("A local embedding provider cannot declare remote content processing"),
    );
  }
  if (metadata.kind === "remote" && !metadata.sendsContentRemotely) {
    return Effect.fail(
      configurationError("A remote embedding provider must disclose remote content processing"),
    );
  }
  if (
    metadata.kind === "remote" &&
    (metadata.remoteContentDescription === null ||
      metadata.remoteContentDescription.trim().length === 0)
  ) {
    return Effect.fail(
      configurationError("A remote embedding provider must describe the content it sends"),
    );
  }
  return Effect.void;
};

const validateRequest = (
  metadata: EmbeddingProviderMetadata,
  request: EmbeddingRequest,
): Effect.Effect<void, EmbeddingProviderError> => {
  if (request.texts.length === 0 || request.texts.length > 64) {
    return Effect.fail(requestError("Embedding requests must contain between 1 and 64 texts"));
  }
  if (request.texts.some((text) => text.length === 0 || text.length > 64_000)) {
    return Effect.fail(
      requestError("Embedding request texts must contain between 1 and 64,000 characters"),
    );
  }
  if (metadata.kind === "remote" && metadata.remoteCodeUploadAcceptedAt === null) {
    return Effect.fail(
      new EmbeddingProviderError({
        reason: "privacy_consent_required",
        message: "Remote embedding is disabled until remote content processing is accepted",
      }),
    );
  }
  return Effect.void;
};

const validateResponse = (
  metadata: EmbeddingProviderMetadata,
  expectedCount: number,
  response: EmbeddingExecutorResponse,
): Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbeddingProviderError> => {
  if (response.model !== metadata.model) {
    return Effect.fail(
      new EmbeddingProviderError({
        reason: "model_mismatch",
        message: `Embedding provider returned model ${response.model}; expected ${metadata.model}`,
      }),
    );
  }
  if (response.dimensions !== metadata.dimensions) {
    return Effect.fail(
      new EmbeddingProviderError({
        reason: "dimension_mismatch",
        message: `Embedding provider returned ${response.dimensions} dimensions; expected ${metadata.dimensions}`,
      }),
    );
  }
  if (response.vectors.length !== expectedCount) {
    return Effect.fail(
      new EmbeddingProviderError({
        reason: "invalid_vector",
        message: "Embedding provider returned an unexpected number of vectors",
      }),
    );
  }
  for (const vector of response.vectors) {
    if (
      vector.length !== metadata.dimensions ||
      vector.some((component) => !Number.isFinite(component))
    ) {
      return Effect.fail(
        new EmbeddingProviderError({
          reason: "invalid_vector",
          message: "Embedding provider returned an invalid vector",
        }),
      );
    }
  }
  return Effect.succeed(response.vectors);
};

export const makeConfiguredEmbeddingProvider = (
  metadata: EmbeddingProviderMetadata,
  execute: EmbeddingExecutor,
): Effect.Effect<ConfiguredEmbeddingProvider, EmbeddingProviderError> =>
  Effect.as(validateMetadata(metadata), {
    metadata,
    embed: (request) =>
      Effect.gen(function* () {
        yield* validateRequest(metadata, request);
        const response = yield* execute(request);
        return yield* validateResponse(metadata, request.texts.length, response);
      }),
  } satisfies ConfiguredEmbeddingProvider);

export const EmbeddingProviderDisabledLive = Layer.succeed(EmbeddingProvider, {
  configured: Option.none(),
});

export const makeEmbeddingProviderLayer = (configured: ConfiguredEmbeddingProvider) =>
  Layer.succeed(EmbeddingProvider, { configured: Option.some(configured) });
