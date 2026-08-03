import { expect, it } from "@effect/vitest";

import {
  AgentRunId,
  ManagedWorktreeId,
  MissionId,
  MissionTaskId,
  ProjectId,
  VerificationProfileId,
  VerificationRepairAttemptId,
  VerificationRunId,
  VerificationCheckDefinitionId,
  VerificationCheckRunId,
  VerificationGateId,
  type VerificationCheckRun,
  type VerificationExecutionPlan,
  type VerificationRepairAttempt,
  type VerificationRun,
} from "@t3tools/contracts";

import {
  evaluateRepairAttemptBudget,
  createFailedGateDiagnosticPlan,
  interruptVerificationCheckForRecovery,
  shouldAutomaticallyRepairVerification,
  terminalizeVerificationCheckAfterEngineFailure,
} from "./VerificationOrchestrationReactor.ts";

const verificationPlan = (): VerificationExecutionPlan => ({
  version: 1,
  profileId: VerificationProfileId.make("profile:standard"),
  profileName: "Standard",
  configurationPath: "t3.json",
  configurationRevision: "revision:1",
  configurationDigest: "digest:1",
  source: {
    worktreeRoot: "C:/repo/worktree",
    branchName: "agent/task",
    commitHash: "abc123",
    dirtyStateFingerprint: null,
    sourceFingerprint: "source:1",
  },
  changedFiles: ["src/example.ts"],
  environment: {
    platform: "win32",
    architecture: "x64",
    runtimeVersions: { node: "v24" },
    continuousIntegration: false,
  },
  gates: [
    {
      gateId: VerificationGateId.make("gate:typecheck"),
      name: "Typecheck",
      description: "Type checks",
      category: "typecheck",
      position: 0,
      required: true,
      executionMode: "sequential",
      failurePolicy: "block",
      checks: [
        {
          checkDefinitionId: VerificationCheckDefinitionId.make("check:typecheck"),
          gateId: VerificationGateId.make("gate:typecheck"),
          name: "TypeScript",
          command: "pnpm",
          arguments: ["typecheck"],
          requiresShell: false,
          workingDirectory: ".",
          environment: [],
          timeoutSeconds: 300,
          allowedExitCodes: [0],
          continueOnFailure: false,
          artifacts: [],
          diagnosticParser: "typescript",
          selectionReason: "Required by the accepted profile",
          selectionSource: "explicit_configuration",
          required: true,
          failurePolicy: "block",
          position: 0,
        },
      ],
    },
    {
      gateId: VerificationGateId.make("gate:tests"),
      name: "Tests",
      description: "Unit tests",
      category: "unit_test",
      position: 1,
      required: true,
      executionMode: "sequential",
      failurePolicy: "block",
      checks: [
        {
          checkDefinitionId: VerificationCheckDefinitionId.make("check:tests"),
          gateId: VerificationGateId.make("gate:tests"),
          name: "Unit tests",
          command: "pnpm",
          arguments: ["test"],
          requiresShell: false,
          workingDirectory: ".",
          environment: [],
          timeoutSeconds: 300,
          allowedExitCodes: [0],
          continueOnFailure: false,
          artifacts: [],
          diagnosticParser: "test",
          selectionReason: "Required by the accepted profile",
          selectionSource: "explicit_configuration",
          required: true,
          failurePolicy: "block",
          position: 0,
        },
      ],
    },
  ],
  skippedChecks: [],
  createdAt: "2026-08-03T00:00:00.000Z",
});

