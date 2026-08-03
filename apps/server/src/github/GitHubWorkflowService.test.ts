import { describe, expect, it } from "vite-plus/test";

import { buildPullRequestBody } from "./GitHubWorkflowService.ts";

describe("buildPullRequestBody", () => {
  const evidence = [
    "- Task task-1: passed",
    "  - Profile: focused",
    "  - Source fingerprint: sha256:current",
    "  - Check: unit tests — passed",
  ].join("\n");

  it("keeps local verification separate from future GitHub checks", () => {
    const body = buildPullRequestBody({
      missionTitle: "Ship the workspace",
      missionDescription: "Connect the local mission to GitHub.",
      linkedIssueNumber: 42,
      closeLinkedIssue: false,
      tasks: [
        { title: "Implement sync", status: "completed" },
        { title: "Polish docs", status: "running" },
      ],
      handoffs: [
        {
          summary: "Kept remote state external and local history authoritative.",
          changedFiles: [{ path: "apps/server/src/github/GitHubWorkspaceService.ts" }],
          unresolvedProblems: ["OAuth device flow is not bundled in this release."],
        },
      ],
      verificationEvidence: evidence,
    });

    expect(body).toContain("Related to #42");
    expect(body).not.toContain("Closes #42");
    expect(body).toContain("- [x] Implement sync");
    expect(body).toContain("- [ ] Polish docs");
    expect(body).toContain(`## Local harness verification\n${evidence}`);
    expect(body).toContain(
      "## GitHub remote checks\nRemote checks are synchronized separately for the current PR head after creation.",
    );
    expect(body).not.toMatch(/chain[- ]of[- ]thought|agent transcript/iu);
  });

  it("uses closing language only after explicit closing intent", () => {
    const body = buildPullRequestBody({
      missionTitle: "Fix issue",
      missionDescription: "A verified fix.",
      linkedIssueNumber: 7,
      closeLinkedIssue: true,
      tasks: [],
      handoffs: [],
      verificationEvidence: "No task-scoped verification was required.",
    });

    expect(body).toContain("Closes #7");
    expect(body).toContain("No mission tasks were recorded.");
    expect(body).toContain("No structured handoff decisions were recorded.");
    expect(body).toContain("None recorded.");
  });
});
