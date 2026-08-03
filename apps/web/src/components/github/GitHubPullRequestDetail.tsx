import type {
  GitHubPullRequestDetailSnapshot,
  MissionId,
  ReviewCommentRecord,
  ReviewThreadRecord,
  VerificationRunSummary,
} from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  GitCommitHorizontalIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
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
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { checkDisplayState, canResolveReviewThread, mergeReadinessItems } from "./workspaceModel";

function CheckBadge({ status }: { readonly status: string }) {
  const failure = ["failure", "timed out", "action required", "cancelled"].includes(status);
  const success = status === "success";
  return (
    <Badge
      variant={failure ? "error" : success ? "success" : status === "stale" ? "warning" : "outline"}
    >
      {status}
    </Badge>
  );
}

function LocalVerification({
  runs,
  missionIds,
  headSha,
}: {
  readonly runs: ReadonlyArray<VerificationRunSummary>;
  readonly missionIds: ReadonlySet<MissionId>;
  readonly headSha: string;
}) {
  const relevant = runs.filter((run) => run.missionId !== null && missionIds.has(run.missionId));
  const latest =
    relevant.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const current = latest?.commitHash === headSha && latest.invalidatedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" /> Local harness verification
        </CardTitle>
      </CardHeader>
      <CardPanel>
        {latest ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{latest.profileName}</span>
              <Badge
                variant={
                  current && latest.result === "passed"
                    ? "success"
                    : current
                      ? "warning"
                      : "outline"
                }
              >
                {current ? (latest.result ?? latest.status) : "stale for PR head"}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              fingerprint {latest.sourceFingerprint}
            </p>
            <p className="text-muted-foreground">
              Commit {latest.commitHash?.slice(0, 12) ?? "uncommitted source"}
              {latest.failureSummary ? ` · ${latest.failureSummary}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No local verification record is linked to this PR’s mission.
          </p>
        )}
      </CardPanel>
    </Card>
  );
}

function RemoteChecks({ detail }: { readonly detail: GitHubPullRequestDetailSnapshot }) {
  const headSha = detail.pullRequest.headSha;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecksIcon className="size-4" /> GitHub Actions and remote checks
        </CardTitle>
      </CardHeader>
      <CardPanel className="space-y-2">
        {detail.checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No remote checks were synchronized for this pull request.
          </p>
        ) : null}
        {detail.checks.map((check) => {
          const belongsToHead = check.headSha === headSha;
          const state = belongsToHead ? checkDisplayState(check) : "stale";
          const duration =
            check.startedAtRemote && check.completedAtRemote
              ? Math.max(
                  0,
                  new Date(check.completedAtRemote).getTime() -
                    new Date(check.startedAtRemote).getTime(),
                )
              : null;
          return (
            <div
              key={check.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border p-3 [content-visibility:auto]"
            >
              {state === "success" ? (
                <CheckCircle2Icon className="size-4 text-success-foreground" />
              ) : state === "queued" || state === "in progress" ? (
                <CircleDashedIcon className="size-4" />
              ) : (
                <CircleAlertIcon className="size-4 text-warning-foreground" />
              )}
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-medium">{check.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {check.provider} · {check.headSha.slice(0, 8)}
                  {duration === null ? "" : ` · ${(duration / 1000).toFixed(1)}s`}
                </p>
              </div>
              {check.isRequired ? <Badge variant="outline">required</Badge> : null}
              <CheckBadge status={state} />
              {check.detailsUrl ? (
                <a
                  href={check.detailsUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${check.name} details`}
                >
                  <ExternalLinkIcon className="size-4" />
                </a>
              ) : null}
              {check.summary ? (
                <p className="basis-full text-xs text-muted-foreground">{check.summary}</p>
              ) : null}
            </div>
          );
        })}
      </CardPanel>
    </Card>
  );
}

