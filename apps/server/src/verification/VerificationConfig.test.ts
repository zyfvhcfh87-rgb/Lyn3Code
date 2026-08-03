import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { T3ProjectVerificationConfig } from "@t3tools/contracts";

import * as VerificationConfig from "./VerificationConfig.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(VerificationConfig.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDirectory = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "lyn-verification-config-" });
});

it.layer(TestLayer)("VerificationConfigService", (it) => {
  it.effect("discovers an exact revision and requires explicit acceptance", () =>
    Effect.gen(function* () {
      const service = yield* VerificationConfig.VerificationConfigService;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* makeTempDirectory;
      yield* fileSystem.writeFileString(
        path.join(root, "t3.json"),
        `{
          "verification": {
            "version": 1,
            "defaultProfile": "fast",
            "profiles": {
              "fast": {
                "gates": [{
                  "id": "types",
                  "category": "typecheck",
                  "checks": [{
                    "id": "types",
                    "name": "Typecheck",
                    "command": { "executable": "pnpm", "args": ["run", "typecheck"] }
                  }]
                }]
              }
            }
          }
        }`,
      );

      const discovered = yield* service.discover({ workspaceRoot: root });
      expect(discovered.trust).toBe("requires_acceptance");
      expect(discovered.revision).toMatch(/^[a-f0-9]{64}$/u);

      const accepted = yield* service.discover({
        workspaceRoot: root,
        acceptedRevision: discovered.revision!,
      });
      expect(accepted.trust).toBe("accepted");
      expect(accepted.profiles.fast?.gates[0]?.checks[0]?.command).toEqual({
        executable: "pnpm",
        args: ["run", "typecheck"],
      });
    }),
  );

  it.effect("returns untrusted package-script suggestions without persisting them", () =>
    Effect.gen(function* () {
      const service = yield* VerificationConfig.VerificationConfigService;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* makeTempDirectory;
      yield* fileSystem.writeFileString(
        path.join(root, "package.json"),
        `{ "packageManager": "pnpm@11.10.0", "scripts": { "lint": "oxlint ." } }`,
      );
      yield* fileSystem.writeFileString(
        path.join(root, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'",
      );

      const discovered = yield* service.discover({ workspaceRoot: root });

      expect(discovered.trust).toBe("not_configured");
      expect(discovered.suggestions).toEqual([
        {
          id: "lint",
          category: "lint",
          command: { executable: "pnpm", args: ["run", "lint"] },
          reason: "package.json defines the lint script",
          trusted: false,
        },
      ]);
    }),
  );
});

describe("resolveVerificationProfiles", () => {
  it.effect("rejects deterministic inheritance cycles", () => {
    const config = {
      version: 1,
      profiles: {
        first: { extends: ["second"], gates: [] },
        second: { extends: ["first"], gates: [] },
      },
    } satisfies T3ProjectVerificationConfig;

    return VerificationConfig.resolveVerificationProfiles(config, "t3.json").pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => expect(error.message).toContain("first -> second -> first")),
      ),
    );
  });

  it.effect("rejects sensitive literal environment overrides", () => {
    const config = {
      version: 1,
      profiles: {
        fast: {
          gates: [
            {
              id: "lint",
              category: "lint",
              checks: [
                {
                  id: "lint",
                  name: "Lint",
                  command: { executable: "pnpm", args: ["lint"] },
                  environment: { API_TOKEN: { value: "do-not-store-this" } },
                },
              ],
            },
          ],
        },
      },
    } satisfies T3ProjectVerificationConfig;

    return VerificationConfig.resolveVerificationProfiles(config, "t3.json").pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => expect(error.message).toContain("must use fromEnvironment")),
      ),
    );
  });

  it.effect("rejects secret-looking command arguments", () => {
    const config = {
      version: 1,
      profiles: {
        fast: {
          gates: [
            {
              id: "custom",
              category: "custom",
              checks: [
                {
                  id: "unsafe-token",
                  name: "Unsafe token",
                  command: { executable: "tool", args: ["--api-token=do-not-store-this"] },
                },
              ],
            },
          ],
        },
      },
    } satisfies T3ProjectVerificationConfig;

    return VerificationConfig.resolveVerificationProfiles(config, "t3.json").pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("fromEnvironment"))),
    );
  });

  it.effect("rejects a disabled required blocking gate", () => {
    const config = {
      version: 1,
      profiles: {
        standard: {
          gates: [
            {
              id: "required-build",
              category: "build",
              enabled: false,
              required: true,
              failurePolicy: "block",
              checks: [
                {
                  id: "build",
                  name: "Build",
                  command: { executable: "pnpm", args: ["run", "build"] },
                },
              ],
            },
          ],
        },
      },
    } satisfies T3ProjectVerificationConfig;

    return VerificationConfig.resolveVerificationProfiles(config, "t3.json").pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => expect(error.message).toContain("cannot be both disabled and required")),
      ),
    );
  });
});
