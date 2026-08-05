import * as Effect from "effect/Effect";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import {
  buildVerificationProcessEnvironment,
  VerificationProcessRunner,
  type VerificationProcessError,
} from "../verification/VerificationProcessRunner.ts";
import { makeVerificationChunkRedactor } from "../verification/VerificationRedaction.ts";
import type { PlannedVerificationEnvironmentValue } from "../verification/VerificationPlan.ts";
import {
  DeploymentAdapterError,
  type DeploymentAdapter,
  type DeploymentExecutionResult,
  type DeploymentLogEntry,
} from "./DeploymentAdapter.ts";

export const REPOSITORY_SCRIPT_PROVIDER_KIND = "repository_script";
export const REPOSITORY_SCRIPT_STRATEGIES = ["provider_default", "standard"] as const;

export interface RepositoryScriptDeploymentConfiguration {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly workingDirectory: string;
  readonly timeoutSeconds: number;
  readonly maximumLogBytes?: number;
  readonly environment?: ReadonlyArray<PlannedVerificationEnvironmentValue>;
}

const DEFAULT_MAXIMUM_LOG_BYTES = 1024 * 1024;
const SECRET_ENVIRONMENT_NAME =
  /(?:^|_)(?:API_?(?:KEY|TOKEN)|ACCESS_?TOKEN|AUTH_?TOKEN|TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_?KEY)(?:$|_)/i;

