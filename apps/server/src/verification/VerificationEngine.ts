import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { VerificationFailureCategory } from "@t3tools/contracts";

import * as ArtifactCollector from "./VerificationArtifactCollector.ts";
import type { CollectedVerificationArtifact } from "./VerificationArtifactCollector.ts";
import {
  parseVerificationDiagnostics,
  type ParsedVerificationDiagnostic,
} from "./VerificationDiagnostics.ts";
import * as LogStore from "./VerificationLogStore.ts";
import type { VerificationLogRecord } from "./VerificationLogStore.ts";
import * as PathGuard from "./VerificationPathGuard.ts";
import type { AuthorizedVerificationWorktree } from "./VerificationPathGuard.ts";
import type {
  PlannedVerificationCheck,
  PlannedVerificationGate,
  VerificationExecutionPlanSnapshot,
} from "./VerificationPlan.ts";
import * as ProcessRunner from "./VerificationProcessRunner.ts";
import type { VerificationProcessResult } from "./VerificationProcessRunner.ts";
import * as SourceCapture from "./VerificationSourceCapture.ts";
import type { CapturedVerificationSource } from "./VerificationSourceCapture.ts";

const DIAGNOSTIC_CAPTURE_LIMIT = 2 * 1024 * 1024;

export type VerificationEngineProgress =
  | {
      readonly _tag: "check_started";
      readonly runId: string;
      readonly gateId: string;
      readonly checkId: string;
      readonly executionId: string;
      readonly logReference: string;
    }
  | {
      readonly _tag: "output";
      readonly runId: string;
      readonly gateId: string;
      readonly checkId: string;
      readonly records: ReadonlyArray<VerificationLogRecord>;
    }
  | {
      readonly _tag: "check_completed";
      readonly runId: string;
      readonly gateId: string;
      readonly checkId: string;
      readonly status: ExecutedVerificationCheck["status"];
      readonly failureCategory: VerificationFailureCategory | null;
    };

export interface ExecutedVerificationCheck {
  readonly checkId: string;
  readonly gateId: string;
  readonly name: string;
  readonly status: "passed" | "warned" | "failed" | "cancelled" | "skipped";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMilliseconds: number | null;
  readonly timedOut: boolean;
  readonly failureCategory: VerificationFailureCategory | null;
  readonly summary: string | null;
  readonly logReference: string | null;
  readonly textLogReference: string | null;
  readonly diagnostics: ReadonlyArray<ParsedVerificationDiagnostic>;
  readonly diagnosticParserWarning: string | null;
  readonly diagnosticInputTruncated: boolean;
  readonly artifacts: ReadonlyArray<CollectedVerificationArtifact>;
  readonly selectionReason: string;
  readonly required: boolean;
  readonly failurePolicy: "block" | "warn" | "informational";
  readonly position: number;
}

export interface VerificationEngineResult {
  readonly runId: string;
  readonly result: "passed" | "passed_with_warnings" | "failed" | "cancelled" | "invalidated";
  readonly checks: ReadonlyArray<ExecutedVerificationCheck>;
  readonly sourceBefore: CapturedVerificationSource;
  readonly sourceAfter: CapturedVerificationSource;
  readonly sourceMutatedDuringVerification: boolean;
  readonly failureSummary: string | null;
}

