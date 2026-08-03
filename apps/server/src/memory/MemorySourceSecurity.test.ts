import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  classifyMemorySourcePath,
  fingerprintMemorySource,
  isBinaryMemorySource,
  MemorySourcePathError,
  redactMemorySourceText,
  resolveContainedRepositoryFile,
} from "./MemorySourceSecurity.ts";

describe("MemorySourceSecurity", () => {
  it("rejects generated, binary, secret-bearing, oversized, and explicitly excluded paths", () => {
    expect(classifyMemorySourcePath("src/index.ts", 120)).toMatchObject({ indexable: true });
    expect(classifyMemorySourcePath("node_modules/pkg/index.js", 120).reason).toBe(
      "generated_or_dependency",
    );
    expect(classifyMemorySourcePath("assets/logo.png", 120).reason).toBe("binary");
    expect(classifyMemorySourcePath(".env.local", 120).reason).toBe("secret_bearing_path");
    expect(classifyMemorySourcePath("keys/signing.pem", 120).reason).toBe("secret_bearing_path");
    expect(
      classifyMemorySourcePath("src/huge.ts", 2_000, { maximumFileSizeBytes: 1_000 }).reason,
    ).toBe("size_limit");
    expect(
      classifyMemorySourcePath("fixtures/private.txt", 100, { exclusions: ["fixtures/**"] }).reason,
    ).toBe("explicit_exclusion");
    expect(
      classifyMemorySourcePath("fixtures/public.txt", 100, {
        exclusions: ["fixtures/**", "!fixtures/public.txt"],
      }).indexable,
    ).toBe(true);
  });

  it("detects binary content and produces stable content fingerprints", () => {
    expect(isBinaryMemorySource(new Uint8Array([65, 66, 0, 67]))).toBe(true);
    expect(isBinaryMemorySource(new TextEncoder().encode("plain text\n"))).toBe(false);
    expect(fingerprintMemorySource("same")).toBe(fingerprintMemorySource("same"));
    expect(fingerprintMemorySource("same")).not.toBe(fingerprintMemorySource("different"));
  });

  it("redacts secret values before storage while retaining safe environment-variable references", () => {
    const redacted = redactMemorySourceText(`
Authorization: Bearer live-token-value
api_key = "sk-abcdefghijklmnopqrstuvwxyz"
password = process.env.DATABASE_PASSWORD
endpoint = "postgres://user:hunter2@localhost/database"
The project expects DATABASE_URL to be defined.
`);

    expect(redacted.content).not.toContain("live-token-value");
    expect(redacted.content).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted.content).not.toContain("hunter2");
    expect(redacted.content).toContain("process.env.DATABASE_PASSWORD");
    expect(redacted.content).toContain("expects DATABASE_URL");
    expect(redacted.redactionCount).toBeGreaterThanOrEqual(3);
  });

  it.effect("resolves only real files contained by the validated repository root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "memory-source-root-" });
      const repositoryRoot = path.join(parent, "repository");
      const sourcePath = path.join(repositoryRoot, "src", "inside.ts");
      yield* fileSystem.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fileSystem.writeFileString(sourcePath, "export const inside = true;\n");

      const resolved = yield* resolveContainedRepositoryFile(repositoryRoot, "src/inside.ts");

      expect(resolved.relativePath).toBe("src/inside.ts");
      expect(resolved.absolutePath).toBe(yield* fileSystem.realPath(sourcePath));

      const escaped = yield* resolveContainedRepositoryFile(repositoryRoot, "../outside.ts").pipe(
        Effect.flip,
      );
      expect(escaped).toBeInstanceOf(MemorySourcePathError);
      expect(escaped.reason).toBe("outside_repository");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a source symlink that resolves outside the repository", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "memory-source-link-" });
      const repositoryRoot = path.join(parent, "repository");
      const outsidePath = path.join(parent, "outside.txt");
      const linkPath = path.join(repositoryRoot, "linked.txt");
      yield* fileSystem.makeDirectory(repositoryRoot, { recursive: true });
      yield* fileSystem.writeFileString(outsidePath, "outside\n");

      const error = yield* resolveContainedRepositoryFile(repositoryRoot, "linked.txt").pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          realPath: (target) =>
            path.resolve(String(target)) === path.resolve(linkPath)
              ? Effect.succeed(outsidePath)
              : fileSystem.realPath(target),
        }),
        Effect.flip,
      );

      expect(error.reason).toBe("symlink_escape");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
