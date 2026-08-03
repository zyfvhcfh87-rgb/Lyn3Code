import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ProjectScriptIcon } from "./orchestration.ts";
import {
  VerificationArtifactType,
  VerificationCategory,
  VerificationDiagnosticParser,
  VerificationExecutionMode,
  VerificationFailurePolicy,
  VerificationPlatform,
  VerificationTriggerMode,
} from "./verification.ts";

/** File name of the checked-in T3 project file, resolved at the workspace root. */
export const T3_PROJECT_FILE_NAME = "t3.json";

/** Public URL of the published JSON Schema for {@link T3ProjectFile}. */
export const T3_PROJECT_FILE_SCHEMA_URL = "https://t3.codes/schema/t3.json";

const T3_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const T3_PROJECT_FILE_MAX_SCRIPTS = 50;
const VERIFICATION_MAX_PROFILES = 20;
const VERIFICATION_MAX_GATES = 50;
const VERIFICATION_MAX_CHECKS_PER_GATE = 50;
const VERIFICATION_MAX_ARGUMENTS = 200;
const VERIFICATION_MAX_PATTERNS = 100;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const T3ProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the Lyn Code scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in a Lyn Code terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into Lyn Code.",
});
export type T3ProjectFileScript = typeof T3ProjectFileScript.Type;

const VerificationIdentifier = trimmedNonEmpty(
  { description: "Stable verification identifier." },
  100,
).check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/));

const VerificationRelativePath = trimmedNonEmpty(
  { description: "A repository-relative path. Runtime containment checks still apply." },
  T3_PROJECT_FILE_PATH_MAX_LENGTH,
);

const VerificationGlob = trimmedNonEmpty(
  { description: "A repository-relative glob used for applicability or artifact collection." },
  T3_PROJECT_FILE_PATH_MAX_LENGTH,
);

const VerificationEnvironmentVariableName = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(200),
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
);

export const T3ProjectVerificationCommand = Schema.Struct({
  executable: trimmedNonEmpty(
    {
      description:
        "Executable name or repository-relative executable path. Commands are spawned without a shell when possible.",
    },
    T3_PROJECT_FILE_PATH_MAX_LENGTH,
  ),
  args: Schema.optionalKey(
    Schema.Array(
      Schema.String.check(Schema.isMaxLength(8_192)).annotate({
        description: "One literal process argument. Arguments are not shell-interpolated.",
      }),
    ).check(Schema.isMaxLength(VERIFICATION_MAX_ARGUMENTS)),
  ),
}).annotate({
  description: "An argument-based process invocation.",
});
export type T3ProjectVerificationCommand = typeof T3ProjectVerificationCommand.Type;

export const T3ProjectVerificationEnvironmentValue = Schema.Union([
  Schema.Struct({
    value: Schema.String.check(Schema.isMaxLength(8_192)).annotate({
      description:
        "A non-secret literal value. Secret-looking literal overrides are rejected at load time.",
    }),
  }),
  Schema.Struct({
    fromEnvironment: VerificationEnvironmentVariableName.annotate({
      description: "Name of a host environment variable to reference at execution time.",
    }),
    sensitive: Schema.optionalKey(
      Schema.Boolean.annotate({
        description: "Whether the resolved value must be redacted from all verification evidence.",
      }),
    ),
  }),
]);
export type T3ProjectVerificationEnvironmentValue =
  typeof T3ProjectVerificationEnvironmentValue.Type;

export const T3ProjectVerificationCheckApplicability = Schema.Struct({
  mode: Schema.optionalKey(Schema.Literals(["always", "changed_files"])),
  include: Schema.optionalKey(
    Schema.Array(VerificationGlob).check(Schema.isMaxLength(VERIFICATION_MAX_PATTERNS)),
  ),
  exclude: Schema.optionalKey(
    Schema.Array(VerificationGlob).check(Schema.isMaxLength(VERIFICATION_MAX_PATTERNS)),
  ),
  allowRequiredSkip: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Explicitly permits a required check to be skipped when no changed file is applicable. Defaults to false.",
    }),
  ),
}).annotate({
  description: "Transparent changed-file applicability rules for a check.",
});
export type T3ProjectVerificationCheckApplicability =
  typeof T3ProjectVerificationCheckApplicability.Type;