export class VerificationEngineError extends Schema.TaggedErrorClass<VerificationEngineError>()(
  "VerificationEngineError",
  {
    reason: Schema.Literals([
      "duplicate_run",
      "source_mismatch",
      "worktree_rejected",
      "source_capture_failed",
      "managed_directory_failed",
      "invalid_plan",
    ]),
    runId: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Verification execution rejected (${this.reason}): ${this.detail}`;
  }
}

interface ActiveRun {
  cancelled: boolean;
  readonly executionIds: Set<string>;
}

const classifyExitFailure = (gate: PlannedVerificationGate): VerificationFailureCategory => {
  switch (gate.category) {
    case "typecheck":
      return "type_error";
    case "lint":
    case "format":
      return "lint_error";
    case "unit_test":
    case "integration_test":
    case "ui_smoke":
      return "test_failure";
    case "build":
      return "build_error";
    case "install":
      return "dependency_error";
    default:
      return "source_error";
  }
};

const classifyProcessError = (error: ProcessRunner.VerificationProcessError) => {
  switch (error.reason) {
    case "spawn_failed":
      return "environment_error" as const;
    case "invalid_environment":
      return "configuration_error" as const;
    case "termination_failed":
      return "process_crash" as const;
    default:
      return "process_crash" as const;
  }
};

const boundedAppend = (
  current: string,
  text: string,
): { readonly value: string; readonly cut: boolean } => {
  if (current.length >= DIAGNOSTIC_CAPTURE_LIMIT) return { value: current, cut: true };
  const remaining = DIAGNOSTIC_CAPTURE_LIMIT - current.length;
  return {
    value: current + text.slice(0, remaining),
    cut: text.length > remaining,
  };
};

export class VerificationEngine extends Context.Service<
  VerificationEngine,
  {
    readonly execute: (input: {
      readonly runId: string;
      readonly plan: VerificationExecutionPlanSnapshot;
      readonly assignedWorktreeRoot: string;
      readonly registeredWorktreeRoots: ReadonlyArray<string>;
      readonly baseRef?: string;
      readonly logRoot: string;
      readonly artifactRoot: string;
      readonly managedRuntimeRoot: string;
      readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
      readonly onProgress?: (event: VerificationEngineProgress) => Effect.Effect<void, never>;
    }) => Effect.Effect<VerificationEngineResult, VerificationEngineError>;
    readonly cancel: (runId: string) => Effect.Effect<boolean>;
  }
>()("t3/verification/VerificationEngine") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pathGuard = yield* PathGuard.VerificationPathGuard;
  const sourceCapture = yield* SourceCapture.VerificationSourceCapture;
  const processRunner = yield* ProcessRunner.VerificationProcessRunner;
  const logStore = yield* LogStore.VerificationLogStore;
  const artifactCollector = yield* ArtifactCollector.VerificationArtifactCollector;
  const active = new Map<string, ActiveRun>();

  const cancel: VerificationEngine["Service"]["cancel"] = Effect.fn("VerificationEngine.cancel")(
    function* (runId) {
      const run = active.get(runId);
      if (run === undefined) return false;
      run.cancelled = true;
      yield* Effect.forEach(run.executionIds, (executionId) => processRunner.cancel(executionId), {
        concurrency: "unbounded",
        discard: true,
      }).pipe(Effect.ignore);
      return true;
    },
  );

  const executeCore = Effect.fn("VerificationEngine.executeCore")(function* (input: {
    readonly runId: string;
    readonly plan: VerificationExecutionPlanSnapshot;
    readonly assignedWorktreeRoot: string;
    readonly registeredWorktreeRoots: ReadonlyArray<string>;
    readonly baseRef?: string;
    readonly logRoot: string;
    readonly artifactRoot: string;
    readonly managedRuntimeRoot: string;
    readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
    readonly onProgress?: (event: VerificationEngineProgress) => Effect.Effect<void, never>;
  }) {
    if (active.has(input.runId)) {
      return yield* new VerificationEngineError({
        reason: "duplicate_run",
        runId: input.runId,
        detail: "An execution for this verification run is already active.",
      });
    }
    const run: ActiveRun = { cancelled: false, executionIds: new Set() };
    active.set(input.runId, run);
    const progress = input.onProgress ?? (() => Effect.void);
    const planPlatform = input.plan.environment.platform;
    if (planPlatform !== "win32" && planPlatform !== "darwin" && planPlatform !== "linux") {
      return yield* new VerificationEngineError({
        reason: "invalid_plan",
        runId: input.runId,
        detail: `Unsupported persisted verification platform: ${planPlatform}.`,
      });
    }
    const unaccountedRequiredSkip = input.plan.skippedChecks.find(
      (check) => check.required && !check.explicitlyNotApplicable,
    );
    if (unaccountedRequiredSkip !== undefined) {
      return yield* new VerificationEngineError({
        reason: "invalid_plan",
        runId: input.runId,
        detail: `Required check ${unaccountedRequiredSkip.name} was skipped without an explicit applicability decision.`,
      });
    }
    for (const gate of input.plan.gates) {
      if (gate.required && gate.failurePolicy === "block" && gate.checks.length === 0) {
        const explicitSkips = input.plan.skippedChecks.filter(
          (check) => check.gateId === gate.gateId && check.explicitlyNotApplicable,
        );
        if (explicitSkips.length === 0) {
          return yield* new VerificationEngineError({
            reason: "invalid_plan",
            runId: input.runId,
            detail: `Required blocking gate ${gate.name} has neither executable checks nor explicit applicability skips.`,
          });
        }
      }
    }

    const worktree: AuthorizedVerificationWorktree = yield* pathGuard
      .authorizeWorktree({
        assignedWorktreeRoot: input.assignedWorktreeRoot,
        registeredWorktreeRoots: input.registeredWorktreeRoots,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerificationEngineError({
              reason: "worktree_rejected",
              runId: input.runId,
              detail: cause.message,
              cause,
            }),
        ),
      );
    const sourceBefore = yield* sourceCapture
      .capture({
        worktree,
        ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerificationEngineError({
              reason: "source_capture_failed",
              runId: input.runId,
              detail: cause.message,
              cause,
            }),
        ),
      );
    if (sourceBefore.sourceFingerprint !== input.plan.source.sourceFingerprint) {
      return yield* new VerificationEngineError({
        reason: "source_mismatch",
        runId: input.runId,
        detail: `Plan fingerprint ${input.plan.source.sourceFingerprint} no longer matches ${sourceBefore.sourceFingerprint}.`,
      });
    }

    const managedHome = path.resolve(input.managedRuntimeRoot, input.runId, "home");
    const managedTemp = path.resolve(input.managedRuntimeRoot, input.runId, "temp");
    yield* Effect.forEach([managedHome, managedTemp], (directory) =>
      fileSystem.makeDirectory(directory, { recursive: true }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationEngineError({
            reason: "managed_directory_failed",
            runId: input.runId,
            detail: "Unable to create isolated verification runtime directories.",
            cause,
          }),
      ),
    );

    const executed: Array<ExecutedVerificationCheck> = [];
    const makeUnscheduled = (
      gate: PlannedVerificationGate,
      check: PlannedVerificationCheck,
      status: "cancelled" | "skipped",
      summary: string,
    ): ExecutedVerificationCheck => ({
      checkId: check.checkDefinitionId,
      gateId: gate.gateId,
      name: check.name,
      status,
      exitCode: null,
      signal: null,
      durationMilliseconds: null,
      timedOut: false,
      failureCategory: status === "cancelled" ? "cancelled" : null,
      summary,
      logReference: null,
      textLogReference: null,
      diagnostics: [],
      diagnosticParserWarning: null,
      diagnosticInputTruncated: false,
      artifacts: [],
      selectionReason: check.selectionReason,
      required: check.required,
      failurePolicy: check.failurePolicy,
      position: check.position,
    });

    const executeCheck = Effect.fn("VerificationEngine.executeCheck")(function* (
      gate: PlannedVerificationGate,
      check: PlannedVerificationCheck,
    ): Effect.fn.Return<ExecutedVerificationCheck, VerificationEngineError> {
      if (run.cancelled) {
        return makeUnscheduled(
          gate,
          check,
          "cancelled",
          "Verification was cancelled before scheduling.",
        );
      }
      if (check.requiresShell) {
        return {
          ...makeUnscheduled(
            gate,
            check,
            "skipped",
            "Persisted plan requested an interactive shell, which verification execution does not permit.",
          ),
          status: "failed",
          failureCategory: "permission_error",
        };
      }
      const cwd = yield* pathGuard
        .resolveDirectory({ worktree, relativePath: check.workingDirectory })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerificationEngineError({
                reason: "worktree_rejected",
                runId: input.runId,
                detail: cause.message,
                cause,
              }),
          ),
        );
      const environment = yield* ProcessRunner.buildVerificationProcessEnvironment({
        hostEnvironment: input.hostEnvironment,
        configured: check.environment,
        managedHome,
        managedTemp,
        platform: planPlatform,
      }).pipe(Effect.result);
      if (environment._tag === "Failure") {
        return {
          ...makeUnscheduled(gate, check, "skipped", environment.failure.message),
          status: "failed",
          failureCategory: classifyProcessError(environment.failure),
        };
      }
      const writer = yield* logStore
        .open({
          rootDirectory: input.logRoot,
          runId: input.runId,
          checkRunId: check.checkDefinitionId,
          secrets: environment.success.secrets,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerificationEngineError({
                reason: "managed_directory_failed",
                runId: input.runId,
                detail: cause.message,
                cause,
              }),
          ),
        );
      let stdout = "";
      let stderr = "";
      let diagnosticInputTruncated = false;
      const executionId = `${input.runId}:${gate.gateId}:${check.checkDefinitionId}`;
      run.executionIds.add(executionId);
      yield* progress({
        _tag: "check_started",
        runId: input.runId,
        gateId: gate.gateId,
        checkId: check.checkDefinitionId,
        executionId,
        logReference: writer.logReference,
      });

      let executable = check.command;
      if (executable.includes("/") || executable.includes("\\")) {
        const relativeExecutable = normalizeExecutablePath(check.workingDirectory, executable);
        executable = yield* pathGuard
          .resolveFile({ worktree, relativePath: relativeExecutable })
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerificationEngineError({
                  reason: "worktree_rejected",
                  runId: input.runId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );
      }

      const processOutcome = yield* processRunner
        .run({
          executionId,
          executable,
          args: check.arguments,
          cwd,
          environment: environment.success.environment,
          timeoutSeconds: check.timeoutSeconds,
          onOutput: (chunk) =>
            writer.append(chunk).pipe(
              Effect.tap((records) => {
                for (const record of records) {
                  if (record.stream === "stdout") {
                    const next = boundedAppend(stdout, record.text);
                    stdout = next.value;
                    diagnosticInputTruncated ||= next.cut;
                  } else if (record.stream === "stderr") {
                    const next = boundedAppend(stderr, record.text);
                    stderr = next.value;
                    diagnosticInputTruncated ||= next.cut;
                  }
                }
                return records.length === 0
                  ? Effect.void
                  : progress({
                      _tag: "output",
                      runId: input.runId,
                      gateId: gate.gateId,
                      checkId: check.checkDefinitionId,
                      records,
                    });
              }),
              Effect.mapError(
                (cause) =>
                  new ProcessRunner.VerificationProcessError({
                    reason: "output_failed",
                    executionId,
                    command: executable,
                    detail: cause.message,
                    cause,
                  }),
              ),
            ),
        })
        .pipe(Effect.result);
      run.executionIds.delete(executionId);
      const flushed = yield* writer.close().pipe(
        Effect.mapError(
          (cause) =>
            new VerificationEngineError({
              reason: "managed_directory_failed",
              runId: input.runId,
              detail: cause.message,
              cause,
            }),
        ),
      );
      for (const record of flushed) {
        if (record.stream === "stdout") {
          const next = boundedAppend(stdout, record.text);
          stdout = next.value;
          diagnosticInputTruncated ||= next.cut;
        } else if (record.stream === "stderr") {
          const next = boundedAppend(stderr, record.text);
          stderr = next.value;
          diagnosticInputTruncated ||= next.cut;
        }
      }
      if (flushed.length > 0) {
        yield* progress({
          _tag: "output",
          runId: input.runId,
          gateId: gate.gateId,
          checkId: check.checkDefinitionId,
          records: flushed,
        });
      }

      let processResult: VerificationProcessResult | null = null;
      let processError: ProcessRunner.VerificationProcessError | null = null;
      if (processOutcome._tag === "Success") processResult = processOutcome.success;
      else processError = processOutcome.failure;
      const diagnostics = parseVerificationDiagnostics({
        parser: check.diagnosticParser,
        stdout,
        stderr,
      });
      const artifactOutcome = yield* artifactCollector
        .collect({
          worktree,
          artifactRoot: input.artifactRoot,
          runId: input.runId,
          checkRunId: check.checkDefinitionId,
          rules: check.artifacts,
          secrets: environment.success.secrets,
        })
        .pipe(Effect.result);

      let status: ExecutedVerificationCheck["status"] = "passed";
      let failureCategory: VerificationFailureCategory | null = null;
      let summary: string | null = null;
      if (processError !== null) {
        status = "failed";
        failureCategory = classifyProcessError(processError);
        summary = processError.message;
      } else if (processResult!.cancelled || run.cancelled) {
        status = "cancelled";
        failureCategory = "cancelled";
        summary = "Verification command was cancelled.";
      } else if (processResult!.timedOut) {
        status = "failed";
        failureCategory = "timeout";
        summary = `Verification command timed out after ${check.timeoutSeconds} seconds.`;
      } else if (
        processResult!.exitCode === null ||
        !check.allowedExitCodes.includes(processResult!.exitCode)
      ) {
        status = check.failurePolicy === "block" ? "failed" : "warned";
        failureCategory = classifyExitFailure(gate);
        summary = `Command exited with ${processResult!.exitCode ?? "no exit code"}; allowed codes: ${check.allowedExitCodes.join(", ")}.`;
      }
      let artifacts: ReadonlyArray<CollectedVerificationArtifact> = [];
      if (artifactOutcome._tag === "Failure") {
        if (status === "failed") {
          summary = `${summary ?? "Verification command failed."} Artifact collection also failed: ${artifactOutcome.failure.message}`;
        } else {
          status = "failed";
          failureCategory = "configuration_error";
          summary = artifactOutcome.failure.message;
        }
      } else {
        artifacts = artifactOutcome.success;
      }
      const result: ExecutedVerificationCheck = {
        checkId: check.checkDefinitionId,
        gateId: gate.gateId,
        name: check.name,
        status,
        exitCode: processResult?.exitCode ?? null,
        signal: processResult?.signal ?? null,
        durationMilliseconds: processResult?.durationMilliseconds ?? null,
        timedOut: processResult?.timedOut ?? false,
        failureCategory,
        summary,
        logReference: writer.logReference,
        textLogReference: writer.textReference,
        diagnostics: diagnostics.diagnostics,
        diagnosticParserWarning: diagnostics.parserWarning,
        diagnosticInputTruncated: diagnosticInputTruncated || diagnostics.truncated,
        artifacts,
        selectionReason: check.selectionReason,
        required: check.required,
        failurePolicy: check.failurePolicy,
        position: check.position,
      };
      yield* progress({
        _tag: "check_completed",
        runId: input.runId,
        gateId: gate.gateId,
        checkId: check.checkDefinitionId,
        status,
        failureCategory,
      });
      return result;
    });

    for (const gate of input.plan.gates) {
      if (gate.executionMode === "parallel_safe") {
        const results = yield* Effect.forEach(gate.checks, (check) => executeCheck(gate, check), {
          concurrency: "unbounded",
        });
        executed.push(...results);
        continue;
      }
      let stopGate = false;
      for (const check of gate.checks) {
        if (run.cancelled) {
          executed.push(makeUnscheduled(gate, check, "cancelled", "Verification was cancelled."));
        } else if (stopGate) {
          executed.push(
            makeUnscheduled(
              gate,
              check,
              "skipped",
              "An earlier sequential check failed and continueOnFailure was false.",
            ),
          );
        } else {
          const result = yield* executeCheck(gate, check);
          executed.push(result);
          stopGate = result.status === "failed" && !check.continueOnFailure;
        }
      }
    }

    const sourceAfter = yield* sourceCapture
      .capture({
        worktree,
        ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerificationEngineError({
              reason: "source_capture_failed",
              runId: input.runId,
              detail: cause.message,
              cause,
            }),
        ),
      );
    const sourceMutatedDuringVerification =
      sourceBefore.sourceFingerprint !== sourceAfter.sourceFingerprint;
    const blockingFailure = executed.find(
      (check) => check.status === "failed" && check.required && check.failurePolicy === "block",
    );
    const warning = executed.find(
      (check) =>
        check.status === "warned" ||
        (check.status === "failed" && !(check.required && check.failurePolicy === "block")),
    );
    const result: VerificationEngineResult["result"] = run.cancelled
      ? "cancelled"
      : sourceMutatedDuringVerification
        ? "invalidated"
        : blockingFailure !== undefined
          ? "failed"
          : warning !== undefined
            ? "passed_with_warnings"
            : "passed";
    return {
      runId: input.runId,
      result,
      checks: executed,
      sourceBefore,
      sourceAfter,
      sourceMutatedDuringVerification,
      failureSummary:
        result === "invalidated"
          ? "The assigned worktree source state changed while verification was running."
          : (blockingFailure?.summary ?? null),
    } satisfies VerificationEngineResult;
  });

  const execute: VerificationEngine["Service"]["execute"] = (input) =>
    executeCore(input).pipe(Effect.ensuring(Effect.sync(() => active.delete(input.runId))));

  return VerificationEngine.of({ execute, cancel });
});

const normalizeExecutablePath = (workingDirectory: string, executable: string): string => {
  const joined = `${workingDirectory.replaceAll("\\", "/").replace(/\/$/u, "")}/${executable.replaceAll("\\", "/")}`;
  const normalized: Array<string> = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join("/");
};

export const layer = Layer.effect(VerificationEngine, make);
