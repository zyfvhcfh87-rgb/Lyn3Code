import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type {
  T3ProjectVerificationEnvironmentValue,
  VerificationCheckDefinitionId,
  VerificationExecutionPlan,
  VerificationGateId,
  VerificationPlannedCheck,
  VerificationPlannedEnvironmentValue,
  VerificationPlannedGate,
  VerificationProfileId,
  VerificationSkippedCheck,
} from "@t3tools/contracts";

import type {
  DiscoveredVerificationConfig,
  ResolvedVerificationProfile,
} from "./VerificationConfig.ts";

export interface VerificationSourceState {
  readonly worktreeRoot: string;
  readonly branchName: string;
  readonly commitHash: string | null;
  readonly dirtyStateFingerprint: string | null;
  readonly sourceFingerprint: string;
}

export interface VerificationPlanEnvironment {
  readonly platform: "win32" | "darwin" | "linux";
  readonly architecture: string;
  readonly runtimeVersions: Readonly<Record<string, string>>;
  readonly continuousIntegration: boolean;
}

export type PlannedVerificationEnvironmentValue = VerificationPlannedEnvironmentValue;
export type PlannedVerificationCheck = VerificationPlannedCheck;
export type PlannedVerificationGate = VerificationPlannedGate;
export type SkippedVerificationCheck = VerificationSkippedCheck;
export type VerificationExecutionPlanSnapshot = VerificationExecutionPlan;

export interface VerificationPlanIdentities {
  readonly profileId: VerificationProfileId;
  readonly gateIds: Readonly<Record<string, VerificationGateId>>;
  readonly checkDefinitionIds: Readonly<
    Record<string, Readonly<Record<string, VerificationCheckDefinitionId>>>
  >;
}