function ReviewThread({
  detail,
  thread,
  canWrite,
  missionId,
  onCreateTask,
  onResolve,
}: {
  readonly detail: GitHubPullRequestDetailSnapshot;
  readonly thread: ReviewThreadRecord;
  readonly canWrite: boolean;
  readonly missionId: MissionId | null;
  readonly onCreateTask: (comment: ReviewCommentRecord, missionId: MissionId) => Promise<void>;
  readonly onResolve: (thread: ReviewThreadRecord) => Promise<void>;
}) {
  const comments = detail.comments.filter((comment) => comment.reviewThreadId === thread.id);
  const taskLinks = detail.taskLinks.filter((link) =>
    comments.some((comment) => comment.id === link.reviewCommentRecordId),
  );
  const resolvable = canWrite && canResolveReviewThread(detail, thread);
  return (
    <div className={cn("rounded-xl border p-3", thread.isOutdated && "opacity-64")}>
      <div className="flex flex-wrap items-center gap-2">
        <FileCode2Icon className="size-4" />
        <span className="mr-auto break-all font-mono text-xs">
          {thread.path}
          {thread.line ? `:${thread.line}` : ""}
        </span>
        {thread.isResolved ? (
          <Badge variant="success">resolved</Badge>
        ) : thread.isOutdated ? (
          <Badge variant="secondary">outdated</Badge>
        ) : (
          <Badge variant="warning">unresolved</Badge>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {comments.map((comment) => {
          const taskLink = taskLinks.find((link) => link.reviewCommentRecordId === comment.id);
          return (
            <div key={comment.id} className="rounded-lg bg-muted/48 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium">@{comment.author.login}</span>
                {taskLink ? <Badge variant="info">task {taskLink.status}</Badge> : null}
                <a
                  className="ml-auto"
                  href={comment.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open review comment on GitHub"
                >
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{comment.body}</p>
              {!taskLink && missionId ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => void onCreateTask(comment, missionId)}
                >
                  <MessageSquareTextIcon /> Create fix task
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {resolvable ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void onResolve(thread)}>
          <CheckCircle2Icon /> Resolve with verified evidence
        </Button>
      ) : null}
      {!thread.isResolved && !thread.isOutdated && taskLinks.length > 0 && !resolvable ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The thread remains open until linked work is verified and resolution is explicitly
          confirmed.
        </p>
      ) : null}
    </div>
  );
}

export default function GitHubPullRequestDetail({
  detail,
  localVerificationRuns,
  canWrite,
  loading,
  focus = "all",
  onRefresh,
  onUpdate,
  onMarkReady,
  onCreateReviewTask,
  onResolveThread,
}: {
  readonly detail: GitHubPullRequestDetailSnapshot;
  readonly localVerificationRuns: ReadonlyArray<VerificationRunSummary>;
  readonly canWrite: boolean;
  readonly loading: boolean;
  readonly focus?: "all" | "checks";
  readonly onRefresh: () => void;
  readonly onUpdate: (title: string, body: string | undefined) => Promise<void>;
  readonly onMarkReady: () => Promise<void>;
  readonly onCreateReviewTask: (
    comment: ReviewCommentRecord,
    missionId: MissionId,
  ) => Promise<void>;
  readonly onResolveThread: (thread: ReviewThreadRecord) => Promise<void>;
}) {
  const [filePath, setFilePath] = useState<string | null>(detail.changedFiles[0]?.path ?? null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const selectedFile = detail.changedFiles.find((file) => file.path === filePath) ?? null;
  const missionIds = new Set(detail.missionLinks.map((link) => link.missionId));
  const primaryMissionId =
    detail.missionLinks.find((link) => link.relationship === "primary")?.missionId ??
    detail.missionLinks[0]?.missionId ??
    null;

  if (focus === "checks") {
    return (
      <div className="grid gap-4">
        <LocalVerification
          runs={localVerificationRuns}
          missionIds={missionIds}
          headSha={detail.pullRequest.headSha}
        />
        <RemoteChecks detail={detail} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-2">
            <div className="mr-auto">
              <CardTitle>
                #{detail.pullRequest.number} {detail.pullRequest.title}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {detail.pullRequest.headRef} ({detail.pullRequest.headSha.slice(0, 8)}) →{" "}
                {detail.pullRequest.baseRef}
              </p>
            </div>
            <Button variant="outline" disabled={loading} onClick={onRefresh}>
              <RefreshCwIcon /> {loading ? "Refreshing…" : "Refresh detail"}
            </Button>
            {canWrite ? (
              <Button variant="outline" onClick={() => setUpdateOpen(true)}>
                Edit title or description
              </Button>
            ) : null}
            {canWrite && detail.pullRequest.isDraft ? (
              <Button onClick={() => void onMarkReady()}>Mark ready for review</Button>
            ) : null}
            <Button
              variant="outline"
              render={<a href={detail.pullRequest.htmlUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon /> GitHub
            </Button>
          </div>
        </CardHeader>
        <CardPanel className="flex flex-wrap gap-2">
          {mergeReadinessItems(detail).map((item) => (
            <Badge
              key={item.text}
              variant={
                item.tone === "error" ? "error" : item.tone === "warning" ? "warning" : "info"
              }
            >
              {item.text}
            </Badge>
          ))}
        </CardPanel>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <LocalVerification
          runs={localVerificationRuns}
          missionIds={missionIds}
          headSha={detail.pullRequest.headSha}
        />
        <RemoteChecks detail={detail} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2Icon className="size-4" /> Changed files ({detail.changedFiles.length})
          </CardTitle>
        </CardHeader>
        <CardPanel className="grid min-h-80 gap-3 p-0 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="max-h-[32rem] overflow-auto border-r p-2">
            {detail.changedFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-muted",
                  file.path === selectedFile?.path && "bg-muted",
                )}
                onClick={() => setFilePath(file.path)}
              >
                <span className="mr-2 text-success-foreground">+{file.additions}</span>
                <span className="mr-2 text-destructive">-{file.deletions}</span>
                {file.path}
              </button>
            ))}
          </div>
          <div className="min-w-0 overflow-auto p-3">
            {selectedFile ? (
              <>
                <p className="mb-2 font-mono text-xs font-medium">{selectedFile.path}</p>
                {selectedFile.patch ? (
                  <pre className="overflow-auto whitespace-pre text-xs leading-5">
                    {selectedFile.patch}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The synchronized record has no bounded patch. Open the file on GitHub for the
                    full diff.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No changed file selected.</p>
            )}
          </div>
        </CardPanel>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCommitHorizontalIcon className="size-4" /> Commits ({detail.commits.length})
            </CardTitle>
          </CardHeader>
          <CardPanel className="space-y-2">
            {detail.commits.map((commit) => (
              <div key={commit.sha} className="rounded-xl border p-3 [content-visibility:auto]">
                <p className="text-sm font-medium">{commit.message.split("\n")[0]}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {commit.sha.slice(0, 12)}
                  {commit.author ? ` · @${commit.author.login}` : ""}
                </p>
              </div>
            ))}
          </CardPanel>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reviews ({detail.reviews.length})</CardTitle>
          </CardHeader>
          <CardPanel className="space-y-2">
            {detail.reviews.map((review) => (
              <div key={review.id} className="flex items-center gap-2 rounded-xl border p-3">
                <span className="mr-auto text-sm font-medium">@{review.author.login}</span>
                <Badge
                  variant={
                    review.state === "approved"
                      ? "success"
                      : review.state === "changes_requested"
                        ? "error"
                        : "outline"
                  }
                >
                  {review.state.replaceAll("_", " ")}
                </Badge>
              </div>
            ))}
          </CardPanel>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Review threads ({detail.threads.length})</CardTitle>
        </CardHeader>
        <CardPanel className="space-y-3">
          {detail.threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inline review threads.</p>
          ) : (
            detail.threads.map((thread) => (
              <ReviewThread
                key={thread.id}
                detail={detail}
                thread={thread}
                canWrite={canWrite}
                missionId={primaryMissionId}
                onCreateTask={onCreateReviewTask}
                onResolve={onResolveThread}
              />
            ))
          )}
        </CardPanel>
      </Card>
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Update pull request</DialogTitle>
            <DialogDescription>
              The cached body is a bounded preview. Leave the description empty to preserve the full
              remote body.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const body = String(data.get("body") ?? "").trim();
              void onUpdate(String(data.get("title") ?? ""), body || undefined).then(() =>
                setUpdateOpen(false),
              );
            }}
          >
            <DialogPanel className="grid gap-3">
              <label className="grid gap-1 text-sm">
                Title
                <Input name="title" defaultValue={detail.pullRequest.title} required />
              </label>
              <label className="grid gap-1 text-sm">
                New description (optional)
                <Textarea
                  name="body"
                  placeholder="Leave empty to keep the current GitHub description"
                />
              </label>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUpdateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Update pull request</Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
