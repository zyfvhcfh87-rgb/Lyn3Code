import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  inspectReleaseArtifact,
  resolveManagedArtifactPath,
  verifyArtifactProvenance,
} from "./ArtifactIntegrity.ts";

describe("ArtifactIntegrity", () => {
  it.effect("records SHA-256, size, managed path, and immutable source provenance", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-delivery-artifact-" });
      const artifactPath = path.join(root, "bundle.bin");
      yield* fileSystem.writeFileString(artifactPath, "artifact-content");

      const artifact = yield* inspectReleaseArtifact({
        managedRoot: root,
        artifactPath,
        sourceFingerprint: "a".repeat(64),
        sourceCommitSha: "b".repeat(40),
        generatedAt: "2026-08-05T10:00:00.000Z",
        maximumSizeBytes: 1024,
      });

      expect(artifact.managedRelativePath).toBe("bundle.bin");
      expect(artifact.sizeBytes).toBe(16);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(
        yield* verifyArtifactProvenance({
          artifact,
          expectedSourceFingerprint: "a".repeat(64),
          expectedCommitSha: "b".repeat(40),
        }),
      ).toBe(true);
      expect(
        yield* verifyArtifactProvenance({
          artifact,
          expectedSourceFingerprint: "c".repeat(64),
          expectedCommitSha: "b".repeat(40),
        }),
      ).toBe(false);
      expect(
        yield* verifyArtifactProvenance({
          artifact: { ...artifact, sha256: "0".repeat(64) },
          expectedSourceFingerprint: "a".repeat(64),
          expectedCommitSha: "b".repeat(40),
        }),
      ).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects paths that escape the managed artifact root before reading them", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-delivery-root-" });
      const error = yield* resolveManagedArtifactPath({
        managedRoot: root,
        artifactPath: path.resolve(root, "..", "escape.bin"),
      }).pipe(Effect.flip);
      expect(error.reason).toBe("outside_managed_root");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
