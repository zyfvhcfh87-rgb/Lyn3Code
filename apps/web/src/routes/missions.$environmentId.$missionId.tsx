import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  EnvironmentId,
  hasWritePermission,
  MissionId,
  type AgentPermission,
  type AgentRoleKind,
  type ManagedWorktree,
  type ManagedWorktreeId,
  type MissionAgentId,
  type MissionTaskId,
  type MissionTeamSettings,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { ArrowLeftIcon, CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import type { CreateMissionTaskInput } from "../components/missions/CreateTaskDialog";
import type {
  CreateMissionAgentDraft,
  UpdateMissionAgentDraft,
} from "../components/missions/MissionTeamPanel";
import { MissionWorkspace } from "../components/missions/MissionWorkspace";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { isMissionEnvironmentUnavailable } from "../lib/missionConnection";
import {
  newAgentRunId,
  newMissionAgentId,
  newMissionTaskId,
  newTaskDependencyId,
} from "../lib/missionIds";
import { newThreadId } from "../lib/utils";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  resolveDefaultProviderModelSelection,
} from "../providerInstances";
import { useProjects, useServerConfigs } from "../state/entities";
import { useEnvironment, useEnvironments } from "../state/environments";
import { missionEnvironment, useMissionDetailState } from "../state/missions";
import { useAtomCommand } from "../state/use-atom-command";
import { DEFAULT_RUNTIME_MODE } from "../types";

const FALLBACK_PERMISSIONS = {
  coordinator: ["read_files", "search_repository", "run_safe_commands", "manage_tasks"],
  implementer: [
    "read_files",
    "search_repository",
    "run_safe_commands",
    "run_tests",
    "write_files",
    "create_commits",
  ],
  researcher: ["read_files", "search_repository", "run_safe_commands"],
  reviewer: ["read_files", "search_repository", "run_safe_commands", "run_tests"],
  verifier: ["read_files", "search_repository", "run_safe_commands", "run_tests"],
  custom: ["read_files"],
} satisfies Readonly<Record<AgentRoleKind, ReadonlyArray<AgentPermission>>>;

function failureDescription(failure: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The mission command failed.";
}

