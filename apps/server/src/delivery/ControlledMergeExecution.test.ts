import {
  DeliveryPolicyId,
  MergeExecutionId,
  MergeReadinessAssessmentId,
  MissionId,
  ProjectId,
  PullRequestRecordId,
  RepositoryConnectionId,
  type MergeExecution,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { executeControlledMerge } from "./ControlledMergeExecution.ts";

const execution: MergeExecution = {
  id: MergeExecutionId.make("merge-1"),
  idempotencyKey: "merge:pr-1:abc123:squash",
  projectId: ProjectId.make("project-1"),
  missionId: MissionId.make("mission-1"),
  repositoryConnectionId: RepositoryConnectionId.make("connection-1"),
  pullRequestRecordId: PullRequestRecordId.make("pr-1"),
  readinessAssessmentId: MergeReadinessAssessmentId.make("assessment-1"),
  approvalRequestId: null,
  deliveryPolicyId: DeliveryPolicyId.make("policy-1"),
  mergeStrategy: "squash",
  expectedHeadSha: "abc123",
  expectedBaseSha: "def456",
  sourceCommit: "abc123",
  status: "queued",
  remoteMergeSha: null,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-08-05T09:00:00.000Z",
  startedAt: null,
  finishedAt: null,
};

describe("executeControlledMerge", () => {
  it.effect("persists intent, uses exact head, and confirms the merged commit", () =>
    Effect.gen(function* () {
      const persisted: Array<MergeExecution> = [];
      const requestedHeads: Array<string> = [];
      const result = yield* executeControlledMerge({
        execution,
        dependencies: {
          persist: (value) => Effect.sync(() => persisted.push(value)).pipe(Effect.asVoid),
          refreshAndAssess: () =>
            Effect.succeed({
              readiness: "ready" as const,
              headSha: "abc123",
              baseSha: "def456",
              approvalCurrent: true,
              policyAllowsStrategy: true,
            }),
          mergeExactHead: ({ expectedHeadSha }) =>
            Effect.sync(() => {
              requestedHeads.push(expectedHeadSha);
              return {
                accepted: true,
                mergedCommitSha: "fedcba",
                failureSummary: null,
                outcomeAmbiguous: false,
              };
            }),
          confirmRemote: () =>
            Effect.succeed({
              state: "merged" as const,
              headSha: "abc123",
              mergedCommitSha: "fedcba",
            }),
          now: () => Effect.succeed("2026-08-05T10:00:00.000Z"),
        },
      });
      expect(requestedHeads).toEqual(["abc123"]);
      expect(persisted.map((value) => value.status)).toEqual(["preparing", "running", "succeeded"]);
      expect(result.remoteMergeSha).toBe("fedcba");
    }),
  );

  it.effect("blocks a stale head before any remote mutation", () =>
    Effect.gen(function* () {
      let mutationCount = 0;
      const result = yield* executeControlledMerge({
        execution,
        dependencies: {
          persist: () => Effect.void,
          refreshAndAssess: () =>
            Effect.succeed({
              readiness: "stale" as const,
              headSha: "new-head",
              baseSha: "def456",
              approvalCurrent: false,
              policyAllowsStrategy: true,
            }),
          mergeExactHead: () =>
            Effect.sync(() => {
              mutationCount += 1;
              return {
                accepted: true,
                mergedCommitSha: "never",
                failureSummary: null,
                outcomeAmbiguous: false,
              };
            }),
          confirmRemote: () =>
            Effect.succeed({
              state: "unknown" as const,
              headSha: "new-head",
              mergedCommitSha: null,
            }),
          now: () => Effect.succeed("2026-08-05T10:00:00.000Z"),
        },
      });
      expect(mutationCount).toBe(0);
      expect(result.errorCode).toBe("stale_source");
    }),
  );

  it.effect("marks an ambiguous remote outcome for recovery instead of retrying", () =>
    Effect.gen(function* () {
      const result = yield* executeControlledMerge({
        execution,
        dependencies: {
          persist: () => Effect.void,
          refreshAndAssess: () =>
            Effect.succeed({
              readiness: "ready" as const,
              headSha: "abc123",
              baseSha: "def456",
              approvalCurrent: true,
              policyAllowsStrategy: true,
            }),
          mergeExactHead: () =>
            Effect.succeed({
              accepted: false,
              mergedCommitSha: null,
              failureSummary: "Connection closed after request submission.",
              outcomeAmbiguous: true,
            }),
          confirmRemote: () =>
            Effect.succeed({ state: "unknown" as const, headSha: "abc123", mergedCommitSha: null }),
          now: () => Effect.succeed("2026-08-05T10:00:00.000Z"),
        },
      });
      expect(result.status).toBe("indeterminate");
      expect(result.errorCode).toBe("remote_outcome_unknown");
    }),
  );
});
