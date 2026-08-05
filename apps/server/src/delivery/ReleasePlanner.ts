import * as NodeCrypto from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import type { ReleasePlan } from "@t3tools/contracts";

export type ReleaseProposalKind = "manual" | "calendar" | "explicit_semver";
export type ReleaseBump = "major" | "minor" | "patch";

export interface ReleaseEvidence {
  readonly sourceFingerprint: string;
  readonly commitSha: string;
  readonly verificationRunId: string;
  readonly verificationResult: "passed" | "failed" | "cancelled" | "interrupted";
  readonly authorizationScope: "full_profile" | "diagnostic_subset";
}

export interface ReleasePlanProposal {
  readonly proposalKind: ReleaseProposalKind;
  readonly currentVersion: string;
  readonly requestedVersion?: string;
  readonly bump?: ReleaseBump;
  readonly proposedAt: string;
  readonly tagPrefix?: string;
  readonly existingTags?: Readonly<Record<string, string>>;
  readonly evidence: ReleaseEvidence;
  readonly changelogEntries: ReadonlyArray<string>;
  readonly releaseNotes: string;
}

export interface PlannedRelease {
  readonly version: ReleasePlan["version"];
  readonly tag: ReleasePlan["tagName"];
  readonly proposalKind: ReleaseProposalKind;
  readonly proposedAt: string;
  readonly sourceFingerprint: string;
  readonly commitSha: string;
  readonly verificationRunId: string;
  readonly changelogEntries: ReadonlyArray<string>;
  readonly releaseNotes: string;
  readonly planFingerprint: string;
}

export type ReleasePlanningResult =
  | { readonly accepted: true; readonly plan: PlannedRelease }
  | {
      readonly accepted: false;
      readonly reason:
        | "invalid_current_version"
        | "invalid_requested_version"
        | "version_not_greater"
        | "tag_conflict"
        | "invalid_evidence"
        | "invalid_proposal_time";
      readonly detail: string;
    };

const SEMVER_NUMBER = "(?:0|[1-9]\\d*)";
const SEMVER_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT_SEMVER = new RegExp(
  `^(${SEMVER_NUMBER})\\.(${SEMVER_NUMBER})\\.(${SEMVER_NUMBER})(?:-(${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`,
);
const MAX_CHANGELOG_ENTRIES = 64;
const MAX_CHANGELOG_ENTRY_LENGTH = 512;
const MAX_RELEASE_NOTES_LENGTH = 32 * 1024;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: ReadonlyArray<string>;
}

const parseVersion = (value: string): ParsedVersion | null => {
  const match = EXACT_SEMVER.exec(value);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return {
    major,
    minor,
    patch,
    prerelease: match[4]?.split(".") ?? [],
  };
};

const comparePrerelease = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): number => {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      if (leftPart.length !== rightPart.length) return leftPart.length < rightPart.length ? -1 : 1;
      return leftPart < rightPart ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
};

export const compareExactVersions = (left: string, right: string): number => {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (parsedLeft === null || parsedRight === null) {
    throw new Error("compareExactVersions requires exact semantic versions.");
  }
  for (const key of ["major", "minor", "patch"] as const) {
    if (parsedLeft[key] !== parsedRight[key]) return parsedLeft[key] < parsedRight[key] ? -1 : 1;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
};

const nextManualVersion = (current: ParsedVersion, bump: ReleaseBump): string => {
  if (bump === "major") return `${current.major + 1}.0.0`;
  if (bump === "minor") return `${current.major}.${current.minor + 1}.0`;
  return `${current.major}.${current.minor}.${current.patch + 1}`;
};

const nextCalendarVersion = (
  proposedAt: DateTime.DateTime,
  existingTags: Readonly<Record<string, string>>,
  prefix: string,
): string => {
  const parts = DateTime.toPartsUtc(proposedAt);
  const date = `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
  let sequence = 0;
  while (`${prefix}0.${date}.${sequence}` in existingTags) sequence += 1;
  return `0.${date}.${sequence}`;
};

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

const fingerprint = (value: unknown): string =>
  NodeCrypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const boundText = (value: string, maximum: number): string => {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 16).trimEnd()}\n\n[truncated]`;
};

const boundChangelogEntries = (entries: ReadonlyArray<string>): ReadonlyArray<string> =>
  entries
    .slice(0, MAX_CHANGELOG_ENTRIES)
    .map((entry) => boundText(entry.replace(/\s+/g, " "), MAX_CHANGELOG_ENTRY_LENGTH))
    .filter((entry) => entry.length > 0);

const validEvidence = (evidence: ReleaseEvidence): boolean =>
  evidence.sourceFingerprint.length === 64 &&
  /^[a-f0-9]{64}$/i.test(evidence.sourceFingerprint) &&
  /^[a-f0-9]{7,64}$/i.test(evidence.commitSha) &&
  evidence.verificationRunId.trim().length > 0 &&
  evidence.verificationResult === "passed" &&
  evidence.authorizationScope === "full_profile";

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export const planRelease = (proposal: ReleasePlanProposal): ReleasePlanningResult => {
  const current = parseVersion(proposal.currentVersion);
  if (current === null) {
    return {
      accepted: false,
      reason: "invalid_current_version",
      detail: "Current version is not exact SemVer.",
    };
  }
  if (!validEvidence(proposal.evidence)) {
    return {
      accepted: false,
      reason: "invalid_evidence",
      detail: "A passing full-profile verification bound to immutable source is required.",
    };
  }
  const proposedAt = DateTime.make(proposal.proposedAt);
  if (Option.isNone(proposedAt)) {
    return {
      accepted: false,
      reason: "invalid_proposal_time",
      detail: "Proposal time is not a valid instant.",
    };
  }
  const tagPrefix = proposal.tagPrefix ?? "v";
  const existingTags = proposal.existingTags ?? {};
  const version =
    proposal.proposalKind === "calendar"
      ? nextCalendarVersion(proposedAt.value, existingTags, tagPrefix)
      : proposal.proposalKind === "manual"
        ? nextManualVersion(current, proposal.bump ?? "patch")
        : proposal.requestedVersion;
  if (version === undefined || parseVersion(version) === null) {
    return {
      accepted: false,
      reason: "invalid_requested_version",
      detail: "Requested version is not exact SemVer.",
    };
  }
  if (compareExactVersions(version, proposal.currentVersion) <= 0) {
    return {
      accepted: false,
      reason: "version_not_greater",
      detail: "Release version must be greater than the current version.",
    };
  }
  const tag = `${tagPrefix}${version}`;
  const taggedCommit = existingTags[tag];
  if (taggedCommit !== undefined && taggedCommit !== proposal.evidence.commitSha) {
    return {
      accepted: false,
      reason: "tag_conflict",
      detail: `Tag ${tag} already identifies different source.`,
    };
  }
  const changelogEntries = boundChangelogEntries(proposal.changelogEntries);
  const releaseNotes = boundText(proposal.releaseNotes, MAX_RELEASE_NOTES_LENGTH);
  const unsigned = {
    version,
    tag,
    proposalKind: proposal.proposalKind,
    proposedAt: DateTime.formatIso(proposedAt.value),
    sourceFingerprint: proposal.evidence.sourceFingerprint.toLowerCase(),
    commitSha: proposal.evidence.commitSha.toLowerCase(),
    verificationRunId: proposal.evidence.verificationRunId,
    changelogEntries,
    releaseNotes,
  };
  return {
    accepted: true,
    plan: deepFreeze({ ...unsigned, planFingerprint: fingerprint(unsigned) }),
  };
};
