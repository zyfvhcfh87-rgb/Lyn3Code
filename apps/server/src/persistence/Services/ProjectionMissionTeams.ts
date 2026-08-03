import {
  AgentHandoff,
  AgentHandoffId,
  AgentRole,
  ManagedWorktree,
  ManagedWorktreeId,
  MissionAgent,
  MissionAgentId,
  MissionId,
  TaskDependency,
  TaskDependencyId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAgentRole = AgentRole;
export type ProjectionAgentRole = typeof ProjectionAgentRole.Type;

export const ProjectionMissionAgent = MissionAgent;
export type ProjectionMissionAgent = typeof ProjectionMissionAgent.Type;

export const ProjectionTaskDependency = TaskDependency;
export type ProjectionTaskDependency = typeof ProjectionTaskDependency.Type;

export const ProjectionManagedWorktree = ManagedWorktree;
export type ProjectionManagedWorktree = typeof ProjectionManagedWorktree.Type;

export const ProjectionAgentHandoff = AgentHandoff;
export type ProjectionAgentHandoff = typeof ProjectionAgentHandoff.Type;

export const MissionTeamListInput = Schema.Struct({ missionId: MissionId });
export type MissionTeamListInput = typeof MissionTeamListInput.Type;

export const GetMissionAgentInput = Schema.Struct({ missionAgentId: MissionAgentId });
export type GetMissionAgentInput = typeof GetMissionAgentInput.Type;

export const DeleteMissionAgentInput = GetMissionAgentInput;
export type DeleteMissionAgentInput = typeof DeleteMissionAgentInput.Type;

export const DeleteTaskDependencyInput = Schema.Struct({ dependencyId: TaskDependencyId });
export type DeleteTaskDependencyInput = typeof DeleteTaskDependencyInput.Type;

export const GetManagedWorktreeInput = Schema.Struct({ worktreeId: ManagedWorktreeId });
export type GetManagedWorktreeInput = typeof GetManagedWorktreeInput.Type;

export const GetAgentHandoffInput = Schema.Struct({ handoffId: AgentHandoffId });
export type GetAgentHandoffInput = typeof GetAgentHandoffInput.Type;

export interface ProjectionMissionTeamRepositoryShape {
  readonly upsertAgentRole: (
    row: ProjectionAgentRole,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAgentRoles: () => Effect.Effect<
    ReadonlyArray<ProjectionAgentRole>,
    ProjectionRepositoryError
  >;

  readonly upsertMissionAgent: (
    row: ProjectionMissionAgent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getMissionAgentById: (
    input: GetMissionAgentInput,
  ) => Effect.Effect<Option.Option<ProjectionMissionAgent>, ProjectionRepositoryError>;
  readonly listMissionAgentsByMissionId: (
    input: MissionTeamListInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionMissionAgent>, ProjectionRepositoryError>;
  readonly deleteMissionAgent: (
    input: DeleteMissionAgentInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Atomically validates the resulting graph and persists the dependency. */
  readonly addTaskDependency: (
    row: ProjectionTaskDependency,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listTaskDependenciesByMissionId: (
    input: MissionTeamListInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTaskDependency>, ProjectionRepositoryError>;
  readonly deleteTaskDependency: (
    input: DeleteTaskDependencyInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly upsertManagedWorktree: (
    row: ProjectionManagedWorktree,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getManagedWorktreeById: (
    input: GetManagedWorktreeInput,
  ) => Effect.Effect<Option.Option<ProjectionManagedWorktree>, ProjectionRepositoryError>;
  readonly listManagedWorktreesByMissionId: (
    input: MissionTeamListInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionManagedWorktree>, ProjectionRepositoryError>;

  readonly upsertAgentHandoff: (
    row: ProjectionAgentHandoff,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getAgentHandoffById: (
    input: GetAgentHandoffInput,
  ) => Effect.Effect<Option.Option<ProjectionAgentHandoff>, ProjectionRepositoryError>;
  readonly listAgentHandoffsByMissionId: (
    input: MissionTeamListInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionAgentHandoff>, ProjectionRepositoryError>;
}

export class ProjectionMissionTeamRepository extends Context.Service<
  ProjectionMissionTeamRepository,
  ProjectionMissionTeamRepositoryShape
>()("t3/persistence/Services/ProjectionMissionTeams/ProjectionMissionTeamRepository") {}
