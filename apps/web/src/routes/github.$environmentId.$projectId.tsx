import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { createFileRoute } from "@tanstack/react-router";
import {
  EnvironmentId,
  ProjectId,
  type GitHubIssueRecord,
  type GitHubIssuePageSnapshot,
  type GitHubPullRequestPageSnapshot,
  type GitHubRepositoryWorkspaceSnapshot,
  type GitHubSyncResourceType,
  type MissionId,
  type PullRequestRecord,
  type ReviewCommentRecord,
  type ReviewThreadRecord,
} from "@t3tools/contracts";
import { CircleAlertIcon, GithubIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import * as Cause from "effect/Cause";

import {
  GitHubConnectionSetup,
  GitHubOverview,
  GitHubWorkspaceShell,
  type GitHubWorkspaceTab,
} from "../components/github/GitHubWorkspace";
import { GitHubIssuesPanel } from "../components/github/GitHubIssuesPanel";
import {
  GitHubPullRequestsPanel,
  type CreatePullRequestDraft,
} from "../components/github/GitHubPullRequestsPanel";
import {
  GitHubBranchesPanel,
  GitHubSynchronizationPanel,
} from "../components/github/GitHubRepositoryPanels";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { useProjects } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { githubEnvironment } from "../state/github";
import { useMissionBoardState } from "../state/missions";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand as useWebAtomCommand } from "../state/use-atom-command";
import { verificationEnvironment } from "../state/verification";

const GitHubPullRequestDetail = lazy(() => import("../components/github/GitHubPullRequestDetail"));

function errorDescription(failure: { readonly cause: Cause.Cause<unknown> }): string {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The GitHub operation failed.";
}