const failedSourceRun = (plan: VerificationExecutionPlan): VerificationRun => ({
  id: VerificationRunId.make("verification-run:failed"),
  projectId: ProjectId.make("project"),
  missionId: MissionId.make("mission"),
  taskId: MissionTaskId.make("task"),
  worktreeId: ManagedWorktreeId.make("worktree"),
  agentRunId: null,
  profileId: plan.profileId,
  requestedBy: "test",
  trigger: "task_completion",
  authorizationScope: "full_profile",
  sourceVerificationRunId: null,
  status: "failed",
  configurationRevision: plan.configurationRevision,
  configurationDigest: plan.configurationDigest,
  branchName: plan.source.branchName,
  commitHash: plan.source.commitHash,
  dirtyStateFingerprint: plan.source.dirtyStateFingerprint,
  sourceFingerprint: plan.source.sourceFingerprint,
  changedFilesSnapshot: [...plan.changedFiles],
  environmentSnapshot: plan.environment,
  executionPlan: plan,
  startedAt: "2026-08-03T00:00:00.000Z",
  completedAt: "2026-08-03T00:00:01.000Z",
  cancelledAt: null,
  result: "failed",
  failureSummary: "Typecheck failed",
  invalidatedAt: null,
  invalidationReason: null,
  createdAt: "2026-08-03T00:00:00.000Z",
});

const failedCheckRun = (): VerificationCheckRun => ({
  id: VerificationCheckRunId.make("check-run:failed"),
  verificationRunId: VerificationRunId.make("verification-run:failed"),
  gateId: VerificationGateId.make("gate:typecheck"),
  checkDefinitionId: VerificationCheckDefinitionId.make("check:typecheck"),
  nameSnapshot: "TypeScript",
  commandSnapshot: "pnpm",
  argumentsSnapshot: ["typecheck"],
  workingDirectorySnapshot: ".",
  selectionReason: "Required by the accepted profile",
  status: "failed",
  position: 0,
  startedAt: "2026-08-03T00:00:00.000Z",
  completedAt: "2026-08-03T00:00:01.000Z",
  exitCode: 1,
  signal: null,
  durationMilliseconds: 1_000,
  timedOut: false,
  result: "failed",
  failureCategory: "type_error",
  summary: "TypeScript failed",
  logReference: "verification/run/check.jsonl",
  createdAt: "2026-08-03T00:00:00.000Z",
});

const attempt = (number: number, runId: string): VerificationRepairAttempt => ({
  id: VerificationRepairAttemptId.make(`repair-${number}`),
  verificationRunId: VerificationRunId.make(runId),
  taskId: MissionTaskId.make("task"),
  agentRunId: AgentRunId.make(`repair-agent-${number}`),
  attemptNumber: number,
  failureSnapshot: {
    summary: "Verification still fails.",
    failedCheckRunIds: [],
    diagnosticIds: [],
    logReferences: [],
  },
  status: "failed",
  startedAt: `2026-08-03T00:00:0${number}.000Z`,
  completedAt: `2026-08-03T00:00:0${number}.500Z`,
  createdAt: `2026-08-03T00:00:0${number}.000Z`,
});

it("interrupts active checks on recovery without discarding partial log evidence", () => {
  const running: VerificationCheckRun = {
    id: VerificationCheckRunId.make("check-run"),
    verificationRunId: VerificationRunId.make("verification-run"),
    gateId: VerificationGateId.make("gate"),
    checkDefinitionId: VerificationCheckDefinitionId.make("check"),
    nameSnapshot: "Typecheck",
    commandSnapshot: "pnpm",
    argumentsSnapshot: ["typecheck"],
    workingDirectorySnapshot: ".",
    selectionReason: "Required gate",
    status: "running",
    position: 0,
    startedAt: "2026-08-03T00:00:01.000Z",
    completedAt: null,
    exitCode: null,
    signal: null,
    durationMilliseconds: null,
    timedOut: false,
    result: null,
    failureCategory: null,
    summary: null,
    logReference: "verification/run/check.jsonl",
    createdAt: "2026-08-03T00:00:00.000Z",
  };

  const interrupted = interruptVerificationCheckForRecovery(running, "2026-08-03T00:00:02.000Z");

  expect(interrupted.status).toBe("interrupted");
  expect(interrupted.result).toBe("interrupted");
  expect(interrupted.failureCategory).toBe("process_crash");
  expect(interrupted.logReference).toBe(running.logReference);
  expect(interrupted.completedAt).toBe("2026-08-03T00:00:02.000Z");
});

