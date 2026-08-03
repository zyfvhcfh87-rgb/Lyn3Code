import {
  VerificationArtifactAccessError,
  VerificationArtifactId,
  VerificationRunId,
  type VerificationArtifact,
  type VerificationArtifactAccessUrl,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { ProjectionVerificationRunRepository } from "../persistence/Services/ProjectionVerificationRuns.ts";

export const VERIFICATION_ARTIFACT_ROUTE_PREFIX = "/api/verification/artifacts";

const SIGNING_SECRET_NAME = "verification-artifact-access-signing-key";
const TOKEN_TTL_MILLISECONDS = 10 * 60 * 1_000;

const Claims = Schema.Struct({
  version: Schema.Literal(1),
  verificationRunId: VerificationRunId,
  artifactId: VerificationArtifactId,
  expiresAt: Schema.Number,
});
type Claims = typeof Claims.Type;
const ClaimsJson = Schema.fromJsonString(Claims);
const encodeClaims = Schema.encodeSync(ClaimsJson);
const decodeClaims = Schema.decodeUnknownOption(ClaimsJson);

export interface ResolvedVerificationArtifact {
  readonly path: string;
  readonly name: string;
  readonly mimeType: string | null;
}

const accessError = (
  reason: VerificationArtifactAccessError["reason"],
  message: string,
): VerificationArtifactAccessError => new VerificationArtifactAccessError({ reason, message });

const decodeTokenClaims = (encoded: string): Claims | null => {
  try {
    return Option.getOrNull(decodeClaims(base64UrlDecodeUtf8(encoded)));
  } catch {
    return null;
  }
};

const decodeFileName = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

interface VerificationArtifactAccessDependencies {
  readonly artifactRoot: string;
  readonly loadArtifact: (input: {
    readonly verificationRunId: VerificationRunId;
    readonly artifactId: VerificationArtifactId;
  }) => Effect.Effect<VerificationArtifact, VerificationArtifactAccessError>;
  readonly signingSecret: () => Effect.Effect<Uint8Array, VerificationArtifactAccessError>;
}

export const makeWithDependencies = Effect.fn("VerificationArtifactAccess.makeWithDependencies")(
  function* (dependencies: VerificationArtifactAccessDependencies) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const artifactRoot = path.resolve(dependencies.artifactRoot);

    const resolveCanonicalArtifact = (artifact: VerificationArtifact) =>
      Effect.gen(function* () {
        const candidate = path.resolve(artifactRoot, artifact.path);
        const lexicalRelative = path.relative(artifactRoot, candidate);
        if (
          lexicalRelative === "" ||
          lexicalRelative === ".." ||
          lexicalRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(lexicalRelative)
        ) {
          return yield* accessError(
            "unsafe_path",
            "The recorded verification artifact path is outside managed storage.",
          );
        }
        const [canonicalRoot, canonicalFile] = yield* Effect.all([
          fileSystem.realPath(artifactRoot),
          fileSystem.realPath(candidate),
        ]).pipe(
          Effect.mapError(() =>
            accessError("unavailable", "The verification artifact is no longer available."),
          ),
        );
        const canonicalRelative = path.relative(canonicalRoot, canonicalFile);
        if (
          canonicalRelative === "" ||
          canonicalRelative === ".." ||
          canonicalRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(canonicalRelative)
        ) {
          return yield* accessError(
            "unsafe_path",
            "The verification artifact resolves outside managed storage.",
          );
        }
        const info = yield* fileSystem
          .stat(canonicalFile)
          .pipe(
            Effect.mapError(() =>
              accessError("unavailable", "The verification artifact is no longer available."),
            ),
          );
        if (info.type !== "File") {
          return yield* accessError("unavailable", "The verification artifact is not a file.");
        }
        return {
          path: canonicalFile,
          name: artifact.name,
          mimeType: artifact.mimeType,
        } satisfies ResolvedVerificationArtifact;
      });

    const inspect = (input: {
      readonly verificationRunId: VerificationRunId;
      readonly artifactId: VerificationArtifactId;
    }) => dependencies.loadArtifact(input).pipe(Effect.flatMap(resolveCanonicalArtifact));

    const issueUrl = Effect.fn("VerificationArtifactAccess.issueUrl")(function* (input: {
      readonly verificationRunId: VerificationRunId;
      readonly artifactId: VerificationArtifactId;
    }): Effect.fn.Return<VerificationArtifactAccessUrl, VerificationArtifactAccessError> {
      const artifact = yield* inspect(input);
      const expiresAt = (yield* Clock.currentTimeMillis) + TOKEN_TTL_MILLISECONDS;
      const claims: Claims = { version: 1, ...input, expiresAt };
      const encodedPayload = base64UrlEncode(encodeClaims(claims));
      const signature = signPayload(encodedPayload, yield* dependencies.signingSecret());
      const token = `${encodedPayload}.${signature}`;
      const fileName = encodeURIComponent(path.basename(artifact.path));
      return {
        relativeUrl: `${VERIFICATION_ARTIFACT_ROUTE_PREFIX}/${token}/${fileName}`,
        expiresAt,
      };
    });

    const resolve = Effect.fn("VerificationArtifactAccess.resolve")(function* (
      token: string,
      fileName: string,
    ) {
      const tokenParts = token.split(".");
      if (tokenParts.length !== 2) return null;
      const [encodedPayload, signature] = tokenParts;
      if (!encodedPayload || !signature) return null;
      const secret = yield* dependencies.signingSecret().pipe(Effect.orElseSucceed(() => null));
      if (!secret || !timingSafeEqualBase64Url(signature, signPayload(encodedPayload, secret))) {
        return null;
      }
      const claims = decodeTokenClaims(encodedPayload);
      if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) return null;
      const artifact = yield* inspect(claims).pipe(Effect.orElseSucceed(() => null));
      if (artifact === null) return null;
      const decodedFileName = decodeFileName(fileName);
      if (decodedFileName === null) return null;
      return decodedFileName === path.basename(artifact.path) ? artifact : null;
    });

    return { inspect, issueUrl, resolve };
  },
);

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const runs = yield* ProjectionVerificationRunRepository;
  const artifactRoot = path.resolve(config.stateDir, "verification", "artifacts");

  const loadArtifact = (input: {
    readonly verificationRunId: VerificationRunId;
    readonly artifactId: VerificationArtifactId;
  }) =>
    runs.listArtifactsByRunId({ verificationRunId: input.verificationRunId }).pipe(
      Effect.mapError(() =>
        accessError("persistence_error", "Verification artifact metadata could not be loaded."),
      ),
      Effect.flatMap((artifacts) => {
        const artifact = artifacts.find((candidate) => candidate.id === input.artifactId);
        return artifact === undefined
          ? Effect.fail(accessError("not_found", "The verification artifact was not found."))
          : Effect.succeed(artifact);
      }),
    );

  const signingSecret = () =>
    secretStore
      .getOrCreateRandom(SIGNING_SECRET_NAME, 32)
      .pipe(
        Effect.mapError(() =>
          accessError("signing_error", "Verification artifact access could not be authorized."),
        ),
      );

  return yield* makeWithDependencies({ artifactRoot, loadArtifact, signingSecret });
});

export type VerificationArtifactAccess = Effect.Success<typeof make>;
