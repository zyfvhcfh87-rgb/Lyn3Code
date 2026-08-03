// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  MissionId,
  MissionTaskId,
  ProjectId,
  VerificationArtifactId,
  VerificationCheckDefinitionId,
  VerificationCheckRunId,
  VerificationDiagnosticId,
  VerificationGateId,
  VerificationOverrideId,
  VerificationProfileId,
  VerificationRepairAttemptId,
  VerificationRunId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlClientService from "effect/unstable/sql/SqlClient";

import { ProjectionVerificationConfigurationRepository } from "../Services/ProjectionVerificationConfiguration.ts";
import { ProjectionVerificationRunRepository } from "../Services/ProjectionVerificationRuns.ts";
import { ProjectionVerificationConfigurationRepositoryLive } from "./ProjectionVerificationConfiguration.ts";
import { ProjectionVerificationRunRepositoryLive } from "./ProjectionVerificationRuns.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";

const now = "2026-08-03T00:00:00.000Z";
const later = "2026-08-03T00:01:00.000Z";
const projectId = ProjectId.make("project-verification-repository");
const missionId = MissionId.make("mission-verification-repository");
const taskId = MissionTaskId.make("task-verification-repository");
const profileId = VerificationProfileId.make("profile-standard");
const gateId = VerificationGateId.make("gate-typecheck");
const checkDefinitionId = VerificationCheckDefinitionId.make("check-typescript");
const verificationRunId = VerificationRunId.make("verification-run-one");
const checkRunId = VerificationCheckRunId.make("check-run-one");

function makeLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  return Layer.mergeAll(
    ProjectionVerificationConfigurationRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    ProjectionVerificationRunRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
    persistenceLayer,
  );
}

const profile = {
  id: profileId,
  projectId,
  name: "standard",
  description: "Required verification",
  isDefault: true,
  triggerModes: ["on_task_completion", "before_integration"] as const,
  configurationRevision: "revision-1",
  configurationDigest: "sha256:configuration-one",
  createdAt: now,
  updatedAt: now,
};
const gate = {
  id: gateId,
  profileId,
  name: "Typecheck",
  description: "TypeScript compiler",
  category: "typecheck" as const,
  position: 0,
  required: true,
  enabled: true,
  executionMode: "sequential" as const,
  failurePolicy: "block" as const,
  createdAt: now,
  updatedAt: now,
};
const checkDefinition = {
  id: checkDefinitionId,
  gateId,
  name: "TypeScript",
  command: "bun",
  arguments: ["run", "typecheck"],
  requiresShell: false,
  workingDirectory: ".",
  environmentOverrides: [],
  timeoutSeconds: 300,
  allowedExitCodes: [0],
  continueOnFailure: false,
  applicableFilePatterns: ["**/*.ts"],
  excludedFilePatterns: [],
  platforms: ["win32", "linux", "darwin"] as const,
  artifactPatterns: ["reports/*.xml"],
  diagnosticParser: "typescript" as const,
  createdAt: now,
  updatedAt: now,
};

const environment = {
  platform: "win32",
  architecture: "x64",
  runtimeVersions: { node: "24" },
  continuousIntegration: false,
};
const source = {
  worktreeRoot: "C:/tmp/repository-worktree",
  branchName: "agent/mission/task",
  commitHash: "abc123",
  dirtyStateFingerprint: null,
  sourceFingerprint: "sha256:source-one",
};
const executionPlan = {
  version: 1 as const,
  profileId,
  profileName: "standard",
  configurationPath: "C:/tmp/repository-worktree/t3.json",
  configurationRevision: "revision-1",
  configurationDigest: "sha256:configuration-one",
  source,
  changedFiles: ["src/example.ts"],
  environment,
  gates: [
    {
      gateId,
      name: "Typecheck",
      description: "TypeScript compiler",
      category: "typecheck" as const,
      position: 0,
      required: true,
      executionMode: "sequential" as const,
      failurePolicy: "block" as const,
      checks: [
        {
          checkDefinitionId,
          gateId,
          name: "TypeScript",
          command: "bun",
          arguments: ["run", "typecheck"],
          requiresShell: false,
          workingDirectory: ".",
          environment: [],
          timeoutSeconds: 300,
          allowedExitCodes: [0],
          continueOnFailure: false,
          artifacts: [
            {
              pattern: "reports/*.xml",
              type: "report" as const,
              name: "Test report",
              required: true,
              maxBytes: 1_000_000,
            },
          ],
          diagnosticParser: "typescript" as const,
          selectionReason: "TypeScript source changed",
          selectionSource: "explicit_configuration" as const,
          required: true,
          failurePolicy: "block" as const,
          position: 0,
        },
      ],
    },
  ],
  skippedChecks: [],
  createdAt: now,
};
const queuedRun = {
  id: verificationRunId,
  projectId,
  missionId,
  taskId,
  worktreeId: null,
  agentRunId: null,
  profileId,
  requestedBy: "user",
  trigger: "task_completion" as const,
  authorizationScope: "full_profile" as const,
  sourceVerificationRunId: null,
  status: "queued" as const,
  configurationRevision: "revision-1",
  configurationDigest: "sha256:configuration-one",
  branchName: source.branchName,
  commitHash: source.commitHash,
  dirtyStateFingerprint: null,
  sourceFingerprint: source.sourceFingerprint,
  changedFilesSnapshot: ["src/example.ts"],
  environmentSnapshot: environment,
  executionPlan,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  result: null,
  failureSummary: null,
  invalidatedAt: null,
  invalidationReason: null,
  createdAt: now,
};

