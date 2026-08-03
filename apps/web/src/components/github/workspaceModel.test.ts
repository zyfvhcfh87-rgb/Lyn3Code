import { describe, expect, it } from "vite-plus/test";

import { githubWorkspaceNotice, mergeReadinessItems } from "./workspaceModel";

describe("GitHub workspace presentation", () => {
  it("keeps authentication and cached-data state explicit", () => {
    expect(
      githubWorkspaceNotice({
        freshness: "stale",
        syncStatus: "authentication_required",
        accountStatus: "expired",
      }),
    ).toMatchObject({ tone: "error", title: "GitHub authentication expired" });
    expect(
      githubWorkspaceNotice({
        freshness: "partial",
        syncStatus: "partially_stale",
        accountStatus: "connected",
      }),
    ).toMatchObject({ tone: "warning", title: "Partially synchronized" });
  });

  it("only considers required checks for the current PR head", () => {
    const detail = {
      pullRequest: {
        headSha: "new-head",
        reviewDecision: "review_required",
        mergeableState: "behind",
        requiredCheckNames: ["build"],
      },
      checks: [
        { headSha: "old-head", isRequired: true, status: "completed", conclusion: "failure" },
        {
          headSha: "new-head",
          name: "build",
          isRequired: true,
          status: "in_progress",
          conclusion: null,
        },
      ],
      threads: [{ isResolved: false, isOutdated: false }],
    } as unknown as Parameters<typeof mergeReadinessItems>[0];

    const labels = mergeReadinessItems(detail).map((item) => item.text);
    expect(labels).toContain("1 required check pending");
    expect(labels).not.toContain("1 required check failing");
    expect(labels).toContain("Review approval missing");
    expect(labels).toContain("1 unresolved review thread");
  });
});
