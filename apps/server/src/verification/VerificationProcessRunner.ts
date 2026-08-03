import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import type { PlannedVerificationEnvironmentValue } from "./VerificationPlan.ts";

const CREDENTIAL_PATH_ENVIRONMENT_NAMES = new Set([
  "ANTHROPIC_CONFIG_DIR",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "CURSOR_CONFIG_DIR",
  "GH_CONFIG_DIR",
  "GROK_CONFIG_DIR",
  "OPENCODE_HOME",
]);

const SECRET_ENVIRONMENT_NAME =
  /(?:^|_)(?:API_?(?:KEY|TOKEN)|ACCESS_?TOKEN|AUTH_?TOKEN|TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_?KEY)(?:$|_)/i;

export type VerificationOutputStream = "stdout" | "stderr";

export interface VerificationOutputChunk {
  readonly sequence: number;
  readonly observedAt: string;
  readonly stream: VerificationOutputStream;
  readonly text: string;
}

export interface VerificationProcessResult {
  readonly executionId: string;
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signal: null;
  readonly durationMilliseconds: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

export class VerificationProcessError extends Schema.TaggedErrorClass<VerificationProcessError>()(
  "VerificationProcessError",
  {
    reason: Schema.Literals([
      "duplicate_execution",
      "invalid_environment",
      "spawn_failed",
      "output_failed",
      "exit_failed",
      "termination_failed",
    ]),
    executionId: Schema.String,
    command: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Verification process failed (${this.reason}): ${this.detail}`;
  }
}

export interface VerificationEnvironmentBuildResult {
  readonly environment: NodeJS.ProcessEnv;
  readonly secrets: ReadonlyArray<string>;
  readonly summary: Readonly<Record<string, "literal" | "host_environment" | "runtime">>;
}

/**
 * Build the intentionally small environment passed to verification commands.
 * Provider credential locations and the user's home are replaced with a managed
 * verification home, while explicitly referenced secret values are returned to
 * the redactor and never included in the summary.
 */
export const buildVerificationProcessEnvironment = (input: {
  readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  readonly configured: ReadonlyArray<PlannedVerificationEnvironmentValue>;
  readonly managedHome: string;
  readonly managedTemp: string;
  readonly platform: NodeJS.Platform;
}): Effect.Effect<VerificationEnvironmentBuildResult, VerificationProcessError> =>
  Effect.gen(function* () {
    const environment: NodeJS.ProcessEnv = {
      CI: "true",
      NO_COLOR: "1",
      HOME: input.managedHome,
      USERPROFILE: input.managedHome,
      TMP: input.managedTemp,
      TEMP: input.managedTemp,
    };
    const summary: Record<string, "literal" | "host_environment" | "runtime"> = {
      CI: "runtime",
      NO_COLOR: "runtime",
      HOME: "runtime",
      USERPROFILE: "runtime",
      TMP: "runtime",
      TEMP: "runtime",
    };
    for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec"]) {
      const value = input.hostEnvironment[name];
      if (value !== undefined) {
        environment[name] = value;
        summary[name] = "runtime";
      }
    }
    if (input.platform === "win32") {
      environment.APPDATA = input.managedHome;
      environment.LOCALAPPDATA = input.managedHome;
      summary.APPDATA = "runtime";
      summary.LOCALAPPDATA = "runtime";
    }

    const secrets: Array<string> = [];
    for (const configured of input.configured) {
      if (configured.source === "literal") {
        environment[configured.name] = configured.value ?? "";
        summary[configured.name] = "literal";
        continue;
      }
      const sourceName = configured.fromEnvironment!;
      if (CREDENTIAL_PATH_ENVIRONMENT_NAMES.has(sourceName.toLocaleUpperCase("en-US"))) {
        return yield* new VerificationProcessError({
          reason: "invalid_environment",
          executionId: "environment",
          command: "",
          detail: `Environment reference ${sourceName} exposes a provider credential location.`,
        });
      }
      const value = input.hostEnvironment[sourceName];
      if (value === undefined) {
        return yield* new VerificationProcessError({
          reason: "invalid_environment",
          executionId: "environment",
          command: "",
          detail: `Required environment reference ${sourceName} is not available.`,
        });
      }
      environment[configured.name] = value;
      summary[configured.name] = "host_environment";
      if (
        value.length > 0 &&
        (configured.sensitive ||
          SECRET_ENVIRONMENT_NAME.test(configured.name) ||
          SECRET_ENVIRONMENT_NAME.test(sourceName))
      ) {
        secrets.push(value);
      }
    }
    return { environment, secrets: [...new Set(secrets)], summary };
  });

interface ActiveExecution {
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  cancelled: boolean;
  timedOut: boolean;
}

export class VerificationProcessRunner extends Context.Service<
  VerificationProcessRunner,
  {
    readonly run: (input: {
      readonly executionId: string;
      readonly executable: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string;
      readonly environment: NodeJS.ProcessEnv;
      readonly timeoutSeconds: number;
      readonly onOutput: (
        chunk: VerificationOutputChunk,
      ) => Effect.Effect<void, VerificationProcessError>;
    }) => Effect.Effect<VerificationProcessResult, VerificationProcessError>;
    readonly cancel: (executionId: string) => Effect.Effect<boolean, VerificationProcessError>;
  }
>()("t3/verification/VerificationProcessRunner") {}

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const hostPlatform = yield* HostProcessPlatform;
  const active = new Map<string, ActiveExecution>();

  const terminate = Effect.fn("VerificationProcessRunner.terminate")(function* (
    executionId: string,
    executable: string,
    execution: ActiveExecution,
  ) {
    const isRunning = yield* execution.handle.isRunning.pipe(Effect.orElseSucceed(() => true));
    if (!isRunning) return;
    yield* execution.handle.kill({ killSignal: "SIGTERM", forceKillAfter: "2 seconds" }).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationProcessError({
            reason: "termination_failed",
            executionId,
            command: executable,
            detail: `Unable to terminate captured process tree for PID ${execution.handle.pid}.`,
            cause,
          }),
      ),
    );
  });

  const runScoped = Effect.fn("VerificationProcessRunner.runScoped")(function* (input: {
    readonly executionId: string;
    readonly executable: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly timeoutSeconds: number;
    readonly onOutput: (
      chunk: VerificationOutputChunk,
    ) => Effect.Effect<void, VerificationProcessError>;
  }): Effect.fn.Return<VerificationProcessResult, VerificationProcessError, Scope.Scope> {
    if (active.has(input.executionId)) {
      return yield* new VerificationProcessError({
        reason: "duplicate_execution",
        executionId: input.executionId,
        command: input.executable,
        detail: "An active process already uses this execution id.",
      });
    }
    const startedAt = yield* Clock.currentTimeMillis;
    const spawnCommand = yield* resolveSpawnCommand(input.executable, input.args, {
      env: input.environment,
      extendEnv: false,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationProcessError({
            reason: "spawn_failed",
            executionId: input.executionId,
            command: input.executable,
            detail: "The configured executable could not be resolved.",
            cause,
          }),
      ),
    );
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd: input.cwd,
          env: input.environment,
          extendEnv: false,
          shell: spawnCommand.shell,
          detached: hostPlatform !== "win32",
          killSignal: "SIGTERM",
          forceKillAfter: "2 seconds",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerificationProcessError({
              reason: "spawn_failed",
              executionId: input.executionId,
              command: input.executable,
              detail: "The configured verification process could not be started.",
              cause,
            }),
        ),
      );
    const execution: ActiveExecution = { handle, cancelled: false, timedOut: false };
    active.set(input.executionId, execution);
    yield* Effect.addFinalizer(() =>
      terminate(input.executionId, input.executable, execution).pipe(
        Effect.ignore,
        Effect.andThen(Effect.sync(() => active.delete(input.executionId))),
      ),
    );

    let sequence = 0;
    const consume = (streamName: VerificationOutputStream, stream: typeof handle.stdout) => {
      const decoder = new TextDecoder();
      const emit = (text: string) =>
        DateTime.now.pipe(
          Effect.flatMap((observedAt) =>
            input.onOutput({
              sequence: sequence++,
              observedAt: DateTime.formatIso(observedAt),
              stream: streamName,
              text,
            }),
          ),
        );
      return stream.pipe(
        Stream.runForEach((bytes) => {
          const text = decoder.decode(bytes, { stream: true });
          if (text.length === 0) return Effect.void;
          return emit(text);
        }),
        Effect.andThen(
          Effect.suspend(() => {
            const text = decoder.decode();
            return text.length === 0 ? Effect.void : emit(text);
          }),
        ),
        Effect.mapError(
          (cause) =>
            new VerificationProcessError({
              reason: "output_failed",
              executionId: input.executionId,
              command: input.executable,
              detail: `Unable to stream ${streamName}.`,
              cause,
            }),
        ),
      );
    };

    const wait = Effect.all(
      [
        consume("stdout", handle.stdout),
        consume("stderr", handle.stderr),
        handle.exitCode.pipe(
          Effect.catch((cause) =>
            execution.cancelled || execution.timedOut
              ? Effect.succeed(null)
              : Effect.fail(
                  new VerificationProcessError({
                    reason: "exit_failed",
                    executionId: input.executionId,
                    command: input.executable,
                    detail: "Unable to observe the verification process exit status.",
                    cause,
                  }),
                ),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const waitFiber = yield* Effect.forkScoped(wait);
    const outcome = yield* Effect.raceFirst(
      Fiber.join(waitFiber).pipe(Effect.map((result) => ({ _tag: "Completed" as const, result }))),
      Effect.sleep(input.timeoutSeconds * 1_000).pipe(Effect.as({ _tag: "TimedOut" as const })),
    );
    let exitCode: number | null;
    let timedOut = false;
    if (outcome._tag === "TimedOut") {
      timedOut = true;
      execution.timedOut = true;
      yield* terminate(input.executionId, input.executable, execution);
      const drained = yield* Fiber.join(waitFiber);
      exitCode = drained[2];
    } else {
      exitCode = outcome.result[2];
    }
    active.delete(input.executionId);
    const completedAt = yield* Clock.currentTimeMillis;
    return {
      executionId: input.executionId,
      pid: handle.pid,
      exitCode,
      signal: null,
      durationMilliseconds: completedAt - startedAt,
      timedOut,
      cancelled: execution.cancelled,
    };
  });

  const run: VerificationProcessRunner["Service"]["run"] = (input) =>
    runScoped(input).pipe(Effect.scoped);

  const cancel: VerificationProcessRunner["Service"]["cancel"] = Effect.fn(
    "VerificationProcessRunner.cancel",
  )(function* (executionId) {
    const execution = active.get(executionId);
    if (execution === undefined) return false;
    execution.cancelled = true;
    yield* terminate(executionId, "active verification command", execution);
    return true;
  });

  return VerificationProcessRunner.of({ run, cancel });
});

export const layer = Layer.effect(VerificationProcessRunner, make);