const adapterError = (
  reason: DeploymentAdapterError["reason"],
  detail: string,
  cause?: unknown,
): DeploymentAdapterError =>
  new DeploymentAdapterError({
    reason,
    providerKind: REPOSITORY_SCRIPT_PROVIDER_KIND,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

const mapProcessError = (cause: VerificationProcessError): DeploymentAdapterError =>
  adapterError("execution_failed", cause.message, cause);

const validateConfiguration = (
  configuration: RepositoryScriptDeploymentConfiguration,
): DeploymentAdapterError | null => {
  if (configuration.executable.trim().length === 0 || configuration.executable.includes("\0")) {
    return adapterError(
      "invalid_configuration",
      "Executable must be a fixed non-empty path or name.",
    );
  }
  if (
    configuration.args.some((argument) => typeof argument !== "string" || argument.includes("\0"))
  ) {
    return adapterError(
      "invalid_configuration",
      "Arguments must be fixed strings without NUL bytes.",
    );
  }
  if (configuration.workingDirectory.trim().length === 0) {
    return adapterError("invalid_configuration", "Working directory must be fixed and non-empty.");
  }
  if (
    !Number.isSafeInteger(configuration.timeoutSeconds) ||
    configuration.timeoutSeconds < 1 ||
    configuration.timeoutSeconds > 60 * 60
  ) {
    return adapterError("invalid_configuration", "Timeout must be between 1 and 3600 seconds.");
  }
  const maximumLogBytes = configuration.maximumLogBytes ?? DEFAULT_MAXIMUM_LOG_BYTES;
  if (
    !Number.isSafeInteger(maximumLogBytes) ||
    maximumLogBytes < 1 ||
    maximumLogBytes > 8 * 1024 * 1024
  ) {
    return adapterError("invalid_configuration", "Log limit must be between 1 byte and 8 MiB.");
  }
  if (
    (configuration.environment ?? []).some(
      (entry) =>
        entry.source === "literal" && (entry.sensitive || SECRET_ENVIRONMENT_NAME.test(entry.name)),
    )
  ) {
    return adapterError(
      "invalid_configuration",
      "Sensitive deployment values must be resolved from explicit host environment references.",
    );
  }
  return null;
};

const makeBoundedLog = (maximumBytes: number) => {
  const entries: Array<DeploymentLogEntry> = [];
  let usedBytes = 0;
  let truncated = false;

  const append = (entry: DeploymentLogEntry): DeploymentLogEntry | null => {
    if (truncated) return null;
    const encoded = Buffer.from(entry.text, "utf8");
    const remaining = maximumBytes - usedBytes;
    if (encoded.byteLength <= remaining) {
      entries.push(entry);
      usedBytes += encoded.byteLength;
      return entry;
    }
    truncated = true;
    if (remaining <= 0) return null;
    const bounded = { ...entry, text: encoded.subarray(0, remaining).toString("utf8") };
    entries.push(bounded);
    usedBytes = maximumBytes;
    return bounded;
  };

  return {
    append,
    entries,
    get logText(): string {
      return entries.map((entry) => entry.text).join("");
    },
    get truncated(): boolean {
      return truncated;
    },
  };
};

export const makeRepositoryScriptDeploymentAdapter = Effect.fn(
  "makeRepositoryScriptDeploymentAdapter",
)(function* (
  configuration: RepositoryScriptDeploymentConfiguration,
): Effect.fn.Return<DeploymentAdapter, DeploymentAdapterError, VerificationProcessRunner> {
  const invalid = validateConfiguration(configuration);
  if (invalid !== null) return yield* invalid;
  const runner = yield* VerificationProcessRunner;
  const platform = yield* HostProcessPlatform;
  const executable = configuration.executable;
  const args = Object.freeze([...configuration.args]);
  const environmentConfiguration = Object.freeze([...(configuration.environment ?? [])]);
  const maximumLogBytes = configuration.maximumLogBytes ?? DEFAULT_MAXIMUM_LOG_BYTES;

  const start: DeploymentAdapter["start"] = Effect.fn("RepositoryScriptDeploymentAdapter.start")(
    function* (input) {
      if (
        !REPOSITORY_SCRIPT_STRATEGIES.includes(
          input.strategy as (typeof REPOSITORY_SCRIPT_STRATEGIES)[number],
        )
      ) {
        return yield* adapterError(
          "unsupported_strategy",
          `Repository scripts do not support ${input.strategy}.`,
        );
      }
      if (
        !/^[a-f0-9]{64}$/i.test(input.sourceFingerprint) ||
        !/^[a-f0-9]{7,64}$/i.test(input.sourceCommitSha)
      ) {
        return yield* adapterError(
          "invalid_configuration",
          "Deployment execution requires immutable source fingerprint and commit evidence.",
        );
      }
      const builtEnvironment = yield* buildVerificationProcessEnvironment({
        hostEnvironment: input.hostEnvironment,
        configured: environmentConfiguration,
        managedHome: input.managedHome,
        managedTemp: input.managedTemp,
        platform,
      }).pipe(Effect.mapError(mapProcessError));
      const redactor = makeVerificationChunkRedactor(builtEnvironment.secrets);
      const log = makeBoundedLog(maximumLogBytes);
      let lastObservedAt = "";

      const publish = (entry: DeploymentLogEntry): Effect.Effect<void> => {
        const bounded = log.append(entry);
        return bounded === null || input.onLog === undefined ? Effect.void : input.onLog(bounded);
      };

      const result = yield* runner
        .run({
          executionId: input.executionId,
          executable,
          args,
          cwd: configuration.workingDirectory,
          environment: builtEnvironment.environment,
          timeoutSeconds: configuration.timeoutSeconds,
          onOutput: (chunk) => {
            lastObservedAt = chunk.observedAt;
            return Effect.forEach(redactor.push(chunk.stream, chunk.text), (text) =>
              publish({
                sequence: chunk.sequence,
                observedAt: chunk.observedAt,
                stream: chunk.stream,
                text,
              }),
            ).pipe(Effect.asVoid);
          },
        })
        .pipe(Effect.mapError(mapProcessError));
      for (const buffered of redactor.flush()) {
        yield* publish({
          sequence: Number.MAX_SAFE_INTEGER,
          observedAt: lastObservedAt,
          stream: buffered.stream,
          text: buffered.text,
        });
      }
      const status: DeploymentExecutionResult["status"] = result.cancelled
        ? "cancelled"
        : result.timedOut
          ? "timed_out"
          : result.exitCode === 0
            ? "succeeded"
            : "failed";
      return {
        deploymentId: input.deploymentId,
        executionId: input.executionId,
        providerKind: REPOSITORY_SCRIPT_PROVIDER_KIND,
        status,
        providerDeploymentId: null,
        sourceFingerprint: input.sourceFingerprint.toLowerCase(),
        sourceCommitSha: input.sourceCommitSha.toLowerCase(),
        exitCode: result.exitCode,
        logText: log.logText,
        logTruncated: log.truncated,
      };
    },
  );

  const cancel: NonNullable<DeploymentAdapter["cancel"]> = Effect.fn(
    "RepositoryScriptDeploymentAdapter.cancel",
  )(function* (input) {
    return yield* runner.cancel(input.executionId).pipe(Effect.mapError(mapProcessError));
  });

  return {
    providerKind: REPOSITORY_SCRIPT_PROVIDER_KIND,
    capabilities: {
      strategies: REPOSITORY_SCRIPT_STRATEGIES,
      inspect: false,
      cancel: true,
      rollback: false,
      idempotentStart: false,
      idempotentRollback: false,
    },
    start,
    cancel,
  };
});