function MissionDetailRoute() {
  const { environmentId: environmentIdParam, missionId: missionIdParam } = Route.useParams();
  const environmentId = EnvironmentId.make(environmentIdParam);
  const missionId = MissionId.make(missionIdParam);
  const { isReady: environmentCatalogReady } = useEnvironments();
  const environment = useEnvironment(environmentId);
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const detailState = useMissionDetailState({ environmentId, missionId });

  const createTask = useAtomCommand(missionEnvironment.createTask, { reportFailure: false });
  const updateTask = useAtomCommand(missionEnvironment.updateTask, { reportFailure: false });
  const startMission = useAtomCommand(missionEnvironment.start, { reportFailure: false });
  const cancelMission = useAtomCommand(missionEnvironment.cancel, { reportFailure: false });
  const configureTeam = useAtomCommand(missionEnvironment.configureTeam, { reportFailure: false });
  const upsertAgent = useAtomCommand(missionEnvironment.upsertAgent, { reportFailure: false });
  const removeAgent = useAtomCommand(missionEnvironment.removeAgent, { reportFailure: false });
  const updateAgentPermissions = useAtomCommand(missionEnvironment.updateAgentPermissions, {
    reportFailure: false,
  });
  const addTaskDependency = useAtomCommand(missionEnvironment.addTaskDependency, {
    reportFailure: false,
  });
  const removeTaskDependency = useAtomCommand(missionEnvironment.removeTaskDependency, {
    reportFailure: false,
  });
  const retryTask = useAtomCommand(missionEnvironment.retryTask, { reportFailure: false });
  const cancelTask = useAtomCommand(missionEnvironment.cancelTask, { reportFailure: false });
  const startScheduler = useAtomCommand(missionEnvironment.startScheduler, {
    reportFailure: false,
  });
  const pauseScheduler = useAtomCommand(missionEnvironment.pauseScheduler, {
    reportFailure: false,
  });
  const resumeScheduler = useAtomCommand(missionEnvironment.resumeScheduler, {
    reportFailure: false,
  });
  const requestIntegration = useAtomCommand(missionEnvironment.requestIntegration, {
    reportFailure: false,
  });
  const approveIntegration = useAtomCommand(missionEnvironment.approveIntegration, {
    reportFailure: false,
  });
  const abortIntegration = useAtomCommand(missionEnvironment.abortIntegration, {
    reportFailure: false,
  });
  const removeWorktree = useAtomCommand(missionEnvironment.removeWorktree, {
    reportFailure: false,
  });

  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const snapshot = Option.getOrNull(detailState.snapshot);
  const streamError = Option.getOrNull(detailState.error);
  const project = snapshot
    ? (projects.find(
        (candidate) =>
          candidate.environmentId === environmentId && candidate.id === snapshot.mission.projectId,
      ) ?? null)
    : null;
  const serverConfig = serverConfigs.get(environmentId);
  const modelSelection = resolveDefaultProviderModelSelection(
    serverConfig?.providers ?? [],
    project?.defaultModelSelection,
  );
  const providerEntries = deriveProviderInstanceEntries(serverConfig?.providers ?? []);
  const providerChoices = providerEntries
    .filter(isProviderInstancePickerReady)
    .map((provider) => ({ id: provider.instanceId, label: provider.displayName }));
  const openInPreferredEditor = useOpenInPreferredEditor(
    environmentId,
    serverConfig?.availableEditors ?? [],
  );
  const connected = environment?.connection.phase === "connected";
  const environmentUnavailable = isMissionEnvironmentUnavailable(
    environmentCatalogReady,
    environment?.connection.phase,
  );
  const live = detailState.status === "live";
  const missionTerminal =
    snapshot?.mission.status === "completed" || snapshot?.mission.status === "cancelled";
  const canMutate = connected && live && !missionTerminal;

  const runAction = async (
    key: string,
    failureTitle: string,
    action: () => Promise<{ readonly _tag: string }>,
    successTitle?: string,
  ): Promise<boolean> => {
    setPendingKeys((current) => new Set([...current, key]));
    try {
      const result = await action();
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: failureDescription(
            result as unknown as Parameters<typeof squashAtomCommandFailure>[0],
          ),
        });
        return false;
      }
      if (successTitle) toastManager.add({ type: "success", title: successTitle });
      return true;
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleAddTask = async (input: CreateMissionTaskInput) => {
    if (!snapshot) return false;
    const position = snapshot.tasks.reduce(
      (maximum, task) => Math.max(maximum, task.position + 1),
      0,
    );
    return await runAction(
      "task:add",
      "Failed to add task",
      () =>
        createTask({
          environmentId,
          input: {
            missionId,
            taskId: newMissionTaskId(),
            title: input.title,
            description: input.description,
            position,
            createdAt: new Date().toISOString(),
          },
        }),
      "Task added",
    );
  };

  const startRun = async (taskId?: MissionTaskId) => {
    if (!snapshot) return;
    const task = taskId ? snapshot.tasks.find((candidate) => candidate.id === taskId) : null;
    const agent = task?.assignedMissionAgentId
      ? snapshot.missionAgents.find((candidate) => candidate.id === task.assignedMissionAgentId)
      : null;
    const instanceId = agent?.providerInstanceId ?? modelSelection?.instanceId;
    const model =
      agent?.model ??
      (instanceId
        ? getDefaultProviderInstanceModel(serverConfig?.providers ?? [], instanceId)
        : null);
    if (!instanceId || !model) {
      toastManager.add({
        type: "error",
        title: "No provider is ready",
        description: "Choose an available provider and model before starting this task.",
      });
      return;
    }
    await runAction(
      taskId ? `task:${taskId}` : "mission:start",
      taskId ? "Failed to start task" : "Failed to start mission",
      () =>
        startMission({
          environmentId,
          input: {
            missionId,
            ...(taskId ? { taskId } : {}),
            agentRunId: newAgentRunId(),
            threadId: newThreadId(),
            providerInstanceId: instanceId,
            modelSelection: { instanceId, model },
            runtimeMode: DEFAULT_RUNTIME_MODE,
            ...(agent ? { missionAgentId: agent.id, permissions: agent.permissions } : {}),
            ...(task?.worktreeId ? { worktreeId: task.worktreeId } : {}),
            ...(task ? { attemptNumber: task.attemptCount + 1 } : {}),
            ...(agent ? { writeCapable: hasWritePermission(agent.permissions) } : {}),
            createdAt: new Date().toISOString(),
          },
        }),
      taskId ? "Task started" : "Mission started",
    );
  };

  const handleCancelMission = async () => {
    await runAction(
      "mission:cancel",
      "Failed to cancel mission",
      () =>
        cancelMission({
          environmentId,
          input: { missionId, createdAt: new Date().toISOString() },
        }),
      "Cancellation requested",
    );
  };

  const handleConfigureTeam = async (settings: MissionTeamSettings) => {
    await runAction(
      "team-settings",
      "Failed to update team settings",
      () =>
        configureTeam({
          environmentId,
          input: { missionId, settings, updatedAt: new Date().toISOString() },
        }),
      "Team settings updated",
    );
  };

  const handleAddAgent = async (draft: CreateMissionAgentDraft) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const role = snapshot.agentRoles.find((candidate) => candidate.kind === draft.roleKind);
    await runAction(
      "agent:add",
      "Failed to add agent",
      () =>
        upsertAgent({
          environmentId,
          input: {
            missionId,
            agent: {
              id: newMissionAgentId(),
              missionId,
              roleId: role?.id ?? null,
              roleKind: draft.roleKind,
              displayName: draft.displayName,
              providerInstanceId: draft.providerInstanceId,
              model: draft.model,
              reasoningLevel: null,
              permissions: role?.defaultPermissions ?? FALLBACK_PERMISSIONS[draft.roleKind],
              maximumConcurrentRuns: 1,
              status: "idle",
              createdAt: now,
              updatedAt: now,
            },
          },
        }),
      "Agent added",
    );
  };

  const handleRemoveAgent = async (missionAgentId: MissionAgentId) => {
    await runAction(
      `agent:${missionAgentId}`,
      "Failed to remove agent",
      () =>
        removeAgent({
          environmentId,
          input: { missionId, missionAgentId, removedAt: new Date().toISOString() },
        }),
      "Agent removed",
    );
  };

  const handleUpdateAgent = async (draft: UpdateMissionAgentDraft) => {
    const agent = snapshot?.missionAgents.find(
      (candidate) => candidate.id === draft.missionAgentId,
    );
    if (!agent || !snapshot) return;
    const role = snapshot.agentRoles.find((candidate) => candidate.kind === draft.roleKind);
    await runAction(
      `agent:${agent.id}`,
      "Failed to update agent",
      () =>
        upsertAgent({
          environmentId,
          input: {
            missionId,
            agent: {
              ...agent,
              roleId: role?.id ?? null,
              roleKind: draft.roleKind,
              displayName: draft.displayName,
              providerInstanceId: draft.providerInstanceId,
              model: draft.model,
              maximumConcurrentRuns: draft.maximumConcurrentRuns,
              status: draft.status,
              updatedAt: new Date().toISOString(),
            },
          },
        }),
      "Agent updated",
    );
  };

  const handleUpdatePermissions = async (
    missionAgentId: MissionAgentId,
    permissions: ReadonlyArray<AgentPermission>,
  ) => {
    await runAction(
      `permissions:${missionAgentId}`,
      "Failed to update permissions",
      () =>
        updateAgentPermissions({
          environmentId,
          input: {
            missionId,
            missionAgentId,
            permissions,
            updatedAt: new Date().toISOString(),
          },
        }),
      "Permissions updated",
    );
  };

  const handleSchedulerAction = async (action: "start" | "pause" | "resume") => {
    const command =
      action === "start" ? startScheduler : action === "pause" ? pauseScheduler : resumeScheduler;
    await runAction(
      "scheduler",
      `Failed to ${action} scheduler`,
      () =>
        command({
          environmentId,
          input: { missionId, requestedAt: new Date().toISOString() },
        }),
      `Scheduler ${action === "start" ? "started" : `${action}d`}`,
    );
  };

  const handleAddDependency = async (taskId: MissionTaskId, dependsOnTaskId: MissionTaskId) => {
    const key = `dependency:${taskId}:${dependsOnTaskId}`;
    await runAction(
      key,
      "Failed to add dependency",
      () =>
        addTaskDependency({
          environmentId,
          input: {
            missionId,
            dependency: {
              id: newTaskDependencyId(),
              missionId,
              taskId,
              dependsOnTaskId,
              createdAt: new Date().toISOString(),
            },
          },
        }),
      "Dependency added",
    );
  };

  const handleRemoveDependency = async (taskId: MissionTaskId, dependsOnTaskId: MissionTaskId) => {
    const dependency = snapshot?.taskDependencies.find(
      (candidate) => candidate.taskId === taskId && candidate.dependsOnTaskId === dependsOnTaskId,
    );
    if (!dependency) return;
    await runAction(
      `dependency:${taskId}:${dependsOnTaskId}`,
      "Failed to remove dependency",
      () =>
        removeTaskDependency({
          environmentId,
          input: {
            missionId,
            dependencyId: dependency.id,
            taskId,
            dependsOnTaskId,
            removedAt: new Date().toISOString(),
          },
        }),
      "Dependency removed",
    );
  };

  const handleAssignTask = async (
    taskId: MissionTaskId,
    assignedMissionAgentId: MissionAgentId | null,
  ) => {
    await runAction(
      `task:${taskId}`,
      "Failed to assign task",
      () =>
        updateTask({
          environmentId,
          input: {
            missionId,
            taskId,
            assignedMissionAgentId,
            updatedAt: new Date().toISOString(),
          },
        }),
      assignedMissionAgentId ? "Task assigned" : "Task unassigned",
    );
  };

  const handleUpdateTask = async (
    taskId: MissionTaskId,
    patch: {
      readonly title: string;
      readonly description: string;
      readonly maximumAttempts: number;
      readonly requiresDependencyHandoffs: boolean;
    },
  ) => {
    await runAction(
      `task:${taskId}`,
      "Failed to update task",
      () =>
        updateTask({
          environmentId,
          input: {
            missionId,
            taskId,
            ...patch,
            updatedAt: new Date().toISOString(),
          },
        }),
      "Task updated",
    );
  };

  const handleRetryTask = async (taskId: MissionTaskId) => {
    await runAction(
      `task:${taskId}`,
      "Failed to retry task",
      () =>
        retryTask({
          environmentId,
          input: {
            missionId,
            taskId,
            reason: "Retry requested by the user.",
            requestedAt: new Date().toISOString(),
          },
        }),
      "Task retry requested",
    );
  };

  const handleCancelTask = async (taskId: MissionTaskId) => {
    await runAction(
      `task:${taskId}`,
      "Failed to cancel task",
      () =>
        cancelTask({
          environmentId,
          input: { missionId, taskId, requestedAt: new Date().toISOString() },
        }),
      "Task cancellation requested",
    );
  };

  const handleRequestIntegration = async (worktreeId: ManagedWorktreeId) => {
    const worktree = snapshot?.managedWorktrees.find((candidate) => candidate.id === worktreeId);
    if (!worktree?.taskId) return;
    await runAction(
      `integrate:${worktreeId}`,
      "Failed to request integration",
      () =>
        requestIntegration({
          environmentId,
          input: {
            missionId,
            taskId: worktree.taskId!,
            worktreeId,
            requestedAt: new Date().toISOString(),
          },
        }),
      "Integration requested",
    );
  };

  const handleApproveIntegration = async (taskId: MissionTaskId) => {
    const task = snapshot?.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.worktreeId) return;
    await runAction(
      `approve:${taskId}`,
      "Failed to approve integration",
      () =>
        approveIntegration({
          environmentId,
          input: {
            missionId,
            taskId,
            worktreeId: task.worktreeId!,
            requestedAt: new Date().toISOString(),
          },
        }),
      "Integration approved",
    );
  };

  const handleRemoveWorktree = async (worktreeId: ManagedWorktreeId) => {
    await runAction(
      `worktree:${worktreeId}`,
      "Failed to remove worktree",
      () =>
        removeWorktree({
          environmentId,
          input: { missionId, worktreeId, requestedAt: new Date().toISOString() },
        }),
      "Worktree removal requested",
    );
  };

  const handleAbortIntegration = async (taskId: MissionTaskId) => {
    const task = snapshot?.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.worktreeId) return;
    await runAction(
      `abort:${taskId}`,
      "Failed to abort integration",
      () =>
        abortIntegration({
          environmentId,
          input: {
            missionId,
            taskId,
            worktreeId: task.worktreeId!,
            reason: "User requested conflict recovery.",
            requestedAt: new Date().toISOString(),
          },
        }),
      "Integration aborted; task branch preserved",
    );
  };

  const openWorktree = async (worktree: ManagedWorktree, purpose: "open" | "inspect") => {
    const result = await openInPreferredEditor(worktree.worktreePath);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: purpose === "open" ? "Failed to open worktree" : "Failed to inspect changes",
        description: failureDescription(result),
      });
      return;
    }
    if (purpose === "inspect") {
      toastManager.add({ type: "success", title: "Opened worktree for change inspection" });
    }
  };

  if (snapshot === null && streamError !== null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Couldn’t load this mission</EmptyTitle>
            <EmptyDescription>{streamError}</EmptyDescription>
            <Button
              variant="outline"
              render={<Link to="/missions/$environmentId" params={{ environmentId }} />}
            >
              <ArrowLeftIcon /> Back to missions
            </Button>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  if (snapshot === null && environmentUnavailable) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This mission is unavailable while disconnected</EmptyTitle>
            <EmptyDescription>
              Reconnect this environment to load the persisted mission and its activity history.
            </EmptyDescription>
            <Button
              variant="outline"
              render={<Link to="/missions/$environmentId" params={{ environmentId }} />}
            >
              <ArrowLeftIcon /> Back to missions
            </Button>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  if (snapshot === null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status">
          Loading mission workspace...
        </div>
      </SidebarInset>
    );
  }

  const syncMessage =
    environment?.connection.phase === "reconnecting"
      ? "Reconnecting. Showing the last mission snapshot; changes are temporarily disabled."
      : !connected
        ? "This environment is disconnected. Showing cached mission data when available."
        : detailState.status === "cached"
          ? "Showing cached mission data while the live connection resumes."
          : detailState.status === "synchronizing"
            ? "Refreshing mission history from the server..."
            : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {syncMessage ? (
        <div
          className="border-b border-warning/24 bg-warning/8 px-4 py-2 text-sm text-warning-foreground"
          role="status"
        >
          {syncMessage}
        </div>
      ) : null}
      {streamError ? (
        <Alert variant="error" className="m-3 mb-0">
          <CircleAlertIcon />
          <AlertTitle>Live updates paused</AlertTitle>
          <AlertDescription>{streamError}</AlertDescription>
        </Alert>
      ) : null}
      <MissionWorkspace
        environmentId={environmentId}
        projectTitle={project?.title ?? "Unknown project"}
        mission={snapshot.mission}
        tasks={snapshot.tasks}
        agentRuns={snapshot.agentRuns}
        agentRoles={snapshot.agentRoles}
        missionAgents={snapshot.missionAgents}
        taskDependencies={snapshot.taskDependencies}
        managedWorktrees={snapshot.managedWorktrees}
        agentHandoffs={snapshot.agentHandoffs}
        events={snapshot.events}
        providerChoices={providerChoices}
        canMutate={canMutate}
        providerReady={providerChoices.length > 0}
        isPending={(key) => pendingKeys.has(key)}
        onAddTask={handleAddTask}
        onStartMission={() => startRun()}
        onCancelMission={handleCancelMission}
        onConfigureTeam={handleConfigureTeam}
        onAddAgent={handleAddAgent}
        onUpdateAgent={handleUpdateAgent}
        onRemoveAgent={handleRemoveAgent}
        onUpdateAgentPermissions={handleUpdatePermissions}
        onSchedulerAction={handleSchedulerAction}
        onAddDependency={handleAddDependency}
        onRemoveDependency={handleRemoveDependency}
        onAssignTask={handleAssignTask}
        onUpdateTask={handleUpdateTask}
        onStartTask={startRun}
        onRetryTask={handleRetryTask}
        onCancelTask={handleCancelTask}
        onCancelRun={(_agentRunId, taskId) =>
          taskId ? handleCancelTask(taskId) : handleCancelMission()
        }
        onOpenWorktree={(worktree) => void openWorktree(worktree, "open")}
        onCopyWorktreePath={async (worktree) => {
          await writeTextToClipboard(worktree.worktreePath, "worktree path");
          toastManager.add({ type: "success", title: "Worktree path copied" });
        }}
        onInspectWorktreeChanges={(worktree) => void openWorktree(worktree, "inspect")}
        onRequestIntegration={handleRequestIntegration}
        onApproveIntegration={handleApproveIntegration}
        onAbortIntegration={handleAbortIntegration}
        onRemoveWorktree={handleRemoveWorktree}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/missions/$environmentId/$missionId")({
  component: MissionDetailRoute,
});