function GitHubProjectWorkspaceRoute() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);
  const project =
    useProjects().find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
    ) ?? null;
  const environment = useEnvironment(environmentId);
  const missionState = useMissionBoardState({ environmentId, projectId });
  const missionSnapshot =
    missionState.snapshot._tag === "Some" ? missionState.snapshot.value : null;
  const missionOptions = (missionSnapshot?.missions ?? []).map((summary) => ({
    id: summary.mission.id,
    title: summary.mission.title,
    status: summary.mission.status,
  }));

  const accountsQuery = useEnvironmentQuery(
    githubEnvironment.accountsAtom({ environmentId, input: { includeDisconnected: true } }),
  );
  const workspaceQuery = useEnvironmentQuery(
    githubEnvironment.workspaceAtom({ environmentId, input: { projectId } }),
  );
  const [workspaceOverride, setWorkspaceOverride] =
    useState<GitHubRepositoryWorkspaceSnapshot | null>(null);
  const workspace = workspaceOverride ?? workspaceQuery.data;
  const [activeTab, setActiveTab] = useState<GitHubWorkspaceTab>("overview");
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [issuesFilter, setIssuesFilter] = useState<{
    readonly search: string;
    readonly state: "open" | "closed" | null;
    readonly labels: ReadonlyArray<string>;
    readonly assignee: string | null;
    readonly milestone: number | null;
  }>({ search: "", state: "open", labels: [], assignee: null, milestone: null });
  const [pullRequestsFilter, setPullRequestsFilter] = useState<{
    readonly search: string;
    readonly state: "open" | "closed" | "merged" | null;
  }>({ search: "", state: "open" });
  const [issuesCursor, setIssuesCursor] = useState<string | null>(null);
  const [pullRequestsCursor, setPullRequestsCursor] = useState<string | null>(null);
  const [issuesPage, setIssuesPage] = useState<GitHubIssuePageSnapshot | null>(null);
  const [pullRequestsPage, setPullRequestsPage] = useState<GitHubPullRequestPageSnapshot | null>(
    null,
  );
  const [selectedPullRequest, setSelectedPullRequest] = useState<PullRequestRecord | null>(null);

  useEffect(() => {
    if (!workspaceQuery.data || !workspaceOverride) return;
    if (workspaceQuery.data.capturedAt >= workspaceOverride.capturedAt) setWorkspaceOverride(null);
  }, [workspaceOverride, workspaceQuery.data]);

  const issuesQuery = useEnvironmentQuery(
    workspace && activeTab === "issues"
      ? githubEnvironment.issuesAtom({
          environmentId,
          input: {
            repositoryConnectionId: workspace.connection.id,
            state: issuesFilter.state,
            search: issuesFilter.search || null,
            labels: [...issuesFilter.labels],
            assignee: issuesFilter.assignee,
            milestone: issuesFilter.milestone,
            cursor: issuesCursor,
            limit: 50,
            refresh: false,
          },
        })
      : null,
  );
  const pullRequestsQuery = useEnvironmentQuery(
    workspace && (activeTab === "pull-requests" || activeTab === "checks")
      ? githubEnvironment.pullRequestsAtom({
          environmentId,
          input: {
            repositoryConnectionId: workspace.connection.id,
            state: pullRequestsFilter.state,
            search: pullRequestsFilter.search || null,
            cursor: pullRequestsCursor,
            limit: 50,
            refresh: false,
          },
        })
      : null,
  );
  const pullRequestDetailQuery = useEnvironmentQuery(
    workspace && selectedPullRequest && (activeTab === "pull-requests" || activeTab === "checks")
      ? githubEnvironment.pullRequestDetailAtom({
          environmentId,
          input: {
            repositoryConnectionId: workspace.connection.id,
            number: selectedPullRequest.number,
            refresh: false,
          },
        })
      : null,
  );
  const verificationQuery = useEnvironmentQuery(
    activeTab === "pull-requests" || activeTab === "checks"
      ? verificationEnvironment.runHistoryAtom({
          environmentId,
          input: { projectId, taskId: null, cursor: null, limit: 100 },
        })
      : null,
  );

  useEffect(() => {
    const page = issuesQuery.data;
    if (!page) return;
    setIssuesPage((current) =>
      issuesCursor === null || current === null
        ? page
        : {
            ...page,
            records: [
              ...current.records,
              ...page.records.filter(
                (record) => !current.records.some((existing) => existing.id === record.id),
              ),
            ],
          },
    );
  }, [issuesCursor, issuesQuery.data]);

  useEffect(() => {
    const page = pullRequestsQuery.data;
    if (!page) return;
    setPullRequestsPage((current) =>
      pullRequestsCursor === null || current === null
        ? page
        : {
            ...page,
            records: [
              ...current.records,
              ...page.records.filter(
                (record) => !current.records.some((existing) => existing.id === record.id),
              ),
            ],
          },
    );
  }, [pullRequestsCursor, pullRequestsQuery.data]);

  useEffect(() => {
    if ((activeTab !== "checks" && activeTab !== "pull-requests") || selectedPullRequest) return;
    const first = pullRequestsPage?.records[0];
    if (first) setSelectedPullRequest(first);
  }, [activeTab, pullRequestsPage, selectedPullRequest]);

  const connectAccount = useWebAtomCommand(githubEnvironment.connectAccount, {
    reportFailure: false,
  });
  const disconnectAccount = useWebAtomCommand(githubEnvironment.disconnectAccount, {
    reportFailure: false,
  });
  const connectRepository = useWebAtomCommand(githubEnvironment.connectRepository, {
    reportFailure: false,
  });
  const disconnectRepository = useWebAtomCommand(githubEnvironment.disconnectRepository, {
    reportFailure: false,
  });
  const refresh = useWebAtomCommand(githubEnvironment.refresh, { reportFailure: false });
  const createMission = useWebAtomCommand(githubEnvironment.createMissionFromIssue, {
    reportFailure: false,
  });
  const linkMission = useWebAtomCommand(githubEnvironment.linkIssueMission, {
    reportFailure: false,
  });
  const createReviewTask = useWebAtomCommand(githubEnvironment.createReviewTask, {
    reportFailure: false,
  });
  const pushBranch = useWebAtomCommand(githubEnvironment.pushBranch, { reportFailure: false });
  const createPullRequest = useWebAtomCommand(githubEnvironment.createPullRequest, {
    reportFailure: false,
  });
  const updatePullRequest = useWebAtomCommand(githubEnvironment.updatePullRequest, {
    reportFailure: false,
  });
  const markReady = useWebAtomCommand(githubEnvironment.markReadyForReview, {
    reportFailure: false,
  });
  const resolveThread = useWebAtomCommand(githubEnvironment.resolveReviewThread, {
    reportFailure: false,
  });

  const run = async <A, E>(
    key: string,
    failureTitle: string,
    operation: () => Promise<AtomCommandResult<A, E>>,
    successTitle?: string,
  ): Promise<A | null> => {
    setBusyKeys((current) => new Set([...current, key]));
    try {
      const result = await operation();
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: errorDescription(result),
        });
        return null;
      }
      if (successTitle) toastManager.add({ type: "success", title: successTitle });
      return result.value;
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleRefresh = async (resources: ReadonlyArray<GitHubSyncResourceType>) => {
    if (!workspace) return;
    const next = await run("refresh", "GitHub refresh failed", () =>
      refresh({
        environmentId,
        input: { repositoryConnectionId: workspace.connection.id, resources: [...resources] },
      }),
    );
    if (next) {
      setWorkspaceOverride(next);
      workspaceQuery.refresh();
      issuesQuery.refresh();
      pullRequestsQuery.refresh();
    }
  };

  const handleConnectAccount = async (serverUrl: string) => {
    const result = await run(
      "connect-account",
      "Could not connect GitHub",
      () => connectAccount({ environmentId, input: { serverUrl } }),
      "GitHub account connected",
    );
    if (result) accountsQuery.refresh();
  };

  const handleConnectRepository = async (input: {
    readonly accountId: Parameters<typeof connectRepository>[0]["input"]["githubAccountId"];
    readonly repositoryUrl: string | null;
    readonly remoteName: string;
  }) => {
    const result = await run(
      "connect-repository",
      "Could not connect repository",
      () =>
        connectRepository({
          environmentId,
          input: {
            projectId,
            githubAccountId: input.accountId,
            repositoryUrl: input.repositoryUrl,
            owner: null,
            repository: null,
            remoteName: input.remoteName,
          },
        }),
      "Repository connected",
    );
    if (result) workspaceQuery.refresh();
  };

  const handleCreateMission = async (issue: GitHubIssueRecord) => {
    if (!workspace) return;
    const result = await run("issue-mission", "Could not create mission", () =>
      createMission({
        environmentId,
        input: {
          repositoryConnectionId: workspace.connection.id,
          issueNumber: issue.number,
          linkType: "implements",
          selectedCommentIds: [],
        },
      }),
    );
    if (result)
      toastManager.add({
        type: "success",
        title: result.duplicatePrevented
          ? "Existing linked mission preserved"
          : "Mission created from issue",
      });
  };

  const handleLinkMission = async (issue: GitHubIssueRecord, missionId: MissionId) => {
    if (!workspace) return;
    const result = await run(
      "issue-link",
      "Could not link mission",
      () =>
        linkMission({
          environmentId,
          input: {
            repositoryConnectionId: workspace.connection.id,
            issueNumber: issue.number,
            missionId,
            linkType: "related",
          },
        }),
      "Mission linked",
    );
    if (result) workspaceQuery.refresh();
  };

  const handlePushBranch = async ({
    missionId,
    branch,
  }: {
    readonly missionId: MissionId;
    readonly branch: GitHubRepositoryWorkspaceSnapshot["branches"][number];
  }) => {
    if (!workspace || !branch.localSha) return;
    const expectedHeadSha = branch.localSha;
    const result = await run(
      "push",
      "Branch push rejected",
      () =>
        pushBranch({
          environmentId,
          input: {
            missionId,
            taskId: null,
            repositoryConnectionId: workspace.connection.id,
            branchName: branch.branchName,
            expectedHeadSha,
            confirmation: true,
          },
        }),
      "Branch pushed and confirmed by GitHub",
    );
    if (result) void handleRefresh(["branches"]);
  };

  const handleCreatePullRequest = async (draft: CreatePullRequestDraft) => {
    if (!workspace) return;
    const result = await run(
      "create-pr",
      "Could not create pull request",
      () =>
        createPullRequest({
          environmentId,
          input: {
            repositoryConnectionId: workspace.connection.id,
            missionId: draft.missionId,
            taskId: null,
            headBranch: draft.headBranch,
            baseBranch: draft.baseBranch,
            title: draft.title,
            draft: true,
            linkedIssueNumber: draft.linkedIssueNumber,
            closeLinkedIssue: draft.closeLinkedIssue,
            bodyOverride: null,
            expectedHeadSha: draft.expectedHeadSha,
            confirmation: true,
          },
        }),
      "Draft pull request created",
    );
    if (result) {
      setSelectedPullRequest(result.pullRequest);
      pullRequestsQuery.refresh();
    }
  };

  const detail = pullRequestDetailQuery.data;
  const handleCreateReviewTask = async (comment: ReviewCommentRecord, missionId: MissionId) => {
    const result = await run(
      "review-task",
      "Could not create review task",
      () =>
        createReviewTask({
          environmentId,
          input: {
            reviewCommentRecordId: comment.id,
            missionId,
            assignedMissionAgentId: null,
            title: null,
          },
        }),
      "Review fix task created",
    );
    if (result) pullRequestDetailQuery.refresh();
  };
  const handleResolveThread = async (thread: ReviewThreadRecord) => {
    const result = await run(
      "resolve-thread",
      "Could not resolve review thread",
      () =>
        resolveThread({
          environmentId,
          input: { reviewThreadRecordId: thread.id, confirmation: true },
        }),
      "Review thread resolved",
    );
    if (result) pullRequestDetailQuery.refresh();
  };

  if (!project) {
    return (
      <SidebarInset className="h-dvh min-h-0">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GithubIcon />
            </EmptyMedia>
            <EmptyTitle>Project not found</EmptyTitle>
            <EmptyDescription>
              This GitHub workspace must be opened with a project from the selected environment.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  if (workspaceQuery.error && workspace === null && environment?.connection.phase === "connected") {
    return (
      <SidebarInset className="h-dvh min-h-0 p-6">
        <Alert variant="error">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t load the GitHub workspace</AlertTitle>
          <AlertDescription>{workspaceQuery.error}</AlertDescription>
        </Alert>
      </SidebarInset>
    );
  }

  if (workspace === null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-auto bg-background p-4 sm:p-8">
        <GitHubConnectionSetup
          projectTitle={project.title}
          accounts={accountsQuery.data ?? []}
          busy={busyKeys.size > 0}
          error={accountsQuery.error ?? workspaceQuery.error}
          onConnectAccount={handleConnectAccount}
          onConnectRepository={handleConnectRepository}
        />
      </SidebarInset>
    );
  }

  const canWrite =
    workspace.account?.status === "connected" && workspace.connection.permissions.canPush;
  const canCreateLocalLinks =
    environment?.connection.phase === "connected" &&
    missionState.status === "live" &&
    workspace.connection.permissions.canRead;
  const renderDetail = (focus: "all" | "checks") =>
    detail ? (
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading pull request workspace…</p>}
      >
        <GitHubPullRequestDetail
          detail={detail}
          localVerificationRuns={verificationQuery.data?.runs ?? []}
          canWrite={canWrite}
          loading={pullRequestDetailQuery.isPending}
          focus={focus}
          onRefresh={pullRequestDetailQuery.refresh}
          onUpdate={async (title, body) => {
            const result = await run(
              "update-pr",
              "Could not update pull request",
              () =>
                updatePullRequest({
                  environmentId,
                  input: {
                    repositoryConnectionId: workspace.connection.id,
                    number: detail.pullRequest.number,
                    title,
                    ...(body === undefined ? {} : { body }),
                  },
                }),
              "Pull request updated",
            );
            if (result) pullRequestDetailQuery.refresh();
          }}
          onMarkReady={async () => {
            const result = await run(
              "ready",
              "Could not mark pull request ready",
              () =>
                markReady({
                  environmentId,
                  input: {
                    repositoryConnectionId: workspace.connection.id,
                    number: detail.pullRequest.number,
                    confirmation: true,
                  },
                }),
              "Pull request marked ready for review",
            );
            if (result) pullRequestDetailQuery.refresh();
          }}
          onCreateReviewTask={handleCreateReviewTask}
          onResolveThread={handleResolveThread}
        />
      </Suspense>
    ) : (
      <p className="text-sm text-muted-foreground">
        Select a pull request to load commits, files, reviews, threads, and checks.
      </p>
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <GitHubWorkspaceShell
        projectTitle={project.title}
        snapshot={workspace}
        activeTab={activeTab}
        refreshing={busyKeys.has("refresh")}
        onTabChange={setActiveTab}
        onRefresh={(resources) => void handleRefresh(resources)}
      >
        {activeTab === "overview" ? <GitHubOverview snapshot={workspace} /> : null}
        {activeTab === "issues" ? (
          <GitHubIssuesPanel
            page={issuesPage}
            links={workspace.issueLinks}
            missions={missionOptions}
            canCreateMission={canCreateLocalLinks}
            loading={issuesQuery.isPending}
            error={issuesQuery.error}
            onQueryChange={(filter) => {
              setIssuesCursor(null);
              setIssuesPage(null);
              setIssuesFilter(filter);
            }}
            onLoadMore={() => setIssuesCursor(issuesPage?.pageInfo.endCursor ?? null)}
            onCreateMission={handleCreateMission}
            onLinkMission={handleLinkMission}
          />
        ) : null}
        {activeTab === "pull-requests" ? (
          <div className="grid gap-4">
            <GitHubPullRequestsPanel
              page={pullRequestsPage}
              branches={workspace.branches}
              missions={missionOptions}
              defaultBranch={workspace.connection.defaultBranch}
              repositoryLabel={`${workspace.connection.owner}/${workspace.connection.repository}`}
              verificationRuns={verificationQuery.data?.runs ?? []}
              canWrite={canWrite}
              loading={pullRequestsQuery.isPending}
              error={pullRequestsQuery.error}
              selectedNumber={selectedPullRequest?.number ?? null}
              onQueryChange={(filter) => {
                setPullRequestsCursor(null);
                setPullRequestsPage(null);
                setPullRequestsFilter(filter);
              }}
              onLoadMore={() => setPullRequestsCursor(pullRequestsPage?.pageInfo.endCursor ?? null)}
              onSelect={setSelectedPullRequest}
              onCreateDraft={handleCreatePullRequest}
            />
            {renderDetail("all")}
          </div>
        ) : null}
        {activeTab === "branches" ? (
          <GitHubBranchesPanel
            branches={workspace.branches}
            missions={missionOptions}
            defaultBranch={workspace.connection.defaultBranch}
            canPush={canWrite}
            onPush={handlePushBranch}
          />
        ) : null}
        {activeTab === "checks" ? renderDetail("checks") : null}
        {activeTab === "synchronization" ? (
          <GitHubSynchronizationPanel
            snapshot={workspace}
            busy={busyKeys.size > 0}
            onRefresh={() =>
              void handleRefresh([
                "repository",
                "issues",
                "pull_requests",
                "reviews",
                "review_threads",
                "checks",
                "branches",
              ])
            }
            onReconnect={() =>
              void handleConnectAccount(
                workspace.account?.serverUrl ?? workspace.connection.serverUrl,
              )
            }
            onDisconnectAccount={() => {
              if (!workspace.account) return;
              void run(
                "disconnect-account",
                "Could not disconnect account",
                () =>
                  disconnectAccount({
                    environmentId,
                    input: { githubAccountId: workspace.account!.id },
                  }),
                "GitHub account disconnected",
              ).then(() => {
                accountsQuery.refresh();
                workspaceQuery.refresh();
              });
            }}
            onDisconnectRepository={() =>
              void run(
                "disconnect-repository",
                "Could not disconnect repository",
                () =>
                  disconnectRepository({
                    environmentId,
                    input: { repositoryConnectionId: workspace.connection.id },
                  }),
                "Repository disconnected",
              ).then((result) => {
                if (result !== null) {
                  setWorkspaceOverride(null);
                  workspaceQuery.refresh();
                }
              })
            }
          />
        ) : null}
      </GitHubWorkspaceShell>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/github/$environmentId/$projectId")({
  component: GitHubProjectWorkspaceRoute,
});
