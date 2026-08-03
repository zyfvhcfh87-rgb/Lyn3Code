import { createFileRoute } from "@tanstack/react-router";
import { BrainCircuitIcon } from "lucide-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { lazy, Suspense } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useProjects } from "../state/entities";

const MemoryWorkspace = lazy(() =>
  import("../components/memory/MemoryWorkspace").then((module) => ({
    default: module.MemoryWorkspace,
  })),
);

function ProjectMemoryRoute() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);
  const project =
    useProjects().find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
    ) ?? null;

  if (!project) {
    return (
      <SidebarInset className="h-dvh min-h-0">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainCircuitIcon />
            </EmptyMedia>
            <EmptyTitle>Project not found</EmptyTitle>
            <EmptyDescription>
              Project memory must be opened for a project in the selected environment.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Loading project memory…
          </div>
        }
      >
        <MemoryWorkspace
          environmentId={environmentId}
          projectId={projectId}
          projectTitle={project.title}
        />
      </Suspense>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/memory/$environmentId/$projectId")({
  component: ProjectMemoryRoute,
});
