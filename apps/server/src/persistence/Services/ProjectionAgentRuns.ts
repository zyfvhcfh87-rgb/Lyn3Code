import { AgentRun, AgentRunId, MissionId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAgentRun = AgentRun;
export type ProjectionAgentRun = typeof ProjectionAgentRun.Type;

export const GetProjectionAgentRunInput = Schema.Struct({
  agentRunId: AgentRunId,
});
export type GetProjectionAgentRunInput = typeof GetProjectionAgentRunInput.Type;

export const ListProjectionAgentRunsInput = Schema.Struct({
  missionId: MissionId,
});
export type ListProjectionAgentRunsInput = typeof ListProjectionAgentRunsInput.Type;

export const GetProjectionAgentRunByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionAgentRunByThreadInput = typeof GetProjectionAgentRunByThreadInput.Type;

export interface ProjectionAgentRunRepositoryShape {
  readonly upsert: (row: ProjectionAgentRun) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionAgentRunInput,
  ) => Effect.Effect<Option.Option<ProjectionAgentRun>, ProjectionRepositoryError>;

  readonly getActiveByMissionId: (
    input: ListProjectionAgentRunsInput,
  ) => Effect.Effect<Option.Option<ProjectionAgentRun>, ProjectionRepositoryError>;

  readonly getByThreadId: (
    input: GetProjectionAgentRunByThreadInput,
  ) => Effect.Effect<Option.Option<ProjectionAgentRun>, ProjectionRepositoryError>;

  readonly listByMissionId: (
    input: ListProjectionAgentRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionAgentRun>, ProjectionRepositoryError>;

  readonly listActive: () => Effect.Effect<
    ReadonlyArray<ProjectionAgentRun>,
    ProjectionRepositoryError
  >;
}

export class ProjectionAgentRunRepository extends Context.Service<
  ProjectionAgentRunRepository,
  ProjectionAgentRunRepositoryShape
>()("t3/persistence/Services/ProjectionAgentRuns/ProjectionAgentRunRepository") {}
