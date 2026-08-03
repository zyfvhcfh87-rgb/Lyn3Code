import { Mission, MissionId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionMission = Mission;
export type ProjectionMission = typeof ProjectionMission.Type;

export const GetProjectionMissionInput = Schema.Struct({
  missionId: MissionId,
});
export type GetProjectionMissionInput = typeof GetProjectionMissionInput.Type;

export const ListProjectionMissionsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionMissionsByProjectInput = typeof ListProjectionMissionsByProjectInput.Type;

export interface ProjectionMissionRepositoryShape {
  readonly upsert: (row: ProjectionMission) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionMissionInput,
  ) => Effect.Effect<Option.Option<ProjectionMission>, ProjectionRepositoryError>;

  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionMission>,
    ProjectionRepositoryError
  >;

  readonly listByProjectId: (
    input: ListProjectionMissionsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionMission>, ProjectionRepositoryError>;
}

export class ProjectionMissionRepository extends Context.Service<
  ProjectionMissionRepository,
  ProjectionMissionRepositoryShape
>()("t3/persistence/Services/ProjectionMissions/ProjectionMissionRepository") {}
