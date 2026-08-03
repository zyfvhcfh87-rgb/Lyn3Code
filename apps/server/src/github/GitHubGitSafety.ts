import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { GitHubBranchRelation } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const GIT_NO_PROMPT_ENV = Object.freeze({
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  GIT_TERMINAL_PROMPT: "0",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
} satisfies NodeJS.ProcessEnv);

const PATCH_SCAN_LIMIT_BYTES = 2 * 1024 * 1024;

export const GitHubGitSafetyFailureReason = Schema.Literals([
  "not_repository",
  "unexpected_branch",
  "unexpected_head",
  "default_branch",
  "uncommitted_changes",
  "no_commits",
  "diverged",
  "behind",
  "secret_detected",
  "scan_incomplete",
  "push_failed",
  "confirmation_failed",
]);
export type GitHubGitSafetyFailureReason = typeof GitHubGitSafetyFailureReason.Type;

export class GitHubGitSafetyError extends Schema.TaggedErrorClass<GitHubGitSafetyError>()(
  "GitHubGitSafetyError",
  {
    operation: Schema.String,
    reason: GitHubGitSafetyFailureReason,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface GitHubPushPreflightInput {
  readonly cwd: string;
  readonly remoteName: string;
  readonly branchName: string;
  readonly expectedHeadSha: string;
  readonly defaultBranch: string;
}

export interface GitHubPushPreflight {
  readonly branchName: string;
  readonly headSha: string;
  readonly remoteSha: string | null;
  readonly relation: GitHubBranchRelation;
  readonly aheadCount: number | null;
  readonly behindCount: number | null;
  readonly hasUncommittedChanges: boolean;
  readonly secretFindingKinds: ReadonlyArray<string>;
}

export interface GitHubConfirmedPushResult {
  readonly preflight: GitHubPushPreflight;
  readonly confirmedRemoteSha: string;
}

export function parseLsRemoteHead(stdout: string): string | null {
  const firstLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return null;
  const [sha, ref, ...extra] = firstLine.split(/\s+/u);
  if (extra.length > 0 || sha === undefined || ref === undefined) return null;
  return /^[0-9a-f]{40,64}$/iu.test(sha) && ref.startsWith("refs/heads/") ? sha : null;
}

export function parseAheadBehind(stdout: string): { ahead: number; behind: number } | null {
  const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(stdout);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const ahead = Number(match[1]);
  const behind = Number(match[2]);
  return Number.isSafeInteger(ahead) && Number.isSafeInteger(behind) ? { ahead, behind } : null;
}

export function classifyBranchRelation(
  localSha: string,
  remoteSha: string | null,
  aheadBehind: { readonly ahead: number; readonly behind: number } | null,
): GitHubBranchRelation {
  if (remoteSha === null) return "missing_remote";
  if (localSha === remoteSha) return "equal";
  if (aheadBehind === null) return "unknown";
  if (aheadBehind.ahead > 0 && aheadBehind.behind > 0) return "diverged";
  if (aheadBehind.ahead > 0) return "ahead";
  if (aheadBehind.behind > 0) return "behind";
  return "unknown";
}

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u],
  ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ["assigned_secret", /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["'][^"'\s]{12,}["']/iu],
];

/** Scan only added patch lines and return finding categories, never matched values. */
export function scanAddedPatchForSecrets(patch: string): ReadonlyArray<string> {
  const findings = new Set<string>();
  for (const line of patch.split(/\r?\n/u)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const added = line.slice(1);
    for (const [kind, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(added)) findings.add(kind);
    }
  }
  return [...findings].toSorted();
}

export class GitHubGitSafety extends Context.Service<
  GitHubGitSafety,
  {
    readonly preflight: (
      input: GitHubPushPreflightInput,
    ) => Effect.Effect<GitHubPushPreflight, GitHubGitSafetyError>;
    readonly pushConfirmed: (
      input: GitHubPushPreflightInput,
    ) => Effect.Effect<GitHubConfirmedPushResult, GitHubGitSafetyError>;
  }
