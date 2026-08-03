import type {
  GitHubIssuePageSnapshot,
  GitHubIssueRecord,
  IssueMissionLink,
  MissionId,
} from "@t3tools/contracts";
import { ExternalLinkIcon, LinkIcon, ListFilterIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardHeader, CardPanel, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

export interface GitHubMissionOption {
  readonly id: MissionId;
  readonly title: string;
  readonly status: string;
}

export function GitHubIssuesPanel({
  page,
  links,
  missions,
  canCreateMission,
  loading,
  error,
  onQueryChange,
  onCreateMission,
  onLinkMission,
  onLoadMore,
}: {
  readonly page: GitHubIssuePageSnapshot | null;
  readonly links: ReadonlyArray<IssueMissionLink>;
  readonly missions: ReadonlyArray<GitHubMissionOption>;
  readonly canCreateMission: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onQueryChange: (query: {
    readonly search: string;
    readonly state: "open" | "closed" | null;
    readonly labels: ReadonlyArray<string>;
    readonly assignee: string | null;
    readonly milestone: number | null;
  }) => void;
  readonly onLoadMore: () => void;
  readonly onCreateMission: (issue: GitHubIssueRecord) => Promise<void>;
  readonly onLinkMission: (issue: GitHubIssueRecord, missionId: MissionId) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [labels, setLabels] = useState("");
  const [assignee, setAssignee] = useState("");
  const [milestone, setMilestone] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssueRecord | null>(null);
  const [missionId, setMissionId] = useState<string>("");
  const deferredSearch = useDeferredValue(search);

  const commitFilters = (nextSearch = deferredSearch, nextState = state) =>
    onQueryChange({
      search: nextSearch,
      state: nextState === "all" ? null : nextState,
      labels: labels
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      assignee: assignee.trim() || null,
      milestone: milestone ? Number(milestone) : null,
    });

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <Card className="min-h-0">
        <CardHeader className="gap-3">
          <CardTitle>Issues</CardTitle>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              commitFilters(search, state);
            }}
          >
            <label className="relative min-w-52 flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search synced issues"
                aria-label="Search issues"
              />
            </label>
            <select
              aria-label="Issue state"
              className="h-9 rounded-lg border bg-background px-3 text-sm"
              value={state}
              onChange={(event) => {
                const next = event.target.value as typeof state;
                setState(next);
                commitFilters(search, next);
              }}
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
            <Input
              className="w-40"
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
              placeholder="labels, comma separated"
              aria-label="Issue labels"
            />
            <Input
              className="w-36"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="assignee"
              aria-label="Issue assignee"
            />
            <Input
              className="w-28"
              type="number"
              min={1}
              value={milestone}
              onChange={(event) => setMilestone(event.target.value)}
              placeholder="milestone"
              aria-label="Milestone number"
            />
            <Button type="submit" variant="outline">
              <ListFilterIcon /> Apply
            </Button>
          </form>
        </CardHeader>
        <CardPanel className="p-0">
          {error ? <p className="px-6 pb-4 text-sm text-destructive">{error}</p> : null}
          {loading && page === null ? (
            <p className="px-6 pb-4 text-sm text-muted-foreground">Loading issues…</p>
          ) : null}
          <div className="divide-y">
            {(page?.records ?? []).map((issue) => {
              const issueLinks = links.filter((link) => link.githubIssueNumber === issue.number);
              return (
                <button
                  key={issue.id}
                  type="button"
                  className="block w-full p-4 text-left [content-visibility:auto] hover:bg-muted/48"
                  onClick={() => setSelectedIssue(issue)}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 font-mono text-xs text-muted-foreground">
                      #{issue.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{issue.title}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant={issue.state === "open" ? "success" : "secondary"}>
                          {issue.state}
                        </Badge>
                        {issue.labels.slice(0, 4).map((label) => (
                          <Badge key={label.name} variant="outline">
                            {label.name}
                          </Badge>
                        ))}
                        {issueLinks.length > 0 ? (
                          <Badge variant="info">
                            <LinkIcon /> {issueLinks.length} mission link
                            {issueLinks.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {page && page.records.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No issues match these filters.</p>
          ) : null}
          {page?.pageInfo.hasNextPage ? (
            <div className="border-t p-3 text-center">
              <Button variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
                Load more issues
              </Button>
            </div>
          ) : null}
        </CardPanel>
      </Card>
      <Card className="h-fit lg:sticky lg:top-0">
        <CardHeader>
          <CardTitle>{selectedIssue ? `Issue #${selectedIssue.number}` : "Issue detail"}</CardTitle>
        </CardHeader>
        <CardPanel className="space-y-4">
          {selectedIssue ? (
            <>
              <div>
                <h2 className="font-medium">{selectedIssue.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Opened by @{selectedIssue.author.login} · {selectedIssue.commentCount} comments
                </p>
              </div>
              <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {selectedIssue.bodyPreview || "No issue description was cached."}
              </p>
              <div className="space-y-2">
                {links
                  .filter((link) => link.githubIssueNumber === selectedIssue.number)
                  .map((link) => {
                    const mission = missions.find((candidate) => candidate.id === link.missionId);
                    return (
                      <div key={link.id} className="rounded-lg border p-2 text-sm">
                        <span className="font-medium">{mission?.title ?? link.missionId}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {link.linkType.replaceAll("_", " ")}
                        </span>
                      </div>
                    );
                  })}
              </div>
              {canCreateMission ? (
                <Button className="w-full" onClick={() => void onCreateMission(selectedIssue)}>
                  <PlusIcon /> Create mission from issue
                </Button>
              ) : null}
              {canCreateMission && missions.length > 0 ? (
                <div className="flex gap-2">
                  <select
                    aria-label="Mission to link"
                    className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
                    value={missionId}
                    onChange={(event) => setMissionId(event.target.value)}
                  >
                    <option value="">Select existing mission…</option>
                    {missions.map((mission) => (
                      <option key={mission.id} value={mission.id}>
                        {mission.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    disabled={!missionId}
                    onClick={() => void onLinkMission(selectedIssue, missionId as MissionId)}
                  >
                    <LinkIcon /> Link
                  </Button>
                </div>
              ) : null}
              <Button
                variant="outline"
                className="w-full"
                render={<a href={selectedIssue.htmlUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon /> Open on GitHub
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an issue to inspect its cached context and mission links.
            </p>
          )}
        </CardPanel>
      </Card>
    </div>
  );
}
