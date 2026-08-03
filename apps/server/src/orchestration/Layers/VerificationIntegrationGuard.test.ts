import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  VerificationOverride,
  VerificationRun,
  type VerificationRunResult,
  type VerificationRunStatus,
} from "@t3tools/contracts";

import { evaluateVerificationIntegrationEvidence } from "./MissionWorktreeReactor.ts";

const now = "2026-08-03T12:00:00.000Z";
const later = "2026-08-03T12:01:00.000Z";
const decodeVerificationRun = Schema.decodeUnknownSync(VerificationRun);
const decodeVerificationOverride = Schema.decodeUnknownSync(VerificationOverride);

const makeRun = (input: {
  readonly id: string;
  readonly sourceFingerprint: string;
  readonly profileId?: string;
  readonly status?: VerificationRunStatus;
  readonly result?: VerificationRunResult;
  readonly invalidatedAt?: string | null;
  readonly diagnosticSourceRunId?: string;
}) =>
  decodeVerificationRun({
    id: input.id,
    projectId: "project:verification",
    missionId: "mission:verification",
    taskId: "task:verification",
    worktreeId: "worktree:verification",
    agentRunId: null,
    profileId: input.profileId ?? "profile:standard",
    requestedBy: "user:test",
    trigger: "before_integration",
    authorizationScope:
      input.diagnosticSourceRunId === undefined ? "full_profile" : "diagnostic_subset",
    sourceVerificationRunId: input.diagnosticSourceRunId ?? null,
    status: input.status ?? "passed",
    configurationRevision: "revision:1",
    configurationDigest: "digest:1",
    branchName: "agent/task",
    commitHash: "abc123",
    dirtyStateFingerprint: null,
    sourceFingerprint: input.sourceFingerprint,
    changedFilesSnapshot: ["source.ts"],
    environmentSnapshot: {
      platform: "win32",
      architecture: "x64",
      runtimeVersions: { node: "24" },
      continuousIntegration: false,
    },
    executionPlan: {
      version: 1,
      profileId: input.profileId ?? "profile:standard",
      profileName: "Standard",
      configurationPath: "t3.json",
      configurationRevision: "revision:1",
      configurationDigest: "digest:1",
      source: {
        worktreeRoot: "C:/temp/task",
        branchName: "agent/task",
        commitHash: "abc123",
        dirtyStateFingerprint: null,
        sourceFingerprint: input.sourceFingerprint,
      },
      changedFiles: ["source.ts"],
      environment: {
        platform: "win32",
        architecture: "x64",
        runtimeVersions: { node: "24" },
        continuousIntegration: false,
      },
      gates: [],
      skippedChecks: [],
      createdAt: now,
    },
    startedAt: now,
    completedAt: later,
    cancelledAt: null,
    result: input.result ?? "passed",
    failureSummary: null,
    invalidatedAt: input.invalidatedAt ?? null,
    invalidationReason:
      input.invalidatedAt === undefined || input.invalidatedAt === null
        ? null
        : "Source changed after verification.",
    createdAt: now,
  });

const makeOverride = (sourceFingerprint: string, revokedAt: string | null = null) =>
  decodeVerificationOverride({
    id: "override:verification",
    projectId: "project:verification",
    missionId: "mission:verification",
    taskId: "task:verification",
    verificationRunId: "run:failed",
    sourceFingerprint,
    reason: "Reviewed environment-only failure",
    requestedBy: "user:test",
    createdAt: later,
    revokedAt,
  });

describe("verification integration evidence", () => {
  it("authorizes only a passing required-profile run for the exact current source", () => {
    const current = makeRun({ id: "run:current", sourceFingerprint: "source:current" });
    const failed = makeRun({
      id: "run:failed",
      sourceFingerprint: "source:current",
      status: "failed",
      result: "failed",
    });
    const wrongProfile = makeRun({
      id: "run:wrong-profile",
      sourceFingerprint: "source:current",
      profileId: "profile:fast",
    });

    const evidence = evaluateVerificationIntegrationEvidence({
      requiredProfileId: "profile:standard",
      sourceFingerprint: "source:current",
      runs: [failed, wrongProfile, current],
      overrides: [],
    });

    expect(evidence.authorized).toBe(true);
    expect(evidence.matchingRun?.id).toBe("run:current");
    expect(evidence.matchingOverride).toBeUndefined();
  });

  it("blocks a formerly passing result after source mutation or invalidation", () => {
    const formerlyPassing = makeRun({
      id: "run:old-source",
      sourceFingerprint: "source:old",
    });
    const invalidatedCurrent = makeRun({
      id: "run:invalidated",
      sourceFingerprint: "source:current",
      status: "invalidated",
      result: "passed",
      invalidatedAt: later,
    });

    const evidence = evaluateVerificationIntegrationEvidence({
      requiredProfileId: "profile:standard",
      sourceFingerprint: "source:current",
      runs: [formerlyPassing, invalidatedCurrent],
      overrides: [],
    });

    expect(evidence.authorized).toBe(false);
    expect(evidence.matchingRun).toBeUndefined();
    expect(evidence.staleRuns.map((run) => run.id)).toEqual(["run:old-source"]);
  });

  it("never authorizes integration from a passing failed-gate diagnostic subset", () => {
    const diagnosticPass = makeRun({
      id: "run:diagnostic-pass",
      sourceFingerprint: "source:current",
      diagnosticSourceRunId: "run:failed",
    });

    const evidence = evaluateVerificationIntegrationEvidence({
      requiredProfileId: "profile:standard",
      sourceFingerprint: "source:current",
      runs: [diagnosticPass],
      overrides: [],
    });

    expect(evidence.authorized).toBe(false);
    expect(evidence.matchingRun).toBeUndefined();
  });

  it("accepts only an explicit current-source override and exposes it separately from a pass", () => {
    const failed = makeRun({
      id: "run:failed",
      sourceFingerprint: "source:current",
      status: "failed",
      result: "failed",
    });
    const currentOverride = makeOverride("source:current");

    const overridden = evaluateVerificationIntegrationEvidence({
      requiredProfileId: "profile:standard",
      sourceFingerprint: "source:current",
      runs: [failed],
      overrides: [currentOverride],
    });
    const revoked = evaluateVerificationIntegrationEvidence({
      requiredProfileId: "profile:standard",
      sourceFingerprint: "source:current",
      runs: [failed],
      overrides: [makeOverride("source:current", later)],
    });
    const stale = evaluateVerificationIntegrationEvidence({
      requiredProfileId: "profile:standard",
      sourceFingerprint: "source:new",
      runs: [failed],
      overrides: [currentOverride],
    });

    expect(overridden.authorized).toBe(true);
    expect(overridden.matchingRun).toBeUndefined();
    expect(overridden.matchingOverride?.reason).toContain("environment-only");
    expect(revoked.authorized).toBe(false);
    expect(stale.authorized).toBe(false);
  });
});
