import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  T3_PROJECT_FILE_NAME,
  type T3ProjectVerificationConfig,
  type T3ProjectVerificationGateDefinition,
  type T3ProjectVerificationProfileDefinition,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";

const MAX_PROFILES = 20;
const SECRET_NAME =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)(?:$|_)/i;
const SECRET_COMMAND_ARGUMENT =
  /^(?:--?|\/)(?:api[-_]?key|api[-_]?token|access[-_]?token|auth[-_]?token|token|password|passwd|secret|private[-_]?key|credential)(?:=|:|$)/i;
const SECRET_URL_PARAMETER =
  /[?&](?:api[-_]?key|api[-_]?token|access[-_]?token|auth[-_]?token|token|password|secret)=/i;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const PATH_SEPARATOR = /[\\/]+/;

const PackageJson = Schema.Struct({
  packageManager: Schema.optionalKey(Schema.String),
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const PackageJsonFromJson = fromLenientJson(PackageJson);
const decodeT3ProjectFile = Schema.decodeEffect(T3ProjectFileFromJson);
const decodePackageJson = Schema.decodeEffect(PackageJsonFromJson);

export type VerificationConfigTrust = "accepted" | "requires_acceptance" | "not_configured";

export interface VerificationCommandSuggestion {
  readonly id: string;
  readonly category: "format" | "lint" | "typecheck" | "unit_test" | "build";
  readonly command: {
    readonly executable: string;
    readonly args: ReadonlyArray<string>;
  };
  readonly reason: string;
  readonly trusted: false;
}

export interface ResolvedVerificationProfile {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly triggers: ReadonlyArray<
    "manual" | "on_task_completion" | "before_integration" | "after_integration"
  >;
  readonly gates: ReadonlyArray<T3ProjectVerificationGateDefinition>;
}

export interface DiscoveredVerificationConfig {
  readonly source: "repository" | "none";
  readonly configPath: string;
  readonly revision: string | null;
  readonly trust: VerificationConfigTrust;
  readonly config: T3ProjectVerificationConfig | null;
  readonly profiles: Readonly<Record<string, ResolvedVerificationProfile>>;
  readonly suggestions: ReadonlyArray<VerificationCommandSuggestion>;
}

export class VerificationConfigurationError extends Schema.TaggedErrorClass<VerificationConfigurationError>()(
  "VerificationConfigurationError",
  {
    operation: Schema.Literals(["read", "decode", "validate", "hash"]),
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Verification configuration ${this.operation} failed at ${this.configPath}: ${this.detail}`;
  }
}

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJsonValue(child)]),
    );
  }
  return value;
};

export const stableVerificationConfigJson = (config: T3ProjectVerificationConfig): string =>
  JSON.stringify(stableJsonValue(config));

const hasTraversal = (value: string): boolean =>
  value.split(PATH_SEPARATOR).some((segment) => segment === "..");

const isAbsolute = (value: string): boolean =>
  value.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(value);

const validateRelativeValue = (
  value: string,
  label: string,
  configPath: string,
): Effect.Effect<void, VerificationConfigurationError> =>
  isAbsolute(value) || hasTraversal(value)
    ? Effect.fail(
        new VerificationConfigurationError({
          operation: "validate",
          configPath,
          detail: `${label} must remain beneath the assigned worktree: ${JSON.stringify(value)}`,
        }),
      )
    : Effect.void;

const validateArtifactPattern = (
  pattern: string,
  configPath: string,
): Effect.Effect<void, VerificationConfigurationError> => {
  if (pattern === "*" || pattern === "**" || pattern === "**/*" || pattern === ".") {
    return Effect.fail(
      new VerificationConfigurationError({
        operation: "validate",
        configPath,
        detail: `Artifact pattern ${JSON.stringify(pattern)} is too broad. Select a bounded output path.`,
      }),
    );
  }
  return validateRelativeValue(pattern, "Artifact pattern", configPath);
};

const validateGate = (
  profileId: string,
  gate: T3ProjectVerificationGateDefinition,
  configPath: string,
): Effect.Effect<void, VerificationConfigurationError> =>
  Effect.gen(function* () {
    if (
      gate.enabled === false &&
      (gate.required ?? true) &&
      (gate.failurePolicy ?? "block") === "block"
    ) {
      return yield* new VerificationConfigurationError({
        operation: "validate",
        configPath,
        detail: `Profile ${profileId} gate ${gate.id} cannot be both disabled and required with a blocking failure policy.`,
      });
    }
    const checkIds = new Set<string>();
    for (const check of gate.checks) {
      if (checkIds.has(check.id)) {
        return yield* new VerificationConfigurationError({
          operation: "validate",
          configPath,
          detail: `Profile ${profileId} gate ${gate.id} repeats check id ${check.id}.`,
        });
      }
      checkIds.add(check.id);
      yield* validateRelativeValue(
        check.workingDirectory ?? ".",
        `Working directory for ${profileId}/${gate.id}/${check.id}`,
        configPath,
      );
      if (check.command.executable.includes("/") || check.command.executable.includes("\\")) {
        yield* validateRelativeValue(
          check.command.executable,
          `Executable for ${profileId}/${gate.id}/${check.id}`,
          configPath,
        );
      }
      const secretArgument = (check.command.args ?? []).find(
        (argument) => SECRET_COMMAND_ARGUMENT.test(argument) || SECRET_URL_PARAMETER.test(argument),
      );
      if (secretArgument !== undefined) {
        return yield* new VerificationConfigurationError({
          operation: "validate",
          configPath,
          detail:
            "A command argument looks sensitive and was not included in this diagnostic. Pass secrets through a sensitive fromEnvironment reference instead.",
        });
      }
      for (const [name, configured] of Object.entries(check.environment ?? {})) {
        if ("value" in configured && SECRET_NAME.test(name)) {
          return yield* new VerificationConfigurationError({
            operation: "validate",
            configPath,
            detail: `Environment override ${name} looks sensitive and must use fromEnvironment instead of a literal value.`,
          });
        }
      }
      for (const artifact of check.artifacts ?? []) {
        yield* validateArtifactPattern(artifact.pattern, configPath);
      }
      for (const pattern of [
        ...(check.applicability?.include ?? []),
        ...(check.applicability?.exclude ?? []),
      ]) {
        yield* validateRelativeValue(pattern, "Applicability pattern", configPath);
      }
    }
  });

export const resolveVerificationProfiles = (
  config: T3ProjectVerificationConfig,
  configPath: string,
): Effect.Effect<
  Readonly<Record<string, ResolvedVerificationProfile>>,
  VerificationConfigurationError
> =>
  Effect.gen(function* () {
    const entries = Object.entries(config.profiles);
    if (entries.length === 0) {
      return yield* new VerificationConfigurationError({
        operation: "validate",
        configPath,
        detail: "At least one verification profile is required.",
      });
    }
    if (entries.length > MAX_PROFILES) {
      return yield* new VerificationConfigurationError({
        operation: "validate",
        configPath,
        detail: `At most ${MAX_PROFILES} verification profiles are allowed.`,
      });
    }
    for (const reference of [config.defaultProfile, config.preIntegrationProfile]) {
      if (reference !== undefined && config.profiles[reference] === undefined) {
        return yield* new VerificationConfigurationError({
          operation: "validate",
          configPath,
          detail: `Unknown profile reference: ${reference}.`,
        });
      }
    }

    const resolved = new Map<string, ResolvedVerificationProfile>();
    const visiting: Array<string> = [];

    const visit: (
      profileId: string,
    ) => Effect.Effect<ResolvedVerificationProfile, VerificationConfigurationError> = Effect.fn(
      "VerificationConfig.resolveProfile",
    )(function* (
      profileId: string,
    ): Effect.fn.Return<ResolvedVerificationProfile, VerificationConfigurationError> {
      const cached = resolved.get(profileId);
      if (cached !== undefined) {
        return cached;
      }
      const cycleStart = visiting.indexOf(profileId);
      if (cycleStart >= 0) {
        return yield* new VerificationConfigurationError({
          operation: "validate",
          configPath,
          detail: `Verification profile inheritance cycle: ${[
            ...visiting.slice(cycleStart),
            profileId,
          ].join(" -> ")}.`,
        });
      }
      const profile: T3ProjectVerificationProfileDefinition | undefined =
        config.profiles[profileId];
      if (profile === undefined) {
        return yield* new VerificationConfigurationError({
          operation: "validate",
          configPath,
          detail: `Profile ${visiting.at(-1) ?? profileId} extends unknown profile ${profileId}.`,
        });
      }

      visiting.push(profileId);
      const inherited: Array<T3ProjectVerificationGateDefinition> = [];
      for (const parentId of profile.extends ?? []) {
        const parent = yield* visit(parentId);
        inherited.push(...parent.gates);
      }
      visiting.pop();

      const gates = [...inherited, ...profile.gates];
      const gateIds = new Set<string>();
      for (const gate of gates) {
        if (gateIds.has(gate.id)) {
          return yield* new VerificationConfigurationError({
            operation: "validate",
            configPath,
            detail: `Resolved profile ${profileId} repeats gate id ${gate.id}.`,
          });
        }
        gateIds.add(gate.id);
        yield* validateGate(profileId, gate, configPath);
      }
      const result: ResolvedVerificationProfile = {
        id: profileId,
        name: profile.name ?? profileId,
        ...(profile.description === undefined ? {} : { description: profile.description }),
        triggers: profile.triggers ?? ["manual"],
        gates,
      };
      resolved.set(profileId, result);
      return result;
    });

    for (const [profileId] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      yield* visit(profileId);
    }
    return Object.fromEntries(resolved);
  });

const packageManagerCommand = (
  manager: string,
  script: string,
): VerificationCommandSuggestion["command"] => {
  switch (manager) {
    case "npm":
      return { executable: "npm", args: ["run", script] };
    case "yarn":
      return { executable: "yarn", args: ["run", script] };
    case "bun":
      return { executable: "bun", args: ["run", script] };
    default:
      return { executable: "pnpm", args: ["run", script] };
  }
};

const inferPackageManager = Effect.fn("VerificationConfig.inferPackageManager")(function* (
  workspaceRoot: string,
  declared: string | undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const declaredName = declared?.split("@", 1)[0];
  if (
    declaredName === "npm" ||
    declaredName === "yarn" ||
    declaredName === "bun" ||
    declaredName === "pnpm"
  ) {
    return declaredName;
  }
  const candidates = [
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const;
  for (const [lockfile, manager] of candidates) {
    if (
      yield* fileSystem
        .exists(path.join(workspaceRoot, lockfile))
        .pipe(Effect.orElseSucceed(() => false))
    ) {
      return manager;
    }
  }
  return "npm";
});

const inferSuggestions = Effect.fn("VerificationConfig.inferSuggestions")(function* (
  workspaceRoot: string,
): Effect.fn.Return<
  ReadonlyArray<VerificationCommandSuggestion>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const raw = yield* fileSystem.readFileString(packageJsonPath).pipe(Effect.option);
  if (raw._tag === "None") {
    return [];
  }
  const decoded = yield* decodePackageJson(raw.value).pipe(Effect.option);
  if (decoded._tag === "None") {
    return [];
  }
  const manager = yield* inferPackageManager(workspaceRoot, decoded.value.packageManager);
  const mappings = [
    ["format", "format"],
    ["lint", "lint"],
    ["typecheck", "typecheck"],
    ["test", "unit_test"],
    ["build", "build"],
  ] as const;
  return mappings.flatMap(([script, category]) =>
    decoded.value.scripts?.[script] === undefined
      ? []
      : [
          {
            id: script,
            category,
            command: packageManagerCommand(manager, script),
            reason: `package.json defines the ${script} script`,
            trusted: false,
          } satisfies VerificationCommandSuggestion,
        ],
  );
});

export class VerificationConfigService extends Context.Service<
  VerificationConfigService,
  {
    readonly discover: (input: {
      readonly workspaceRoot: string;
      readonly acceptedRevision?: string;
    }) => Effect.Effect<DiscoveredVerificationConfig, VerificationConfigurationError>;
    readonly resolveProfile: (
      config: T3ProjectVerificationConfig,
      profileId: string,
      configPath?: string,
    ) => Effect.Effect<ResolvedVerificationProfile, VerificationConfigurationError>;
  }
>()("t3/verification/VerificationConfig/VerificationConfigService") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const discoverSuggestions = (workspaceRoot: string) =>
    inferSuggestions(workspaceRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const discover: VerificationConfigService["Service"]["discover"] = Effect.fn(
    "VerificationConfigService.discover",
  )(function* (input) {
    const configPath = path.join(input.workspaceRoot, T3_PROJECT_FILE_NAME);
    const raw = yield* fileSystem.readFileString(configPath).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationConfigurationError({
            operation: "read",
            configPath,
            detail: `Unable to read ${T3_PROJECT_FILE_NAME}.`,
            cause,
          }),
      ),
      Effect.catchTag("VerificationConfigurationError", (error) =>
        fileSystem.exists(configPath).pipe(
          Effect.orElseSucceed(() => true),
          Effect.flatMap((exists) => (exists ? Effect.fail(error) : Effect.succeed(null))),
        ),
      ),
    );
    if (raw === null) {
      return {
        source: "none",
        configPath,
        revision: null,
        trust: "not_configured",
        config: null,
        profiles: {},
        suggestions: yield* discoverSuggestions(input.workspaceRoot),
      } satisfies DiscoveredVerificationConfig;
    }
    const projectFile = yield* decodeT3ProjectFile(raw).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationConfigurationError({
            operation: "decode",
            configPath,
            detail:
              "The repository project file is malformed or does not match the supported schema.",
            cause,
          }),
      ),
    );
    if (projectFile.verification === undefined) {
      return {
        source: "none",
        configPath,
        revision: null,
        trust: "not_configured",
        config: null,
        profiles: {},
        suggestions: yield* discoverSuggestions(input.workspaceRoot),
      } satisfies DiscoveredVerificationConfig;
    }
    const profiles = yield* resolveVerificationProfiles(projectFile.verification, configPath);
    const revision = yield* crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(stableVerificationConfigJson(projectFile.verification)),
      )
      .pipe(
        Effect.map(Encoding.encodeHex),
        Effect.mapError(
          (cause) =>
            new VerificationConfigurationError({
              operation: "hash",
              configPath,
              detail: "Unable to calculate the verification configuration revision.",
              cause,
            }),
        ),
      );
    return {
      source: "repository",
      configPath,
      revision,
      trust: input.acceptedRevision === revision ? "accepted" : "requires_acceptance",
      config: projectFile.verification,
      profiles,
      suggestions: [],
    } satisfies DiscoveredVerificationConfig;
  });

  const resolveProfile: VerificationConfigService["Service"]["resolveProfile"] = Effect.fn(
    "VerificationConfigService.resolveProfile",
  )(function* (config, profileId, configPath = T3_PROJECT_FILE_NAME) {
    const profiles = yield* resolveVerificationProfiles(config, configPath);
    const profile = profiles[profileId];
    if (profile === undefined) {
      return yield* new VerificationConfigurationError({
        operation: "validate",
        configPath,
        detail: `Unknown verification profile: ${profileId}.`,
      });
    }
    return profile;
  });

  return VerificationConfigService.of({ discover, resolveProfile });
});

export const layer = Layer.effect(VerificationConfigService, make);
