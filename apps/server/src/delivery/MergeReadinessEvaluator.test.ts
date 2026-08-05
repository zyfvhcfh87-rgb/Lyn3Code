import {
  GitHubCheckRecordId,
  PullRequestRecordId,
  PullRequestReviewRecordId,
  RepositoryConnectionId,
  ReviewThreadRecordId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  evaluateMergeReadiness,
  type MergeReadinessEvaluationInput,
} from "./MergeReadinessEvaluator.ts";

const input = (): MergeReadinessEvaluationInput => ({
  pullRequest: {
    id: PullRequestRecordId.make("pr:1"),
    repositoryConnectionId: RepositoryConnectionId.make("repository:1"),
    githubPullRequestId: "1",
    number: 1,
    title: "Ship controlled delivery",
    bodyPreview: null,
    state: "open",
    isDraft: false,
    author: { login: "author", displayName: null, avatarUrl: null, htmlUrl: null },
    headRef: "mission/delivery",
    headSha: "head",
    baseRef: "main",
    baseSha: "base",
    mergeableState: "mergeable",
    reviewDecision: "approved",
    changedFileCount: 1,
    commitCount: 1,
    commentCount: 0,
    requiredCheckNames: ["tests"],
    htmlUrl: "https://github.com/acme/widgets/pull/1",
    createdAtRemote: "2026-08-05T00:00:00.000Z",
    updatedAtRemote: "2026-08-05T00:00:00.000Z",
    mergedAtRemote: null,
    closedAtRemote: null,
    syncedAt: "2026-08-05T00:00:00.000Z",
  },
  expectedHeadSha: "head",
  expectedBaseSha: "base",
  strategy: "squash",
  policy: {
    requireCurrentVerificationFingerprint: true,
    requireRemoteChecks: true,
    requireBranchProtectionCompliance: true,
    requiredApprovalCount: 1,
    requireResolvedThreads: true,
    allowDraftMerge: false,
    allowMergeWithWarnings: false,
    allowedMergeStrategies: ["squash"],
    allowedTargetBranches: ["main"],
  },
  localVerification: {
    status: "passed",
    fingerprintCurrent: true,
    requiredProfiles: ["default"],
    passedProfiles: ["default"],
    evidenceReferences: ["verification:1"],
  },
  checks: [
    {
      id: GitHubCheckRecordId.make("check:1"),
      pullRequestRecordId: PullRequestRecordId.make("pr:1"),
      repositoryConnectionId: RepositoryConnectionId.make("repository:1"),
      githubCheckId: "1",
      name: "tests",
      provider: "GitHub Actions",
      headSha: "head",
      status: "completed",
      conclusion: "success",
      isRequired: true,
      detailsUrl: null,
      startedAtRemote: null,
      completedAtRemote: null,
      summary: null,
      syncedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
  reviews: [
    {
      id: PullRequestReviewRecordId.make("review:1"),
      pullRequestRecordId: PullRequestRecordId.make("pr:1"),
      githubReviewId: "1",
      author: { login: "reviewer", displayName: null, avatarUrl: null, htmlUrl: null },
      state: "approved",
      bodyPreview: null,
      submittedAt: "2026-08-05T00:00:00.000Z",
      commitSha: "head",
      syncedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
  threads: [],
  branchProtection: {
    state: "protected",
    requiredCheckNames: ["tests"],
    requiredApprovalCount: 1,
    requireConversationResolution: true,
    allowedMergeStrategies: ["squash"],
    observedAt: "2026-08-05T00:00:00.000Z",
  },
  repositoryPermission: "write",
  secretScan: { status: "passed", evidenceReferences: ["scan:1"] },
  deliveryWindow: { state: "allowed", policyReference: "policy:1" },
});

describe("evaluateMergeReadiness", () => {
  it("marks a fully evidenced exact-head assessment ready", () => {
    const result = evaluateMergeReadiness(input());
    expect(result.result).toBe("ready");
    expect(result.blockingReasons).toEqual([]);
    expect(result.evidenceSnapshot.approvals).toBe(1);
  });

  it("marks a changed head stale even when older evidence passed", () => {
    const current = input();
    const result = evaluateMergeReadiness({
      ...current,
      pullRequest: { ...current.pullRequest, headSha: "new-head" },
    });
    expect(result.result).toBe("stale");
    expect(result.blockingReasons).toContain(
      "The pull request head SHA changed after the delivery plan was created.",
    );
  });

  it("blocks failed checks, changes requested, unresolved threads, and freezes", () => {
    const current = input();
    const result = evaluateMergeReadiness({
      ...current,
      checks: [{ ...current.checks[0]!, conclusion: "failure" }],
      reviews: [{ ...current.reviews[0]!, state: "changes_requested" }],
      threads: [
        {
          id: ReviewThreadRecordId.make("thread:1"),
          pullRequestRecordId: PullRequestRecordId.make("pr:1"),
          githubThreadId: "1",
          path: "src/delivery.ts",
          line: 1,
          originalLine: 1,
          side: "RIGHT",
          isResolved: false,
          isOutdated: false,
          createdAtRemote: "2026-08-05T00:00:00.000Z",
          updatedAtRemote: "2026-08-05T00:00:00.000Z",
          syncedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
      deliveryWindow: { state: "freeze", policyReference: "freeze:1" },
    });
    expect(result.result).toBe("blocked");
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        "Required GitHub checks failed: tests.",
        "A current review requests changes.",
        "1 blocking review thread is unresolved.",
        "An active delivery freeze blocks this merge.",
      ]),
    );
  });

  it("does not silently substitute a disallowed merge strategy", () => {
    const current = input();
    const result = evaluateMergeReadiness({ ...current, strategy: "rebase" });
    expect(result.result).toBe("blocked");
    expect(result.blockingReasons).toContain(
      "Merge strategy 'rebase' is not allowed by policy or repository settings.",
    );
  });
});
