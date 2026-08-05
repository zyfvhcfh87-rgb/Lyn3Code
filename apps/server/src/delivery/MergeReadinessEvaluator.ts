import type {
  GitHubCheckRecord,
  PullRequestRecord,
  PullRequestReviewRecord,
  ReviewThreadRecord,
} from "@t3tools/contracts";

export type ReadinessLaneState = "passed" | "warning" | "blocked" | "unknown" | "stale";

export interface MergeReadinessPolicyInput {
  readonly requireCurrentVerificationFingerprint: boolean;
  readonly requireRemoteChecks: boolean;
  readonly requireBranchProtectionCompliance: boolean;
  readonly requiredApprovalCount: number;
  readonly requireResolvedThreads: boolean;
  readonly allowDraftMerge: boolean;
  readonly allowMergeWithWarnings: boolean;
  readonly allowedMergeStrategies: ReadonlyArray<"merge_commit" | "squash" | "rebase">;
  readonly allowedTargetBranches: ReadonlyArray<string>;
}

export interface BranchProtectionReadinessInput {
  readonly state: "protected" | "unprotected" | "unavailable" | "unknown";
  readonly requiredCheckNames: ReadonlyArray<string>;
  readonly requiredApprovalCount: number;
  readonly requireConversationResolution: boolean;
  readonly allowedMergeStrategies: ReadonlyArray<"merge_commit" | "squash" | "rebase">;
  readonly observedAt: string | null;
}

export interface MergeReadinessEvaluationInput {
  readonly pullRequest: PullRequestRecord;
  readonly expectedHeadSha: string;
  readonly expectedBaseSha: string;
  readonly strategy: "merge_commit" | "squash" | "rebase";
  readonly policy: MergeReadinessPolicyInput;
  readonly localVerification: {
    readonly status: "passed" | "passed_with_warnings" | "failed" | "pending" | "unknown";
    readonly fingerprintCurrent: boolean;
    readonly requiredProfiles: ReadonlyArray<string>;
    readonly passedProfiles: ReadonlyArray<string>;
    readonly evidenceReferences: ReadonlyArray<string>;
  };
  readonly checks: ReadonlyArray<GitHubCheckRecord>;
  readonly reviews: ReadonlyArray<PullRequestReviewRecord>;
  readonly threads: ReadonlyArray<ReviewThreadRecord>;
  readonly branchProtection: BranchProtectionReadinessInput;
  readonly repositoryPermission: "none" | "read" | "triage" | "write" | "maintain" | "admin";
  readonly secretScan: {
    readonly status: "passed" | "failed" | "not_configured" | "unknown";
    readonly evidenceReferences: ReadonlyArray<string>;
  };
  readonly deliveryWindow: {
    readonly state: "allowed" | "outside_window" | "freeze" | "unknown";
    readonly policyReference: string | null;
  };
}

export interface MergeReadinessEvaluation {
  readonly result: "ready" | "ready_with_warnings" | "blocked" | "unknown" | "stale";
  readonly blockingReasons: ReadonlyArray<string>;
  readonly warningReasons: ReadonlyArray<string>;
  readonly states: {
    readonly localVerification: ReadinessLaneState;
    readonly remoteChecks: ReadinessLaneState;
    readonly reviews: ReadinessLaneState;
    readonly threads: ReadinessLaneState;
    readonly mergeability: ReadinessLaneState;
    readonly branchProtection: ReadinessLaneState;
    readonly secretScan: ReadinessLaneState;
    readonly deliveryWindow: ReadinessLaneState;
  };
  readonly evidenceSnapshot: {
    readonly headSha: string;
    readonly baseSha: string;
    readonly strategy: "merge_commit" | "squash" | "rebase";
    readonly requiredChecks: ReadonlyArray<string>;
    readonly passedChecks: ReadonlyArray<string>;
    readonly pendingChecks: ReadonlyArray<string>;
    readonly failedChecks: ReadonlyArray<string>;
    readonly approvals: number;
    readonly requiredApprovals: number;
    readonly changesRequested: boolean;
    readonly unresolvedBlockingThreads: number;
    readonly branchProtectionObservedAt: string | null;
    readonly localVerificationEvidence: ReadonlyArray<string>;
    readonly secretScanEvidence: ReadonlyArray<string>;
    readonly deliveryWindowPolicyReference: string | null;
  };
}

const unique = (values: ReadonlyArray<string>) => [...new Set(values)];

const latestReviewsByActor = (reviews: ReadonlyArray<PullRequestReviewRecord>) => {
  const latest = new Map<string, PullRequestReviewRecord>();
  for (const review of reviews) {
    const actor = review.author.login.toLowerCase();
    const current = latest.get(actor);
    if (
      current === undefined ||
      (review.submittedAt ?? review.syncedAt).localeCompare(
        current.submittedAt ?? current.syncedAt,
      ) >= 0
    ) {
      latest.set(actor, review);
    }
  }
  return [...latest.values()];
};