export const T3ProjectVerificationArtifactRule = Schema.Struct({
  pattern: VerificationGlob,
  type: Schema.optionalKey(VerificationArtifactType),
  name: Schema.optionalKey(trimmedNonEmpty({ description: "Artifact display name." }, 200)),
  required: Schema.optionalKey(Schema.Boolean),
  maxBytes: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 * 1024 * 1024 })),
  ),
}).annotate({
  description: "A bounded artifact collection rule beneath the assigned worktree.",
});
export type T3ProjectVerificationArtifactRule = typeof T3ProjectVerificationArtifactRule.Type;

export const T3ProjectVerificationCheckDefinition = Schema.Struct({
  id: VerificationIdentifier,
  name: trimmedNonEmpty({ description: "Check display name." }, 200),
  command: T3ProjectVerificationCommand,
  workingDirectory: Schema.optionalKey(VerificationRelativePath),
  environment: Schema.optionalKey(
    Schema.Record(VerificationEnvironmentVariableName, T3ProjectVerificationEnvironmentValue),
  ),
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7_200 })),
  ),
  allowedExitCodes: Schema.optionalKey(
    Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(32),
    ),
  ),
  continueOnFailure: Schema.optionalKey(Schema.Boolean),
  applicability: Schema.optionalKey(T3ProjectVerificationCheckApplicability),
  platforms: Schema.optionalKey(
    Schema.Array(VerificationPlatform).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  ),
  artifacts: Schema.optionalKey(
    Schema.Array(T3ProjectVerificationArtifactRule).check(
      Schema.isMaxLength(VERIFICATION_MAX_PATTERNS),
    ),
  ),
  diagnosticParser: Schema.optionalKey(VerificationDiagnosticParser),
}).annotate({
  description: "One executable verification check. Runtime execution uses an immutable snapshot.",
});
export type T3ProjectVerificationCheckDefinition = typeof T3ProjectVerificationCheckDefinition.Type;

export const T3ProjectVerificationGateDefinition = Schema.Struct({
  id: VerificationIdentifier,
  name: Schema.optionalKey(trimmedNonEmpty({ description: "Gate display name." }, 200)),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  category: VerificationCategory,
  required: Schema.optionalKey(Schema.Boolean),
  enabled: Schema.optionalKey(Schema.Boolean),
  executionMode: Schema.optionalKey(VerificationExecutionMode),
  failurePolicy: Schema.optionalKey(VerificationFailurePolicy),
  checks: Schema.Array(T3ProjectVerificationCheckDefinition).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(VERIFICATION_MAX_CHECKS_PER_GATE),
  ),
}).annotate({
  description: "An ordered logical gate within a verification profile.",
});
export type T3ProjectVerificationGateDefinition = typeof T3ProjectVerificationGateDefinition.Type;

export const T3ProjectVerificationProfileDefinition = Schema.Struct({
  name: Schema.optionalKey(trimmedNonEmpty({ description: "Profile display name." }, 200)),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  extends: Schema.optionalKey(
    Schema.Array(VerificationIdentifier).check(Schema.isMaxLength(VERIFICATION_MAX_PROFILES)),
  ),
  triggers: Schema.optionalKey(
    Schema.Array(VerificationTriggerMode).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  ),
  gates: Schema.Array(T3ProjectVerificationGateDefinition).check(
    Schema.isMaxLength(VERIFICATION_MAX_GATES),
  ),
}).annotate({
  description:
    "A reusable ordered verification profile. Parent profiles are resolved deterministically.",
});
export type T3ProjectVerificationProfileDefinition =
  typeof T3ProjectVerificationProfileDefinition.Type;

export const T3ProjectVerificationConfig = Schema.Struct({
  version: Schema.Literal(1),
  defaultProfile: Schema.optionalKey(VerificationIdentifier),
  preIntegrationProfile: Schema.optionalKey(VerificationIdentifier),
  profiles: Schema.Record(VerificationIdentifier, T3ProjectVerificationProfileDefinition).check(
    Schema.isMaxProperties(VERIFICATION_MAX_PROFILES),
  ),
}).annotate({
  description:
    "Versioned repository-local verification configuration. It must be explicitly accepted before execution.",
});
export type T3ProjectVerificationConfig = typeof T3ProjectVerificationConfig.Type;

export const T3ProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${T3_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before Lyn Code\'s built-in icon locations.',
      },
      T3_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(T3ProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in Lyn Code.",
      })
      .check(Schema.isMaxLength(T3_PROJECT_FILE_MAX_SCRIPTS)),
  ),
  verification: Schema.optionalKey(T3ProjectVerificationConfig),
}).annotate({
  title: "T3 project file",
  description:
    "Checked-in project configuration for Lyn Code (t3.json at the repository root). See https://t3.codes for documentation.",
});
export type T3ProjectFile = typeof T3ProjectFile.Type;
