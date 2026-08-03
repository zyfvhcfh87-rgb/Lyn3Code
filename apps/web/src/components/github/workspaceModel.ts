import type {
  GitHubAccountStatus,
  GitHubCheckRecord,
  GitHubDataFreshness,
  GitHubPullRequestDetailSnapshot,
  RepositorySyncStatus,
  ReviewThreadRecord,
} from "@t3tools/contracts";

export type GitHubNoticeTone = "neutral" | "info" | "warning" | "error";

export interface GitHubWorkspaceNotice {
  readonly tone: GitHubNoticeTone;
  readonly title: string;
  readonly description: string;
}

export function githubWorkspaceNotice(input: {
  readonly freshness: GitHubDataFreshness;
  readonly syncStatus: RepositorySyncStatus;
  readonly accountStatus: GitHubAccountStatus | null;
}): GitHubWorkspaceNotice | null {
  if (input.accountStatus === "expired" || input.accountStatus === "revoked") {
    return {
      tone: "error",
      title: "GitHub authentication expired",
      description:
        "Cached data is still available. Reconnect before reading fresh data or writing.",
    };
  }
  if (input.accountStatus === "insufficient_permissions") {
    return {
      tone: "warning",
      title: "Limited GitHub permissions",
      description: "Read-only data remains available; actions requiring write access are hidden.",
    };
  }
  if (input.syncStatus === "rate_limited") {
    return {
      tone: "warning",
      title: "GitHub rate limit reached",
      description:
        "Cached data remains available while synchronization waits for the reset window.",
    };
  }
  if (input.syncStatus === "remote_deleted") {
    return {
      tone: "error",
      title: "Remote repository unavailable",
      description: "The local project and mission history are unchanged.",
    };
  }
  if (input.freshness === "partial" || input.syncStatus === "partially_stale") {
    return {
      tone: "warning",
      title: "Partially synchronized",
      description: "Some GitHub resources are current while others will retry independently.",
    };
  }
  if (input.freshness === "offline" || input.syncStatus === "offline") {
    return {
      tone: "info",
      title: "Offline — showing cached GitHub data",
      description: "Local missions, tasks, branches, and verification continue to work normally.",
    };
  }
  if (input.freshness === "stale" || input.syncStatus === "stale") {
    return {
      tone: "info",
      title: "GitHub data may be stale",
      description: "Refresh before making a decision that depends on current remote state.",
    };
  }
  if (input.freshness === "never_synced" || input.syncStatus === "not_synced") {
    return {
      tone: "neutral",
      title: "Repository has not synchronized yet",
      description: "Start a refresh to load repository metadata, issues, and pull requests.",
    };
  }
  return null;
}

export function checkDisplayState(check: GitHubCheckRecord): string {
  if (check.conclusion === "stale") return "stale";
  if (check.status === "queued") return "queued";
  if (check.status === "in_progress") return "in progress";
  return check.conclusion?.replaceAll("_", " ") ?? "completed";
}

export function mergeReadinessItems(
  detail: GitHubPullRequestDetailSnapshot,
): ReadonlyArray<{ readonly tone: GitHubNoticeTone; readonly text: string }> {
  const currentChecks = detail.checks.filter(
    (check) => check.headSha === detail.pullRequest.headSha && check.conclusion !== "stale",
  );
  const requiredChecks = currentChecks.filter((check) => check.isRequired);
  const observedRequiredNames = new Set(requiredChecks.map((check) => check.name));
  const unobservedRequired = detail.pullRequest.requiredCheckNames.filter(
    (name) => !observedRequiredNames.has(name),
  ).length;
  const pending =
    requiredChecks.filter((check) => check.status !== "completed").length + unobservedRequired;
  const failed = requiredChecks.filter(
    (check) =>
      check.status === "completed" &&
      check.conclusion !== "success" &&
      check.conclusion !== "neutral" &&
      check.conclusion !== "skipped",
  ).length;
  const unresolved = detail.threads.filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  ).length;
  const items: Array<{ readonly tone: GitHubNoticeTone; readonly text: string }> = [];

  if (failed > 0)
    items.push({
      tone: "error",
      text: `${failed} required check${failed === 1 ? "" : "s"} failing`,
    });
  if (pending > 0)
    items.push({
      tone: "warning",
      text: `${pending} required check${pending === 1 ? "" : "s"} pending`,
    });
  if (detail.pullRequest.reviewDecision === "changes_requested") {
    items.push({ tone: "error", text: "Changes requested" });
  } else if (detail.pullRequest.reviewDecision === "review_required") {
    items.push({ tone: "warning", text: "Review approval missing" });
  }
  if (unresolved > 0)
    items.push({
      tone: "warning",
      text: `${unresolved} unresolved review thread${unresolved === 1 ? "" : "s"}`,
    });
  if (detail.pullRequest.mergeableState === "behind")
    items.push({ tone: "warning", text: "Branch is behind the base branch" });
  if (detail.pullRequest.mergeableState === "conflicting")
    items.push({ tone: "error", text: "Branch has merge conflicts" });
  if (items.length === 0) items.push({ tone: "info", text: "No known remote blockers" });
  return items;
}

export function canResolveReviewThread(
  detail: GitHubPullRequestDetailSnapshot,
  thread: ReviewThreadRecord,
): boolean {
  if (thread.isResolved || thread.isOutdated) return false;
  const commentIds = new Set(
    detail.comments
      .filter((comment) => comment.reviewThreadId === thread.id)
      .map((comment) => comment.id),
  );
  return detail.taskLinks.some(
    (link) =>
      commentIds.has(link.reviewCommentRecordId) &&
      link.status !== "dismissed" &&
      link.status !== "resolved",
  );
}