const seed = Effect.gen(function* () {
  const sql = yield* SqlClientService.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (${projectId}, 'Verification', '/tmp/repository', NULL, '[]', ${now}, ${now}, NULL)
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_missions (
      mission_id, project_id, title, description, status, created_at, updated_at,
      started_at, completed_at, cancelled_at
    ) VALUES (
      ${missionId}, ${projectId}, 'Verify', '', 'running', ${now}, ${now}, ${now}, NULL, NULL
    )
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_mission_tasks (
      task_id, mission_id, title, description, status, position, created_at, updated_at,
      started_at, completed_at
    ) VALUES (${taskId}, ${missionId}, 'Implement', '', 'verification', 0, ${now}, ${now}, ${now}, NULL)
  `;
  const configuration = yield* ProjectionVerificationConfigurationRepository;
  yield* configuration.saveProfileGraph({
    profile,
    gates: [gate],
    checks: [checkDefinition],
  });
});

const layer = it.layer(makeLayer(SqlitePersistenceMemory));

layer("verification persistence repositories", (it) => {
  it.effect("persists profile graphs transactionally and validates ownership", () =>
    Effect.gen(function* () {
      yield* seed;
      const repository = yield* ProjectionVerificationConfigurationRepository;
      assert.deepStrictEqual(
        (yield* repository.listProfilesByProjectId({ projectId })).map((item) => item.id),
        [profileId],
      );
      assert.deepStrictEqual(
        (yield* repository.listGatesByProfileId({ profileId })).map((item) => item.id),
        [gateId],
      );
      assert.deepStrictEqual(
        (yield* repository.listCheckDefinitionsByGateId({ gateId })).map((item) => item.id),
        [checkDefinitionId],
      );

      const error = yield* Effect.flip(
        repository.saveProfileGraph({
          profile,
          gates: [{ ...gate, profileId: VerificationProfileId.make("another-profile") }],
          checks: [checkDefinition],
        }),
      );
      assert.strictEqual(error._tag, "VerificationProjectionValidationError");
    }),
  );

  it.effect("enforces transitions and preserves a passing result during invalidation", () =>
    Effect.gen(function* () {
      yield* seed;
      const repository = yield* ProjectionVerificationRunRepository;
      yield* repository.saveRun(queuedRun);
      assert.deepStrictEqual(
        (yield* repository.listActiveRuns()).map((run) => run.id),
        [verificationRunId],
      );

      const invalid = yield* Effect.flip(
        repository.saveRun({
          ...queuedRun,
          status: "passed",
          result: "passed",
          completedAt: later,
        }),
      );
      assert.strictEqual(invalid._tag, "VerificationProjectionValidationError");

      const running = {
        ...queuedRun,
        status: "running" as const,
        startedAt: now,
      };
      yield* repository.saveRun({ ...queuedRun, status: "preparing" });
      yield* repository.saveRun(running);
      yield* repository.saveRun({
        ...running,
        status: "passed",
        result: "passed",
        completedAt: later,
      });
      yield* repository.invalidateRun({
        verificationRunId,
        invalidatedAt: later,
        reason: "source fingerprint changed",
      });
      const stored = yield* repository.getRunById({ verificationRunId });
      assert.ok(Option.isSome(stored));
      assert.strictEqual(stored.value.status, "invalidated");
      assert.strictEqual(stored.value.result, "passed");
      assert.strictEqual(stored.value.invalidationReason, "source fingerprint changed");
    }),
  );

  it.effect("preserves a failed full run when a linked diagnostic gate rerun is created", () =>
    Effect.gen(function* () {
      yield* seed;
      const repository = yield* ProjectionVerificationRunRepository;
      const sourceRunId = VerificationRunId.make("verification-run-diagnostic-source");
      const sourceQueued = { ...queuedRun, id: sourceRunId };
      yield* repository.saveRun(sourceQueued);
      yield* repository.saveRun({ ...sourceQueued, status: "preparing" });
      const running = { ...sourceQueued, status: "running" as const, startedAt: now };
      yield* repository.saveRun(running);
      yield* repository.saveRun({
        ...running,
        status: "failed",
        result: "failed",
        completedAt: later,
        failureSummary: "Typecheck failed",
      });

      const diagnosticRunId = VerificationRunId.make("verification-run-diagnostic");
      const diagnosticQueued = {
        ...queuedRun,
        id: diagnosticRunId,
        trigger: "retry_failed_gate",
        authorizationScope: "diagnostic_subset",
        sourceVerificationRunId: sourceRunId,
        createdAt: later,
      } as const;
      yield* repository.saveRun(diagnosticQueued);
      yield* repository.saveRun({ ...diagnosticQueued, status: "preparing" });
      const diagnosticRunning = {
        ...diagnosticQueued,
        status: "running" as const,
        startedAt: later,
      };
      yield* repository.saveRun(diagnosticRunning);
      yield* repository.saveRun({
        ...diagnosticRunning,
        status: "passed",
        result: "passed",
        completedAt: later,
      });

      const history = yield* repository.listRunsByTaskId({ taskId });
      assert.deepStrictEqual(
        new Set(history.map((run) => run.id)),
        new Set([verificationRunId, sourceRunId, diagnosticRunId]),
      );
      const sourceRun = yield* repository.getRunById({ verificationRunId: sourceRunId });
      assert.ok(Option.isSome(sourceRun));
      assert.strictEqual(sourceRun.value.status, "failed");
      assert.strictEqual(sourceRun.value.result, "failed");
      assert.strictEqual(sourceRun.value.authorizationScope, "full_profile");
    }),
  );

  it.effect("appends check evidence, diagnostics, artifacts, repairs, and explicit overrides", () =>
    Effect.gen(function* () {
      yield* seed;
      const repository = yield* ProjectionVerificationRunRepository;
      const evidenceRunId = VerificationRunId.make("verification-run-evidence");
      const evidenceQueuedRun = { ...queuedRun, id: evidenceRunId };
      yield* repository.saveRun(evidenceQueuedRun);
      const queuedCheck = {
        id: checkRunId,
        verificationRunId: evidenceRunId,
        gateId,
        checkDefinitionId,
        nameSnapshot: "TypeScript",
        commandSnapshot: "bun",
        argumentsSnapshot: ["run", "typecheck"],
        workingDirectorySnapshot: ".",
        selectionReason: "TypeScript source changed",
        status: "queued" as const,
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
        createdAt: now,
      };
      yield* repository.saveCheckRun(queuedCheck);
      yield* repository.saveCheckRun({ ...queuedCheck, status: "running", startedAt: now });
      yield* repository.saveCheckRun({
        ...queuedCheck,
        status: "failed",
        startedAt: now,
        completedAt: later,
        exitCode: 1,
        durationMilliseconds: 60_000,
        result: "failed",
        failureCategory: "type_error",
        summary: "One type error",
        logReference: "verification/run/check.log",
      });

      const diagnosticId = VerificationDiagnosticId.make("diagnostic-one");
      yield* repository.appendDiagnostic({
        id: diagnosticId,
        checkRunId,
        severity: "error",
        category: "typescript",
        message: "Type mismatch",
        filePath: "src/example.ts",
        line: 4,
        column: 8,
        code: "TS2322",
        rawReference: "verification/run/check.log#L1",
        createdAt: later,
      });
      yield* repository.appendArtifact({
        id: VerificationArtifactId.make("artifact-one"),
        verificationRunId: evidenceRunId,
        checkRunId,
        type: "report",
        name: "TypeScript report",
        path: "verification/run/report.json",
        mimeType: "application/json",
        sizeBytes: 42,
        checksum: "sha256:artifact",
        metadata: { parser: "typescript" },
        createdAt: later,
      });
      const repairAttemptId = VerificationRepairAttemptId.make("repair-one");
      const queuedRepair = {
        id: repairAttemptId,
        verificationRunId: evidenceRunId,
        taskId,
        agentRunId: null,
        attemptNumber: 1,
        failureSnapshot: {
          summary: "TypeScript failed",
          failedCheckRunIds: [checkRunId],
          diagnosticIds: [diagnosticId],
          logReferences: ["verification/run/check.log"],
        },
        status: "queued" as const,
        startedAt: null,
        completedAt: null,
        createdAt: later,
      };
      yield* repository.saveRepairAttempt(queuedRepair);
      yield* repository.saveRepairAttempt({ ...queuedRepair, status: "running", startedAt: later });
      yield* repository.saveRepairAttempt({
        ...queuedRepair,
        status: "completed",
        startedAt: later,
        completedAt: later,
      });

      const overrideId = VerificationOverrideId.make("override-one");
      yield* repository.appendOverride({
        id: overrideId,
        projectId,
        missionId,
        taskId,
        verificationRunId: evidenceRunId,
        sourceFingerprint: source.sourceFingerprint,
        reason: "Reviewed environment-only failure",
        requestedBy: "user",
        createdAt: later,
        revokedAt: null,
      });
      yield* repository.revokeOverride({ overrideId, revokedAt: later });

      assert.strictEqual((yield* repository.listDiagnosticsByCheckRunId({ checkRunId })).length, 1);
      assert.strictEqual(
        (yield* repository.listArtifactsByRunId({ verificationRunId: evidenceRunId })).length,
        1,
      );
      assert.strictEqual(
        (yield* repository.listRepairAttemptsByRunId({ verificationRunId: evidenceRunId })).length,
        1,
      );
      assert.strictEqual(
        (yield* repository.listOverridesByTaskId({ taskId }))[0]?.revokedAt,
        later,
      );
    }),
  );
});

describe("verification persistence restart recovery", () => {
  it.effect("reloads active immutable plans for deterministic interruption recovery", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-verification-"))),
      (tempDir) =>
        Effect.gen(function* () {
          const dbPath = NodePath.join(tempDir, "state.sqlite");
          yield* Effect.gen(function* () {
            yield* seed;
            const repository = yield* ProjectionVerificationRunRepository;
            yield* repository.saveRun(queuedRun);
            yield* repository.saveRun({ ...queuedRun, status: "preparing" });
            yield* repository.saveRun({ ...queuedRun, status: "running", startedAt: now });
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));

          yield* Effect.gen(function* () {
            const repository = yield* ProjectionVerificationRunRepository;
            const active = yield* repository.listActiveRuns();
            assert.strictEqual(active.length, 1);
            assert.strictEqual(active[0]?.status, "running");
            assert.deepStrictEqual(active[0]?.executionPlan, executionPlan);
            yield* repository.saveRun({
              ...active[0]!,
              status: "interrupted",
              result: "interrupted",
              completedAt: later,
              failureSummary:
                "Server restarted while verification was active; no completion was fabricated.",
            });
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));

          yield* Effect.gen(function* () {
            const repository = yield* ProjectionVerificationRunRepository;
            assert.strictEqual((yield* repository.listActiveRuns()).length, 0);
            const recovered = yield* repository.getRunById({ verificationRunId });
            assert.strictEqual(Option.isSome(recovered), true);
            if (Option.isNone(recovered)) return;
            assert.strictEqual(recovered.value.status, "interrupted");
            assert.strictEqual(recovered.value.result, "interrupted");
            assert.strictEqual(recovered.value.completedAt, later);
            assert.match(recovered.value.failureSummary ?? "", /no completion was fabricated/u);
            assert.deepStrictEqual(recovered.value.executionPlan, executionPlan);
          }).pipe(Effect.provide(makeLayer(makeSqlitePersistenceLive(dbPath))));
        }),
      (tempDir) => Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
