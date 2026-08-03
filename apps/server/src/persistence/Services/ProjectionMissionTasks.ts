import { MissionId, MissionTask, MissionTaskId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionMissionTask = MissionTask;
export type ProjectionMissionTask = typeof ProjectionMissionTask.Type;

export const GetProjectionMissionTaskInput = Schema.Struct({
  taskId: MissionTaskId,
});
export type GetProjectionMissionTaskInput = typeof GetProjectionMissionTaskInput.Type;

export const ListProjectionMissionTasksInput = Schema.Struct({
  missionId: MissionId,
});
export type ListProjectionMissionTasksInput = typeof ListProjectionMissionTasksInput.Type;

export interface ProjectionMissionTaskRepositoryShape {
  readonly upsert: (row: ProjectionMissionTask) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionMissionTaskInput,
  ) => Effect.Effect<Option.Option<ProjectionMissionTask>, ProjectionRepositoryError>;

  readonly listByMissionId: (
    input: ListProjectionMissionTasksInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionMissionTask>, ProjectionRepositoryError>;
}

export class ProjectionMissionTaskRepository extends Context.Service<
  ProjectionMissionTaskRepository,
  ProjectionMissionTaskRepositoryShape
>()("t3/persistence/Services/ProjectionMissionTasks/ProjectionMissionTaskRepository") {}
