import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type T3ProjectVerificationConfig,
  VerificationCheckDefinitionId,
  VerificationExecutionPlan,
  VerificationGateId,
  VerificationProfileId,
} from "@t3tools/contracts";

import {
  type DiscoveredVerificationConfig,
  resolveVerificationProfiles,
} from "./VerificationConfig.ts";
import { createVerificationExecutionPlan, matchesVerificationGlob } from "./VerificationPlan.ts";

const config = {
  version: 1,
  profiles: {
    standard: {
      gates: [
        {
          id: "types",
          category: "typecheck",
          checks: [
            {
              id: "web-types",
              name: "Web typecheck",
              command: { executable: "pnpm", args: ["run", "typecheck:web"] },
              applicability: {
                mode: "changed_files",
                include: ["apps/web/**"],
              },
            },
          ],
        },
        {
          id: "server-tests",
          category: "unit_test",
          required: false,
          checks: [
            {
              id: "server-tests",
              name: "Server tests",
              command: { executable: "pnpm", args: ["test:server"] },
              applicability: {
                mode: "changed_files",
                include: ["apps/server/**"],
              },
            },
          ],
        },
      ],
    },
  },
} satisfies T3ProjectVerificationConfig;

const discovered = resolveVerificationProfiles(config, "t3.json").pipe(
  Effect.map(
    (profiles): DiscoveredVerificationConfig => ({
      source: "repository",
      configPath: "t3.json",
      revision: "a".repeat(64),
      trust: "accepted",
      config,
      profiles,
      suggestions: [],
    }),
  ),
);

const PlanJson = Schema.fromJsonString(VerificationExecutionPlan);
const encodePlanJson = Schema.encodeEffect(PlanJson);
const decodePlanJson = Schema.decodeEffect(PlanJson);

const identities = {
  profileId: Schema.decodeUnknownSync(VerificationProfileId)("verification-profile:standard"),
  gateIds: {
    types: Schema.decodeUnknownSync(VerificationGateId)("verification-gate:types"),
    "server-tests": Schema.decodeUnknownSync(VerificationGateId)("verification-gate:server-tests"),
  },
  checkDefinitionIds: {
    types: {
      "web-types": Schema.decodeUnknownSync(VerificationCheckDefinitionId)(
        "verification-check:web-types",
      ),
    },
    "server-tests": {
      "server-tests": Schema.decodeUnknownSync(VerificationCheckDefinitionId)(
        "verification-check:server-tests",
      ),
    },
  },
};

const plan = (changedFiles: ReadonlyArray<string>) =>
  discovered.pipe(
    Effect.flatMap((resolved) =>
      createVerificationExecutionPlan({
        discovered: resolved,
        profileKey: "standard",
        identities,
        source: {
          worktreeRoot: "/repo",
          branchName: "agent/task",
          commitHash: "abc123",
          dirtyStateFingerprint: null,
          sourceFingerprint: "fingerprint",
        },
        changedFiles,
        environment: {
          platform: "linux",
          architecture: "x64",
          runtimeVersions: { node: "24" },
          continuousIntegration: false,
        },
        createdAt: "2026-08-03T12:00:00.000Z",
      }),
    ),
  );

describe("VerificationPlanner", () => {
  it.effect("keeps required checks broad and explains optional skips", () =>
    Effect.gen(function* () {
      const result = yield* plan(["docs/phase-3.md"]);

      expect(result.gates[0]?.checks[0]?.selectionReason).toContain(
        "required check did not explicitly permit",
      );
      expect(result.gates[1]?.checks).toEqual([]);
      expect(result.skippedChecks).toEqual([
        expect.objectContaining({
          checkDefinitionId: "verification-check:server-tests",
          reason: "No changed file matched the configured applicability patterns",
          explicitlyNotApplicable: true,
        }),
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.gates)).toBe(true);
    }),
  );

  it.effect("selects checks whose configured changed-file patterns match", () =>
    Effect.gen(function* () {
      const result = yield* plan(["apps/server/src/index.ts"]);
      expect(result.gates[1]?.checks[0]?.checkDefinitionId).toBe("verification-check:server-tests");
      expect(result.gates[1]?.checks[0]?.selectionReason).toContain("apps/server/**");
    }),
  );

  it.effect("refuses to execute an unaccepted configuration revision", () =>
    discovered.pipe(
      Effect.flatMap((resolved) =>
        createVerificationExecutionPlan({
          discovered: { ...resolved, trust: "requires_acceptance" },
          profileKey: "standard",
          identities,
          source: {
            worktreeRoot: "/repo",
            branchName: "agent/task",
            commitHash: "abc123",
            dirtyStateFingerprint: null,
            sourceFingerprint: "fingerprint",
          },
          changedFiles: [],
          environment: {
            platform: "linux",
            architecture: "x64",
            runtimeVersions: {},
            continuousIntegration: false,
          },
          createdAt: "2026-08-03T12:00:00.000Z",
        }),
      ),
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() =>
          expect(error).toMatchObject({
            _tag: "VerificationPlanError",
            reason: "configuration_not_accepted",
          }),
        ),
      ),
    ),
  );

  it.effect("round-trips the immutable persisted plan without consulting later config", () =>
    Effect.gen(function* () {
      const original = yield* plan(["apps/web/src/App.tsx"]);
      const persisted = yield* encodePlanJson(original);

      const laterConfig = structuredClone(config);
      laterConfig.profiles.standard.gates[0]!.checks[0]!.command = {
        executable: "pnpm",
        args: ["run", "different-command"],
      };

      const restored = yield* decodePlanJson(persisted);
      expect(restored).toEqual(original);
      expect(restored.gates[0]?.checks[0]?.command).toBe("pnpm");
      expect(restored.gates[0]?.checks[0]?.arguments).toEqual(["run", "typecheck:web"]);
      expect(restored.configurationDigest).toBe(original.configurationDigest);
      expect(laterConfig.profiles.standard.gates[0]?.checks[0]?.command.args).toEqual([
        "run",
        "different-command",
      ]);
    }),
  );
});

describe("matchesVerificationGlob", () => {
  it("normalizes Windows separators and handles globstar", () => {
    expect(matchesVerificationGlob("apps\\web\\src\\App.tsx", "apps/web/**")).toBe(true);
    expect(matchesVerificationGlob("apps/server/index.ts", "apps/web/**")).toBe(false);
  });
});
