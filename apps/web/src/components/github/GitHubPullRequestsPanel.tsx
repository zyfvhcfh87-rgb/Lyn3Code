import type {
  GitHubBranchObservation,
  GitHubPullRequestPageSnapshot,
  MissionId,
  PullRequestRecord,
  VerificationRunSummary,
} from "@t3tools/contracts";
import { ExternalLinkIcon, GitPullRequestArrowIcon, PlusIcon, SearchIcon } from "lucide-react";
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
import { Input } from "../ui/input";

export interface CreatePullRequestDraft {
  readonly missionId: MissionId;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly title: string;
  readonly expectedHeadSha: string;
  readonly linkedIssueNumber: number | null;
  readonly closeLinkedIssue: boolean;
}

export function GitHubPullRequestsPanel({
  page,
  branches,
  missions,
  defaultBranch,
  repositoryLabel,
  verificationRuns,
  canWrite,
  loading,
  error,
  selectedNumber,
  onQueryChange,
  onSelect,
  onCreateDraft,
  onLoadMore,
}: {
  readonly page: GitHubPullRequestPageSnapshot | null;
  readonly branches: ReadonlyArray<GitHubBranchObservation>;
  readonly missions: ReadonlyArray<GitHubMissionOption>;
  readonly defaultBranch: string;
  readonly repositoryLabel: string;
  readonly verificationRuns: ReadonlyArray<VerificationRunSummary>;
  readonly canWrite: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedNumber: number | null;
  readonly onQueryChange: (query: {
    readonly search: string;
    readonly state: "open" | "closed" | "merged" | null;
  }) => void;
  readonly onLoadMore: () => void;
  readonly onSelect: (pullRequest: PullRequestRecord) => void;
  readonly onCreateDraft: (draft: CreatePullRequestDraft) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"open" | "closed" | "merged" | "all">("open");
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card className="min-h-0">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <CardTitle className="mr-auto">Pull requests</CardTitle>
          {canWrite ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> Create draft PR
            </Button>
          ) : null}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onQueryChange({ search, state: state === "all" ? null : state });
          }}
        >
          <label className="relative min-w-52 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search synced pull requests"
              aria-label="Search pull requests"
            />
          </label>
          <select
            aria-label="Pull request state"
            className="h-9 rounded-lg border bg-background px-3 text-sm"
            value={state}
            onChange={(event) => {
              const next = event.target.value as typeof state;
              setState(next);
              onQueryChange({ search, state: next === "all" ? null : next });
            }}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="merged">Merged</option>
            <option value="all">All</option>
          </select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </CardHeader>
      <CardPanel className="p-0">
        {error ? <p className="px-6 pb-4 text-sm text-destructive">{error}</p> : null}
        {loading && page === null ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">Loading pull requests…</p>
        ) : null}
        <div className="divide-y">
          {(page?.records ?? []).map((pullRequest) => (
            <button
              key={pullRequest.id}
              type="button"
              aria-pressed={selectedNumber === pullRequest.number}
              className="block w-full p-4 text-left [content-visibility:auto] hover:bg-muted/48 aria-pressed:bg-muted/64"
              onClick={() => onSelect(pullRequest)}
            >
              <div className="flex gap-3">
                <GitPullRequestArrowIcon className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{pullRequest.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{pullRequest.number} by @{pullRequest.author.login} · {pullRequest.headRef} →{" "}
                    {pullRequest.baseRef}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge
                      variant={
                        pullRequest.state === "open"
                          ? "success"
                          : pullRequest.state === "merged"
                            ? "info"
                            : "secondary"
                      }
                    >
                      {pullRequest.state}
                    </Badge>
                    {pullRequest.isDraft ? <Badge variant="secondary">draft</Badge> : null}
                    <Badge
                      variant={
                        pullRequest.reviewDecision === "changes_requested"
                          ? "error"
                          : pullRequest.reviewDecision === "approved"
                            ? "success"
                            : "outline"
                      }
                    >
                      {pullRequest.reviewDecision.replaceAll("_", " ")}
                    </Badge>
                    <Badge
                      variant={pullRequest.mergeableState === "conflicting" ? "error" : "outline"}
                    >
                      {pullRequest.mergeableState}
                    </Badge>
                  </div>
                </div>
                <a
                  href={pullRequest.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open pull request ${pullRequest.number} on GitHub`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLinkIcon className="size-4" />
                </a>
              </div>
            </button>
          ))}
        </div>
        {page && page.records.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No pull requests match these filters.</p>
        ) : null}
        {page?.pageInfo.hasNextPage ? (
          <div className="border-t p-3 text-center">
            <Button variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
              Load more pull requests
            </Button>
          </div>
        ) : null}
      </CardPanel>
      <CreatePullRequestDialog
        open={createOpen}
        branches={branches}
        missions={missions}
        defaultBranch={defaultBranch}
        repositoryLabel={repositoryLabel}
        verificationRuns={verificationRuns}
        onOpenChange={setCreateOpen}
        onCreate={async (draft) => {
          await onCreateDraft(draft);
          setCreateOpen(false);
        }}
      />
    </Card>
  );
}

function CreatePullRequestDialog({
  open,
  branches,
  missions,
  defaultBranch,
  repositoryLabel,
  verificationRuns,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly branches: ReadonlyArray<GitHubBranchObservation>;
  readonly missions: ReadonlyArray<GitHubMissionOption>;
  readonly defaultBranch: string;
  readonly repositoryLabel: string;
  readonly verificationRuns: ReadonlyArray<VerificationRunSummary>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (draft: CreatePullRequestDraft) => Promise<void>;
}) {
  const candidateBranches = branches.filter(
    (branch) => branch.localSha !== null && branch.branchName !== defaultBranch,
  );
  const confirmedBranches = candidateBranches.filter(
    (branch) =>
      branch.relation === "equal" &&
      branch.localSha !== null &&
      branch.remoteSha === branch.localSha,
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [selectedMissionId, setSelectedMissionId] = useState<string>("");
  const selectedBranch =
    confirmedBranches.find((branch) => branch.id === selectedBranchId) ??
    confirmedBranches[0] ??
    null;
  const selectedMission =
    missions.find((mission) => mission.id === selectedMissionId) ?? missions[0] ?? null;
  const latestVerification = verificationRuns
    .filter((run) => run.missionId === selectedMission?.id)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const verificationIsCurrent =
    latestVerification !== undefined &&
    latestVerification.invalidatedAt === null &&
    latestVerification.commitHash === selectedBranch?.localSha &&
    (latestVerification.status === "passed" ||
      latestVerification.status === "passed_with_warnings");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create draft pull request</DialogTitle>
          <DialogDescription>
            Confirm the exact mission branch, base, head commit, and issue intent. No merge action
            is performed.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const selectedBranch = confirmedBranches.find(
              (branch) => branch.id === data.get("branchId"),
            );
            if (!selectedBranch?.localSha) return;
            void onCreate({
              missionId: String(data.get("missionId")) as MissionId,
              headBranch: selectedBranch.branchName,
              baseBranch: String(data.get("baseBranch")),
              title: String(data.get("title")),
              expectedHeadSha: selectedBranch.localSha,
              linkedIssueNumber: data.get("issueNumber") ? Number(data.get("issueNumber")) : null,
              closeLinkedIssue: data.get("closeLinkedIssue") === "on",
            });
          }}
        >
          <DialogPanel className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Mission
              <select
                name="missionId"
                required
                className="h-9 rounded-lg border bg-background px-3"
                value={selectedMission?.id ?? ""}
                onChange={(event) => setSelectedMissionId(event.target.value)}
              >
                {missions.map((mission) => (
                  <option key={mission.id} value={mission.id}>
                    {mission.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Head branch
              <select
                name="branchId"
                required
                className="h-9 rounded-lg border bg-background px-3"
                value={selectedBranch?.id ?? ""}
                onChange={(event) => setSelectedBranchId(event.target.value)}
              >
                {confirmedBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.branchName} · {branch.relation.replaceAll("_", " ")} ·{" "}
                    {branch.localSha?.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Base branch
              <Input name="baseBranch" defaultValue={defaultBranch} required />
            </label>
            <label className="grid gap-1 text-sm">
              Title
              <Input name="title" required />
            </label>
            <label className="grid gap-1 text-sm">
              Linked issue number (optional)
              <Input name="issueNumber" type="number" min={1} />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input className="mt-1" name="closeLinkedIssue" type="checkbox" />
              <span>
                Use closing language for the linked issue. Leave this off for related work.
              </span>
            </label>
            <div className="grid grid-cols-[8rem_1fr] gap-2 rounded-xl border p-3 text-xs">
              <span className="text-muted-foreground">Repository</span>
              <span>{repositoryLabel}</span>
              <span className="text-muted-foreground">Head</span>
              <span className="break-all font-mono">
                {selectedBranch
                  ? `${selectedBranch.branchName} @ ${selectedBranch.localSha}`
                  : "No confirmed remote branch"}
              </span>
              <span className="text-muted-foreground">Base</span>
              <span>{defaultBranch}</span>
              <span className="text-muted-foreground">Pull request</span>
              <span>Draft; no merge action</span>
              <span className="text-muted-foreground">Commits</span>
              <span>Head commit shown above; non-empty branch validated server-side</span>
              <span className="text-muted-foreground">Verification</span>
              <span className={verificationIsCurrent ? "text-success" : "text-warning-foreground"}>
                {verificationIsCurrent
                  ? `${latestVerification.status} for this head`
                  : "Missing, failed, or stale for this head; every mission task is revalidated before creation"}
              </span>
              <span className="text-muted-foreground">Worktree</span>
              <span>Cleanliness and exact head are rechecked immediately before creation</span>
            </div>
            {candidateBranches.length > confirmedBranches.length ? (
              <p className="text-sm text-warning-foreground">
                {candidateBranches.length - confirmedBranches.length} local branch
                {candidateBranches.length - confirmedBranches.length === 1
                  ? " requires"
                  : "es require"}{" "}
                a confirmed safe push before PR creation.
              </p>
            ) : null}
            {confirmedBranches.length === 0 ? (
              <p className="text-sm text-warning-foreground">
                No non-default branch has matching local and remote heads. Push safely, then refresh
                branch state first.
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={missions.length === 0 || confirmedBranches.length === 0}
            >
              Create draft PR
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
