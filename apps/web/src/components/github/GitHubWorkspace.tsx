import type {
  GitHubAccount,
  GitHubRepositoryWorkspaceSnapshot,
  GitHubSyncResourceType,
} from "@t3tools/contracts";
import {
  CircleAlertIcon,
  CloudOffIcon,
  ExternalLinkIcon,
  GithubIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardHeader, CardPanel, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { githubWorkspaceNotice } from "./workspaceModel";

export type GitHubWorkspaceTab =
  | "overview"
  | "issues"
  | "pull-requests"
  | "branches"
  | "checks"
  | "synchronization";

const TABS: ReadonlyArray<{ readonly id: GitHubWorkspaceTab; readonly label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Issues" },
  { id: "pull-requests", label: "Pull requests" },
  { id: "branches", label: "Branches" },
  { id: "checks", label: "Checks" },
  { id: "synchronization", label: "Synchronization" },
];

export function GitHubWorkspaceShell({
  projectTitle,
  snapshot,
  activeTab,
  refreshing,
  onTabChange,
  onRefresh,
  children,
}: {
  readonly projectTitle: string;
  readonly snapshot: GitHubRepositoryWorkspaceSnapshot;
  readonly activeTab: GitHubWorkspaceTab;
  readonly refreshing: boolean;
  readonly onTabChange: (tab: GitHubWorkspaceTab) => void;
  readonly onRefresh: (resources: ReadonlyArray<GitHubSyncResourceType>) => void;
  readonly children: ReactNode;
}) {
  const { account, connection } = snapshot;
  const notice = githubWorkspaceNotice({
    freshness: snapshot.freshness,
    syncStatus: connection.syncStatus,
    accountStatus: account?.status ?? null,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="border-b px-4 pb-0 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-3 pb-4">
          <div className="mr-auto min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <GithubIcon className="size-5" />
              <h1 className="truncate text-lg font-semibold">
                {connection.owner}/{connection.repository}
              </h1>
              <Badge variant="outline">{connection.visibility}</Badge>
              {connection.isFork ? <Badge variant="secondary">fork</Badge> : null}
              {connection.permissions.canPush ? (
                <Badge variant="success">write capable</Badge>
              ) : (
                <Badge variant="info">read only</Badge>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{projectTitle}</p>
          </div>
          <Button
            variant="outline"
            disabled={refreshing || account?.status !== "connected"}
            onClick={() => onRefresh(["repository", "branches", "issues", "pull_requests"])}
          >
            <RefreshCwIcon /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            variant="outline"
            render={<a href={connection.htmlUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLinkIcon /> Open on GitHub
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto" aria-label="GitHub workspace sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                activeTab === tab.id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      {notice ? (
        <Alert
          className="m-4 mb-0 rounded-xl sm:mx-6"
          variant={
            notice.tone === "error" ? "error" : notice.tone === "warning" ? "warning" : "default"
          }
        >
          {notice.tone === "error" ? <CircleAlertIcon /> : <CloudOffIcon />}
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.description}</AlertDescription>
        </Alert>
      ) : null}
      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}

export function GitHubConnectionSetup({
  projectTitle,
  accounts,
  busy,
  error,
  onConnectAccount,
  onConnectRepository,
}: {
  readonly projectTitle: string;
  readonly accounts: ReadonlyArray<GitHubAccount>;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onConnectAccount: (serverUrl: string) => Promise<void>;
  readonly onConnectRepository: (input: {
    readonly accountId: GitHubAccount["id"];
    readonly repositoryUrl: string | null;
    readonly remoteName: string;
  }) => Promise<void>;
}) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div>
        <h1 className="text-xl font-semibold">Connect {projectTitle} to GitHub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GitHub stays authoritative for remote issues, pull requests, reviews, and checks. Your
          local project and mission history remain independent.
        </p>
      </div>
      {error ? (
        <Alert variant="error">
          <CircleAlertIcon />
          <AlertTitle>GitHub connection failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>1. Account</CardTitle>
        </CardHeader>
        <CardPanel className="space-y-3">
          {accounts.length > 0 ? (
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">@{account.login}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {account.serverUrl} · {account.status.replaceAll("_", " ")}
                    </p>
                  </div>
                  <Badge variant={account.status === "connected" ? "success" : "warning"}>
                    {account.authenticationType.replaceAll("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No connected GitHub account yet.</p>
          )}
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void onConnectAccount(String(data.get("serverUrl") ?? "https://github.com"));
            }}
          >
            <Input
              name="serverUrl"
              aria-label="GitHub server URL"
              defaultValue="https://github.com"
            />
            <Button type="submit" disabled={busy}>
              Connect GitHub
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            This release uses the GitHub CLI&apos;s authenticated account for the selected host. If
            it is not connected yet, run <code>gh auth login</code> on the environment host and
            retry. The CLI keeps the credential in its secure credential store; Lyn Code never
            copies it into project settings.
          </p>
        </CardPanel>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>2. Repository</CardTitle>
        </CardHeader>
        <CardPanel>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const accountId = String(data.get("accountId") ?? "") as GitHubAccount["id"];
              if (!accountId) return;
              void onConnectRepository({
                accountId,
                repositoryUrl: String(data.get("repositoryUrl") ?? "").trim() || null,
                remoteName: String(data.get("remoteName") ?? "origin"),
              });
            }}
          >
            <label className="grid gap-1 text-sm">
              Repository URL
              <Input
                name="repositoryUrl"
                placeholder="Leave blank to detect the selected Git remote"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Git remote
              <Input name="remoteName" defaultValue="origin" required />
            </label>
            <label className="grid gap-1 text-sm">
              Account
              <select
                name="accountId"
                className="h-9 rounded-lg border bg-background px-3 text-sm"
                disabled={accounts.length === 0}
                required
              >
                {accounts
                  .filter((account) => account.status === "connected")
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      @{account.login}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              className="sm:col-start-3"
              type="submit"
              disabled={busy || accounts.length === 0}
            >
              Connect repository
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Connecting records the selected remote; it does not rewrite local Git remote URLs.
          </p>
        </CardPanel>
      </Card>
    </div>
  );
}

export function GitHubOverview({
  snapshot,
}: {
  readonly snapshot: GitHubRepositoryWorkspaceSnapshot;
}) {
  const { connection, account } = snapshot;
  const fields = [
    ["Default branch", connection.defaultBranch],
    ["Selected remote", `${connection.remoteName} · ${connection.remoteUrl}`],
    ["Permissions", connection.permissions.level],
    ["Account", account ? `@${account.login}` : "Unavailable"],
    ["Last synchronized", connection.lastSyncedAt ?? "Never"],
    ["Cached snapshot", snapshot.capturedAt],
  ] as const;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Repository</CardTitle>
        </CardHeader>
        <CardPanel className="grid gap-3">
          {fields.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 border-b pb-3 last:border-0 last:pb-0 sm:grid-cols-[9rem_1fr]"
            >
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="break-all text-sm font-medium">{value}</span>
            </div>
          ))}
        </CardPanel>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connection boundaries</CardTitle>
        </CardHeader>
        <CardPanel className="space-y-3 text-sm text-muted-foreground">
          <p>Local Git is the source of truth for local branches, worktrees, and commits.</p>
          <p>
            GitHub is the source of truth for remote branches, pull requests, reviews, and Actions.
          </p>
          <p>
            Cached remote records are labelled when stale and never overwrite local mission history.
          </p>
          {connection.parentRepository ? (
            <p>
              Forked from{" "}
              <a
                className="text-primary underline"
                href={connection.parentRepository.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                {connection.parentRepository.owner}/{connection.parentRepository.repository}
              </a>
              .
            </p>
          ) : null}
        </CardPanel>
      </Card>
    </div>
  );
}
