export type GitHubRemoteTransport = "https" | "ssh";

export interface GitHubRemote {
  readonly transport: GitHubRemoteTransport;
  readonly host: string;
  readonly serverUrl: string;
  readonly owner: string;
  readonly repository: string;
  readonly nameWithOwner: string;
  readonly webUrl: string;
  readonly canonicalRemoteUrl: string;
}

const REPOSITORY_SEGMENT = /^[a-z0-9](?:[a-z0-9_.-]{0,98}[a-z0-9_.-])?$/i;
const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function decodeRepositorySegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      !REPOSITORY_SEGMENT.test(decoded)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseRepositoryPath(pathname: string): { owner: string; repository: string } | null {
  const segments = pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length !== 2) return null;

  const owner = decodeRepositorySegment(segments[0] ?? "");
  const rawRepository = (segments[1] ?? "").replace(/\.git$/i, "");
  const repository = decodeRepositorySegment(rawRepository);
  if (owner === null || repository === null || repository.length === 0) return null;
  return { owner, repository };
}

function buildRemote(input: {
  readonly transport: GitHubRemoteTransport;
  readonly host: string;
  readonly serverUrl: string;
  readonly owner: string;
  readonly repository: string;
  readonly sshPort?: string;
}): GitHubRemote {
  const host = input.host.toLowerCase();
  const nameWithOwner = `${input.owner}/${input.repository}`;
  const canonicalRemoteUrl =
    input.transport === "https"
      ? `${input.serverUrl}/${nameWithOwner}.git`
      : input.sshPort
        ? `ssh://git@${host}:${input.sshPort}/${nameWithOwner}.git`
        : `git@${host}:${nameWithOwner}.git`;

  return {
    transport: input.transport,
    host,
    serverUrl: input.serverUrl,
    owner: input.owner,
    repository: input.repository,
    nameWithOwner,
    webUrl: `${input.serverUrl}/${nameWithOwner}`,
    canonicalRemoteUrl,
  };
}

/**
 * Parses GitHub and GitHub Enterprise clone URLs without retaining any
 * credentials or unrelated URL components from the input.
 */
export function parseGitHubRemote(value: string | null | undefined): GitHubRemote | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0 || trimmed.includes("\0")) return null;

  const scp = trimmed.includes("://") ? null : /^(?:[^@\s/:]+@)?([^\s/:]+):(.+)$/u.exec(trimmed);
  if (scp?.[1] && scp[2] && HOST.test(scp[1])) {
    const repositoryPath = parseRepositoryPath(scp[2].split(/[?#]/u, 1)[0] ?? "");
    if (repositoryPath === null) return null;
    const host = scp[1].toLowerCase();
    return buildRemote({
      transport: "ssh",
      host,
      serverUrl: `https://${host}`,
      ...repositoryPath,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!HOST.test(parsed.hostname)) return null;
  const repositoryPath = parseRepositoryPath(parsed.pathname);
  if (repositoryPath === null) return null;
  const host = parsed.hostname.toLowerCase();

  if (parsed.protocol === "https:") {
    const serverUrl = `https://${host}${parsed.port ? `:${parsed.port}` : ""}`;
    return buildRemote({
      transport: "https",
      host,
      serverUrl,
      ...repositoryPath,
    });
  }

  if (parsed.protocol === "ssh:") {
    return buildRemote({
      transport: "ssh",
      host,
      serverUrl: `https://${host}`,
      ...(parsed.port ? { sshPort: parsed.port } : {}),
      ...repositoryPath,
    });
  }

  return null;
}

export function parseGitHubRepositoryInput(
  value: string,
  serverUrl = "https://github.com",
): GitHubRemote | null {
  const parsedRemote = parseGitHubRemote(value);
  if (parsedRemote !== null) return parsedRemote;

  let parsedServer: URL;
  try {
    parsedServer = new URL(serverUrl);
  } catch {
    return null;
  }
  if (parsedServer.protocol !== "https:" || !HOST.test(parsedServer.hostname)) return null;

  const repositoryPath = parseRepositoryPath(value);
  if (repositoryPath === null) return null;
  const host = parsedServer.hostname.toLowerCase();
  const canonicalServerUrl = `https://${host}${parsedServer.port ? `:${parsedServer.port}` : ""}`;
  return buildRemote({
    transport: "https",
    host,
    serverUrl: canonicalServerUrl,
    ...repositoryPath,
  });
}
