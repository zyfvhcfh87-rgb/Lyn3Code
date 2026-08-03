import {
  AgentRunId,
  CommandId,
  MissionTaskId,
  ProjectId,
  ThreadId,
  VerificationArtifactId,
  VerificationCheckDefinitionId,
  VerificationCheckRunId,
  VerificationDiagnosticId,
  VerificationGateId,
  VerificationProfileId,
  VerificationRepairAttemptId,
  VerificationRunId,
  type OrchestrationEvent,
  type VerificationCheckRun,
  type VerificationExecutionPlan,
  type VerificationRepairAttempt,
  type VerificationRun,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionVerificationConfigurationRepository } from "../../persistence/Services/ProjectionVerificationConfiguration.ts";
import { ProjectionVerificationRunRepository } from "../../persistence/Services/ProjectionVerificationRuns.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  VerificationConfigService,
  type DiscoveredVerificationConfig,
} from "../../verification/VerificationConfig.ts";
import {
  VerificationEngine,
  type VerificationEngineProgress,
} from "../../verification/VerificationEngine.ts";
import { VerificationPathGuard } from "../../verification/VerificationPathGuard.ts";
import {
  VerificationPlanner,
  type VerificationPlanIdentities,
} from "../../verification/VerificationPlan.ts";
import {
  type CapturedVerificationSource,
  VerificationSourceCapture,
} from "../../verification/VerificationSourceCapture.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  VerificationOrchestrationReactor,
  type VerificationOrchestrationReactorShape,
} from "../Services/VerificationOrchestrationReactor.ts";

type VerificationTrigger = Extract<
  OrchestrationEvent,
  {
    type:
      | "task.implementation-completed"
      | "mission.cancellation-requested"
      | "task.cancellation-requested"
      | "verification.requested"
      | "verification.cancel_requested"
      | "verification.repair_requested"
      | "verification.override_requested"
      | "verification.settings_updated"
      | "managed_worktree.status-updated"
      | "integration.completed"
      | "agent_run.completed"
      | "agent_run.cancelled"
      | "agent_run.failed"
      | "agent_run.interrupted";
  }
