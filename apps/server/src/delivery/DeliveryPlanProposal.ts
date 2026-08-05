import * as NodeCrypto from "node:crypto";

import type {
  DeliveryPublicMetadata,
  Mission,
  MissionTask,
  PullRequestRecord,
} from "@t3tools/contracts";

export interface ProposalSource {
  readonly commitHash: string | null;
  readonly sourceFingerprint: string;
}

export interface ReleaseVerificationRecord {
  readonly id: string;
  readonly profileId: string;
  readonly authorizationScope: "full_profile" | "diagnostic_subset";
  readonly result:
    | "passed"
    | "passed_with_warnings"
    | "failed"
    | "cancelled"
    | "interrupted"
    | null;
  readonly invalidatedAt: string | null;
  readonly commitHash: string | null;
  readonly sourceFingerprint: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const proposalDigest = (value: unknown): string =>
  NodeCrypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

export const selectCurrentReleaseVerification = (
  runs: ReadonlyArray<ReleaseVerificationRecord>,
  source: ProposalSource,
): ReleaseVerificationRecord | null =>
  runs
    .filter(
      (run) =>
        source.commitHash !== null &&
        run.authorizationScope === "full_profile" &&
        run.result === "passed" &&
        run.invalidatedAt === null &&
        run.commitHash === source.commitHash &&
        run.sourceFingerprint === source.sourceFingerprint,
    )
    .sort(
      (left, right) =>
        Date.parse(right.completedAt ?? right.createdAt) -
        Date.parse(left.completedAt ?? left.createdAt),
    )[0] ?? null;

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

export const releaseEvidenceNarrative = (input: {
  readonly mission: Mission | null;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly pullRequests: ReadonlyArray<PullRequestRecord>;
  readonly verification: ReleaseVerificationRecord;
  readonly supplement: string | null;
}): {
  readonly changelogEntries: ReadonlyArray<string>;
  readonly changeSummary: string;
  readonly releaseNotes: string;
} => {
  const taskEntries = [...input.tasks]
    .sort((left, right) => left.position - right.position)
    .map((task) => `${compact(task.title)} (${task.status})`);
  const pullRequestEntries = [...input.pullRequests]
    .sort((left, right) => left.number - right.number)
    .map((pullRequest) => `#${pullRequest.number} ${compact(pullRequest.title)}`);
  const fallback = input.mission === null ? [] : [compact(input.mission.title)];
  const changelogEntries = [...taskEntries, ...pullRequestEntries].slice(0, 64);
  if (changelogEntries.length === 0) changelogEntries.push(...fallback);
  const summary =
    input.mission?.description.trim() || input.mission?.title || "Verified project changes";
  const sections = [
    `## Summary\n\n${summary}`,
    changelogEntries.length > 0
      ? `## Changes\n\n${changelogEntries.map((entry) => `- ${entry}`).join("\n")}`
      : "## Changes\n\n- No mission-scoped task or pull request records were available.",
    `## Verification\n\n- Full profile: ${input.verification.profileId}\n- Run: ${input.verification.id}\n- Source: ${input.verification.sourceFingerprint}`,
  ];
  if (input.supplement?.trim()) sections.push(`## Additional notes\n\n${input.supplement.trim()}`);
  return {
    changelogEntries,
    changeSummary: compact(summary).slice(0, 8_000),
    releaseNotes: sections.join("\n\n").slice(0, 32_000),
  };
};

export const tagPrefixFromPattern = (tagPattern: string): string => {
  const marker = tagPattern.indexOf("{version}");
  return marker < 0 ? "v" : tagPattern.slice(0, marker);
};

export const deploymentConfigurationSnapshot = (input: {
  readonly environmentDigest: string;
  readonly policyDigest: string;
  readonly sourceFingerprint: string;
  readonly environmentMetadata: DeliveryPublicMetadata;
}): DeliveryPublicMetadata => ({
  environmentDigest: input.environmentDigest,
  policyDigest: input.policyDigest,
  sourceFingerprint: input.sourceFingerprint,
  ...input.environmentMetadata,
});
