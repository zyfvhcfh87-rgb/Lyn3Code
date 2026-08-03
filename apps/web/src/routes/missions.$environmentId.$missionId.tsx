import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EnvironmentId, MissionId, type MissionTaskId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { ArrowLeftIcon, CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { MissionWorkspace } from "../components/missions/MissionWorkspace";
import type { CreateMissionTaskInput } from "../components/missions/CreateTaskDialog";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { isMissionEnvironmentUnavailable } from "../lib/missionConnection";
import { newAgentRunId, newMissionTaskId } from "../lib/missionIds";
import { newThreadId } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { useProjects, useServerConfigs } from "../state/entities";
import { useEnvironment, useEnvironments } from "../state/environments";
import { missionEnvironment, useMissionDetailState } from "../state/missions";
import { useAtomCommand } from "../state/use-atom-command";
import { DEFAULT_RUNTIME_MODE } from "../types";

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
  const startMission = useAtomCommand(missionEnvironment.start, { reportFailure: false });
  const retryMission = useAtomCommand(missionEnvironment.retry, { reportFailure: false });
  const cancelMission = useAtomCommand(missionEnvironment.cancel, { reportFailure: false });
  const [actionPending, setActionPending] = useState(false);
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
  const connected = environment?.connection.phase === "connected";
  const environmentUnavailable = isMissionEnvironmentUnavailable(
    environmentCatalogReady,
    environment?.connection.phase,
  );
  const live = detailState.status === "live";
  const missionTerminal =
    snapshot?.mission.status === "completed" || snapshot?.mission.status === "cancelled";
  const canMutate = connected && live && !missionTerminal;

  const handleAddTask = async (input: CreateMissionTaskInput) => {
    if (!snapshot) return;
    const position = snapshot.tasks.reduce(
      (maximum, task) => Math.max(maximum, task.position + 1),
      0,
    );
    const result = await createTask({
      environmentId,
      input: {
        missionId,
        taskId: newMissionTaskId(),
        title: input.title,
        description: input.description,
        position,
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Failure") {
      const description = failureDescription(result);
      toastManager.add({ type: "error", title: "Failed to add task", description });
      throw new Error(description);
    }
    toastManager.add({ type: "success", title: "Task added" });
  };

  const handleRun = async (kind: "start" | "retry", taskId?: MissionTaskId) => {
    if (!modelSelection) {
      toastManager.add({
        type: "error",
        title: "No provider is ready",
        description: "Configure an available provider before starting this mission.",
      });
      return;
    }
    setActionPending(true);
    try {
      const command = kind === "start" ? startMission : retryMission;
      const result = await command({
        environmentId,
        input: {
          missionId,
          ...(taskId === undefined ? {} : { taskId }),
          agentRunId: newAgentRunId(),
          threadId: newThreadId(),
          providerInstanceId: modelSelection.instanceId,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          createdAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: kind === "start" ? "Failed to start mission" : "Failed to retry mission",
          description: failureDescription(result),
        });
        return;
      }
      toastManager.add({
        type: "success",
        title: kind === "start" ? "Mission started" : "Mission retry started",
      });
    } finally {
      setActionPending(false);
    }
  };

  const handleCancel = async () => {
    setActionPending(true);
    try {
      const result = await cancelMission({
        environmentId,
        input: { missionId, createdAt: new Date().toISOString() },
      });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: "Failed to cancel mission",
          description: failureDescription(result),
        });
        return;
      }
      toastManager.add({ type: "success", title: "Cancellation requested" });
    } finally {
      setActionPending(false);
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
              <ArrowLeftIcon />
              Back to missions
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
              <ArrowLeftIcon />
              Back to missions
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
        events={snapshot.events}
        canMutate={canMutate}
        providerReady={modelSelection !== null}
        actionPending={actionPending}
        onAddTask={handleAddTask}
        onStart={(taskId) => handleRun("start", taskId)}
        onRetry={(taskId) => handleRun("retry", taskId)}
        onCancel={handleCancel}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/missions/$environmentId/$missionId")({
  component: MissionDetailRoute,
});
