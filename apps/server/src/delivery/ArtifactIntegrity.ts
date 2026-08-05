import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ReleaseArtifact } from "@t3tools/contracts";

export interface ReleaseArtifactIntegrity {
  readonly managedRelativePath: ReleaseArtifact["relativePath"];
  readonly sha256: string;
  readonly sizeBytes: NonNullable<ReleaseArtifact["sizeBytes"]>;
  readonly sourceFingerprint: string;
  readonly sourceCommitSha: ReleaseArtifact["sourceCommit"];
  readonly generatedAt: string;
  readonly provenanceFingerprint: string;
}

export class ArtifactIntegrityError extends Schema.TaggedErrorClass<ArtifactIntegrityError>()(
  "ArtifactIntegrityError",
  {
    reason: Schema.Literals([
      "invalid_source_provenance",
      "invalid_managed_root",
      "outside_managed_root",
      "not_a_file",
      "artifact_too_large",
      "artifact_changed",
      "io_failed",
    ]),
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Artifact integrity check failed (${this.reason}): ${this.detail}`;
  }
}

const isWithin = (path: Path.Path, root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const isSha256 = (value: string): boolean => /^[a-f0-9]{64}$/i.test(value);
const isCommitSha = (value: string): boolean => /^[a-f0-9]{7,64}$/i.test(value);

const digestHex = Effect.fn("ArtifactIntegrity.digestHex")(function* (value: Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  return Encoding.encodeHex(yield* crypto.digest("SHA-256", value));
});

const provenanceFingerprint = Effect.fn("ArtifactIntegrity.provenanceFingerprint")(function* (
  value: Omit<ReleaseArtifactIntegrity, "provenanceFingerprint">,
) {
  const fields: ReadonlyArray<string> = [
    value.managedRelativePath,
    value.sha256,
    String(value.sizeBytes),
    value.sourceFingerprint,
    value.sourceCommitSha,
    value.generatedAt,
  ];
  return yield* digestHex(
    new TextEncoder().encode(
      fields.map((field) => `${new TextEncoder().encode(field).byteLength}:${field}`).join(""),
    ),
  );
});

const ioError = (detail: string, cause: unknown): ArtifactIntegrityError =>
  new ArtifactIntegrityError({ reason: "io_failed", detail, cause });

export const resolveManagedArtifactPath = Effect.fn("ArtifactIntegrity.resolveManagedArtifactPath")(
  function* (input: { readonly managedRoot: string; readonly artifactPath: string }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.realPath(input.managedRoot).pipe(
      Effect.mapError(
        (cause) =>
          new ArtifactIntegrityError({
            reason: "invalid_managed_root",
            detail: "Managed artifact root could not be resolved.",
            cause,
          }),
      ),
    );
    const requested = path.resolve(root, input.artifactPath);
    if (!isWithin(path, root, requested)) {
      return yield* new ArtifactIntegrityError({
        reason: "outside_managed_root",
        detail: "Artifact path escapes its managed root.",
      });
    }
    const artifact = yield* fileSystem
      .realPath(requested)
      .pipe(Effect.mapError((cause) => ioError("Artifact path could not be resolved.", cause)));
    if (!isWithin(path, root, artifact)) {
      return yield* new ArtifactIntegrityError({
        reason: "outside_managed_root",
        detail: "Artifact resolves outside its managed root.",
      });
    }
    const relative = path.relative(root, artifact).replaceAll("\\", "/");
    if (relative.length === 0) {
      return yield* new ArtifactIntegrityError({
        reason: "not_a_file",
        detail: "Managed root itself is not an artifact.",
      });
    }
    return { root, artifact, relative };
  },
);

const sameFileInfo = (left: FileSystem.File.Info, right: FileSystem.File.Info): boolean => {
  const leftModified = Option.map(left.mtime, (value) =>
    DateTime.toEpochMillis(DateTime.makeUnsafe(value)),
  );
  const rightModified = Option.map(right.mtime, (value) =>
    DateTime.toEpochMillis(DateTime.makeUnsafe(value)),
  );
  return (
    left.size === right.size &&
    left.dev === right.dev &&
    Option.getOrNull(left.ino) === Option.getOrNull(right.ino) &&
    Option.getOrNull(leftModified) === Option.getOrNull(rightModified)
  );
};

export const inspectReleaseArtifact = Effect.fn("ArtifactIntegrity.inspectReleaseArtifact")(
  function* (input: {
    readonly managedRoot: string;
    readonly artifactPath: string;
    readonly sourceFingerprint: string;
    readonly sourceCommitSha: string;
    readonly generatedAt: string;
    readonly maximumSizeBytes: number;
  }) {
    const generatedAt = DateTime.make(input.generatedAt);
    if (
      !isSha256(input.sourceFingerprint) ||
      !isCommitSha(input.sourceCommitSha) ||
      Option.isNone(generatedAt)
    ) {
      return yield* new ArtifactIntegrityError({
        reason: "invalid_source_provenance",
        detail:
          "Artifact provenance requires an immutable source fingerprint, commit, and timestamp.",
      });
    }
    if (!Number.isSafeInteger(input.maximumSizeBytes) || input.maximumSizeBytes < 0) {
      return yield* new ArtifactIntegrityError({
        reason: "artifact_too_large",
        detail: "Artifact size limit is invalid.",
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const resolved = yield* resolveManagedArtifactPath(input);
    const before = yield* fileSystem
      .stat(resolved.artifact)
      .pipe(Effect.mapError((cause) => ioError("Artifact metadata could not be read.", cause)));
    if (before.type !== "File") {
      return yield* new ArtifactIntegrityError({
        reason: "not_a_file",
        detail: "Artifact path does not identify a regular file.",
      });
    }
    const beforeSize = Number(before.size);
    if (!Number.isSafeInteger(beforeSize) || beforeSize > input.maximumSizeBytes) {
      return yield* new ArtifactIntegrityError({
        reason: "artifact_too_large",
        detail: `Artifact size exceeds the configured ${input.maximumSizeBytes} byte limit.`,
      });
    }
    const contents = yield* fileSystem
      .readFile(resolved.artifact)
      .pipe(Effect.mapError((cause) => ioError("Artifact could not be read.", cause)));
    const sha256 = yield* digestHex(contents);
    const after = yield* fileSystem
      .stat(resolved.artifact)
      .pipe(Effect.mapError((cause) => ioError("Artifact metadata could not be re-read.", cause)));
    if (!sameFileInfo(before, after)) {
      return yield* new ArtifactIntegrityError({
        reason: "artifact_changed",
        detail: "Artifact changed while its integrity record was being created.",
      });
    }
    const record = {
      managedRelativePath: resolved.relative,
      sha256,
      sizeBytes: Number(after.size),
      sourceFingerprint: input.sourceFingerprint.toLowerCase(),
      sourceCommitSha: input.sourceCommitSha.toLowerCase(),
      generatedAt: DateTime.formatIso(generatedAt.value),
    };
    return Object.freeze({
      ...record,
      provenanceFingerprint: yield* provenanceFingerprint(record),
    });
  },
);

export const verifyArtifactProvenance = Effect.fn("ArtifactIntegrity.verifyArtifactProvenance")(
  function* (input: {
    readonly artifact: ReleaseArtifactIntegrity;
    readonly expectedSourceFingerprint: string;
    readonly expectedCommitSha: string;
  }) {
    const expectedProvenance = yield* provenanceFingerprint({
      managedRelativePath: input.artifact.managedRelativePath,
      sha256: input.artifact.sha256,
      sizeBytes: input.artifact.sizeBytes,
      sourceFingerprint: input.artifact.sourceFingerprint,
      sourceCommitSha: input.artifact.sourceCommitSha,
      generatedAt: input.artifact.generatedAt,
    });
    return (
      input.artifact.sourceFingerprint === input.expectedSourceFingerprint.toLowerCase() &&
      input.artifact.sourceCommitSha === input.expectedCommitSha.toLowerCase() &&
      isSha256(input.artifact.sha256) &&
      input.artifact.provenanceFingerprint === expectedProvenance
    );
  },
);
