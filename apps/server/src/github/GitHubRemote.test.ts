import { describe, expect, it } from "@effect/vitest";

import { parseGitHubRemote, parseGitHubRepositoryInput } from "./GitHubRemote.ts";

describe("parseGitHubRemote", () => {
  it.each([
    "https://github.com/octocat/hello-world.git",
    "git@github.com:octocat/hello-world.git",
    "ssh://git@github.com/octocat/hello-world.git",
  ])("normalizes GitHub clone URL %s", (remote) => {
    expect(parseGitHubRemote(remote)).toMatchObject({
      host: "github.com",
      serverUrl: "https://github.com",
      owner: "octocat",
      repository: "hello-world",
      nameWithOwner: "octocat/hello-world",
      webUrl: "https://github.com/octocat/hello-world",
    });
  });

  it("supports GitHub Enterprise HTTPS hosts and ports", () => {
    expect(parseGitHubRemote("https://github.example.test:8443/acme/widgets.git")).toEqual({
      transport: "https",
      host: "github.example.test",
      serverUrl: "https://github.example.test:8443",
      owner: "acme",
      repository: "widgets",
      nameWithOwner: "acme/widgets",
      webUrl: "https://github.example.test:8443/acme/widgets",
      canonicalRemoteUrl: "https://github.example.test:8443/acme/widgets.git",
    });
  });

  it("preserves an alternate SSH port without treating it as the web port", () => {
    expect(parseGitHubRemote("ssh://git@github.example.test:2222/acme/widgets.git")).toEqual({
      transport: "ssh",
      host: "github.example.test",
      serverUrl: "https://github.example.test",
      owner: "acme",
      repository: "widgets",
      nameWithOwner: "acme/widgets",
      webUrl: "https://github.example.test/acme/widgets",
      canonicalRemoteUrl: "ssh://git@github.example.test:2222/acme/widgets.git",
    });
  });

  it("drops URL userinfo, query, and fragment from every returned field", () => {
    const secret = "credential-secret-sentinel";
    const parsed = parseGitHubRemote(
      `https://user:${secret}@github.example.test/acme/widgets.git?token=${secret}#${secret}`,
    );

    expect(parsed).not.toBeNull();
    expect(Object.values(parsed ?? {}).join("\n")).not.toContain(secret);
    expect(parsed?.canonicalRemoteUrl).toBe("https://github.example.test/acme/widgets.git");
  });

  it.each([
    "http://github.com/acme/widgets.git",
    "git://github.com/acme/widgets.git",
    "https://github.com/acme",
    "https://github.com/acme/widgets/extra",
    "https://github.com/acme/%2e%2e",
    "file:///acme/widgets",
  ])("rejects unsupported or ambiguous remote %s", (remote) => {
    expect(parseGitHubRemote(remote)).toBeNull();
  });
});

describe("parseGitHubRepositoryInput", () => {
  it("resolves owner/repository selectors against a configured GHES server", () => {
    expect(
      parseGitHubRepositoryInput("acme/widgets", "https://github.example.test:8443/settings"),
    ).toMatchObject({
      serverUrl: "https://github.example.test:8443",
      host: "github.example.test",
      nameWithOwner: "acme/widgets",
    });
  });
});
