import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { MissionBoard } from "../components/missions/MissionBoard";
import type { CreateMissionInput } from "../components/missions/CreateMissionDialog";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { isMissionEnvironmentUnavailable } from "../lib/missionConnection";
import { newMissionId } from "../lib/missionIds";
import { useProjects } from "../state/entities";
import { useEnvironment, useEnvironments } from "../state/environments";
import { missionEnvironment, useMissionBoardState } from "../state/missions";
import { useAtomCommand } from "../state/use-atom-command";

function synchronizationMessage(
  status: ReturnType<typeof useMissionBoardState>["status"],
  connectionPhase: string | undefined,
): string | null {
  if (connectionPhase === "reconnecting") {
    return "Reconnecting. Showing the last mission snapshot; changes are temporarily disabled.";
  }
  if (connectionPhase !== "connected") {
    return "This environment is disconnected. Showing cached mission data when available.";
  }
  if (status === "cached") return "Showing cached mission data while the live connection resumes.";
  if (status === "synchronizing") return "Refreshing mission data from the server...";
  return null;
}

function failureMessage(failure: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The mission command failed.";
}

function MissionBoardRoute() {
  const { environmentId: environmentIdParam } = Route.useParams();
  const environmentId = EnvironmentId.make(environmentIdParam);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const { isReady: environmentCatalogReady } = useEnvironments();
  const environment = useEnvironment(environmentId);
  const boardState = useMissionBoardState({ environmentId });
  const createMission = useAtomCommand(missionEnvironment.create, { reportFailure: false });
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const selectedProjectId =
    requestedProjectId !== null && projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : null;
  const snapshot = Option.getOrNull(boardState.snapshot);
  const streamError = Option.getOrNull(boardState.error);
  const connectionPhase = environment?.connection.phase;
  const environmentUnavailable = isMissionEnvironmentUnavailable(
    environmentCatalogReady,
    connectionPhase,
  );
  const canMutate = connectionPhase === "connected" && boardState.status === "live";
  const syncMessage = synchronizationMessage(boardState.status, connectionPhase);

  const handleCreateMission = async (input: CreateMissionInput) => {
    const result = await createMission({
      environmentId,
      input: {
        missionId: newMissionId(),
        projectId: ProjectId.make(input.projectId),
        title: input.title,
        description: input.description,
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Failure") {
      const description = failureMessage(result);
      toastManager.add({ type: "error", title: "Failed to create mission", description });
      return false;
    }
    toastManager.add({ type: "success", title: "Mission created" });
    return true;
  };

  if (snapshot === null && streamError !== null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="grid flex-1 place-items-center p-6">
          <Alert variant="error" className="max-w-lg">
            <CircleAlertIcon />
            <AlertTitle>Couldn’t load missions</AlertTitle>
            <AlertDescription>{streamError}</AlertDescription>
          </Alert>
        </div>
      </SidebarInset>
    );
  }

  if (snapshot === null && environmentUnavailable) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="grid flex-1 place-items-center p-6">
          <Alert variant="warning" className="max-w-lg">
            <CircleAlertIcon />
            <AlertTitle>Missions are unavailable while disconnected</AlertTitle>
            <AlertDescription>
              Reconnect this environment to load its persisted mission board.
            </AlertDescription>
          </Alert>
        </div>
      </SidebarInset>
    );
  }

  if (snapshot === null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status">
          Loading missions...
        </div>
      </SidebarInset>
    );
  }

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
        <div
          className="border-b border-destructive/24 bg-destructive/8 px-4 py-2 text-sm text-destructive-foreground"
          role="alert"
        >
          Live mission updates failed: {streamError}
        </div>
      ) : null}
      <MissionBoard
        projects={projects.map((project) => ({ id: project.id, title: project.title }))}
        missions={snapshot.missions.map((summary) => ({
          environmentId,
          missionId: summary.mission.id,
          projectId: summary.mission.projectId,
          title: summary.mission.title,
          status: summary.mission.status,
          completedTaskCount: summary.taskProgress.completed,
          taskCount: summary.taskProgress.total,
          activeRunStatus: summary.activeAgentRun?.status ?? null,
          updatedAt: summary.mission.updatedAt,
          alertSummary:
            summary.latestAgentRun?.errorSummary ??
            (summary.mission.status === "blocked"
              ? "This mission needs attention before it can continue."
              : summary.mission.status === "failed"
                ? "The latest mission run failed."
                : null),
        }))}
        selectedProjectId={selectedProjectId}
        canMutate={canMutate}
        onSelectedProjectChange={setRequestedProjectId}
        onOpenAddProject={() => openCommandPalette({ open: "add-project" })}
        onCreateMission={handleCreateMission}
      />
    </SidebarInset>
  );
}

function MissionEnvironmentRoute() {
  const { environmentId } = Route.useParams();
  const pathname = useLocation({ select: (location) => location.pathname });

  return pathname === `/missions/${environmentId}` ? <MissionBoardRoute /> : <Outlet />;
}

export const Route = createFileRoute("/missions/$environmentId")({
  component: MissionEnvironmentRoute,
});