it("terminalizes planned checks when the engine fails instead of leaving stale active evidence", () => {
  const queued: VerificationCheckRun = {
    id: VerificationCheckRunId.make("check-run"),
    verificationRunId: VerificationRunId.make("verification-run"),
    gateId: VerificationGateId.make("gate"),
    checkDefinitionId: VerificationCheckDefinitionId.make("check"),
    nameSnapshot: "Typecheck",
    commandSnapshot: "pnpm",
    argumentsSnapshot: ["typecheck"],
    workingDirectorySnapshot: ".",
    selectionReason: "Required gate",
    status: "queued",
    position: 0,
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
    createdAt: "2026-08-03T00:00:00.000Z",
  };
  const completedAt = "2026-08-03T00:00:02.000Z";

  const invalidated = terminalizeVerificationCheckAfterEngineFailure(
    queued,
    completedAt,
    "source_mismatch",
    "The fingerprint changed.",
  );
  expect(invalidated.status).toBe("skipped");
  expect(invalidated.result).toBe("skipped");
  expect(invalidated.failureCategory).toBeNull();
  expect(invalidated.summary).toContain("no longer matched");

  const interrupted = terminalizeVerificationCheckAfterEngineFailure(
    {
      ...queued,
      status: "running",
      startedAt: "2026-08-03T00:00:01.000Z",
      logReference: "verification/run/check.jsonl",
    },
    completedAt,
    "managed_directory_failed",
    "The durable log directory became unavailable.",
  );
  expect(interrupted.status).toBe("interrupted");
  expect(interrupted.result).toBe("interrupted");
  expect(interrupted.failureCategory).toBe("process_crash");
  expect(interrupted.logReference).toBe("verification/run/check.jsonl");
});

it("creates an immutable failed-gate diagnostic plan without authorizing omitted required gates", () => {
  const plan = verificationPlan();
  const result = createFailedGateDiagnosticPlan({
    plan,
    sourceRun: failedSourceRun(plan),
    sourceCheckRuns: [failedCheckRun()],
    gateId: VerificationGateId.make("gate:typecheck"),
    projectId: "project",
    missionId: "mission",
    taskId: "task",
    worktreeId: "worktree",
    sourceFingerprint: "source:1",
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan).not.toBe(plan);
  expect(result.plan.gates.map((gate) => gate.gateId)).toEqual(["gate:typecheck"]);
  expect(result.plan.skippedChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        checkDefinitionId: "check:tests",
        required: true,
        explicitlyNotApplicable: true,
      }),
    ]),
  );
  expect(result.plan.skippedChecks[0]?.reason).toContain("cannot authorize integration");
  expect(plan.gates).toHaveLength(2);
  expect(plan.skippedChecks).toHaveLength(0);
});

it("rejects a failed-gate rerun after its exact source fingerprint changes", () => {
  const plan = verificationPlan();
  const result = createFailedGateDiagnosticPlan({
    plan,
    sourceRun: failedSourceRun(plan),
    sourceCheckRuns: [failedCheckRun()],
    gateId: VerificationGateId.make("gate:typecheck"),
    projectId: "project",
    missionId: "mission",
    taskId: "task",
    worktreeId: "worktree",
    sourceFingerprint: "source:changed",
  });

  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      summary: expect.stringContaining("source state changed"),
    }),
  );
});

it("counts repair attempts across retry verification runs and refuses a third", () => {
  const budget = evaluateRepairAttemptBudget({
    ancestorAttempts: [attempt(2, "verification-run-1"), attempt(1, "verification-run-0")],
    directAttempts: [],
    maximumAttempts: 2,
  });

  expect(budget.history).toHaveLength(2);
  expect(budget.limitReached).toBe(true);
  expect(budget.nextAttemptNumber).toBe(3);
});

it("only automatically repairs blocking source failures", () => {
  expect(
    shouldAutomaticallyRepairVerification([
      { status: "failed", failurePolicy: "block", failureCategory: "type_error" },
    ]),
  ).toBe(true);
  for (const failureCategory of [
    "environment_error",
    "configuration_error",
    "permission_error",
    "timeout",
    "process_crash",
    "cancelled",
  ]) {
    expect(
      shouldAutomaticallyRepairVerification([
        { status: "failed", failurePolicy: "block", failureCategory },
      ]),
    ).toBe(false);
  }
});