export function evaluateMergeReadiness(
  input: MergeReadinessEvaluationInput,
): MergeReadinessEvaluation {
  const blockingReasons: Array<string> = [];
  const warningReasons: Array<string> = [];
  let stale = false;
  let unknown = false;

  if (input.pullRequest.state !== "open") {
    blockingReasons.push("The pull request is not open.");
  }
  if (input.pullRequest.isDraft && !input.policy.allowDraftMerge) {
    blockingReasons.push("The pull request is still a draft.");
  }
  if (input.pullRequest.headSha !== input.expectedHeadSha) {
    stale = true;
    blockingReasons.push("The pull request head SHA changed after the delivery plan was created.");
  }
  if (input.pullRequest.baseSha !== input.expectedBaseSha) {
    stale = true;
    blockingReasons.push("The pull request base SHA changed after the delivery plan was created.");
  }
  if (
    input.policy.allowedTargetBranches.length > 0 &&
    !input.policy.allowedTargetBranches.includes(input.pullRequest.baseRef)
  ) {
    blockingReasons.push(`Target branch '${input.pullRequest.baseRef}' is not allowed by policy.`);
  }

  let localVerification: ReadinessLaneState = "passed";
  const missingProfiles = input.localVerification.requiredProfiles.filter(
    (profile) => !input.localVerification.passedProfiles.includes(profile),
  );
  if (!input.localVerification.fingerprintCurrent) {
    localVerification = "stale";
    stale = true;
    blockingReasons.push("Local verification does not match the current source fingerprint.");
  } else if (input.localVerification.status === "failed" || missingProfiles.length > 0) {
    localVerification = "blocked";
    blockingReasons.push(
      missingProfiles.length > 0
        ? `Required local verification profiles are missing: ${missingProfiles.join(", ")}.`
        : "Required local verification failed.",
    );
  } else if (
    input.localVerification.status === "pending" ||
    input.localVerification.status === "unknown"
  ) {
    localVerification = "unknown";
    unknown = true;
    blockingReasons.push("Current local verification evidence is unavailable.");
  } else if (input.localVerification.status === "passed_with_warnings") {
    localVerification = "warning";
    warningReasons.push("Local verification passed with warnings.");
  }

  const requiredChecks = unique([
    ...(input.policy.requireRemoteChecks ? input.pullRequest.requiredCheckNames : []),
    ...(input.policy.requireBranchProtectionCompliance
      ? input.branchProtection.requiredCheckNames
      : []),
  ]);
  const currentChecks = input.checks.filter((check) => check.headSha === input.pullRequest.headSha);
  const passedChecks = unique(
    currentChecks
      .filter((check) => check.status === "completed" && check.conclusion === "success")
      .map((check) => check.name),
  );
  const failedChecks = unique(
    currentChecks
      .filter(
        (check) =>
          check.status === "completed" &&
          check.conclusion !== null &&
          check.conclusion !== "success" &&
          check.conclusion !== "neutral" &&
          check.conclusion !== "skipped",
      )
      .map((check) => check.name),
  );
  const pendingChecks = requiredChecks.filter(
    (name) => !passedChecks.includes(name) && !failedChecks.includes(name),
  );
  let remoteChecks: ReadinessLaneState = "passed";
  if (failedChecks.length > 0) {
    remoteChecks = "blocked";
    blockingReasons.push(`Required GitHub checks failed: ${failedChecks.join(", ")}.`);
  } else if (pendingChecks.length > 0) {
    remoteChecks = "blocked";
    blockingReasons.push(
      `Required GitHub checks are pending or missing: ${pendingChecks.join(", ")}.`,
    );
  } else if (input.policy.requireRemoteChecks && requiredChecks.length === 0) {
    remoteChecks = "unknown";
    unknown = true;
    blockingReasons.push(
      "Remote checks are required, but no authoritative required-check set is available.",
    );
  }

  const latestReviews = latestReviewsByActor(input.reviews);
  const approvals = latestReviews.filter(
    (review) => review.state === "approved" && review.commitSha === input.pullRequest.headSha,
  ).length;
  const changesRequested = latestReviews.some((review) => review.state === "changes_requested");
  const requiredApprovals = Math.max(
    input.policy.requiredApprovalCount,
    input.policy.requireBranchProtectionCompliance
      ? input.branchProtection.requiredApprovalCount
      : 0,
  );
  let reviews: ReadinessLaneState = "passed";
  if (changesRequested) {
    reviews = "blocked";
    blockingReasons.push("A current review requests changes.");
  }
  if (approvals < requiredApprovals) {
    reviews = "blocked";
    blockingReasons.push(
      `${requiredApprovals - approvals} additional approval${requiredApprovals - approvals === 1 ? " is" : "s are"} required.`,
    );
  }

  const unresolvedBlockingThreads = input.threads.filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  ).length;
  const threadsRequired =
    input.policy.requireResolvedThreads ||
    (input.policy.requireBranchProtectionCompliance &&
      input.branchProtection.requireConversationResolution);
  const threadState: ReadinessLaneState =
    threadsRequired && unresolvedBlockingThreads > 0 ? "blocked" : "passed";
  if (threadState === "blocked") {
    blockingReasons.push(
      `${unresolvedBlockingThreads} blocking review thread${unresolvedBlockingThreads === 1 ? " is" : "s are"} unresolved.`,
    );
  }

  let mergeability: ReadinessLaneState = "passed";
  if (
    input.pullRequest.mergeableState === "conflicting" ||
    input.pullRequest.mergeableState === "blocked"
  ) {
    mergeability = "blocked";
    blockingReasons.push("GitHub reports that the pull request cannot be merged cleanly.");
  } else if (input.pullRequest.mergeableState === "behind") {
    mergeability = "blocked";
    blockingReasons.push("The pull request branch is behind the target branch.");
  } else if (input.pullRequest.mergeableState === "unknown") {
    mergeability = "unknown";
    unknown = true;
    blockingReasons.push("GitHub has not produced an authoritative mergeability result.");
  } else if (input.pullRequest.mergeableState === "unstable") {
    mergeability = "warning";
    warningReasons.push("GitHub reports an unstable merge state.");
  }

  let branchProtection: ReadinessLaneState = "passed";
  if (input.policy.requireBranchProtectionCompliance) {
    if (
      input.branchProtection.state === "unavailable" ||
      input.branchProtection.state === "unknown"
    ) {
      branchProtection = "unknown";
      unknown = true;
      blockingReasons.push("Branch-protection requirements could not be confirmed.");
    } else if (input.branchProtection.state === "unprotected") {
      branchProtection = "blocked";
      blockingReasons.push(
        "Policy requires branch protection, but the target branch is unprotected.",
      );
    }
  }
  const allowedStrategies = input.branchProtection.allowedMergeStrategies.filter((strategy) =>
    input.policy.allowedMergeStrategies.includes(strategy),
  );
  if (!allowedStrategies.includes(input.strategy)) {
    branchProtection = "blocked";
    blockingReasons.push(
      `Merge strategy '${input.strategy}' is not allowed by policy or repository settings.`,
    );
  }
  if (
    input.repositoryPermission !== "write" &&
    input.repositoryPermission !== "maintain" &&
    input.repositoryPermission !== "admin"
  ) {
    branchProtection = "blocked";
    blockingReasons.push(
      "The connected GitHub account does not have permission to merge this pull request.",
    );
  }

  let secretScan: ReadinessLaneState = "passed";
  if (input.secretScan.status === "failed") {
    secretScan = "blocked";
    blockingReasons.push("The configured secret scan detected potentially sensitive content.");
  } else if (input.secretScan.status === "unknown") {
    secretScan = "unknown";
    unknown = true;
    blockingReasons.push("Secret-scan evidence is unavailable.");
  } else if (input.secretScan.status === "not_configured") {
    secretScan = "warning";
    warningReasons.push("No secret scan is configured for this delivery.");
  }

  let deliveryWindow: ReadinessLaneState = "passed";
  if (input.deliveryWindow.state === "freeze") {
    deliveryWindow = "blocked";
    blockingReasons.push("An active delivery freeze blocks this merge.");
  } else if (input.deliveryWindow.state === "outside_window") {
    deliveryWindow = "blocked";
    blockingReasons.push("The merge is outside the policy's permitted delivery window.");
  } else if (input.deliveryWindow.state === "unknown") {
    deliveryWindow = "unknown";
    unknown = true;
    blockingReasons.push("The permitted delivery window could not be evaluated.");
  }

  const uniqueBlockers = unique(blockingReasons);
  const uniqueWarnings = unique(warningReasons);
  const result = stale
    ? "stale"
    : uniqueBlockers.length > 0
      ? unknown
        ? "unknown"
        : "blocked"
      : uniqueWarnings.length > 0
        ? input.policy.allowMergeWithWarnings
          ? "ready_with_warnings"
          : "blocked"
        : "ready";
  if (
    uniqueWarnings.length > 0 &&
    !input.policy.allowMergeWithWarnings &&
    uniqueBlockers.length === 0
  ) {
    uniqueBlockers.push("Policy does not allow merging while warnings remain.");
  }

  return {
    result,
    blockingReasons: uniqueBlockers,
    warningReasons: uniqueWarnings,
    states: {
      localVerification,
      remoteChecks,
      reviews,
      threads: threadState,
      mergeability,
      branchProtection,
      secretScan,
      deliveryWindow,
    },
    evidenceSnapshot: {
      headSha: input.pullRequest.headSha,
      baseSha: input.pullRequest.baseSha,
      strategy: input.strategy,
      requiredChecks,
      passedChecks,
      pendingChecks,
      failedChecks,
      approvals,
      requiredApprovals,
      changesRequested,
      unresolvedBlockingThreads,
      branchProtectionObservedAt: input.branchProtection.observedAt,
      localVerificationEvidence: input.localVerification.evidenceReferences,
      secretScanEvidence: input.secretScan.evidenceReferences,
      deliveryWindowPolicyReference: input.deliveryWindow.policyReference,
    },
  };
}
