import {
  type MissionTaskId,
  type ProjectId,
  type VerificationCheckRun,
  type VerificationCheckRunId,
  VerificationArtifactAccessError,
  type VerificationArtifactAccessUrl,
  type VerificationArtifactId,
  type VerificationIntegrationAuthorization,
  VerificationQueryError,
  VerificationProfileId,
  type VerificationRun,
  type VerificationRunComparison,
  type VerificationRunEvidence,
  type VerificationRunHistoryPage,
  type VerificationRunId,
  type VerificationRunSummary,
  type VerificationTaskSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import { ProjectionVerificationConfigurationRepository } from "../persistence/Services/ProjectionVerificationConfiguration.ts";
import { ProjectionVerificationRunRepository } from "../persistence/Services/ProjectionVerificationRuns.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { VerificationConfigService } from "./VerificationConfig.ts";
import * as VerificationArtifactAccess from "./VerificationArtifactAccess.ts";
import { VerificationLogStore } from "./VerificationLogStore.ts";

const queryError = (
  reason: VerificationQueryError["reason"],
  message: string,
): VerificationQueryError => new VerificationQueryError({ reason, message });

const duration = (run: VerificationRun): number | null => {
  if (run.startedAt === null || run.completedAt === null) return null;
  const milliseconds = Date.parse(run.completedAt) - Date.parse(run.startedAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
};

const authorizationFromRun = (
  run: VerificationRun | null,
): VerificationIntegrationAuthorization => {
  if (run === null) {
    return {
      status: "missing",
      required: true,
      allowed: false,
      blockingReason: "Required verification has not run for this task.",
      verificationRunId: null,
      override: null,
    };
  }
  switch (run.status) {
    case "queued":
    case "preparing":
      return {
        status: "queued",
        required: true,
        allowed: false,
        blockingReason: "Required verification is queued.",
        verificationRunId: run.id,
        override: null,
      };
    case "running":
    case "cancelling":
      return {
        status: "running",
        required: true,
        allowed: false,
        blockingReason: "Required verification is still running.",
        verificationRunId: run.id,
        override: null,
      };
    case "passed":
    case "passed_with_warnings":
      return {
        status: run.status,
        required: true,
        allowed: true,
        blockingReason: null,
        verificationRunId: run.id,
        override: null,
      };
    case "failed":
    case "cancelled":
    case "interrupted":
    case "invalidated":
      return {
        status: run.status,
        required: true,
        allowed: false,
        blockingReason:
          run.status === "invalidated"
            ? "The verified source state changed. Run verification again."
            : `Required verification ${run.status}.`,
        verificationRunId: run.id,
        override: null,
      };
  }
};

export interface VerificationQueryServiceShape {
  readonly getProjectConfiguration: (
    projectId: ProjectId,
  ) => Effect.Effect<
    import("@t3tools/contracts").VerificationProjectConfigurationSnapshot,
    VerificationQueryError
  >;
  readonly listRuns: (input: {
    readonly projectId: ProjectId;
    readonly taskId: MissionTaskId | null;
    readonly cursor: string | null;
    readonly limit: number;
  }) => Effect.Effect<VerificationRunHistoryPage, VerificationQueryError>;
  readonly getRunEvidence: (
    verificationRunId: VerificationRunId,
  ) => Effect.Effect<VerificationRunEvidence, VerificationQueryError>;
  readonly getTaskSummaries: (input: {
    readonly projectId: ProjectId;
    readonly taskIds: ReadonlyArray<MissionTaskId>;
  }) => Effect.Effect<ReadonlyArray<VerificationTaskSummary>, VerificationQueryError>;
  readonly compareRuns: (input: {
    readonly previousRunId: VerificationRunId;
    readonly currentRunId: VerificationRunId;
  }) => Effect.Effect<VerificationRunComparison, VerificationQueryError>;
  readonly readLog: (input: {
    readonly verificationRunId: VerificationRunId;
    readonly checkRunId: VerificationCheckRunId;
    readonly cursor: number;
    readonly limit: number;
  }) => Effect.Effect<import("@t3tools/contracts").VerificationLogPage, VerificationQueryError>;
  readonly createArtifactUrl: (input: {
    readonly verificationRunId: VerificationRunId;
    readonly artifactId: VerificationArtifactId;
  }) => Effect.Effect<VerificationArtifactAccessUrl, VerificationArtifactAccessError>;
  readonly resolveArtifact: (
    token: string,
    fileName: string,
  ) => Effect.Effect<VerificationArtifactAccess.ResolvedVerificationArtifact | null>;
}

const unavailable = () =>
  Effect.fail(
    queryError(
      "persistence_error",
      "Verification evidence is unavailable while the verification read service is starting.",
    ),
  );

const artifactAccessUnavailable = () =>
  Effect.fail(
    new VerificationArtifactAccessError({
      reason: "unavailable",
      message:
        "Verification artifact access is unavailable while the verification read service is starting.",
    }),
  );

export class VerificationQueryService extends Context.Reference<VerificationQueryServiceShape>(
  "t3/verification/VerificationQueryService",
  {
    defaultValue: () => ({
      getProjectConfiguration: unavailable,
      listRuns: unavailable,
      getRunEvidence: unavailable,
      getTaskSummaries: unavailable,
      compareRuns: unavailable,
      readLog: unavailable,
      createArtifactUrl: artifactAccessUnavailable,
      resolveArtifact: () => Effect.succeed(null),
    }),
  },
) {}

export const make = Effect.gen(function* () {
  const configuration = yield* ProjectionVerificationConfigurationRepository;
  const runs = yield* ProjectionVerificationRunRepository;
  const projects = yield* ProjectionProjectRepository;
  const configService = yield* VerificationConfigService;
  const logs = yield* VerificationLogStore;
  const serverConfig = yield* ServerConfig;
  const path = yield* Path.Path;
  const artifactAccess = yield* VerificationArtifactAccess.make;

  const persistenceFailure = (operation: string) =>
    Effect.mapError((cause: unknown) =>
      queryError("persistence_error", `${operation} failed: ${String(cause)}`),
    );

  const loadRun = (id: VerificationRunId) =>
    runs.getRunById({ verificationRunId: id }).pipe(
      persistenceFailure("Loading verification evidence"),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(queryError("run_not_found", `Verification run ${id} was not found.`)),
          onSome: Effect.succeed,
        }),
      ),
    );

  const summarize = (
    run: VerificationRun,
  ): Effect.Effect<VerificationRunSummary, VerificationQueryError> =>
    Effect.gen(function* () {
      const [checks, repairs] = yield* Effect.all([
        runs.listCheckRunsByRunId({ verificationRunId: run.id }),
        runs.listRepairAttemptsByRunId({ verificationRunId: run.id }),
      ]).pipe(persistenceFailure("Loading verification run summary"));
      return {
        id: run.id,
        projectId: run.projectId,
        missionId: run.missionId,
        taskId: run.taskId,
        profileId: run.profileId,
        profileName: run.executionPlan.profileName,
        trigger: run.trigger,
        status: run.status,
        result: run.result,
        sourceFingerprint: run.sourceFingerprint,
        branchName: run.branchName,
        commitHash: run.commitHash,
        dirtyStateFingerprint: run.dirtyStateFingerprint,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        durationMilliseconds: duration(run),
        failureSummary: run.failureSummary,
        failedCheckNames: checks
          .filter((check) => check.status === "failed" || check.status === "interrupted")
          .map((check) => check.nameSnapshot),
        repairAttemptCount: repairs.length,
        invalidatedAt: run.invalidatedAt,
      };
    });

  const getProjectConfiguration: VerificationQueryServiceShape["getProjectConfiguration"] =
    Effect.fn("VerificationQueryService.getProjectConfiguration")(function* (projectId) {
      const project = yield* projects
        .getById({ projectId })
        .pipe(persistenceFailure("Loading project verification configuration"));
      if (Option.isNone(project)) {
        return yield* queryError("project_not_found", `Project ${projectId} was not found.`);
      }
      const [settingsOption, profiles] = yield* Effect.all([
        configuration.getProjectSettings({ projectId }),
        configuration.listProfilesByProjectId({ projectId }),
      ]).pipe(persistenceFailure("Loading accepted verification configuration"));
      const settings = Option.getOrNull(settingsOption);
      const discovered = yield* configService
        .discover({
          workspaceRoot: project.value.workspaceRoot,
          ...(settings?.acceptedConfigurationDigest
            ? { acceptedRevision: settings.acceptedConfigurationDigest }
            : {}),
        })
        .pipe(Effect.mapError((error) => queryError("configuration_error", error.message)));
      const acceptedProfiles = yield* Effect.forEach(profiles, (profile) =>
        Effect.gen(function* () {
          const gates = yield* configuration.listGatesByProfileId({ profileId: profile.id });
          return {
            profile,
            gates: yield* Effect.forEach(gates, (gate) =>
              configuration
                .listCheckDefinitionsByGateId({ gateId: gate.id })
                .pipe(Effect.map((checks) => ({ gate, checks }))),
            ),
          };
        }),
      ).pipe(persistenceFailure("Loading accepted verification profiles"));
      return {
        projectId,
        workspaceRoot: project.value.workspaceRoot,
        settings,
        discovery: {
          source: discovered.source,
          configPath: discovered.configPath,
          revision: discovered.revision,
          trust: discovered.trust,
          profiles: Object.values(discovered.profiles).map((profile) => ({
            id: profile.id,
            persistedProfileId: VerificationProfileId.make(
              `verification-profile:${encodeURIComponent(projectId)}:${encodeURIComponent(profile.id)}`,
            ),
            name: profile.name,
            description: profile.description ?? "",
            triggerModes: profile.triggers,
            gates: profile.gates.map((gate) => ({
              id: gate.id,
              name: gate.name ?? gate.id,
              description: gate.description ?? "",
              category: gate.category,
              required: gate.required ?? true,
              enabled: gate.enabled ?? true,
              executionMode: gate.executionMode ?? "sequential",
              failurePolicy: gate.failurePolicy ?? "block",
              checks: gate.checks.map((check) => ({
                id: check.id,
                name: check.name,
                executable: check.command.executable,
                arguments: check.command.args ?? [],
                workingDirectory: check.workingDirectory ?? ".",
                timeoutSeconds: check.timeoutSeconds ?? 300,
                allowedExitCodes: check.allowedExitCodes ?? [0],
                continueOnFailure: check.continueOnFailure ?? false,
                applicableFilePatterns: check.applicability?.include ?? [],
                excludedFilePatterns: check.applicability?.exclude ?? [],
                allowRequiredSkip: check.applicability?.allowRequiredSkip ?? false,
                platforms: check.platforms ?? [],
                artifactPatterns: (check.artifacts ?? []).map((artifact) => artifact.pattern),
                diagnosticParser: check.diagnosticParser ?? "none",
              })),
            })),
          })),
          suggestions: discovered.suggestions.map((suggestion) => ({
            id: suggestion.id,
            category: suggestion.category,
            executable: suggestion.command.executable,
            arguments: suggestion.command.args,
            reason: suggestion.reason,
            trusted: false as const,
          })),
        },
        acceptedProfiles,
      };
    });

  const listRuns: VerificationQueryServiceShape["listRuns"] = Effect.fn(
    "VerificationQueryService.listRuns",
  )(function* (input) {
    const all = yield* (
      input.taskId === null
        ? runs.listRunsByProjectId({ projectId: input.projectId })
        : runs.listRunsByTaskId({ taskId: input.taskId })
    ).pipe(persistenceFailure("Listing verification runs"));
    const ordered = [...all]
      .filter((run) => run.projectId === input.projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const start =
      input.cursor === null
        ? 0
        : Math.max(0, ordered.findIndex((run) => run.id === input.cursor) + 1);
    const page = ordered.slice(start, start + input.limit);
    const summaries = yield* Effect.forEach(page, summarize, { concurrency: 8 });
    return {
      runs: summaries,
      nextCursor: start + page.length < ordered.length ? (page.at(-1)?.id ?? null) : null,
    };
  });

  const getRunEvidence: VerificationQueryServiceShape["getRunEvidence"] = Effect.fn(
    "VerificationQueryService.getRunEvidence",
  )(function* (verificationRunId) {
    const run = yield* loadRun(verificationRunId);
    const [checks, artifacts, repairAttempts] = yield* Effect.all([
      runs.listCheckRunsByRunId({ verificationRunId }),
      runs.listArtifactsByRunId({ verificationRunId }),
      runs.listRepairAttemptsByRunId({ verificationRunId }),
    ]).pipe(persistenceFailure("Loading verification run evidence"));
    const diagnostics = yield* Effect.forEach(
      checks,
      (check) => runs.listDiagnosticsByCheckRunId({ checkRunId: check.id }),
      { concurrency: 8 },
    ).pipe(
      Effect.map((groups) => groups.flat()),
      persistenceFailure("Loading verification diagnostics"),
    );
    const overrides =
      run.taskId === null
        ? []
        : yield* runs
            .listOverridesByTaskId({ taskId: run.taskId })
            .pipe(persistenceFailure("Loading verification overrides"));
    const artifactEvidence = yield* Effect.forEach(artifacts, (artifact) => {
      return artifactAccess.inspect({ verificationRunId, artifactId: artifact.id }).pipe(
        Effect.as({ artifact, available: true, unavailableReason: null }),
        Effect.catch((error) =>
          Effect.succeed({ artifact, available: false, unavailableReason: error.message }),
        ),
      );
    });
    return { run, checks, diagnostics, artifacts: artifactEvidence, repairAttempts, overrides };
  });

  const getTaskSummaries: VerificationQueryServiceShape["getTaskSummaries"] = Effect.fn(
    "VerificationQueryService.getTaskSummaries",
  )(function* (input) {
    const settings = yield* configuration
      .getProjectSettings({ projectId: input.projectId })
      .pipe(persistenceFailure("Loading verification requirements"), Effect.map(Option.getOrNull));
    return yield* Effect.forEach(
      input.taskIds,
      (taskId) =>
        Effect.gen(function* () {
          const [taskRuns, overrides] = yield* Effect.all([
            runs.listRunsByTaskId({ taskId }),
            runs.listOverridesByTaskId({ taskId }),
          ]).pipe(persistenceFailure("Loading task verification state"));
          const ordered = [...taskRuns]
            .filter((run) => run.projectId === input.projectId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          const latest = ordered[0] ?? null;
          let authorization: VerificationIntegrationAuthorization;
          if (settings?.preIntegrationProfileId === null || settings === null) {
            authorization = {
              status: "not_required",
              required: false,
              allowed: true,
              blockingReason: null,
              verificationRunId: latest?.id ?? null,
              override: null,
            };
          } else {
            const requiredRun =
              ordered.find(
                (run) =>
                  run.profileId === settings.preIntegrationProfileId &&
                  run.authorizationScope === "full_profile",
              ) ?? null;
            const matchingOverride = [...overrides]
              .filter(
                (override) =>
                  override.revokedAt === null &&
                  requiredRun !== null &&
                  override.sourceFingerprint === requiredRun.sourceFingerprint,
              )
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
            authorization = matchingOverride
              ? {
                  status: "overridden",
                  required: true,
                  allowed: true,
                  blockingReason: null,
                  verificationRunId: requiredRun?.id ?? null,
                  override: matchingOverride,
                }
              : authorizationFromRun(requiredRun);
          }
          const repairs =
            latest === null
              ? []
              : yield* runs
                  .listRepairAttemptsByRunId({ verificationRunId: latest.id })
                  .pipe(persistenceFailure("Loading task repair state"));
          return {
            taskId,
            latestRun: latest === null ? null : yield* summarize(latest),
            authorization,
            repairRunning: repairs.some(
              (attempt) => attempt.status === "queued" || attempt.status === "running",
            ),
          };
        }),
      { concurrency: 8 },
    );
  });

  const compareRuns: VerificationQueryServiceShape["compareRuns"] = Effect.fn(
    "VerificationQueryService.compareRuns",
  )(function* (input) {
    const [previous, current] = yield* Effect.all([
      loadRun(input.previousRunId),
      loadRun(input.currentRunId),
    ]);
    const [previousChecks, currentChecks] = yield* Effect.all([
      runs.listCheckRunsByRunId({ verificationRunId: previous.id }),
      runs.listCheckRunsByRunId({ verificationRunId: current.id }),
    ]).pipe(persistenceFailure("Comparing verification checks"));
    const failed = (checks: ReadonlyArray<VerificationCheckRun>) =>
      new Set(
        checks.filter((check) => check.status === "failed").map((check) => check.nameSnapshot),
      );
    const previousFailed = failed(previousChecks);
    const currentFailed = failed(currentChecks);
    const currentNames = new Set(currentChecks.map((check) => check.nameSnapshot));
    const previousDuration = duration(previous);
    const currentDuration = duration(current);
    return {
      previousRunId: previous.id,
      currentRunId: current.id,
      previouslyFailingNowPassing: [...previousFailed].filter(
        (name) => !currentFailed.has(name) && currentNames.has(name),
      ),
      newlyFailing: [...currentFailed].filter((name) => !previousFailed.has(name)),
      noLongerApplicable: previousChecks
        .map((check) => check.nameSnapshot)
        .filter((name) => !currentNames.has(name)),
      durationDeltaMilliseconds:
        previousDuration === null || currentDuration === null
          ? null
          : currentDuration - previousDuration,
    };
  });

  const readLog: VerificationQueryServiceShape["readLog"] = Effect.fn(
    "VerificationQueryService.readLog",
  )(function* (input) {
    yield* loadRun(input.verificationRunId);
    const checkOption = yield* runs
      .getCheckRunById({ checkRunId: input.checkRunId })
      .pipe(persistenceFailure("Loading verification check"));
    if (
      Option.isNone(checkOption) ||
      checkOption.value.verificationRunId !== input.verificationRunId
    ) {
      return yield* queryError(
        "check_not_found",
        `Verification check ${input.checkRunId} was not found in this run.`,
      );
    }
    if (checkOption.value.logReference === null) {
      return {
        records: [],
        nextCursor: input.cursor,
        hasMore: false,
        logAvailable: false,
        unavailableReason: "The check has not produced a durable log reference yet.",
      };
    }
    return yield* logs
      .read({
        rootDirectory: path.join(serverConfig.logsDir, "verification"),
        logReference: checkOption.value.logReference,
        cursor: input.cursor,
        limit: input.limit,
      })
      .pipe(
        Effect.map((page) => ({ ...page, logAvailable: true, unavailableReason: null })),
        Effect.orElseSucceed(() => ({
          records: [],
          nextCursor: input.cursor,
          hasMore: false,
          logAvailable: false,
          unavailableReason:
            "The durable log could not be opened. Partial run evidence remains available.",
        })),
      );
  });

  const createArtifactUrl: VerificationQueryServiceShape["createArtifactUrl"] =
    artifactAccess.issueUrl;

  return {
    getProjectConfiguration,
    listRuns,
    getRunEvidence,
    getTaskSummaries,
    compareRuns,
    readLog,
    createArtifactUrl,
    resolveArtifact: artifactAccess.resolve,
  } satisfies VerificationQueryServiceShape;
});

export const layer = Layer.effect(VerificationQueryService, make);
