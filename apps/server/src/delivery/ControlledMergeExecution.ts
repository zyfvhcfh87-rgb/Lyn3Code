import type { MergeExecution } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export interface RefreshedMergeEvidence {
  readonly readiness: "ready" | "ready_with_warnings" | "blocked" | "unknown" | "stale";
  readonly headSha: string;
  readonly baseSha: string;
  readonly approvalCurrent: boolean;
  readonly policyAllowsStrategy: boolean;
}

export interface MergeMutationResult {
  readonly accepted: boolean;
  readonly mergedCommitSha: string | null;
  readonly failureSummary: string | null;
  /** True when the remote may have accepted the mutation but no response proved it. */
  readonly outcomeAmbiguous: boolean;
}

export interface MergeConfirmation {
  readonly state: "merged" | "open" | "closed" | "unknown";
  readonly headSha: string;
  readonly mergedCommitSha: string | null;
}

export interface ControlledMergeDependencies<E> {
  readonly persist: (execution: MergeExecution) => Effect.Effect<void, E>;
  readonly refreshAndAssess: () => Effect.Effect<RefreshedMergeEvidence, E>;
  readonly mergeExactHead: (input: {
    readonly expectedHeadSha: string;
    readonly strategy: MergeExecution["mergeStrategy"];
  }) => Effect.Effect<MergeMutationResult, E>;
  readonly confirmRemote: () => Effect.Effect<MergeConfirmation, E>;
  readonly now: () => Effect.Effect<string>;
}

const withStatus = (
  execution: MergeExecution,
  status: MergeExecution["status"],
  now: string,
  details: Partial<MergeExecution> = {},
): MergeExecution => ({
  ...execution,
  ...details,
  status,
  ...(status === "preparing" || status === "running"
    ? { startedAt: execution.startedAt ?? now }
    : {}),
  ...(status === "succeeded" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "interrupted" ||
  status === "indeterminate"
    ? { finishedAt: now }
    : {}),
});

/**
 * Executes a merge with a persisted intent, fresh authoritative evidence, and
 * exact-head optimistic concurrency. Branch cleanup is intentionally absent.
 */
export const executeControlledMerge = <E>(input: {
  readonly execution: MergeExecution;
  readonly dependencies: ControlledMergeDependencies<E>;
}): Effect.Effect<MergeExecution, E> =>
  Effect.gen(function* () {
    const preparingAt = yield* input.dependencies.now();
    const preparing = withStatus(input.execution, "preparing", preparingAt);
    yield* input.dependencies.persist(preparing);

    const evidence = yield* input.dependencies.refreshAndAssess();
    if (
      evidence.headSha !== input.execution.expectedHeadSha ||
      evidence.baseSha !== input.execution.expectedBaseSha ||
      evidence.readiness === "stale"
    ) {
      const staleAt = yield* input.dependencies.now();
      const stale = withStatus(preparing, "failed", staleAt, {
        errorCode: "stale_source",
        errorMessage: "The pull request changed after the merge was approved.",
      });
      yield* input.dependencies.persist(stale);
      return stale;
    }
    if (
      (evidence.readiness !== "ready" && evidence.readiness !== "ready_with_warnings") ||
      !evidence.approvalCurrent ||
      !evidence.policyAllowsStrategy
    ) {
      const blockedAt = yield* input.dependencies.now();
      const blocked = withStatus(preparing, "failed", blockedAt, {
        errorCode: "merge_not_authorized",
        errorMessage: "Fresh readiness, approval, and strategy policy did not authorize the merge.",
      });
      yield* input.dependencies.persist(blocked);
      return blocked;
    }

    const runningAt = yield* input.dependencies.now();
    const running = withStatus(preparing, "running", runningAt);
    yield* input.dependencies.persist(running);
    const mutation = yield* input.dependencies.mergeExactHead({
      expectedHeadSha: input.execution.expectedHeadSha,
      strategy: input.execution.mergeStrategy,
    });
    if (!mutation.accepted) {
      const failedAt = yield* input.dependencies.now();
      const failed = withStatus(
        running,
        mutation.outcomeAmbiguous ? "indeterminate" : "failed",
        failedAt,
        {
          errorCode: mutation.outcomeAmbiguous ? "remote_outcome_unknown" : "merge_rejected",
          errorMessage: mutation.failureSummary ?? "GitHub did not accept the merge.",
        },
      );
      yield* input.dependencies.persist(failed);
      return failed;
    }

    const confirmation = yield* input.dependencies.confirmRemote();
    const confirmedSha = confirmation.mergedCommitSha ?? mutation.mergedCommitSha;
    if (
      confirmation.state !== "merged" ||
      confirmation.headSha !== input.execution.expectedHeadSha ||
      confirmedSha === null
    ) {
      const unknownAt = yield* input.dependencies.now();
      const unknown = withStatus(running, "indeterminate", unknownAt, {
        errorCode: "merge_confirmation_missing",
        errorMessage: "GitHub accepted the request, but the merged commit could not be confirmed.",
      });
      yield* input.dependencies.persist(unknown);
      return unknown;
    }
    const completedAt = yield* input.dependencies.now();
    const completed = withStatus(running, "succeeded", completedAt, {
      remoteMergeSha: confirmedSha,
      errorCode: null,
      errorMessage: null,
    });
    yield* input.dependencies.persist(completed);
    return completed;
  });
