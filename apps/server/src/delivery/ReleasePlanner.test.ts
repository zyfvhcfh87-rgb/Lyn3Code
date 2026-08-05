import { describe, expect, it } from "@effect/vitest";

import { planRelease, type ReleasePlanProposal } from "./ReleasePlanner.ts";

const evidence = {
  sourceFingerprint: "a".repeat(64),
  commitSha: "b".repeat(40),
  verificationRunId: "verification-1",
  verificationResult: "passed" as const,
  authorizationScope: "full_profile" as const,
};

const proposal = (overrides: Partial<ReleasePlanProposal> = {}): ReleasePlanProposal => ({
  proposalKind: "explicit_semver",
  currentVersion: "1.2.3",
  requestedVersion: "1.3.0",
  proposedAt: "2026-08-05T10:00:00.000Z",
  evidence,
  changelogEntries: ["Add evidence-backed delivery"],
  releaseNotes: "A bounded release note.",
  ...overrides,
});

describe("ReleasePlanner", () => {
  it("rejects non-increasing versions and conflicting tags", () => {
    expect(planRelease(proposal({ requestedVersion: "1.2.3" }))).toMatchObject({
      accepted: false,
      reason: "version_not_greater",
    });
    expect(planRelease(proposal({ existingTags: { "v1.3.0": "c".repeat(40) } }))).toMatchObject({
      accepted: false,
      reason: "tag_conflict",
    });
  });

  it("requires passing full-profile evidence", () => {
    expect(
      planRelease(
        proposal({
          evidence: { ...evidence, authorizationScope: "diagnostic_subset" },
        }),
      ),
    ).toMatchObject({ accepted: false, reason: "invalid_evidence" });
  });

  it("returns an immutable plan fingerprint bound to source and notes", () => {
    const first = planRelease(proposal());
    const second = planRelease(proposal());
    const changed = planRelease(proposal({ releaseNotes: "Different evidence." }));
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(changed.accepted).toBe(true);
    if (!first.accepted || !second.accepted || !changed.accepted) return;

    expect(first.plan.planFingerprint).toBe(second.plan.planFingerprint);
    expect(first.plan.planFingerprint).not.toBe(changed.plan.planFingerprint);
    expect(Object.isFrozen(first.plan)).toBe(true);
    expect(Object.isFrozen(first.plan.changelogEntries)).toBe(true);
  });

  it("derives deterministic calendar versions and bounds release text", () => {
    const withExplicitVersion = proposal({
      proposalKind: "calendar",
      currentVersion: "0.20260804.9",
      existingTags: { "v0.20260805.0": evidence.commitSha },
      releaseNotes: "x".repeat(40_000),
    });
    const { requestedVersion: _requestedVersion, ...calendarProposal } = withExplicitVersion;
    const result = planRelease(calendarProposal);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.plan.version).toBe("0.20260805.1");
    expect(result.plan.releaseNotes.length).toBeLessThanOrEqual(32 * 1024);
  });
});
