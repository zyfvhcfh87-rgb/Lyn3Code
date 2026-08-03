import { expect, it } from "@effect/vitest";

import {
  classifyBranchRelation,
  parseAheadBehind,
  parseLsRemoteHead,
  scanAddedPatchForSecrets,
} from "./GitHubGitSafety.ts";

it("classifies local and remote branch relationships without inventing ancestry", () => {
  expect(classifyBranchRelation("a", null, null)).toBe("missing_remote");
  expect(classifyBranchRelation("a", "a", null)).toBe("equal");
  expect(classifyBranchRelation("a", "b", { ahead: 2, behind: 0 })).toBe("ahead");
  expect(classifyBranchRelation("a", "b", { ahead: 0, behind: 3 })).toBe("behind");
  expect(classifyBranchRelation("a", "b", { ahead: 2, behind: 3 })).toBe("diverged");
});

it("parses bounded git observations", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  expect(parseLsRemoteHead(`${sha}\trefs/heads/feature\n`)).toBe(sha);
  expect(parseLsRemoteHead("surprise output")).toBeNull();
  expect(parseAheadBehind("2\t3\n")).toEqual({ ahead: 2, behind: 3 });
  expect(parseAheadBehind("nope")).toBeNull();
});

it("redacts secret values by returning finding categories only", () => {
  const patch = [
    "diff --git a/config.ts b/config.ts",
    "--- a/config.ts",
    "+++ b/config.ts",
    '+const token = "github_pat_abcdefghijklmnopqrstuvwxyz_123456";',
    "+-----BEGIN PRIVATE KEY-----",
    "-const oldToken = 'ghp_should_not_count_from_removed_lines';",
  ].join("\n");
  expect(scanAddedPatchForSecrets(patch)).toEqual([
    "assigned_secret",
    "github_token",
    "private_key",
  ]);
  expect(scanAddedPatchForSecrets(patch).join(" ")).not.toContain("github_pat_");
});