export class VerificationPlanError extends Schema.TaggedErrorClass<VerificationPlanError>()(
  "VerificationPlanError",
  {
    reason: Schema.Literals([
      "not_configured",
      "configuration_not_accepted",
      "profile_not_found",
      "identity_not_found",
      "empty_required_gate",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Unable to create verification plan (${this.reason}): ${this.detail}`;
  }
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
};

const normalizeRepositoryPath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "");

const escapeRegex = (character: string): string =>
  /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;

const globToRegExp = (pattern: string): RegExp => {
  const normalized = normalizeRepositoryPath(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`${source}$`);
};

export const matchesVerificationGlob = (filePath: string, pattern: string): boolean =>
  globToRegExp(pattern).test(normalizeRepositoryPath(filePath));

const environmentSnapshot = (
  environment: Readonly<Record<string, T3ProjectVerificationEnvironmentValue>> | undefined,
): ReadonlyArray<PlannedVerificationEnvironmentValue> =>
  Object.entries(environment ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, configured]) =>
      "value" in configured
        ? {
            name,
            source: "literal" as const,
            value: configured.value,
            sensitive: false,
          }
        : {
            name,
            source: "host_environment" as const,
            fromEnvironment: configured.fromEnvironment,
            sensitive: configured.sensitive ?? true,
          },
    );

const checkApplicability = (
  check: ResolvedVerificationProfile["gates"][number]["checks"][number],
  gateRequired: boolean,
  changedFiles: ReadonlyArray<string>,
  platform: VerificationPlanEnvironment["platform"],
): {
  readonly selected: boolean;
  readonly reason: string;
  readonly explicitlyNotApplicable: boolean;
} => {
  if (check.platforms !== undefined && !check.platforms.includes(platform)) {
    return {
      selected: false,
      reason: `Configured for ${check.platforms.join(", ")}; current platform is ${platform}`,
      explicitlyNotApplicable: true,
    };
  }
  const applicability = check.applicability;
  if (applicability === undefined || (applicability.mode ?? "always") === "always") {
    return {
      selected: true,
      reason: "Configured to run for every source state",
      explicitlyNotApplicable: false,
    };
  }

  const relevant = changedFiles.filter(
    (filePath) =>
      !(applicability.exclude ?? []).some((pattern) => matchesVerificationGlob(filePath, pattern)),
  );
  const include = applicability.include ?? [];
  const matched =
    include.length === 0 ||
    relevant.some((filePath) =>
      include.some((pattern) => matchesVerificationGlob(filePath, pattern)),
    );
  if (matched) {
    return {
      selected: true,
      reason:
        include.length === 0
          ? "Changed-file rule has no narrowing include patterns"
          : `Changed file matched configured patterns: ${include.join(", ")}`,
      explicitlyNotApplicable: false,
    };
  }
  if (gateRequired && !(applicability.allowRequiredSkip ?? false)) {
    return {
      selected: true,
      reason:
        "No changed file matched, but this required check did not explicitly permit applicability skipping",
      explicitlyNotApplicable: false,
    };
  }
  return {
    selected: false,
    reason: "No changed file matched the configured applicability patterns",
    explicitlyNotApplicable: true,
  };
};

export const createVerificationExecutionPlan = (input: {
  readonly discovered: DiscoveredVerificationConfig;
  readonly profileKey: string;
  readonly identities: VerificationPlanIdentities;
  readonly source: VerificationSourceState;
  readonly changedFiles: ReadonlyArray<string>;
  readonly environment: VerificationPlanEnvironment;
  readonly createdAt?: string;
}): Effect.Effect<VerificationExecutionPlanSnapshot, VerificationPlanError> =>
  Effect.gen(function* () {
    if (input.discovered.config === null || input.discovered.revision === null) {
      return yield* new VerificationPlanError({
        reason: "not_configured",
        detail: "The repository has no accepted verification configuration.",
      });
    }
    if (input.discovered.trust !== "accepted") {
      return yield* new VerificationPlanError({
        reason: "configuration_not_accepted",
        detail: `Configuration revision ${input.discovered.revision} requires explicit acceptance.`,
      });
    }
    const profile = input.discovered.profiles[input.profileKey];
    if (profile === undefined) {
      return yield* new VerificationPlanError({
        reason: "profile_not_found",
        detail: `Profile ${input.profileKey} does not exist in the accepted configuration revision.`,
      });
    }

    const changedFiles = [...new Set(input.changedFiles.map(normalizeRepositoryPath))].sort();
    const skippedChecks: Array<SkippedVerificationCheck> = [];
    const gates: Array<PlannedVerificationGate> = [];
    for (const [gatePosition, gate] of profile.gates.entries()) {
      const gateId = input.identities.gateIds[gate.id];
      if (gateId === undefined) {
        return yield* new VerificationPlanError({
          reason: "identity_not_found",
          detail: `No persisted gate identity was provided for ${input.profileKey}/${gate.id}.`,
        });
      }
      const required = gate.required ?? true;
      const enabled = gate.enabled ?? true;
      const failurePolicy = gate.failurePolicy ?? "block";
      const checks: Array<PlannedVerificationCheck> = [];
      for (const [checkPosition, check] of gate.checks.entries()) {
        const checkDefinitionId = input.identities.checkDefinitionIds[gate.id]?.[check.id];
        if (checkDefinitionId === undefined) {
          return yield* new VerificationPlanError({
            reason: "identity_not_found",
            detail: `No persisted check identity was provided for ${input.profileKey}/${gate.id}/${check.id}.`,
          });
        }
        const applicability = enabled
          ? checkApplicability(check, required, changedFiles, input.environment.platform)
          : {
              selected: false,
              reason: "Gate is explicitly disabled in repository configuration",
              explicitlyNotApplicable: true,
            };
        if (!applicability.selected) {
          skippedChecks.push({
            checkDefinitionId,
            gateId,
            name: check.name,
            reason: applicability.reason,
            required,
            explicitlyNotApplicable: applicability.explicitlyNotApplicable,
            selectionSource: "explicit_configuration",
          });
          continue;
        }
        checks.push({
          checkDefinitionId,
          gateId,
          name: check.name,
          command: check.command.executable,
          arguments: [...(check.command.args ?? [])],
          requiresShell: false,
          workingDirectory: check.workingDirectory ?? ".",
          environment: environmentSnapshot(check.environment),
          timeoutSeconds: check.timeoutSeconds ?? 300,
          allowedExitCodes: [...(check.allowedExitCodes ?? [0])],
          continueOnFailure: check.continueOnFailure ?? false,
          artifacts: (check.artifacts ?? []).map((artifact) => ({
            pattern: artifact.pattern,
            type: artifact.type ?? "custom",
            ...(artifact.name === undefined ? {} : { name: artifact.name }),
            required: artifact.required ?? false,
            ...(artifact.maxBytes === undefined ? {} : { maxBytes: artifact.maxBytes }),
          })),
          diagnosticParser: check.diagnosticParser ?? "none",
          selectionReason: applicability.reason,
          selectionSource: "explicit_configuration",
          required,
          failurePolicy,
          position: checkPosition,
        });
      }
      if (enabled && required && checks.length === 0) {
        const everySkipWasExplicit = skippedChecks
          .filter((check) => check.gateId === gateId)
          .every((check) => check.explicitlyNotApplicable);
        if (!everySkipWasExplicit) {
          return yield* new VerificationPlanError({
            reason: "empty_required_gate",
            detail: `Required gate ${gate.id} has no executable checks for this source state.`,
          });
        }
      }
      gates.push({
        gateId,
        name: gate.name ?? gate.id,
        description: gate.description ?? "",
        category: gate.category,
        position: gatePosition,
        required,
        executionMode: gate.executionMode ?? "sequential",
        failurePolicy,
        checks,
      });
    }

    return deepFreeze({
      version: 1,
      profileId: input.identities.profileId,
      profileName: profile.name,
      configurationRevision: input.discovered.revision,
      configurationDigest: input.discovered.revision,
      configurationPath: input.discovered.configPath,
      source: { ...input.source },
      changedFiles,
      environment: {
        ...input.environment,
        runtimeVersions: { ...input.environment.runtimeVersions },
      },
      gates,
      skippedChecks,
      createdAt: input.createdAt ?? DateTime.formatIso(yield* DateTime.now),
    } satisfies VerificationExecutionPlanSnapshot);
  });

export class VerificationPlanner extends Context.Service<
  VerificationPlanner,
  {
    readonly createPlan: typeof createVerificationExecutionPlan;
  }
>()("t3/verification/VerificationPlan/VerificationPlanner") {}

export const layer = Layer.succeed(
  VerificationPlanner,
  VerificationPlanner.of({ createPlan: createVerificationExecutionPlan }),
);
