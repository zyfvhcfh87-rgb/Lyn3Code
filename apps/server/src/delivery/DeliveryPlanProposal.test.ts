import { describe, expect, it } from "@effect/vitest";

import type { Mission, MissionTask, PullRequestRecord } from "@t3tools/contracts";

import {
  proposalDigest,
  releaseEvidenceNarrative,
  type ReleaseVerificationRecord,
  selectCurrentReleaseVerification,
  tagPrefixFromPattern,
} from "./DeliveryPlanProposal.ts";

const run = (overrides: Partial<ReleaseVerificationRecord> = {}): ReleaseVerificationRecord => ({
  id: "verification:current",
  authorizationScope: "full_profile",
  result: "passed",
  invalidatedAt: null,
  commitHash: "abc1234",
  sourceFingerprint: "a".repeat(64),
  completedAt: "2026-08-05T12:00:00.000Z",
  createdAt: "2026-08-05T11:00:00.000Z",
  profileId: "profile:release",
  ...overrides,
});

describe("delivery plan proposals", () => {
  it("selects only passing current full-profile evidence", () => {
    const source = { commitHash: "abc1234", sourceFingerprint: "a".repeat(64) };
    expect(
      selectCurrentReleaseVerification(
        [
          run({ id: "diagnostic", authorizationScope: "diagnostic_subset" }),
          run({ id: "stale", sourceFingerprint: "b".repeat(64) }),
          run(),
        ],
        source,
      )?.id,
    ).toBe("verification:current");
    expect(
      selectCurrentReleaseVerification([run({ invalidatedAt: "2026-08-05T12:30:00Z" })], source),
    ).toBeNull();
  });

  it("builds release notes from durable mission, task, PR, and verification records", () => {
    const result = releaseEvidenceNarrative({
      mission: { title: "Controlled delivery", description: "Ship Phase 8 safely." } as Mission,
      tasks: [{ title: "Add release planner", status: "completed", position: 0 } as MissionTask],
      pullRequests: [{ number: 8, title: "feat: controlled delivery" } as PullRequestRecord],
      verification: run(),
      supplement: "Operator note.",
    });
    expect(result.changelogEntries).toEqual([
      "Add release planner (completed)",
      "#8 feat: controlled delivery",
    ]);
    expect(result.releaseNotes).toContain("Full profile: profile:release");
    expect(result.releaseNotes).toContain("Operator note.");
  });

  it("derives tag prefixes and stable deployment digests", () => {
    expect(tagPrefixFromPattern("release/{version}")).toBe("release/");
    expect(tagPrefixFromPattern("version-only")).toBe("v");
    expect(proposalDigest({ b: 2, a: 1 })).toBe(proposalDigest({ a: 1, b: 2 }));
  });
});
