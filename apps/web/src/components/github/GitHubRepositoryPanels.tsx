import type {
  GitHubBranchObservation,
  GitHubRepositoryWorkspaceSnapshot,
  MissionId,
} from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  GitBranchIcon,
  LogOutIcon,
  PlugZapIcon,
  RefreshCwIcon,
  UnplugIcon,
  UploadCloudIcon,
} from "lucide-react";
import { useState } from "react";

import type { GitHubMissionOption } from "./GitHubIssuesPanel";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardHeader, CardPanel, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

function relationVariant(relation: GitHubBranchObservation["relation"]) {
  if (relation === "diverged") return "error" as const;
  if (relation === "ahead" || relation === "missing_remote") return "warning" as const;
  if (relation === "equal") return "success" as const;
  return "outline" as const;
}

export function GitHubBranchesPanel({
  branches,
  missions,
  defaultBranch,
  canPush,
  onPush,
}: {
  readonly branches: ReadonlyArray<GitHubBranchObservation>;
  readonly missions: ReadonlyArray<GitHubMissionOption>;
  readonly defaultBranch: string;
  readonly canPush: boolean;
  readonly onPush: (input: {
    readonly missionId: MissionId;
    readonly branch: GitHubBranchObservation;
  }) => Promise<void>;
}) {
  const [pushBranch, setPushBranch] = useState<GitHubBranchObservation | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranchIcon className="size-4" /> Local and remote branch state
        </CardTitle>
      </CardHeader>
      <CardPanel className="space-y-2">
        {branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No branch observations have been synchronized yet.
          </p>
        ) : null}
        {branches.map((branch) => {
          const pushEligible =
            canPush &&
            branch.branchName !== defaultBranch &&
            branch.localSha !== null &&
            (branch.relation === "ahead" || branch.relation === "missing_remote");
          return (
            <div
              key={branch.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border p-3 [content-visibility:auto]"
            >
              <div className="mr-auto min-w-0">
                <p className="truncate font-mono text-sm font-medium">{branch.branchName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {branch.remoteName} · local {branch.localSha?.slice(0, 8) ?? "missing"} · remote{" "}
                  {branch.remoteSha?.slice(0, 8) ?? "missing"}
                </p>
              </div>
              {branch.aheadCount !== null ? (
                <Badge variant="outline">↑ {branch.aheadCount}</Badge>
              ) : null}
              {branch.behindCount !== null ? (
                <Badge variant="outline">↓ {branch.behindCount}</Badge>
              ) : null}
              <Badge variant={relationVariant(branch.relation)}>
                {branch.relation.replaceAll("_", " ")}
              </Badge>
              {pushEligible ? (
                <Button size="sm" onClick={() => setPushBranch(branch)}>
                  <UploadCloudIcon /> Push safely
                </Button>
              ) : null}
              {branch.relation === "diverged" ? (
                <p className="basis-full text-xs text-destructive">
                  <AlertTriangleIcon className="mr-1 inline size-3" />
                  Remote branch diverged. Lyn Code will not force-push; choose a recovery strategy
                  outside this action.
                </p>
              ) : null}
            </div>
          );
        })}
      </CardPanel>
      <PushConfirmationDialog
        branch={pushBranch}
        missions={missions}
        onOpenChange={(open) => {
          if (!open) setPushBranch(null);
        }}
        onPush={async (missionId, branch) => {
          await onPush({ missionId, branch });
          setPushBranch(null);
        }}
      />
    </Card>
  );
}

