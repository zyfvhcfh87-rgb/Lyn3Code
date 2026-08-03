import { afterEach, assert, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import type * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubApi from "./GitHubApiClient.ts";

const output = (stdout: string, exitCode = 0): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const executeApi = vi.fn<GitHubCli.GitHubCli["Service"]["executeApi"]>();
const layer = GitHubApi.layer.pipe(Layer.provide(Layer.mock(GitHubCli.GitHubCli)({ executeApi })));

afterEach(() => {
  executeApi.mockReset();
});

describe("GitHubApiClient", () => {
  it.effect("validates an account and captures scopes, cache metadata, and rate limits", () => {
    executeApi.mockReturnValueOnce(
      Effect.succeed(
        output(
          [
            "HTTP/2.0 200 OK",
            'etag: "account-v1"',
            "x-oauth-scopes: read:user, repo",
            "x-ratelimit-resource: core",
            "x-ratelimit-limit: 5000",
            "x-ratelimit-remaining: 4999",
            "x-ratelimit-used: 1",
            "x-ratelimit-reset: 1800000000",
            "",
            '{"id":1,"node_id":"U_1","login":"octocat","name":"The Octocat","avatar_url":"https://avatars.example/octocat","html_url":"https://github.com/octocat"}',
          ].join("\n"),
        ),
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.validateAccount({ cwd: "/repo", hostname: "github.com" });

      assert.isFalse(result.notModified);
      if (result.notModified) return;
      assert.deepStrictEqual(result.data, {
        providerAccountId: "1",
        nodeId: "U_1",
        login: "octocat",
        displayName: "The Octocat",
        avatarUrl: "https://avatars.example/octocat",
        htmlUrl: "https://github.com/octocat",
        scopes: ["read:user", "repo"],
        serverUrl: "https://github.com",
      });
      assert.strictEqual(result.etag, '"account-v1"');
      assert.deepStrictEqual(result.rateLimit, {
        kind: "core",
        limit: 5000,
        remaining: 4999,
        used: 1,
        resetAt: "2027-01-15T08:00:00.000Z",
        retryAfterSeconds: null,
        secondary: false,
      });
      expect(executeApi).toHaveBeenCalledWith({
        cwd: "/repo",
        hostname: "github.com",
        endpoint: "user",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("normalizes issues and exposes a sanitized next-page cursor", () => {
    executeApi.mockReturnValueOnce(
      Effect.succeed(
        output(
          [
            "HTTP/2.0 200 OK",
            'link: <https://api.github.com/repos/acme/widgets/issues?state=open&per_page=2&page=2>; rel="next", <https://api.github.com/repos/acme/widgets/issues?state=open&per_page=2&page=4>; rel="last"',
            "",
            '[{"id":42,"node_id":"I_42","number":7,"title":"Fix widgets","body":"Details","state":"open","user":{"login":"octocat","avatar_url":null,"html_url":"https://github.com/octocat"},"assignees":[],"labels":[{"name":"bug","color":"d73a4a","description":null}],"milestone":null,"comments":3,"html_url":"https://github.com/acme/widgets/issues/7","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z","closed_at":null}]',
          ].join("\n"),
        ),
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.listIssues({
        cwd: "/repo",
        hostname: "github.com",
        owner: "acme",
        repository: "widgets",
        pageSize: 2,
      });

      assert.isFalse(result.notModified);
      if (result.notModified) return;
      assert.strictEqual(result.data.records[0]?.githubIssueId, "42");
      assert.strictEqual(result.data.records[0]?.labels[0]?.name, "bug");
      assert.deepStrictEqual(result.data.pageInfo, {
        endCursor: "repos/acme/widgets/issues?state=open&per_page=2&page=2",
        hasNextPage: true,
        totalCount: null,
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("returns not-modified without trying to decode an empty body", () => {
    executeApi.mockReturnValueOnce(
      Effect.succeed(output(["HTTP/2.0 304 Not Modified", 'etag: "v2"', "", ""].join("\n"))),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.getRepository({
        cwd: "/repo",
        hostname: "github.com",
        owner: "acme",
        repository: "widgets",
        conditional: { etag: '"v1"' },
      });

      assert.isTrue(result.notModified);
      assert.strictEqual(result.etag, '"v2"');
      assert.isNull(result.data);
    }).pipe(Effect.provide(layer));
  });

  it.effect("classifies secondary rate limits without retaining the response body", () => {
    const secret = "credential-secret-sentinel";
    executeApi.mockReturnValueOnce(
      Effect.succeed(
        output(
          [
            "HTTP/2.0 403 Forbidden",
            "retry-after: 60",
            "x-ratelimit-remaining: 100",
            "",
            `{"message":"secondary rate limit ${secret}"}`,
          ].join("\n"),
          1,
        ),
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const error = yield* github
        .getRepository({
          cwd: "/repo",
          hostname: "github.com",
          owner: "acme",
          repository: "widgets",
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, GitHubApi.GitHubApiResponseError);
      assert.strictEqual(error.kind, "rate_limited");
      assert.isTrue(error.secondaryRateLimit);
      assert.strictEqual(error.retryAfterSeconds, 60);
      assert.notInclude(error.message, secret);
      assert.strictEqual(executeApi.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("retries transient responses only within the configured bound", () => {
    executeApi
      .mockReturnValueOnce(
        Effect.succeed(output(["HTTP/2.0 503 Service Unavailable", "", "{}"].join("\n"), 1)),
      )
      .mockReturnValueOnce(
        Effect.succeed(
          output(
            [
              "HTTP/2.0 200 OK",
              "",
              '{"id":1,"node_id":"U_1","login":"octocat","name":null,"avatar_url":null,"html_url":null}',
            ].join("\n"),
          ),
        ),
      );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.validateAccount({
        cwd: "/repo",
        hostname: "github.com",
        retry: { maxRetries: 1, baseDelayMs: 0 },
      });

      assert.isFalse(result.notModified);
      assert.strictEqual(executeApi.mock.calls.length, 2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("creates draft pull requests with structured body input", () => {
    executeApi.mockReturnValueOnce(
      Effect.succeed(
        output(
          [
            "HTTP/2.0 201 Created",
            "",
            '{"id":9,"node_id":"PR_9","number":3,"title":"Ship widgets","body":"Evidence","state":"open","draft":true,"user":{"login":"octocat"},"head":{"ref":"mission/widgets","sha":"abc"},"base":{"ref":"main","sha":"def"},"mergeable":null,"mergeable_state":"unknown","changed_files":2,"commits":1,"comments":0,"review_comments":0,"html_url":"https://github.com/acme/widgets/pull/3","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","merged_at":null,"closed_at":null}',
          ].join("\n"),
        ),
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.createPullRequest({
        cwd: "/repo",
        hostname: "github.com",
        owner: "acme",
        repository: "widgets",
        title: "Ship widgets",
        body: "Evidence",
        head: "mission/widgets",
        base: "main",
      });

      assert.isFalse(result.notModified);
      if (result.notModified) return;
      assert.isTrue(result.data.isDraft);
      expect(executeApi).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "repos/acme/widgets/pulls",
          method: "POST",
          body: {
            title: "Ship widgets",
            body: "Evidence",
            head: "mission/widgets",
            base: "main",
            draft: true,
          },
        }),
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps review threads structured and exposes nested comment pagination", () => {
    executeApi.mockReturnValueOnce(
      Effect.succeed(
        output(
          [
            "HTTP/2.0 200 OK",
            "x-ratelimit-resource: graphql",
            "",
            '{"data":{"repository":{"pullRequest":{"reviewThreads":{"totalCount":1,"pageInfo":{"endCursor":"thread-cursor","hasNextPage":false},"nodes":[{"id":"PRRT_1","path":"src/widget.ts","line":12,"originalLine":10,"diffSide":"RIGHT","isResolved":false,"isOutdated":false,"comments":{"totalCount":101,"pageInfo":{"endCursor":"comment-cursor","hasNextPage":true},"nodes":[{"id":"PRRC_1","databaseId":55,"body":"Please guard this","path":"src/widget.ts","line":12,"originalLine":10,"diffSide":"RIGHT","author":{"login":"reviewer","avatarUrl":null,"url":"https://github.com/reviewer"},"commit":{"oid":"abc"},"url":"https://github.com/acme/widgets/pull/3#discussion_r55","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","pullRequestReview":{"databaseId":9}}]}}]}}}}}',
          ].join("\n"),
        ),
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.listReviewThreads({
        cwd: "/repo",
        hostname: "github.com",
        owner: "acme",
        repository: "widgets",
        number: 3,
      });

      assert.isFalse(result.notModified);
      if (result.notModified) return;
      assert.deepStrictEqual(result.data.pageInfo, {
        endCursor: "thread-cursor",
        hasNextPage: false,
        totalCount: 1,
      });
      const thread = result.data.records[0];
      assert.strictEqual(thread?.githubThreadId, "PRRT_1");
      assert.isFalse(thread?.isResolved ?? true);
      assert.deepStrictEqual(thread?.commentPageInfo, {
        endCursor: "comment-cursor",
        hasNextPage: true,
        totalCount: 101,
      });
      assert.strictEqual(thread?.comments[0]?.reviewId, "9");
    }).pipe(Effect.provide(layer));
  });

  it.effect("normalizes check runs for the requested head commit", () => {
    executeApi.mockReturnValueOnce(
      Effect.succeed(
        output(
          [
            "HTTP/2.0 200 OK",
            "",
            '{"total_count":1,"check_runs":[{"id":77,"node_id":"CR_77","name":"tests","head_sha":"abc","status":"completed","conclusion":"success","details_url":"https://github.com/acme/widgets/actions/runs/1","started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-01T00:01:00Z","app":{"name":"GitHub Actions"},"output":{"summary":"All tests passed"}}]}',
          ].join("\n"),
        ),
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHubApi.GitHubApiClient;
      const result = yield* github.listChecks({
        cwd: "/repo",
        hostname: "github.com",
        owner: "acme",
        repository: "widgets",
        headSha: "abc",
      });

      assert.isFalse(result.notModified);
      if (result.notModified) return;
      assert.deepStrictEqual(result.data.records[0], {
        githubCheckId: "77",
        name: "tests",
        provider: "GitHub Actions",
        headSha: "abc",
        status: "completed",
        conclusion: "success",
        detailsUrl: "https://github.com/acme/widgets/actions/runs/1",
        startedAtRemote: "2026-01-01T00:00:00Z",
        completedAtRemote: "2026-01-01T00:01:00Z",
        summary: "All tests passed",
      });
      assert.strictEqual(result.data.pageInfo.totalCount, 1);
    }).pipe(Effect.provide(layer));
  });
});
