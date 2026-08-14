import { ArchiveIcon, CircleAlertIcon, FolderPlusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { DefinitionLabel } from "./DefinitionLabel";
import type { MissionGlossaryTerm } from "./missionGlossary";
import { MissionCard, type MissionCardProps } from "./MissionCard";
import {
  filterMissionsByProject,
  groupMissionsForBoard,
  missionAttentionSummary,
  missionBoardColumns,
  MISSION_STATUS_LABELS,
  type MissionBoardStatus,
} from "./MissionBoard.logic";
import { CreateMissionDialog, type CreateMissionInput } from "./CreateMissionDialog";

/**
 * Columns whose meaning is not obvious from the label. The rest read for themselves and are left
 * plain, so the dotted underline stays a signal rather than decoration.
 */
const COLUMN_DEFINITIONS: Partial<Record<MissionBoardStatus, MissionGlossaryTerm>> = {
  verification: "columnVerification",
  review: "columnReview",
  blocked: "columnBlocked",
};

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
  const [expandedStatuses, setExpandedStatuses] = useState<ReadonlySet<MissionBoardStatus>>(
    () => new Set(),
  );
  const [showTerminal, setShowTerminal] = useState(false);
  const projectTitleById = new Map(projects.map((project) => [project.id, project.title] as const));
  const selectedProject =
    (selectedProjectId ? projects.find((project) => project.id === selectedProjectId) : null) ??
    null;
  const filteredMissions = filterMissionsByProject(missions, selectedProjectId);
  const grouped = groupMissionsForBoard(filteredMissions);
  const columns = missionBoardColumns(grouped, expandedStatuses);
  const attention = missionAttentionSummary(grouped);

  /** Expand the column if it collapsed, then bring it into view from wherever the board is scrolled. */
  const revealColumn = (status: MissionBoardStatus) => {
    setExpandedStatuses((current) => new Set([...current, status]));
    requestAnimationFrame(() => {
      document
        .getElementById(`mission-column-section-${status}`)
        ?.scrollIntoView({ inline: "center", block: "nearest" });
    });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="mr-auto min-w-0">
          <h1 className="text-lg font-semibold">Missions</h1>
          <p className="text-sm text-muted-foreground">Plan, run, and review engineering work.</p>
        </div>
        {attention.blocked > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="text-warning-foreground"
            onClick={() => revealColumn("blocked")}
          >
            <CircleAlertIcon />
            {attention.blocked} blocked
          </Button>
        ) : null}
        {grouped.terminal.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="text-muted-foreground"
            onClick={() => setShowTerminal((current) => !current)}
          >
            <ArchiveIcon />
            {attention.failed > 0
              ? `${attention.failed} failed`
              : `${grouped.terminal.length} closed`}
          </Button>
        ) : null}
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
          {/* Above the horizontal scroller, so it cannot end up parked off-screen right. */}
          {showTerminal && grouped.terminal.length > 0 ? (
            <section
              aria-labelledby="mission-terminal-heading"
              className="mx-4 mt-4 rounded-xl border border-border/70 bg-card sm:mx-6 sm:mt-6"
            >
              <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
                <ArchiveIcon className="size-4 text-muted-foreground" />
                <h2 id="mission-terminal-heading" className="text-sm font-medium">
                  Failed and cancelled
                </h2>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {grouped.terminal.length}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setShowTerminal(false)}>
                  Hide
                </Button>
              </div>
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.terminal.map((mission) => (
                  <MissionCard
                    key={mission.missionId}
                    {...mission}
                    projectTitle={projectTitleById.get(mission.projectId) ?? "Unknown project"}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex min-w-max gap-3 p-4 sm:p-6">
            {columns.map(({ status, missions, collapsed }) =>
              collapsed ? (
                <button
                  key={status}
                  type="button"
                  id={`mission-column-section-${status}`}
                  aria-label={`Show the ${MISSION_STATUS_LABELS[status]} column`}
                  className="flex w-11 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 py-3 text-muted-foreground outline-none transition-colors hover:bg-accent/24 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setExpandedStatuses((current) => new Set([...current, status]))}
                >
                  <span className="text-xs tabular-nums">0</span>
                  <span className="text-xs font-medium [writing-mode:vertical-rl]">
                    {MISSION_STATUS_LABELS[status]}
                  </span>
                </button>
              ) : (
                <section
                  key={status}
                  id={`mission-column-section-${status}`}
                  className="w-72 shrink-0 rounded-xl border border-border/70 bg-muted/28 p-2.5"
                  aria-labelledby={`mission-column-${status}`}
                >
                  <header className="mb-2 flex items-center justify-between gap-2 px-1">
                    <h2 id={`mission-column-${status}`} className="text-sm font-semibold">
                      {COLUMN_DEFINITIONS[status] ? (
                        <DefinitionLabel term={COLUMN_DEFINITIONS[status]}>
                          {MISSION_STATUS_LABELS[status]}
                        </DefinitionLabel>
                      ) : (
                        MISSION_STATUS_LABELS[status]
                      )}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {missions.length}
                    </span>
                  </header>
                  <div className="grid gap-2">
                    {missions.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                        No missions
                      </p>
                    ) : (
                      missions.map((mission) => (
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
              ),
            )}
          </div>
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
