import { describe, expect, it } from "@effect/vitest";
import { GitHubWorkspaceMutationError, GitHubWorkspaceQueryError } from "@t3tools/contracts";

import {
  GitHubApiDecodeError,
  GitHubApiResponseError,
  GitHubApiTransportError,
} from "./GitHubApiClient.ts";
import { classifyGitHubSyncFailure, parseLocalBranchRefs } from "./GitHubWorkspaceService.ts";

const responseError = (kind: GitHubApiResponseError["kind"]) =>
  new GitHubApiResponseError({
    operation: "sync",
    endpoint: "/repos/acme/widget",
    status: kind === "authentication_required" ? 401 : kind === "not_found" ? 404 : 403,
    kind,
    retryable: false,
    responseBodyLength: 0,
    retryAfterSeconds: null,
    rateLimitResetAt: null,
    secondaryRateLimit: false,
  });

describe("parseLocalBranchRefs", () => {
  it("parses trimmed CRLF output with SHA-1 and SHA-256 object ids", () => {
    const sha1 = "0123456789abcdef0123456789abcdef01234567";
    const sha256 = "a".repeat(64);

    expect(
      parseLocalBranchRefs(`  mission/one\t${sha1}\r\nmission/two\t${sha256}\r\n\r\n`),
    ).toEqual([
      { name: "mission/one", sha: sha1 },
      { name: "mission/two", sha: sha256 },
    ]);
  });

  it("drops malformed lines and invalid object ids without inventing refs", () => {
    const validSha = "f".repeat(40);

    expect(
      parseLocalBranchRefs(
        [
          "missing-separator",
          "\t" + validSha,
          "feature/not-hex\t" + "z".repeat(40),
          "feature/short\tdeadbeef",
          `feature/valid\t${validSha}`,
          `feature/extra-tab\t${validSha}\tunexpected`,
        ].join("\n"),
      ),
    ).toEqual([{ name: "feature/valid", sha: validSha }]);
  });
});

describe("classifyGitHubSyncFailure", () => {
  it("maps authentication, permission, and rate-limit failures to durable states and events", () => {
    expect(classifyGitHubSyncFailure(responseError("authentication_required"))).toEqual({
      connectionStatus: "authentication_required",
      accountStatus: "expired",
      eventType: "github.authentication_expired",
    });

    expect(
      classifyGitHubSyncFailure(
        new GitHubWorkspaceQueryError({
          operation: "sync_reviews",
          reason: "permission_denied",
          message: "Read access was denied.",
        }),
      ),
    ).toEqual({
      connectionStatus: "failed",
      accountStatus: "insufficient_permissions",
      eventType: "github.permissions_changed",
    });

    expect(
      classifyGitHubSyncFailure(
        new GitHubWorkspaceMutationError({
          operation: "refresh",
          reason: "rate_limited",
          message: "Wait for the reset window.",
        }),
      ),
    ).toEqual({
      connectionStatus: "rate_limited",
      accountStatus: "rate_limited",
      eventType: "github.rate_limited",
    });
  });

  it("distinguishes offline transport and reason failures from a missing remote resource", () => {
    expect(
      classifyGitHubSyncFailure(
        new GitHubApiTransportError({
          operation: "sync",
          endpoint: "/repos/acme/widget",
          retryable: true,
          cause: new Error("network unavailable"),
        }),
      ),
    ).toEqual({ connectionStatus: "offline", accountStatus: null, eventType: null });

    expect(
      classifyGitHubSyncFailure(
        new GitHubWorkspaceQueryError({
          operation: "sync",
          reason: "offline",
          message: "The server is unreachable.",
        }),
      ),
    ).toEqual({ connectionStatus: "offline", accountStatus: null, eventType: null });

    expect(classifyGitHubSyncFailure(responseError("not_found"))).toEqual({
      connectionStatus: "remote_deleted",
      accountStatus: null,
      eventType: null,
    });
  });

  it("fails closed for decode errors and unrecognized values", () => {
    const expected = { connectionStatus: "failed", accountStatus: "error", eventType: null };

    expect(
      classifyGitHubSyncFailure(
        new GitHubApiDecodeError({
          operation: "sync",
          endpoint: "/repos/acme/widget",
          status: 200,
          responseBodyLength: 12,
        }),
      ),
    ).toEqual(expected);
    expect(classifyGitHubSyncFailure(new Error("unexpected"))).toEqual(expected);
    expect(classifyGitHubSyncFailure(null)).toEqual(expected);
  });
});