>()("t3/github/GitHubGitSafety") {}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;

  const run = (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly allowNonZeroExit?: boolean;
    readonly maxOutputBytes?: number;
  }) =>
    git
      .execute({
        operation: `GitHubGitSafety.${input.operation}`,
        cwd: input.cwd,
        args: input.args,
        env: GIT_NO_PROMPT_ENV,
        timeoutMs: 60_000,
        maxOutputBytes: input.maxOutputBytes ?? 256 * 1024,
        ...(input.allowNonZeroExit === undefined
          ? {}
          : { allowNonZeroExit: input.allowNonZeroExit }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new GitHubGitSafetyError({
              operation: input.operation,
              reason: input.operation === "push" ? "push_failed" : "confirmation_failed",
              message: `Git safety check '${input.operation}' failed.`,
              cause,
            }),
        ),
      );

  const preflight = Effect.fn("GitHubGitSafety.preflight")(function* (
    input: GitHubPushPreflightInput,
  ) {
    const [branchResult, headResult, statusResult] = yield* Effect.all([
      run({ operation: "read-branch", cwd: input.cwd, args: ["symbolic-ref", "--short", "HEAD"] }),
      run({ operation: "read-head", cwd: input.cwd, args: ["rev-parse", "HEAD"] }),
      run({ operation: "read-status", cwd: input.cwd, args: ["status", "--porcelain=v1", "-z"] }),
    ]);
    const branchName = branchResult.stdout.trim();
    const headSha = headResult.stdout.trim();
    if (branchName !== input.branchName) {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "unexpected_branch",
        message: `Expected managed branch '${input.branchName}' but found '${branchName || "detached HEAD"}'.`,
      });
    }
    if (headSha !== input.expectedHeadSha) {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "unexpected_head",
        message: "The managed branch head changed after confirmation. Refresh and review it again.",
      });
    }
    if (branchName === input.defaultBranch) {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "default_branch",
        message: "Direct pushes to the repository default branch are blocked.",
      });
    }
    const hasUncommittedChanges = statusResult.stdout.length > 0;
    if (hasUncommittedChanges) {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "uncommitted_changes",
        message:
          "The managed worktree has uncommitted changes. Commit or discard them before pushing.",
      });
    }

    const remoteResult = yield* run({
      operation: "read-remote-head",
      cwd: input.cwd,
      args: ["ls-remote", "--heads", input.remoteName, `refs/heads/${input.branchName}`],
    });
    const remoteSha = parseLsRemoteHead(remoteResult.stdout);
    let aheadBehind: { ahead: number; behind: number } | null = null;
    if (remoteSha !== null) {
      yield* run({
        operation: "fetch-remote-head",
        cwd: input.cwd,
        args: [
          "fetch",
          "--no-tags",
          input.remoteName,
          `refs/heads/${input.branchName}:refs/remotes/${input.remoteName}/${input.branchName}`,
        ],
      });
      const counts = yield* run({
        operation: "compare-remote-head",
        cwd: input.cwd,
        args: [
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...refs/remotes/${input.remoteName}/${input.branchName}`,
        ],
      });
      aheadBehind = parseAheadBehind(counts.stdout);
    }
    const relation = classifyBranchRelation(headSha, remoteSha, aheadBehind);
    if (relation === "diverged" || relation === "behind") {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: relation,
        message:
          relation === "diverged"
            ? "The remote branch diverged. Lyn Code will not force-push or rewrite it."
            : "The remote branch contains commits that are not in the managed branch.",
      });
    }

    const baseRef =
      remoteSha === null
        ? `refs/remotes/${input.remoteName}/${input.defaultBranch}`
        : `refs/remotes/${input.remoteName}/${input.branchName}`;
    const baseExists = yield* run({
      operation: "resolve-scan-base",
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--quiet", baseRef],
      allowNonZeroExit: true,
    });
    const scanBase = baseExists.exitCode === 0 ? baseRef : input.defaultBranch;
    const commits = yield* run({
      operation: "count-commits",
      cwd: input.cwd,
      args: ["rev-list", "--count", `${scanBase}..HEAD`],
    });
    if (Number(commits.stdout.trim()) < 1 && relation === "missing_remote") {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "no_commits",
        message: "The selected branch has no commits beyond its base branch.",
      });
    }
    const patch = yield* run({
      operation: "scan-patch",
      cwd: input.cwd,
      args: ["diff", "--no-ext-diff", "--no-color", "--unified=0", `${scanBase}..HEAD`],
      maxOutputBytes: PATCH_SCAN_LIMIT_BYTES,
    });
    if (patch.stdoutTruncated) {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "scan_incomplete",
        message: "The outgoing patch exceeded the secret-scan limit, so the push was stopped.",
      });
    }
    const secretFindingKinds = scanAddedPatchForSecrets(patch.stdout);
    if (secretFindingKinds.length > 0) {
      return yield* new GitHubGitSafetyError({
        operation: "preflight",
        reason: "secret_detected",
        message: `Potential credential material was detected (${secretFindingKinds.join(", ")}).`,
      });
    }

    return {
      branchName,
      headSha,
      remoteSha,
      relation,
      aheadCount: aheadBehind?.ahead ?? null,
      behindCount: aheadBehind?.behind ?? null,
      hasUncommittedChanges,
      secretFindingKinds,
    } satisfies GitHubPushPreflight;
  });

  const pushConfirmed = Effect.fn("GitHubGitSafety.pushConfirmed")(function* (
    input: GitHubPushPreflightInput,
  ) {
    const preflightResult = yield* preflight(input);
    yield* run({
      operation: "push",
      cwd: input.cwd,
      args: ["push", "-u", input.remoteName, `HEAD:refs/heads/${input.branchName}`],
    });
    const confirmation = yield* run({
      operation: "confirm-remote-head",
      cwd: input.cwd,
      args: ["ls-remote", "--heads", input.remoteName, `refs/heads/${input.branchName}`],
    });
    const confirmedRemoteSha = parseLsRemoteHead(confirmation.stdout);
    if (confirmedRemoteSha !== input.expectedHeadSha) {
      return yield* new GitHubGitSafetyError({
        operation: "confirm-remote-head",
        reason: "confirmation_failed",
        message:
          "Git accepted the push, but the remote branch did not confirm the expected commit.",
      });
    }
    return { preflight: preflightResult, confirmedRemoteSha };
  });

  return GitHubGitSafety.of({ preflight, pushConfirmed });
});

export const layer = Layer.effect(GitHubGitSafety, make);