>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const stableId = (prefix: string, ...parts: ReadonlyArray<string>) =>
  `${prefix}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
const commandId = (runId: string, action: string) =>
  CommandId.make(`server:verification:${runId}:${action}`);

const profileId = (projectId: string, key: string) =>
  VerificationProfileId.make(stableId("verification-profile", projectId, key));
const gateId = (profile: VerificationProfileId, key: string) =>
  VerificationGateId.make(stableId("verification-gate", profile, key));
const checkDefinitionId = (gate: VerificationGateId, key: string) =>
  VerificationCheckDefinitionId.make(stableId("verification-check", gate, key));
const automaticallyRepairableFailureCategories = new Set([
  "source_error",
  "test_failure",
  "type_error",
  "lint_error",
  "build_error",
]);

export const shouldAutomaticallyRepairVerification = (
  checks: ReadonlyArray<{
    readonly status: string;
    readonly failurePolicy: string;
    readonly failureCategory: string | null;
  }>,
) => {
  const blockingFailures = checks.filter(
    (check) => check.status === "failed" && check.failurePolicy === "block",
  );
  return (
    blockingFailures.length > 0 &&
    blockingFailures.every(
      (check) =>
        check.failureCategory !== null &&
        automaticallyRepairableFailureCategories.has(check.failureCategory),
    )
  );
};

export const evaluateRepairAttemptBudget = (input: {
  readonly ancestorAttempts: ReadonlyArray<VerificationRepairAttempt>;
  readonly directAttempts: ReadonlyArray<VerificationRepairAttempt>;
  readonly maximumAttempts: number;
}) => {
  const history = [...input.ancestorAttempts, ...input.directAttempts].filter(
    (attempt, index, all) => all.findIndex((candidate) => candidate.id === attempt.id) === index,
  );
  return {
    history,
    hasActiveAttempt: input.directAttempts.some(
      (attempt) => attempt.status === "queued" || attempt.status === "running",
    ),
    limitReached: history.length >= input.maximumAttempts,
    nextAttemptNumber: history.length + 1,
  } as const;
};

export const interruptVerificationCheckForRecovery = (
  checkRun: VerificationCheckRun,
  interruptedAt: string,
): VerificationCheckRun => ({
  ...checkRun,
  status: "interrupted",
  completedAt: interruptedAt,
  result: "interrupted",
  failureCategory: "process_crash",
  summary:
    checkRun.status === "running"
      ? "Server restarted while this verification command was active."
      : "Server restarted before this queued verification command could start.",
});

export const terminalizeVerificationCheckAfterEngineFailure = (
  checkRun: VerificationCheckRun,
  completedAt: string,
  engineFailureReason: string,
  detail: string,
): VerificationCheckRun => {
  const sourceInvalidated = engineFailureReason === "source_mismatch";
  const wasRunning = checkRun.status === "running";
  const status = sourceInvalidated || !wasRunning ? "skipped" : "interrupted";
  return {
    ...checkRun,
    status,
    completedAt,
    result: status,
    failureCategory: status === "interrupted" ? "process_crash" : null,
    summary: sourceInvalidated
      ? `The immutable verification plan no longer matched the assigned source state. ${detail}`
      : wasRunning
        ? `Verification infrastructure failed after this check started. Its completion was not fabricated. ${detail}`
        : `Verification infrastructure failed before this check started. ${detail}`,
  };
};

export const createFailedGateDiagnosticPlan = (input: {
  readonly plan: VerificationExecutionPlan;
  readonly sourceRun: VerificationRun;
  readonly sourceCheckRuns: ReadonlyArray<VerificationCheckRun>;
  readonly gateId: VerificationGateId;
  readonly projectId: string;
  readonly missionId: string | null;
  readonly taskId: string | null;
  readonly worktreeId: string | null;
  readonly sourceFingerprint: string;
}):
  | { readonly ok: true; readonly plan: VerificationExecutionPlan }
  | { readonly ok: false; readonly summary: string } => {
  const sourceRun = input.sourceRun;
  if (sourceRun.authorizationScope !== "full_profile") {
    return {
      ok: false,
      summary: "Only a failed full-profile run can be the source of a gate rerun.",
    };
  }
  if (sourceRun.status !== "failed" || sourceRun.result !== "failed") {
    return { ok: false, summary: "The source verification run is not a failed run." };
  }
  if (
    sourceRun.projectId !== input.projectId ||
    sourceRun.missionId !== input.missionId ||
    sourceRun.taskId !== input.taskId ||
    sourceRun.worktreeId !== input.worktreeId
  ) {
    return {
      ok: false,
      summary: "The source verification run does not belong to the requested task worktree.",
    };
  }
  if (sourceRun.sourceFingerprint !== input.sourceFingerprint) {
    return {
      ok: false,
      summary:
        "The source state changed after the failed run; create a new full-profile run instead.",
    };
  }
  if (
    sourceRun.profileId !== input.plan.profileId ||
    sourceRun.configurationDigest !== input.plan.configurationDigest
  ) {
    return {
      ok: false,
      summary: "The verification profile or accepted configuration changed after the failed run.",
    };
  }
  const sourceGate = sourceRun.executionPlan.gates.find((gate) => gate.gateId === input.gateId);
  if (sourceGate === undefined) {
    return {
      ok: false,
      summary: "The requested gate was not part of the source run's immutable plan.",
    };
  }
  if (
    !input.sourceCheckRuns.some(
      (check) => check.gateId === input.gateId && check.status === "failed",
    )
  ) {
    return { ok: false, summary: "The requested gate has no persisted failed check to rerun." };
  }
  const selectedGate = input.plan.gates.find((gate) => gate.gateId === input.gateId);
  if (selectedGate === undefined || selectedGate.checks.length === 0) {
    return {
      ok: false,
      summary: "The requested gate is not executable in the current immutable plan.",
    };
  }

  const skipped = new Map(
    input.plan.skippedChecks
      .filter((check) => check.gateId === input.gateId)
      .map((check) => [check.checkDefinitionId, check] as const),
  );
  for (const gate of input.plan.gates) {
    if (gate.gateId === input.gateId) continue;
    for (const check of gate.checks) {
      skipped.set(check.checkDefinitionId, {
        checkDefinitionId: check.checkDefinitionId,
        gateId: gate.gateId,
        name: check.name,
        reason:
          "Excluded from this requested failed-gate diagnostic rerun; this subset cannot authorize integration.",
        required: check.required,
        explicitlyNotApplicable: true,
        selectionSource: "explicit_configuration",
      });
    }
  }
  for (const check of input.plan.skippedChecks) {
    if (check.gateId === input.gateId) continue;
    skipped.set(check.checkDefinitionId, {
      ...check,
      reason:
        "Excluded from this requested failed-gate diagnostic rerun; this subset cannot authorize integration.",
      explicitlyNotApplicable: true,
    });
  }
  return {
    ok: true,
    plan: {
      ...input.plan,
      gates: [selectedGate],
      skippedChecks: [...skipped.values()],
    },
  };
};

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const projects = yield* ProjectionProjectRepository;
  const configurations = yield* ProjectionVerificationConfigurationRepository;
  const runs = yield* ProjectionVerificationRunRepository;
  const configService = yield* VerificationConfigService;
  const planner = yield* VerificationPlanner;
  const verificationEngine = yield* VerificationEngine;
  const pathGuard = yield* VerificationPathGuard;
  const sourceCapture = yield* VerificationSourceCapture;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const hostPlatform = yield* HostProcessPlatform;
  const hostArchitecture = yield* HostProcessArchitecture;
  const hostEnvironment = yield* HostProcessEnvironment;

  if (query.getMissionDetailSnapshot === undefined) {
    return {
      start: Effect.fn("VerificationOrchestrationReactor.start")(function* () {}),
      cancel: verificationEngine.cancel,
      revalidateTask: () => Effect.void,
      drain: Effect.void,
    } satisfies VerificationOrchestrationReactorShape;
  }
  const getMissionDetailSnapshot = query.getMissionDetailSnapshot;
  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command).pipe(Effect.asVoid);
  const emitRequestRejection = (
    event: Extract<OrchestrationEvent, { type: "verification.requested" }>,
    summary: string,
    failureCategory: "configuration_error" | "source_error" = "configuration_error",
  ) =>
    dispatch({
      type: "verification.request.reject",
      commandId: commandId(event.eventId, "request-rejected"),
      projectId: event.payload.projectId,
      missionId: event.payload.missionId,
      taskId: event.payload.taskId,
      failureCategory,
      summary: summary.slice(0, 2_000),
      occurredAt: event.occurredAt,
    });

  const persistProfile = Effect.fn("VerificationOrchestrationReactor.persistProfile")(function* (
    projectIdValue: string,
    profileKey: string,
    discovered: DiscoveredVerificationConfig,
    occurredAt: string,
  ) {
    if (discovered.trust !== "accepted") {
      return yield* Effect.die(
        new Error(`Refused to persist unaccepted verification profile '${profileKey}'.`),
      );
    }
    const id = profileId(projectIdValue, profileKey);
    const sourceProfile = discovered.profiles[profileKey];
    if (sourceProfile === undefined || discovered.revision === null) {
      return yield* Effect.die(
        new Error(`Resolved verification profile '${profileKey}' disappeared.`),
      );
    }
    const existingProfile = yield* configurations.getProfileById({ profileId: id });
    const gates = sourceProfile.gates.map((gate, position) => ({
      id: gateId(id, gate.id),
      profileId: id,
      name: gate.name ?? gate.id,
      description: gate.description ?? "",
      category: gate.category,
      position,
      required: gate.required ?? true,
      enabled: gate.enabled ?? true,
      executionMode: gate.executionMode ?? "sequential",
      failurePolicy: gate.failurePolicy ?? "block",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }));
    const checks = sourceProfile.gates.flatMap((gate) => {
      const persistedGateId = gateId(id, gate.id);
      return gate.checks.map((check) => ({
        id: checkDefinitionId(persistedGateId, check.id),
        gateId: persistedGateId,
        name: check.name,
        command: check.command.executable,
        arguments: [...(check.command.args ?? [])],
        requiresShell: false,
        workingDirectory: check.workingDirectory ?? ".",
        environmentOverrides: Object.entries(check.environment ?? {}).flatMap(([name, value]) =>
          "fromEnvironment" in value ? [{ name, valueFrom: value.fromEnvironment }] : [],
        ),
        timeoutSeconds: check.timeoutSeconds ?? 300,
        allowedExitCodes: [...(check.allowedExitCodes ?? [0])],
        continueOnFailure: check.continueOnFailure ?? false,
        applicableFilePatterns: [...(check.applicability?.include ?? [])],
        excludedFilePatterns: [...(check.applicability?.exclude ?? [])],
        platforms: [...(check.platforms ?? [])],
        artifactPatterns: (check.artifacts ?? []).map((artifact) => artifact.pattern),
        diagnosticParser: check.diagnosticParser ?? "none",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }));
    });
    const profile = {
      id,
      projectId: ProjectId.make(projectIdValue),
      name: sourceProfile.name,
      description: sourceProfile.description ?? "",
      isDefault: discovered.config?.defaultProfile === profileKey,
      triggerModes: [...sourceProfile.triggers],
      configurationRevision: discovered.revision,
      configurationDigest: discovered.revision,
      createdAt: Option.isSome(existingProfile) ? existingProfile.value.createdAt : occurredAt,
      updatedAt: occurredAt,
    };
    yield* configurations.saveProfileGraph({
      profile,
      gates,
      checks,
    });
    yield* dispatch({
      type: "verification.profile.record",
      commandId: commandId(id, `profile:${discovered.revision}`),
      profile,
      operation: Option.isSome(existingProfile) ? "updated" : "created",
      occurredAt,
    });
    return {
      profileId: id,
      gateIds: Object.fromEntries(
        sourceProfile.gates.map((gate) => [gate.id, gateId(id, gate.id)]),
      ),
      checkDefinitionIds: Object.fromEntries(
        sourceProfile.gates.map((gate) => {
          const persistedGateId = gateId(id, gate.id);
          return [
            gate.id,
            Object.fromEntries(
              gate.checks.map((check) => [check.id, checkDefinitionId(persistedGateId, check.id)]),
            ),
          ];
        }),
      ),
    } satisfies VerificationPlanIdentities;
  });

  const persistConfigurationFailure = Effect.fn(
    "VerificationOrchestrationReactor.persistConfigurationFailure",
  )(function* (
    event: Extract<OrchestrationEvent, { type: "verification.requested" }>,
    source: CapturedVerificationSource,
    summary: string,
    configurationPath: string,
    configurationRevision: string,
  ) {
    if (event.payload.scope !== null) {
      return yield* emitRequestRejection(event, summary, "configuration_error");
    }
    const occurredAt = event.occurredAt;
    const validationProfileId = profileId(event.payload.projectId, "configuration-validation");
    const validationGateId = gateId(validationProfileId, "configuration-validation");
    const validationCheckId = checkDefinitionId(validationGateId, "configuration-validation");
    const existingProfile = yield* configurations.getProfileById({
      profileId: validationProfileId,
    });
    const profile = {
      id: validationProfileId,
      projectId: event.payload.projectId,
      name: "Configuration validation",
      description: "Internal evidence for verification configuration failures.",
      isDefault: false,
      triggerModes: ["manual" as const],
      configurationRevision,
      configurationDigest: configurationRevision,
      createdAt: Option.isSome(existingProfile) ? existingProfile.value.createdAt : occurredAt,
      updatedAt: occurredAt,
    };
    yield* configurations.saveProfileGraph({
      profile,
      gates: [
        {
          id: validationGateId,
          profileId: validationProfileId,
          name: "Configuration validation",
          description: "Validates trusted repository verification configuration.",
          category: "custom",
          position: 0,
          required: true,
          enabled: true,
          executionMode: "sequential",
          failurePolicy: "block",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      ],
      checks: [
        {
          id: validationCheckId,
          gateId: validationGateId,
          name: "Configuration validation",
          command: "internal:verification-configuration-validation",
          arguments: [],
          requiresShell: false,
          workingDirectory: ".",
          environmentOverrides: [],
          timeoutSeconds: 1,
          allowedExitCodes: [0],
          continueOnFailure: false,
          applicableFilePatterns: [],
          excludedFilePatterns: [],
          platforms: [],
          artifactPatterns: [],
          diagnosticParser: "none",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      ],
    });
    yield* dispatch({
      type: "verification.profile.record",
      commandId: commandId(validationProfileId, `profile:${configurationRevision}`),
      profile,
      operation: Option.isSome(existingProfile) ? "updated" : "created",
      occurredAt,
    });
    const environment = {
      platform:
        hostPlatform === "darwin" || hostPlatform === "linux" ? hostPlatform : ("win32" as const),
      architecture: hostArchitecture,
      runtimeVersions: {
        node: process.version,
        ...(typeof Bun === "undefined" ? {} : { bun: Bun.version }),
      },
      continuousIntegration: hostEnvironment.CI === "true",
    };
    const plannedCheck = {
      checkDefinitionId: validationCheckId,
      gateId: validationGateId,
      name: "Configuration validation",
      command: "internal:verification-configuration-validation",
      arguments: [],
      requiresShell: false,
      workingDirectory: ".",
      environment: [],
      timeoutSeconds: 1,
      allowedExitCodes: [0],
      continueOnFailure: false,
      artifacts: [],
      diagnosticParser: "none" as const,
      selectionReason: "Validate accepted repository configuration before command execution.",
      selectionSource: "explicit_configuration" as const,
      required: true,
      failurePolicy: "block" as const,
      position: 0,
    };
    const plan: VerificationExecutionPlan = {
      version: 1,
      profileId: validationProfileId,
      profileName: "Configuration validation",
      configurationPath,
      configurationRevision,
      configurationDigest: configurationRevision,
      source,
      changedFiles: [...source.changedFiles],
      environment,
      gates: [
        {
          gateId: validationGateId,
          name: "Configuration validation",
          description: "Validates trusted repository verification configuration.",
          category: "custom",
          position: 0,
          required: true,
          executionMode: "sequential",
          failurePolicy: "block",
          checks: [plannedCheck],
        },
      ],
      skippedChecks: [],
      createdAt: occurredAt,
    };
    const runId = VerificationRunId.make(stableId("verification-run", event.eventId));
    const run: VerificationRun = {
      id: runId,
      projectId: event.payload.projectId,
      missionId: event.payload.missionId,
      taskId: event.payload.taskId,
      worktreeId: event.payload.worktreeId,
      agentRunId: null,
      profileId: validationProfileId,
      requestedBy: event.payload.requestedBy,
      trigger: event.payload.trigger,
      authorizationScope: "full_profile",
      sourceVerificationRunId: null,
      status: "failed",
      configurationRevision,
      configurationDigest: configurationRevision,
      branchName: source.branchName,
      commitHash: source.commitHash,
      dirtyStateFingerprint: source.dirtyStateFingerprint,
      sourceFingerprint: source.sourceFingerprint,
      changedFilesSnapshot: [...source.changedFiles],
      environmentSnapshot: environment,
      executionPlan: plan,
      startedAt: occurredAt,
      completedAt: occurredAt,
      cancelledAt: null,
      result: "failed",
      failureSummary: summary,
      invalidatedAt: null,
      invalidationReason: null,
      createdAt: occurredAt,
    };
    const checkRun: VerificationCheckRun = {
      id: VerificationCheckRunId.make(stableId("verification-check-run", runId, validationCheckId)),
      verificationRunId: runId,
      gateId: validationGateId,
      checkDefinitionId: validationCheckId,
      nameSnapshot: "Configuration validation",
      commandSnapshot: "internal:verification-configuration-validation",
      argumentsSnapshot: [],
      workingDirectorySnapshot: ".",
      selectionReason: plannedCheck.selectionReason,
      status: "failed",
      position: 0,
      startedAt: occurredAt,
      completedAt: occurredAt,
      exitCode: null,
      signal: null,
      durationMilliseconds: 0,
      timedOut: false,
      result: "failed",
      failureCategory: "configuration_error",
      summary: `${summary} No repository command was executed.`,
      logReference: null,
      createdAt: occurredAt,
    };
    yield* runs.saveRun(run);
    yield* runs.saveCheckRun(checkRun);
    yield* emitRequestRejection(event, summary);
    yield* dispatch({
      type: "verification.run.record",
      commandId: commandId(runId, "configuration-failed"),
      run,
      action: "failed",
      occurredAt,
    });
    yield* dispatch({
      type: "verification.gate.record",
      commandId: commandId(runId, `gate:${validationGateId}:failed`),
      projectId: run.projectId,
      missionId: run.missionId,
      verificationRunId: run.id,
      gateId: validationGateId,
      name: "Configuration validation",
      action: "failed",
      summary,
      occurredAt,
    });
    yield* dispatch({
      type: "verification.check.record",
      commandId: commandId(runId, `check:${checkRun.id}:failed`),
      projectId: run.projectId,
      missionId: run.missionId,
      checkRun,
      action: "failed",
      occurredAt,
    });
  });

  const executeRun = Effect.fn("VerificationOrchestrationReactor.executeRun")(function* (
    run: VerificationRun,
    registeredWorktreeRoots: ReadonlyArray<string>,
    baseRef?: string,
  ) {
    const preparing: VerificationRun = { ...run, status: "preparing" };
    yield* runs.saveRun(preparing);
    const startedAt = yield* nowIso;
    const running: VerificationRun = { ...preparing, status: "running", startedAt };
    yield* runs.saveRun(running);
    yield* dispatch({
      type: "verification.run.record",
      commandId: commandId(run.id, "started"),
      run: running,
      action: "started",
      occurredAt: startedAt,
    });

    const queuedChecks = new Map<string, VerificationCheckRun>();
    for (const gate of running.executionPlan.gates) {
      for (const check of gate.checks) {
        const checkRun: VerificationCheckRun = {
          id: VerificationCheckRunId.make(
            stableId("verification-check-run", run.id, check.checkDefinitionId),
          ),
          verificationRunId: run.id,
          gateId: gate.gateId,
          checkDefinitionId: check.checkDefinitionId,
          nameSnapshot: check.name,
          commandSnapshot: check.command,
          argumentsSnapshot: [...check.arguments],
          workingDirectorySnapshot: check.workingDirectory,
          selectionReason: check.selectionReason,
          status: "queued",
          position: check.position,
          startedAt: null,
          completedAt: null,
          exitCode: null,
          signal: null,
          durationMilliseconds: null,
          timedOut: false,
          result: null,
          failureCategory: null,
          summary: null,
          logReference: null,
          createdAt: startedAt,
        };
        queuedChecks.set(check.checkDefinitionId, checkRun);
        yield* runs.saveCheckRun(checkRun);
      }
    }

    const outputCounts = new Map<string, { stdout: number; stderr: number; truncated: boolean }>();
    const startedGates = new Set<string>();
    const onProgress = (progress: VerificationEngineProgress) =>
      Effect.gen(function* () {
        if (progress._tag === "output") {
          const current = outputCounts.get(progress.checkId) ?? {
            stdout: 0,
            stderr: 0,
            truncated: false,
          };
          for (const record of progress.records) {
            if (record.stream === "stdout") current.stdout += Buffer.byteLength(record.text);
            if (record.stream === "stderr") current.stderr += Buffer.byteLength(record.text);
            current.truncated ||= record.truncated;
          }
          outputCounts.set(progress.checkId, current);
          return;
        }
        if (progress._tag !== "check_started") return;
        const queued = queuedChecks.get(progress.checkId);
        if (queued === undefined) return;
        const occurredAt = yield* nowIso;
        if (!startedGates.has(progress.gateId)) {
          startedGates.add(progress.gateId);
          const gate = running.executionPlan.gates.find(
            (candidate) => candidate.gateId === progress.gateId,
          );
          if (gate !== undefined) {
            yield* dispatch({
              type: "verification.gate.record",
              commandId: commandId(run.id, `gate:${gate.gateId}:started`),
              projectId: run.projectId,
              missionId: run.missionId,
              verificationRunId: run.id,
              gateId: gate.gateId,
              name: gate.name,
              action: "started",
              summary: null,
              occurredAt,
            });
          }
        }
        const active = {
          ...queued,
          status: "running" as const,
          startedAt: occurredAt,
          logReference: progress.logReference,
        };
        queuedChecks.set(progress.checkId, active);
        yield* runs.saveCheckRun(active);
        yield* dispatch({
          type: "verification.check.record",
          commandId: commandId(run.id, `check:${active.id}:started`),
          projectId: run.projectId,
          missionId: run.missionId,
          checkRun: active,
          action: "started",
          occurredAt,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("verification progress persistence failed", {
            verificationRunId: run.id,
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const outcome = yield* verificationEngine
      .execute({
        runId: run.id,
        plan: run.executionPlan,
        assignedWorktreeRoot: run.executionPlan.source.worktreeRoot,
        registeredWorktreeRoots,
        ...(baseRef === undefined ? {} : { baseRef }),
        logRoot: path.join(serverConfig.logsDir, "verification"),
        artifactRoot: path.join(serverConfig.stateDir, "verification", "artifacts"),
        managedRuntimeRoot: path.join(serverConfig.stateDir, "verification", "runtime"),
        hostEnvironment,
        onProgress,
      })
      .pipe(Effect.result);
    const completedAt = yield* nowIso;
    if (outcome._tag === "Failure") {
      const failedAction = outcome.failure.reason === "source_mismatch" ? "invalidated" : "failed";
      for (const checkRun of queuedChecks.values()) {
        if (checkRun.status !== "queued" && checkRun.status !== "running") continue;
        const terminalCheck = terminalizeVerificationCheckAfterEngineFailure(
          checkRun,
          completedAt,
          outcome.failure.reason,
          outcome.failure.message,
        );
        yield* runs.saveCheckRun(terminalCheck);
        yield* dispatch({
          type: "verification.check.record",
          commandId: commandId(run.id, `check:${terminalCheck.id}:engine-failure`),
          projectId: run.projectId,
          missionId: run.missionId,
          checkRun: terminalCheck,
          action: terminalCheck.status === "interrupted" ? "interrupted" : "skipped",
          occurredAt: completedAt,
        });
      }
      const failed: VerificationRun = {
        ...running,
        status: failedAction,
        completedAt,
        result: outcome.failure.reason === "source_mismatch" ? null : "failed",
        failureSummary: outcome.failure.message,
        invalidatedAt: outcome.failure.reason === "source_mismatch" ? completedAt : null,
        invalidationReason:
          outcome.failure.reason === "source_mismatch" ? outcome.failure.message : null,
      };
      yield* runs.saveRun(failed);
      yield* dispatch({
        type: "verification.run.record",
        commandId: commandId(run.id, failed.status),
        run: failed,
        action: failedAction,
        occurredAt: completedAt,
      });
      for (const gate of running.executionPlan.gates) {
        yield* dispatch({
          type: "verification.gate.record",
          commandId: commandId(run.id, `gate:${gate.gateId}:engine-failure`),
          projectId: run.projectId,
          missionId: run.missionId,
          verificationRunId: run.id,
          gateId: gate.gateId,
          name: gate.name,
          action: startedGates.has(gate.gateId) ? "failed" : "skipped",
          summary: outcome.failure.message.slice(0, 1_000),
          occurredAt: completedAt,
        });
      }
      return;
    }

    for (const executed of outcome.success.checks) {
      const prior = queuedChecks.get(executed.checkId);
      if (prior === undefined) continue;
      const status = executed.status;
      const result = status === "cancelled" ? "cancelled" : status;
      const finalCheck: VerificationCheckRun = {
        ...prior,
        status,
        startedAt: prior.startedAt,
        completedAt,
        exitCode: executed.exitCode,
        signal: executed.signal,
        durationMilliseconds: executed.durationMilliseconds,
        timedOut: executed.timedOut,
        result,
        failureCategory: executed.failureCategory,
        summary: executed.summary,
        logReference: executed.logReference,
      };
      yield* runs.saveCheckRun(finalCheck);
      yield* dispatch({
        type: "verification.check.record",
        commandId: commandId(run.id, `check:${finalCheck.id}:${status}`),
        projectId: run.projectId,
        missionId: run.missionId,
        checkRun: finalCheck,
        action: executed.timedOut ? "timed_out" : status,
        occurredAt: completedAt,
      });
      const counts = outputCounts.get(executed.checkId);
      if (executed.logReference !== null && counts !== undefined) {
        yield* dispatch({
          type: "verification.check.output.record",
          commandId: commandId(run.id, `check:${finalCheck.id}:output`),
          projectId: run.projectId,
          missionId: run.missionId,
          verificationRunId: run.id,
          checkRunId: finalCheck.id,
          logReference: executed.logReference,
          stdoutBytes: counts.stdout,
          stderrBytes: counts.stderr,
          truncated: counts.truncated,
          occurredAt: completedAt,
        });
      }
      for (const [index, diagnostic] of executed.diagnostics.entries()) {
        const row = {
          id: VerificationDiagnosticId.make(
            stableId("verification-diagnostic", finalCheck.id, String(index)),
          ),
          checkRunId: finalCheck.id,
          severity: diagnostic.severity,
          category: diagnostic.category,
          message: diagnostic.message,
          filePath: diagnostic.filePath,
          line: diagnostic.line,
          column: diagnostic.column,
          code: diagnostic.code,
          rawReference: executed.logReference,
          createdAt: completedAt,
        };
        yield* runs.appendDiagnostic(row);
        yield* dispatch({
          type: "verification.diagnostic.record",
          commandId: commandId(run.id, `diagnostic:${row.id}`),
          projectId: run.projectId,
          missionId: run.missionId,
          verificationRunId: run.id,
          diagnostic: row,
          occurredAt: completedAt,
        });
      }
      for (const [index, artifact] of executed.artifacts.entries()) {
        const row = {
          id: VerificationArtifactId.make(
            stableId("verification-artifact", finalCheck.id, String(index)),
          ),
          verificationRunId: run.id,
          checkRunId: finalCheck.id,
          type: artifact.type,
          name: artifact.name,
          path: artifact.path,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          checksum: artifact.checksum,
          metadata: artifact.metadata,
          createdAt: completedAt,
        };
        yield* runs.appendArtifact(row);
        yield* dispatch({
          type: "verification.artifact.record",
          commandId: commandId(run.id, `artifact:${row.id}`),
          projectId: run.projectId,
          missionId: run.missionId,
          artifact: row,
          occurredAt: completedAt,
        });
      }
    }

    for (const gate of running.executionPlan.gates) {
      const gateChecks = outcome.success.checks.filter((check) => check.gateId === gate.gateId);
      const failed = gateChecks.filter((check) => check.status === "failed");
      const cancelled = gateChecks.filter((check) => check.status === "cancelled");
      const skipped = gateChecks.filter((check) => check.status === "skipped");
      const action =
        gate.checks.length === 0 || (gateChecks.length > 0 && skipped.length === gateChecks.length)
          ? "skipped"
          : failed.length > 0
            ? "failed"
            : "completed";
      const summary =
        action === "failed"
          ? `${failed.length} check${failed.length === 1 ? "" : "s"} failed.`
          : action === "skipped"
            ? "No check in this gate was executed."
            : cancelled.length > 0
              ? `${cancelled.length} check${cancelled.length === 1 ? " was" : "s were"} cancelled.`
              : null;
      yield* dispatch({
        type: "verification.gate.record",
        commandId: commandId(run.id, `gate:${gate.gateId}:${action}`),
        projectId: run.projectId,
        missionId: run.missionId,
        verificationRunId: run.id,
        gateId: gate.gateId,
        name: gate.name,
        action,
        summary,
        occurredAt: completedAt,
      });
    }

    const finalStatus = outcome.success.result;
    const final: VerificationRun = {
      ...running,
      status: finalStatus,
      completedAt,
      cancelledAt: finalStatus === "cancelled" ? completedAt : null,
      result: finalStatus === "invalidated" ? null : finalStatus,
      failureSummary: outcome.success.failureSummary,
      invalidatedAt: finalStatus === "invalidated" ? completedAt : null,
      invalidationReason: finalStatus === "invalidated" ? outcome.success.failureSummary : null,
    };
    yield* runs.saveRun(final);
    yield* dispatch({
      type: "verification.run.record",
      commandId: commandId(run.id, finalStatus),
      run: final,
      action: finalStatus,
      occurredAt: completedAt,
    });
    if (finalStatus === "failed" && run.missionId !== null && run.taskId !== null) {
      const settings = yield* configurations.getProjectSettings({ projectId: run.projectId });
      const isRepairableSourceFailure = shouldAutomaticallyRepairVerification(
        outcome.success.checks,
      );
      if (
        Option.isSome(settings) &&
        settings.value.automaticRepairEnabled &&
        isRepairableSourceFailure
      ) {
        yield* dispatch({
          type: "verification.repair.request",
          commandId: commandId(run.id, "automatic-repair-request"),
          projectId: run.projectId,
          missionId: run.missionId,
          taskId: run.taskId,
          verificationRunId: run.id,
          requestedBy: "system:verification-failure",
          requestedAt: completedAt,
        });
      }
    }
  });

  const processRequested = Effect.fn("VerificationOrchestrationReactor.processRequested")(
    function* (event: Extract<OrchestrationEvent, { type: "verification.requested" }>) {
      const project = yield* projects.getById({ projectId: event.payload.projectId });
      if (Option.isNone(project)) return;
      const settings = yield* configurations.getProjectSettings({
        projectId: event.payload.projectId,
      });
      const detail =
        event.payload.missionId === null
          ? Option.none()
          : yield* getMissionDetailSnapshot(event.payload.missionId);
      const worktree = Option.isNone(detail)
        ? undefined
        : detail.value.managedWorktrees.find((entry) => entry.id === event.payload.worktreeId);
      const assignedRoot = worktree?.worktreePath ?? project.value.workspaceRoot;
      const registeredRoots = Option.isSome(detail)
        ? detail.value.managedWorktrees
            .filter((entry) => entry.status !== "removed")
            .map((entry) => entry.worktreePath)
        : [project.value.workspaceRoot];
      const authorized = yield* pathGuard.authorizeWorktree({
        assignedWorktreeRoot: assignedRoot,
        registeredWorktreeRoots: registeredRoots,
      });
      const baseRef = Option.isSome(detail)
        ? detail.value.managedWorktrees.find(
            (entry) => entry.purpose === "integration" && entry.status !== "removed",
          )?.branchName
        : undefined;
      const source = yield* sourceCapture.capture({
        worktree: authorized,
        ...(baseRef === undefined ? {} : { baseRef }),
      });
      const scopedSourceRun =
        event.payload.scope === null
          ? Option.none<VerificationRun>()
          : yield* runs.getRunById({
              verificationRunId: event.payload.scope.sourceVerificationRunId,
            });
      if (event.payload.scope !== null && Option.isNone(scopedSourceRun)) {
        return yield* emitRequestRejection(
          event,
          "The source verification run for this failed-gate rerun no longer exists.",
          "source_error",
        );
      }
      if (
        Option.isSome(scopedSourceRun) &&
        event.payload.profileId !== null &&
        event.payload.profileId !== scopedSourceRun.value.profileId
      ) {
        return yield* emitRequestRejection(
          event,
          "A failed-gate rerun must use the exact profile from its source verification run.",
          "source_error",
        );
      }
      const scopedSourceChecks = Option.isSome(scopedSourceRun)
        ? yield* runs.listCheckRunsByRunId({ verificationRunId: scopedSourceRun.value.id })
        : [];
      const acceptedRevision = Option.isSome(settings)
        ? (settings.value.acceptedConfigurationDigest ?? undefined)
        : undefined;
      const discovery = yield* configService
        .discover({
          workspaceRoot: assignedRoot,
          ...(acceptedRevision === undefined ? {} : { acceptedRevision }),
        })
        .pipe(Effect.result);
      if (discovery._tag === "Failure") {
        return yield* persistConfigurationFailure(
          event,
          source,
          discovery.failure.message,
          Option.isSome(settings) ? (settings.value.configurationPath ?? "t3.json") : "t3.json",
          acceptedRevision ?? "unaccepted-configuration",
        );
      }
      const discovered = discovery.success;
      if (discovered.trust !== "accepted") {
        return yield* persistConfigurationFailure(
          event,
          source,
          discovered.trust === "not_configured"
            ? "No repository verification configuration is available for this project."
            : "The repository verification configuration has not been explicitly accepted, or it changed after acceptance.",
          discovered.configPath,
          discovered.revision ?? acceptedRevision ?? "unaccepted-configuration",
        );
      }
      const triggerMode =
        event.payload.trigger === "task_completion"
          ? "on_task_completion"
          : event.payload.trigger === "before_integration"
            ? "before_integration"
            : event.payload.trigger === "after_integration"
              ? "after_integration"
              : "manual";
      const selectedKey = Option.isSome(scopedSourceRun)
        ? scopedSourceRun.value.profileId
        : event.payload.profileId === null
          ? event.payload.trigger === "before_integration" && Option.isSome(settings)
            ? (settings.value.preIntegrationProfileId ?? undefined)
            : Option.isSome(settings)
              ? (settings.value.defaultProfileId ?? undefined)
              : undefined
          : event.payload.profileId;
      const selectedProfile =
        selectedKey === undefined
          ? (Object.values(discovered.profiles).find((profile) =>
              profile.triggers.includes(triggerMode),
            ) ?? Object.values(discovered.profiles)[0])
          : Object.values(discovered.profiles).find(
              (profile) =>
                profile.id === selectedKey ||
                profileId(event.payload.projectId, profile.id) === selectedKey,
            );
      if (selectedProfile === undefined) {
        return yield* persistConfigurationFailure(
          event,
          source,
          selectedKey === undefined
            ? "The accepted verification configuration does not define an applicable profile."
            : `The requested verification profile '${selectedKey}' is not present in the accepted configuration.`,
          discovered.configPath,
          discovered.revision ?? acceptedRevision ?? "unaccepted-configuration",
        );
      }
      const createdAt = yield* nowIso;
      const identities = yield* persistProfile(
        event.payload.projectId,
        selectedProfile.id,
        discovered,
        createdAt,
      );
      const planning = yield* planner
        .createPlan({
          discovered,
          profileKey: selectedProfile.id,
          identities,
          source,
          changedFiles: source.changedFiles,
          environment: {
            platform:
              hostPlatform === "darwin" || hostPlatform === "linux" ? hostPlatform : "win32",
            architecture: hostArchitecture,
            runtimeVersions: {
              node: process.version,
              ...(typeof Bun === "undefined" ? {} : { bun: Bun.version }),
            },
            continuousIntegration: hostEnvironment.CI === "true",
          },
          createdAt,
        })
        .pipe(Effect.result);
      if (planning._tag === "Failure") {
        return yield* persistConfigurationFailure(
          event,
          source,
          planning.failure.message,
          discovered.configPath,
          discovered.revision ?? acceptedRevision ?? "unaccepted-configuration",
        );
      }
      let plan: VerificationExecutionPlan = planning.success;
      if (event.payload.scope !== null && Option.isSome(scopedSourceRun)) {
        const diagnosticPlan = createFailedGateDiagnosticPlan({
          plan,
          sourceRun: scopedSourceRun.value,
          sourceCheckRuns: scopedSourceChecks,
          gateId: event.payload.scope.gateId,
          projectId: event.payload.projectId,
          missionId: event.payload.missionId,
          taskId: event.payload.taskId,
          worktreeId: event.payload.worktreeId,
          sourceFingerprint: source.sourceFingerprint,
        });
        if (!diagnosticPlan.ok) {
          return yield* emitRequestRejection(event, diagnosticPlan.summary, "source_error");
        }
        plan = diagnosticPlan.plan;
      }
      const id = VerificationRunId.make(stableId("verification-run", event.eventId));
      const run: VerificationRun = {
        id,
        projectId: event.payload.projectId,
        missionId: event.payload.missionId,
        taskId: event.payload.taskId,
        worktreeId: event.payload.worktreeId,
        agentRunId: null,
        profileId: plan.profileId,
        requestedBy: event.payload.requestedBy,
        trigger: event.payload.trigger,
        authorizationScope: event.payload.scope === null ? "full_profile" : "diagnostic_subset",
        sourceVerificationRunId: event.payload.scope?.sourceVerificationRunId ?? null,
        status: "queued",
        configurationRevision: plan.configurationRevision,
        configurationDigest: plan.configurationDigest,
        branchName: plan.source.branchName,
        commitHash: plan.source.commitHash,
        dirtyStateFingerprint: plan.source.dirtyStateFingerprint,
        sourceFingerprint: plan.source.sourceFingerprint,
        changedFilesSnapshot: [...plan.changedFiles],
        environmentSnapshot: plan.environment,
        executionPlan: plan,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        result: null,
        failureSummary: null,
        invalidatedAt: null,
        invalidationReason: null,
        createdAt,
      };
      yield* runs.saveRun(run);
      yield* dispatch({
        type: "verification.run.record",
        commandId: commandId(id, "plan-created"),
        run,
        action: "plan_created",
        occurredAt: createdAt,
      });
      yield* dispatch({
        type: "verification.run.record",
        commandId: commandId(id, "queued"),
        run,
        action: "queued",
        occurredAt: createdAt,
      });
      yield* executeRun(run, registeredRoots, baseRef);
    },
  );

  const requestAutomatic = Effect.fn("VerificationOrchestrationReactor.requestAutomatic")(
    function* (event: Extract<OrchestrationEvent, { type: "task.implementation-completed" }>) {
      const detail = yield* getMissionDetailSnapshot(event.payload.missionId);
      if (Option.isNone(detail)) return;
      const projectId = detail.value.mission.projectId;
      const settings = yield* configurations.getProjectSettings({ projectId });
      if (Option.isNone(settings) || !settings.value.automaticTaskVerificationEnabled) return;
      const task = detail.value.tasks.find((entry) => entry.id === event.payload.taskId);
      if (task?.worktreeId === null || task?.worktreeId === undefined) return;
      yield* dispatch({
        type: "verification.request",
        commandId: commandId(event.payload.agentRunId ?? event.payload.taskId, "automatic-request"),
        projectId,
        missionId: event.payload.missionId,
        taskId: event.payload.taskId,
        worktreeId: task.worktreeId,
        profileId: settings.value.defaultProfileId,
        requestedBy: "system:task-completion",
        trigger: "task_completion",
        requestedAt: event.occurredAt,
      });
    },
  );

  const processSettingsUpdated = Effect.fn(
    "VerificationOrchestrationReactor.processSettingsUpdated",
  )(function* (event: Extract<OrchestrationEvent, { type: "verification.settings_updated" }>) {
    const acceptedRevision = event.payload.settings.acceptedConfigurationDigest;
    if (acceptedRevision === null) return;
    const project = yield* projects.getById({ projectId: event.payload.settings.projectId });
    if (Option.isNone(project)) return;
    const discovery = yield* configService
      .discover({
        workspaceRoot: project.value.workspaceRoot,
        acceptedRevision,
      })
      .pipe(Effect.result);
    if (discovery._tag === "Failure" || discovery.success.trust !== "accepted") {
      return yield* Effect.logWarning(
        "accepted verification settings could not resolve their profile graph",
        {
          projectId: event.payload.settings.projectId,
          acceptedRevision,
          detail:
            discovery._tag === "Failure"
              ? discovery.failure.message
              : "The repository configuration no longer matches the accepted digest.",
        },
      );
    }
    for (const key of Object.keys(discovery.success.profiles).sort()) {
      yield* persistProfile(
        event.payload.settings.projectId,
        key,
        discovery.success,
        event.occurredAt,
      );
    }
  });

  const requestAfterIntegration = Effect.fn(
    "VerificationOrchestrationReactor.requestAfterIntegration",
  )(function* (event: Extract<OrchestrationEvent, { type: "integration.completed" }>) {
    const detail = yield* getMissionDetailSnapshot(event.payload.missionId);
    if (Option.isNone(detail)) return;
    const projectId = detail.value.mission.projectId;
    const settings = yield* configurations.getProjectSettings({ projectId });
    if (Option.isNone(settings) || settings.value.acceptedConfigurationDigest === null) return;
    const integration = detail.value.managedWorktrees.find(
      (entry) => entry.purpose === "integration" && entry.status !== "removed",
    );
    if (integration === undefined) return;
    const discovery = yield* configService
      .discover({
        workspaceRoot: integration.worktreePath,
        acceptedRevision: settings.value.acceptedConfigurationDigest,
      })
      .pipe(Effect.result);
    if (discovery._tag === "Failure" || discovery.success.trust !== "accepted") return;
    const selected = Object.values(discovery.success.profiles).find((profile) =>
      profile.triggers.includes("after_integration"),
    );
    if (selected === undefined) return;
    yield* dispatch({
      type: "verification.request",
      commandId: commandId(event.eventId, "after-integration-request"),
      projectId,
      missionId: event.payload.missionId,
      taskId: null,
      worktreeId: integration.id,
      profileId: profileId(projectId, selected.id),
      requestedBy: "system:integration-completed",
      trigger: "after_integration",
      requestedAt: event.occurredAt,
    });
  });

  const processRepairRequested = Effect.fn(
    "VerificationOrchestrationReactor.processRepairRequested",
  )(function* (event: Extract<OrchestrationEvent, { type: "verification.repair_requested" }>) {
    const failedRun = yield* runs.getRunById({
      verificationRunId: event.payload.verificationRunId,
    });
    if (
      Option.isNone(failedRun) ||
      failedRun.value.taskId !== event.payload.taskId ||
      failedRun.value.status !== "failed"
    ) {
      return yield* Effect.logWarning("verification repair refused for a non-failed run", {
        verificationRunId: event.payload.verificationRunId,
      });
    }
    const settings = yield* configurations.getProjectSettings({
      projectId: event.payload.projectId,
    });
    const maximumAttempts = Option.isSome(settings) ? settings.value.maximumRepairAttempts : 2;
    const directAttempts = yield* runs.listRepairAttemptsByRunId({
      verificationRunId: event.payload.verificationRunId,
    });
    const ancestorAttempts: Array<VerificationRepairAttempt> = [];
    const seenRuns = new Set<string>();
    let cursor = failedRun.value;
    while (cursor.requestedBy.startsWith("repair:") && !seenRuns.has(cursor.id)) {
      seenRuns.add(cursor.id);
      const ancestor = yield* runs.getRepairAttemptById({
        repairAttemptId: VerificationRepairAttemptId.make(
          cursor.requestedBy.slice("repair:".length),
        ),
      });
      if (Option.isNone(ancestor)) break;
      ancestorAttempts.push(ancestor.value);
      const previousRun = yield* runs.getRunById({
        verificationRunId: ancestor.value.verificationRunId,
      });
      if (Option.isNone(previousRun)) break;
      cursor = previousRun.value;
    }
    const budget = evaluateRepairAttemptBudget({
      ancestorAttempts,
      directAttempts,
      maximumAttempts,
    });
    if (budget.hasActiveAttempt) {
      return yield* Effect.logWarning(
        "verification repair refused while an attempt is already active",
        {
          verificationRunId: event.payload.verificationRunId,
        },
      );
    }
    if (budget.limitReached) {
      const latest = [...budget.history]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1);
      if (latest !== undefined) {
        yield* dispatch({
          type: "verification.repair.record",
          commandId: commandId(failedRun.value.id, "repair-limit-reached"),
          projectId: event.payload.projectId,
          missionId: event.payload.missionId,
          attempt: latest,
          action: "limit_reached",
          summary: `The configured limit of ${maximumAttempts} repair attempts was reached.`,
          occurredAt: event.payload.requestedAt,
        });
      }
      return;
    }

    const detail = yield* getMissionDetailSnapshot(event.payload.missionId);
    if (Option.isNone(detail)) return;
    const task = detail.value.tasks.find((entry) => entry.id === event.payload.taskId);
    const agent = detail.value.missionAgents.find(
      (entry) => entry.id === task?.assignedMissionAgentId,
    );
    const worktree = detail.value.managedWorktrees.find((entry) => entry.id === task?.worktreeId);
    if (
      task === undefined ||
      agent === undefined ||
      agent.model === null ||
      worktree === undefined
    ) {
      return yield* Effect.logWarning("verification repair has no runnable task agent/worktree", {
        verificationRunId: failedRun.value.id,
        taskId: event.payload.taskId,
      });
    }
    const failedChecks = (yield* runs.listCheckRunsByRunId({
      verificationRunId: failedRun.value.id,
    })).filter((check) => check.status === "failed");
    const diagnostics = yield* Effect.forEach(
      failedChecks,
      (check) => runs.listDiagnosticsByCheckRunId({ checkRunId: check.id }),
      { concurrency: "unbounded" },
    );
    const attemptNumber = budget.nextAttemptNumber;
    const attemptId = VerificationRepairAttemptId.make(
      stableId("verification-repair", failedRun.value.id, String(attemptNumber)),
    );
    const agentRunId = AgentRunId.make(stableId("verification-repair-run", attemptId));
    const createdAt = event.payload.requestedAt;
    const summary = failedChecks
      .map(
        (check) =>
          `${check.nameSnapshot}: ${check.failureCategory ?? "unknown"}${check.summary === null ? "" : ` - ${check.summary}`}`,
      )
      .join("\n")
      .slice(0, 20_000);
    const attempt: VerificationRepairAttempt = {
      id: attemptId,
      verificationRunId: failedRun.value.id,
      taskId: task.id,
      agentRunId,
      attemptNumber,
      failureSnapshot: {
        summary: summary || failedRun.value.failureSummary || "Required verification failed.",
        failedCheckRunIds: failedChecks.map((check) => check.id),
        diagnosticIds: diagnostics.flat().map((diagnostic) => diagnostic.id),
        logReferences: failedChecks.flatMap((check) =>
          check.logReference === null ? [] : [check.logReference],
        ),
      },
      status: "running",
      startedAt: createdAt,
      completedAt: null,
      createdAt,
    };
    yield* runs.saveRepairAttempt({ ...attempt, status: "queued", startedAt: null });
    yield* runs.saveRepairAttempt(attempt);
    yield* dispatch({
      type: "verification.repair.record",
      commandId: commandId(failedRun.value.id, `repair:${attemptNumber}:started`),
      projectId: event.payload.projectId,
      missionId: event.payload.missionId,
      attempt,
      action: "started",
      summary: null,
      occurredAt: createdAt,
    });
    const permissions = agent.permissions.filter(
      (permission) =>
        permission !== "manage_tasks" &&
        permission !== "manage_worktrees" &&
        permission !== "integrate_branches",
    );
    yield* dispatch({
      type: "mission.start",
      commandId: commandId(failedRun.value.id, `repair:${attemptNumber}:agent-start`),
      missionId: event.payload.missionId,
      taskId: task.id,
      agentRunId,
      threadId: ThreadId.make(`${agentRunId}:thread`),
      providerInstanceId: agent.providerInstanceId,
      modelSelection: { instanceId: agent.providerInstanceId, model: agent.model },
      runtimeMode:
        permissions.includes("write_files") || permissions.includes("create_commits")
          ? "full-access"
          : "approval-required",
      missionAgentId: agent.id,
      worktreeId: worktree.id,
      attemptNumber,
      permissions,
      writeCapable: permissions.includes("write_files") || permissions.includes("create_commits"),
      purpose: "verification_repair",
      repairAttemptId: attemptId,
      createdAt,
    });
  });

  const processRepairTerminal = Effect.fn("VerificationOrchestrationReactor.processRepairTerminal")(
    function* (
      event: Extract<
        OrchestrationEvent,
        {
          type:
            | "agent_run.completed"
            | "agent_run.cancelled"
            | "agent_run.failed"
            | "agent_run.interrupted";
        }
      >,
    ) {
      const detail = yield* getMissionDetailSnapshot(event.payload.missionId);
      if (Option.isNone(detail) || event.payload.agentRunId === null) return;
      const agentRun = detail.value.agentRuns.find(
        (entry) => entry.id === event.payload.agentRunId,
      );
      if (
        agentRun?.purpose !== "verification_repair" ||
        agentRun.repairAttemptId === undefined ||
        agentRun.repairAttemptId === null
      )
        return;
      const existing = yield* runs.getRepairAttemptById({
        repairAttemptId: agentRun.repairAttemptId,
      });
      if (Option.isNone(existing) || existing.value.status !== "running") return;
      const completedAt = event.occurredAt;
      const completed = event.type === "agent_run.completed";
      const status = completed
        ? "completed"
        : event.type === "agent_run.cancelled"
          ? "cancelled"
          : event.type === "agent_run.interrupted"
            ? "interrupted"
            : "failed";
      const attempt: VerificationRepairAttempt = {
        ...existing.value,
        status,
        completedAt,
      };
      yield* runs.saveRepairAttempt(attempt);
      const failedRun = yield* runs.getRunById({
        verificationRunId: attempt.verificationRunId,
      });
      if (Option.isNone(failedRun)) return;
      yield* dispatch({
        type: "verification.repair.record",
        commandId: commandId(failedRun.value.id, `repair:${attempt.attemptNumber}:${status}`),
        projectId: failedRun.value.projectId,
        missionId: event.payload.missionId,
        attempt,
        action: completed ? "completed" : "failed",
        summary: completed ? null : `Repair agent ended with status '${status}'.`,
        occurredAt: completedAt,
      });
      if (!completed) return;
      yield* dispatch({
        type: "verification.request",
        commandId: commandId(failedRun.value.id, `repair:${attempt.attemptNumber}:retry`),
        projectId: failedRun.value.projectId,
        missionId: failedRun.value.missionId,
        taskId: failedRun.value.taskId,
        worktreeId: failedRun.value.worktreeId,
        profileId: failedRun.value.profileId,
        requestedBy: `repair:${attempt.id}`,
        trigger: "repair_retry",
        requestedAt: completedAt,
      });
    },
  );

  const processOverrideRequested = Effect.fn(
    "VerificationOrchestrationReactor.processOverrideRequested",
  )(function* (event: Extract<OrchestrationEvent, { type: "verification.override_requested" }>) {
    if (event.payload.missionId === null) return;
    const detail = yield* getMissionDetailSnapshot(event.payload.missionId);
    if (Option.isNone(detail)) return;
    const task = detail.value.tasks.find((entry) => entry.id === event.payload.taskId);
    const worktree = detail.value.managedWorktrees.find((entry) => entry.id === task?.worktreeId);
    if (worktree === undefined) return;
    const authorized = yield* pathGuard.authorizeWorktree({
      assignedWorktreeRoot: worktree.worktreePath,
      registeredWorktreeRoots: detail.value.managedWorktrees
        .filter((entry) => entry.status !== "removed")
        .map((entry) => entry.worktreePath),
    });
    const integration = detail.value.managedWorktrees.find(
      (entry) => entry.purpose === "integration" && entry.status !== "removed",
    );
    const source = yield* sourceCapture.capture({
      worktree: authorized,
      ...(integration === undefined ? {} : { baseRef: integration.branchName }),
    });
    if (source.sourceFingerprint !== event.payload.sourceFingerprint) {
      return yield* Effect.logWarning("verification override source fingerprint is stale", {
        taskId: event.payload.taskId,
      });
    }
    const override = {
      id: event.payload.overrideId,
      projectId: event.payload.projectId,
      missionId: event.payload.missionId,
      taskId: event.payload.taskId,
      verificationRunId: event.payload.verificationRunId,
      sourceFingerprint: source.sourceFingerprint,
      reason: event.payload.reason,
      requestedBy: event.payload.requestedBy,
      createdAt: event.payload.requestedAt,
      revokedAt: null,
    };
    yield* runs.appendOverride(override);
    yield* dispatch({
      type: "verification.override.apply",
      commandId: commandId(event.payload.overrideId, "apply"),
      override,
      occurredAt: event.payload.requestedAt,
    });
  });

  const revalidatePassingRun = Effect.fn("VerificationOrchestrationReactor.revalidatePassingRun")(
    function* (run: VerificationRun) {
      if (run.worktreeId === null || run.missionId === null || run.taskId === null) return;
      const detail = yield* getMissionDetailSnapshot(run.missionId);
      if (Option.isNone(detail)) return;
      const worktree = detail.value.managedWorktrees.find((entry) => entry.id === run.worktreeId);
      if (worktree === undefined || worktree.status === "removed") return;
      const authorized = yield* pathGuard.authorizeWorktree({
        assignedWorktreeRoot: worktree.worktreePath,
        registeredWorktreeRoots: detail.value.managedWorktrees
          .filter((entry) => entry.status !== "removed")
          .map((entry) => entry.worktreePath),
      });
      const integration = detail.value.managedWorktrees.find(
        (entry) => entry.purpose === "integration" && entry.status !== "removed",
      );
      const source = yield* sourceCapture.capture({
        worktree: authorized,
        ...(integration === undefined ? {} : { baseRef: integration.branchName }),
      });
      if (source.sourceFingerprint === run.sourceFingerprint) return;
      const invalidatedAt = yield* nowIso;
      yield* runs.invalidateRun({
        verificationRunId: run.id,
        invalidatedAt,
        reason: "The task worktree source changed after verification passed.",
      });
      const invalidated = yield* runs.getRunById({ verificationRunId: run.id });
      if (Option.isSome(invalidated)) {
        yield* dispatch({
          type: "verification.run.record",
          commandId: commandId(run.id, `revalidated:${source.sourceFingerprint}`),
          run: invalidated.value,
          action: "invalidated",
          occurredAt: invalidatedAt,
        });
      }
    },
  );

  const recover = Effect.gen(function* () {
    const active = yield* runs.listActiveRuns();
    const interruptedAt = yield* nowIso;
    for (const run of active) {
      const checkRuns = yield* runs.listCheckRunsByRunId({ verificationRunId: run.id });
      for (const checkRun of checkRuns) {
        if (checkRun.status !== "queued" && checkRun.status !== "running") continue;
        const interruptedCheck = interruptVerificationCheckForRecovery(checkRun, interruptedAt);
        yield* runs.saveCheckRun(interruptedCheck);
        yield* dispatch({
          type: "verification.check.record",
          commandId: commandId(run.id, `check:${checkRun.id}:restart-interrupted`),
          projectId: run.projectId,
          missionId: run.missionId,
          checkRun: interruptedCheck,
          action: "interrupted",
          occurredAt: interruptedAt,
        });
      }
      for (const gate of run.executionPlan.gates) {
        const persistedGateChecks = checkRuns.filter((check) => check.gateId === gate.gateId);
        const wasRunning = persistedGateChecks.some((check) => check.status === "running");
        yield* dispatch({
          type: "verification.gate.record",
          commandId: commandId(run.id, `gate:${gate.gateId}:restart-interrupted`),
          projectId: run.projectId,
          missionId: run.missionId,
          verificationRunId: run.id,
          gateId: gate.gateId,
          name: gate.name,
          action: wasRunning ? "failed" : "skipped",
          summary: wasRunning
            ? "Server restart interrupted an active check in this gate."
            : "Server restart interrupted the run before this gate started.",
          occurredAt: interruptedAt,
        });
      }
      const interrupted: VerificationRun = {
        ...run,
        status: "interrupted",
        completedAt: interruptedAt,
        result: "interrupted",
        failureSummary:
          "Server restarted while verification was active; no completion was fabricated.",
      };
      yield* runs.saveRun(interrupted);
      yield* dispatch({
        type: "verification.run.record",
        commandId: commandId(run.id, "restart-interrupted"),
        run: interrupted,
        action: "interrupted",
        occurredAt: interruptedAt,
      });
    }
    const allProjects = yield* projects.listAll();
    for (const project of allProjects) {
      const projectRuns = yield* runs.listRunsByProjectId({ projectId: project.projectId });
      for (const run of projectRuns) {
        if (run.status === "passed" || run.status === "passed_with_warnings") {
          yield* revalidatePassingRun(run);
        }
      }
    }
  });

  const worker = yield* makeDrainableWorker((event: VerificationTrigger) =>
    (event.type === "verification.requested"
      ? processRequested(event)
      : event.type === "verification.settings_updated"
        ? processSettingsUpdated(event)
        : event.type === "integration.completed"
          ? requestAfterIntegration(event)
          : event.type === "verification.repair_requested"
            ? processRepairRequested(event)
            : event.type === "verification.override_requested"
              ? processOverrideRequested(event)
              : event.type === "agent_run.completed" ||
                  event.type === "agent_run.cancelled" ||
                  event.type === "agent_run.failed" ||
                  event.type === "agent_run.interrupted"
                ? processRepairTerminal(event)
                : Effect.void
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("verification orchestration failed", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        }),
      ),
    ),
  );

  const cancel: VerificationOrchestrationReactorShape["cancel"] = Effect.fn(
    "VerificationOrchestrationReactor.cancel",
  )(function* (verificationRunId) {
    const cancellationAccepted = yield* verificationEngine.cancel(verificationRunId);
    if (!cancellationAccepted) return false;
    yield* Effect.gen(function* () {
      const existing = yield* runs.getRunById({ verificationRunId });
      if (
        Option.isSome(existing) &&
        (existing.value.status === "queued" ||
          existing.value.status === "preparing" ||
          existing.value.status === "running")
      ) {
        yield* runs.saveRun({ ...existing.value, status: "cancelling" });
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("verification cancellation state could not be persisted", {
          verificationRunId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
    return true;
  });

  const revalidateTaskInternal = Effect.fn("VerificationOrchestrationReactor.revalidateTask")(
    function* (taskId: MissionTaskId) {
      const taskRuns = yield* runs.listRunsByTaskId({ taskId });
      const latest = taskRuns
        .toReversed()
        .find((run) => run.status === "passed" || run.status === "passed_with_warnings");
      if (latest !== undefined) yield* revalidatePassingRun(latest);
    },
  );
  const revalidateTask: VerificationOrchestrationReactorShape["revalidateTask"] = (taskId) =>
    revalidateTaskInternal(taskId).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("verification source revalidation failed", {
          taskId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const start: VerificationOrchestrationReactorShape["start"] = Effect.fn(
    "VerificationOrchestrationReactor.start",
  )(function* () {
    yield* recover.pipe(
      Effect.catchCause((cause) =>
        Effect.logError("verification restart recovery failed", { cause: Cause.pretty(cause) }),
      ),
    );
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        if (event.type === "task.implementation-completed") {
          return requestAutomatic(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("automatic verification request failed", {
                taskId: event.payload.taskId,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        }
        if (event.type === "verification.cancel_requested") {
          return cancel(event.payload.verificationRunId).pipe(Effect.asVoid);
        }
        if (
          event.type === "mission.cancellation-requested" ||
          event.type === "task.cancellation-requested"
        ) {
          return runs.listActiveRuns().pipe(
            Effect.flatMap((active) =>
              Effect.forEach(
                active.filter(
                  (run) =>
                    run.missionId === event.payload.missionId &&
                    (event.type === "mission.cancellation-requested" ||
                      run.taskId === event.payload.taskId),
                ),
                (run) => cancel(run.id),
                { concurrency: "unbounded", discard: true },
              ),
            ),
            Effect.catchCause((cause) =>
              Effect.logError("mission verification cancellation failed", {
                missionId: event.payload.missionId,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        }
        if (
          event.type === "verification.requested" ||
          event.type === "verification.settings_updated" ||
          event.type === "integration.completed" ||
          event.type === "verification.repair_requested" ||
          event.type === "verification.override_requested" ||
          event.type === "agent_run.completed" ||
          event.type === "agent_run.cancelled" ||
          event.type === "agent_run.failed" ||
          event.type === "agent_run.interrupted"
        )
          return worker.enqueue(event);
        if (event.type === "managed_worktree.status-updated") {
          return getMissionDetailSnapshot(event.payload.missionId).pipe(
            Effect.flatMap((detail) => {
              if (Option.isNone(detail)) return Effect.void;
              const worktree = detail.value.managedWorktrees.find(
                (entry) => entry.id === event.payload.worktreeId,
              );
              return worktree?.taskId === null || worktree?.taskId === undefined
                ? Effect.void
                : revalidateTask(worktree.taskId);
            }),
          );
        }
        return Effect.void;
      }),
    );
  });

  return {
    start,
    cancel,
    revalidateTask,
    drain: worker.drain,
  } satisfies VerificationOrchestrationReactorShape;
});

export const VerificationOrchestrationReactorLive = Layer.effect(
  VerificationOrchestrationReactor,
  make,
);
