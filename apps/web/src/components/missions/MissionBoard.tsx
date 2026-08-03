import { ArchiveIcon, FolderPlusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { MissionCard, type MissionCardProps } from "./MissionCard";
import {
  filterMissionsByProject,
  groupMissionsForBoard,
  MISSION_BOARD_STATUSES,
  MISSION_STATUS_LABELS,
} from "./MissionBoard.logic";
import { CreateMissionDialog, type CreateMissionInput } from "./CreateMissionDialog";

export interface MissionBoardProject {
  readonly id: string;
  readonly title: string;
}

export interface MissionBoardMission extends Omit<MissionCardProps, "projectTitle"> {
  readonly projectId: string;
}

export function MissionBoard({
  projects,
  missions,
  selectedProjectId,
  canMutate,
  onSelectedProjectChange,
  onOpenAddProject,
  onCreateMission,
}: {
  readonly projects: ReadonlyArray<MissionBoardProject>;
  readonly missions: ReadonlyArray<MissionBoardMission>;
  readonly selectedProjectId: string | null;
  readonly canMutate: boolean;
  readonly onSelectedProjectChange: (projectId: string | null) => void;
  readonly onOpenAddProject: () => void;
  readonly onCreateMission: (input: CreateMissionInput) => Promise<boolean>;
}) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const projectTitleById = new Map(projects.map((project) => [project.id, project.title] as const));
  const selectedProject =
    (selectedProjectId ? projects.find((project) => project.id === selectedProjectId) : null) ??
    null;
  const filteredMissions = filterMissionsByProject(missions, selectedProjectId);
  const grouped = groupMissionsForBoard(filteredMissions);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="mr-auto min-w-0">
          <h1 className="text-lg font-semibold">Missions</h1>
          <p className="text-sm text-muted-foreground">Plan, run, and review engineering work.</p>
        </div>
        <Select
          value={selectedProjectId ?? "all"}
          onValueChange={(value) => onSelectedProjectChange(value === "all" ? null : value)}
        >
          <SelectTrigger className="w-48" aria-label="Filter missions by project">
            <SelectValue>
              {selectedProject?.title ?? (projects.length === 0 ? "No projects" : "All projects")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button variant="outline" onClick={onOpenAddProject}>
          <FolderPlusIcon />
          Add project
        </Button>
        <Button
          disabled={!canMutate || projects.length === 0}
          onClick={() => setCreateDialogOpen(true)}
        >
          <PlusIcon />
          New mission
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div className="max-w-sm">
            <h2 className="text-lg font-semibold">Add a project first</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Missions belong to an existing T3 project and run in that project workspace.
            </p>
            <Button className="mt-4" onClick={onOpenAddProject}>
              <FolderPlusIcon />
              Add project
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
          <div className="flex min-w-max gap-3 p-4 sm:p-6">
            {MISSION_BOARD_STATUSES.map((status) => {
              const columnMissions = grouped.columns[status];
              return (
                <section
                  key={status}
                  className="w-72 shrink-0 rounded-xl border border-border/70 bg-muted/28 p-2.5"
                  aria-labelledby={`mission-column-${status}`}
                >
                  <header className="mb-2 flex items-center justify-between gap-2 px-1">
                    <h2 id={`mission-column-${status}`} className="text-sm font-semibold">
                      {MISSION_STATUS_LABELS[status]}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {columnMissions.length}
                    </span>
                  </header>
                  <div className="grid gap-2">
                    {columnMissions.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                        No missions
                      </p>
                    ) : (
                      columnMissions.map((mission) => (
                        <MissionCard
                          key={mission.missionId}
                          {...mission}
                          projectTitle={
                            projectTitleById.get(mission.projectId) ?? "Unknown project"
                          }
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {grouped.terminal.length > 0 ? (
            <details className="mx-4 mb-6 rounded-xl border border-border/70 bg-card sm:mx-6">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                <ArchiveIcon className="size-4 text-muted-foreground" />
                Failed and cancelled
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {grouped.terminal.length}
                </span>
              </summary>
              <div className="grid gap-2 border-t border-border/70 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.terminal.map((mission) => (
                  <MissionCard
                    key={mission.missionId}
                    {...mission}
                    projectTitle={projectTitleById.get(mission.projectId) ?? "Unknown project"}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </ScrollArea>
      )}

      <CreateMissionDialog
        key={selectedProject?.id ?? "unselected"}
        open={createDialogOpen}
        projects={projects}
        selectedProjectId={selectedProject?.id ?? null}
        onOpenChange={setCreateDialogOpen}
        onCreate={onCreateMission}
      />
    </div>
  );
}