function PushConfirmationDialog({
  branch,
  missions,
  onOpenChange,
  onPush,
}: {
  readonly branch: GitHubBranchObservation | null;
  readonly missions: ReadonlyArray<GitHubMissionOption>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPush: (missionId: MissionId, branch: GitHubBranchObservation) => Promise<void>;
}) {
  return (
    <Dialog open={branch !== null} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Confirm remote branch push</DialogTitle>
          <DialogDescription>
            This uses the recorded local head and selected repository remote. It never force-pushes
            or rewrites history.
          </DialogDescription>
        </DialogHeader>
        {branch ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const missionId = String(
                new FormData(event.currentTarget).get("missionId"),
              ) as MissionId;
              void onPush(missionId, branch);
            }}
          >
            <DialogPanel className="space-y-3 text-sm">
              <div className="grid grid-cols-[8rem_1fr] gap-2">
                <span className="text-muted-foreground">Branch</span>
                <span className="font-mono">{branch.branchName}</span>
                <span className="text-muted-foreground">Remote</span>
                <span>{branch.remoteName}</span>
                <span className="text-muted-foreground">Expected head</span>
                <span className="break-all font-mono">{branch.localSha}</span>
                <span className="text-muted-foreground">Remote state</span>
                <span>{branch.relation.replaceAll("_", " ")}</span>
              </div>
              <label className="grid gap-1">
                Owning mission
                <select
                  name="missionId"
                  required
                  className="h-9 rounded-lg border bg-background px-3"
                >
                  {missions.map((mission) => (
                    <option key={mission.id} value={mission.id}>
                      {mission.title}
                    </option>
                  ))}
                </select>
              </label>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={missions.length === 0}>
                Confirm push
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

export function GitHubSynchronizationPanel({
  snapshot,
  busy,
  onRefresh,
  onReconnect,
  onDisconnectAccount,
  onDisconnectRepository,
}: {
  readonly snapshot: GitHubRepositoryWorkspaceSnapshot;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onReconnect: () => void;
  readonly onDisconnectAccount: () => void;
  readonly onDisconnectRepository: () => void;
}) {
  const account = snapshot.account;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Synchronization resources</CardTitle>
        </CardHeader>
        <CardPanel className="space-y-2">
          {snapshot.cursors.map((cursor) => (
            <div key={cursor.id} className="rounded-xl border p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="mr-auto font-medium">
                  {cursor.resourceType.replaceAll("_", " ")}
                </span>
                <Badge
                  variant={
                    cursor.errorSummary
                      ? "error"
                      : cursor.lastSuccessfulSyncAt
                        ? "success"
                        : "outline"
                  }
                >
                  {cursor.errorSummary
                    ? "failed"
                    : cursor.lastSuccessfulSyncAt
                      ? "synchronized"
                      : "not synced"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Last success: {cursor.lastSuccessfulSyncAt ?? "never"} · Last attempt:{" "}
                {cursor.lastAttemptAt ?? "never"}
              </p>
              {cursor.errorSummary ? (
                <p className="mt-2 text-xs text-destructive">{cursor.errorSummary}</p>
              ) : null}
            </div>
          ))}
          {snapshot.cursors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resource cursors have been recorded.</p>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={onRefresh}>
            <RefreshCwIcon /> Retry synchronization
          </Button>
        </CardPanel>
      </Card>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Rate limits</CardTitle>
          </CardHeader>
          <CardPanel className="space-y-2">
            {snapshot.rateLimits.map((limit) => (
              <div
                key={limit.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm"
              >
                <span className="mr-auto font-medium">{limit.kind}</span>
                <Badge
                  variant={
                    limit.remaining === 0 || limit.kind === "secondary" ? "warning" : "outline"
                  }
                >
                  {limit.remaining ?? "?"} / {limit.limit ?? "?"} remaining
                </Badge>
                <p className="basis-full text-xs text-muted-foreground">
                  Reset: {limit.resetAt ?? "unknown"}
                  {limit.retryAfterSeconds !== null
                    ? ` · retry after ${limit.retryAfterSeconds}s`
                    : ""}
                  {limit.blockedOperation ? ` · blocked ${limit.blockedOperation}` : ""}
                </p>
              </div>
            ))}
            {snapshot.rateLimits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rate-limit observation is cached.</p>
            ) : null}
          </CardPanel>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account and repository connection</CardTitle>
          </CardHeader>
          <CardPanel className="space-y-3 text-sm">
            <div>
              <p className="font-medium">{account ? `@${account.login}` : "Account unavailable"}</p>
              <p className="text-xs text-muted-foreground">
                {account?.status.replaceAll("_", " ") ?? "disconnected"} · scopes:{" "}
                {account?.scopes.join(", ") || "none reported"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {account?.status !== "connected" ? (
                <Button disabled={busy} onClick={onReconnect}>
                  <PlugZapIcon /> Reconnect
                </Button>
              ) : null}
              {account ? (
                <Button variant="outline" disabled={busy} onClick={onDisconnectAccount}>
                  <LogOutIcon /> Disconnect account
                </Button>
              ) : null}
              <Button variant="outline" disabled={busy} onClick={onDisconnectRepository}>
                <UnplugIcon /> Disconnect repository
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Disconnecting does not delete local missions, tasks, verification history, branches,
              or worktrees.
            </p>
          </CardPanel>
        </Card>
      </div>
    </div>
  );
}
