import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  EmbeddingProviderError,
  makeConfiguredEmbeddingProvider,
  type EmbeddingProviderMetadata,
} from "./EmbeddingProvider.ts";

const localMetadata: EmbeddingProviderMetadata = {
  id: "local-test",
  kind: "local",
  model: "tiny-local-v1",
  dimensions: 3,
  sendsContentRemotely: false,
  remoteContentDescription: null,
  remoteCodeUploadAcceptedAt: null,
};

describe("EmbeddingProvider", () => {
  it.effect("validates model, dimensions, and finite vector values", () =>
    Effect.gen(function* () {
      const provider = yield* makeConfiguredEmbeddingProvider(localMetadata, () =>
        Effect.succeed({
          model: "tiny-local-v1",
          dimensions: 3,
          vectors: [[0.1, 0.2, 0.3]],
        }),
      );
      assert.deepStrictEqual(yield* provider.embed({ kind: "query", texts: ["hello"] }), [
        [0.1, 0.2, 0.3],
      ]);

      const invalid = yield* Effect.result(
        makeConfiguredEmbeddingProvider(localMetadata, () =>
          Effect.succeed({
            model: "tiny-local-v1",
            dimensions: 2,
            vectors: [[0.1, Number.NaN]],
          }),
        ).pipe(Effect.flatMap((configured) => configured.embed({ kind: "query", texts: ["x"] }))),
      );
      assert.isTrue(Result.isFailure(invalid));
      if (Result.isFailure(invalid)) {
        assert.instanceOf(invalid.failure, EmbeddingProviderError);
        assert.equal(invalid.failure.reason, "dimension_mismatch");
      }
    }),
  );

  it.effect("blocks every remote request until explicit privacy acceptance", () =>
    Effect.gen(function* () {
      let executions = 0;
      const provider = yield* makeConfiguredEmbeddingProvider(
        {
          id: "remote-test",
          kind: "remote",
          model: "remote-v1",
          dimensions: 2,
          sendsContentRemotely: true,
          remoteContentDescription: "Query or source text configured by the user",
          remoteCodeUploadAcceptedAt: null,
        },
        () => {
          executions += 1;
          return Effect.succeed({ model: "remote-v1", dimensions: 2, vectors: [[1, 0]] });
        },
      );
      const result = yield* Effect.result(
        provider.embed({ kind: "source", texts: ["private source"] }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.equal(result.failure.reason, "privacy_consent_required");
      }
      assert.equal(executions, 0);
    }),
  );

  it.effect("rejects misleading local and remote metadata", () =>
    Effect.gen(function* () {
      const local = yield* Effect.result(
        makeConfiguredEmbeddingProvider({ ...localMetadata, sendsContentRemotely: true }, () =>
          Effect.succeed({ model: "tiny-local-v1", dimensions: 3, vectors: [[0, 0, 0]] }),
        ),
      );
      assert.isTrue(Result.isFailure(local));

      const remote = yield* Effect.result(
        makeConfiguredEmbeddingProvider(
          {
            ...localMetadata,
            kind: "remote",
            sendsContentRemotely: true,
            remoteContentDescription: null,
          },
          () => Effect.succeed({ model: "tiny-local-v1", dimensions: 3, vectors: [[0, 0, 0]] }),
        ),
      );
      assert.isTrue(Result.isFailure(remote));
    }),
  );
});
