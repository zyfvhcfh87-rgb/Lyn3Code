// @effect-diagnostics nodeBuiltinImport:off - junction fixtures are disposable test data.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  VerificationArtifactAccessError,
  VerificationArtifactId,
  VerificationRunId,
  type VerificationArtifact,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import {
  VERIFICATION_ARTIFACT_ROUTE_PREFIX,
  makeWithDependencies,
} from "./VerificationArtifactAccess.ts";

const runId = VerificationRunId.make("verification-run:artifact-access");
const artifactId = VerificationArtifactId.make("verification-artifact:report");

const artifact = (path: string): VerificationArtifact => ({
  id: artifactId,
  verificationRunId: runId,
  checkRunId: null,
  type: "report",
  name: "Verification report",
  path,
  mimeType: "text/plain",
  sizeBytes: 6,
  checksum: "abc123",
  metadata: {},
  createdAt: "2026-08-03T12:00:00.000Z",
});

it.effect("issues exact signed URLs and revalidates managed artifact metadata", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const artifactRoot = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "lyn-verification-artifact-access-",
    });
    const relativePath = path.join("run-1", "check-1", "report.txt");
    const filePath = path.join(artifactRoot, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fileSystem.writeFileString(filePath, "passed");
    let currentArtifact = artifact(relativePath);
    const access = yield* makeWithDependencies({
      artifactRoot,
      loadArtifact: ({ verificationRunId, artifactId: requestedArtifactId }) =>
        verificationRunId === runId && requestedArtifactId === artifactId
          ? Effect.succeed(currentArtifact)
          : Effect.fail(
              new VerificationArtifactAccessError({
                reason: "not_found",
                message: "Artifact not found.",
              }),
            ),
      signingSecret: () => Effect.succeed(new Uint8Array(32).fill(7)),
    });

    const issued = yield* access.issueUrl({ verificationRunId: runId, artifactId });
    const suffix = issued.relativeUrl.slice(`${VERIFICATION_ARTIFACT_ROUTE_PREFIX}/`.length);
    const separatorIndex = suffix.indexOf("/");
    const token = suffix.slice(0, separatorIndex);
    const fileName = suffix.slice(separatorIndex + 1);
    const canonicalPath = yield* fileSystem.realPath(filePath);

    expect(yield* access.resolve(token, fileName)).toEqual({
      path: canonicalPath,
      name: "Verification report",
      mimeType: "text/plain",
    });
    expect(yield* access.resolve(`${token}tampered`, fileName)).toBeNull();
    expect(yield* access.resolve(`${token}.ignored`, fileName)).toBeNull();
    expect(yield* access.resolve(token, "different.txt")).toBeNull();
    expect(yield* access.resolve(token, "%")).toBeNull();

    currentArtifact = artifact(path.join("..", "outside.txt"));
    expect(yield* access.resolve(token, fileName)).toBeNull();
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rejects lexical traversal and canonical junction escape", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hostPlatform = yield* HostProcessPlatform;
    const artifactRoot = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "lyn-verification-artifact-managed-",
    });
    const outside = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "lyn-verification-artifact-outside-",
    });
    yield* fileSystem.writeFileString(path.join(outside, "private.txt"), "secret");
    NodeFS.symlinkSync(
      outside,
      path.join(artifactRoot, "escape"),
      hostPlatform === "win32" ? "junction" : "dir",
    );

    let currentArtifact = artifact(path.join("..", "private.txt"));
    const access = yield* makeWithDependencies({
      artifactRoot,
      loadArtifact: () => Effect.succeed(currentArtifact),
      signingSecret: () => Effect.succeed(new Uint8Array(32).fill(9)),
    });

    const traversal = yield* access
      .inspect({ verificationRunId: runId, artifactId })
      .pipe(Effect.flip);
    expect(traversal.reason).toBe("unsafe_path");

    currentArtifact = artifact(path.join("escape", "private.txt"));
    const junctionEscape = yield* access
      .inspect({ verificationRunId: runId, artifactId })
      .pipe(Effect.flip);
    expect(junctionEscape.reason).toBe("unsafe_path");
  }).pipe(Effect.provide(NodeServices.layer)),
);
