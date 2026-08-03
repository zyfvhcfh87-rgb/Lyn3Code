import {
  ProjectId,
  VerificationCheckDefinition,
  VerificationCheckDefinitionId,
  VerificationGate,
  VerificationGateId,
  VerificationProfile,
  VerificationProfileId,
  VerificationProjectSettings,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionVerificationProjectSettings = VerificationProjectSettings;
export type ProjectionVerificationProjectSettings =
  typeof ProjectionVerificationProjectSettings.Type;
export const ProjectionVerificationProfile = VerificationProfile;
export type ProjectionVerificationProfile = typeof ProjectionVerificationProfile.Type;
export const ProjectionVerificationGate = VerificationGate;
export type ProjectionVerificationGate = typeof ProjectionVerificationGate.Type;
export const ProjectionVerificationCheckDefinition = VerificationCheckDefinition;
export type ProjectionVerificationCheckDefinition =
  typeof ProjectionVerificationCheckDefinition.Type;

export const GetVerificationProjectSettingsInput = Schema.Struct({ projectId: ProjectId });
export type GetVerificationProjectSettingsInput = typeof GetVerificationProjectSettingsInput.Type;
export const GetVerificationProfileInput = Schema.Struct({ profileId: VerificationProfileId });
export type GetVerificationProfileInput = typeof GetVerificationProfileInput.Type;
export const ListVerificationProfilesInput = Schema.Struct({ projectId: ProjectId });
export type ListVerificationProfilesInput = typeof ListVerificationProfilesInput.Type;
export const GetVerificationGateInput = Schema.Struct({ gateId: VerificationGateId });
export type GetVerificationGateInput = typeof GetVerificationGateInput.Type;
export const ListVerificationGatesInput = Schema.Struct({ profileId: VerificationProfileId });
export type ListVerificationGatesInput = typeof ListVerificationGatesInput.Type;
export const GetVerificationCheckDefinitionInput = Schema.Struct({
  checkDefinitionId: VerificationCheckDefinitionId,
});
export type GetVerificationCheckDefinitionInput = typeof GetVerificationCheckDefinitionInput.Type;
export const ListVerificationCheckDefinitionsInput = Schema.Struct({ gateId: VerificationGateId });
export type ListVerificationCheckDefinitionsInput =
  typeof ListVerificationCheckDefinitionsInput.Type;

export const SaveVerificationProfileGraphInput = Schema.Struct({
  profile: ProjectionVerificationProfile,
  gates: Schema.Array(ProjectionVerificationGate),
  checks: Schema.Array(ProjectionVerificationCheckDefinition),
});
export type SaveVerificationProfileGraphInput = typeof SaveVerificationProfileGraphInput.Type;

export interface ProjectionVerificationConfigurationRepositoryShape {
  readonly upsertProjectSettings: (
    row: ProjectionVerificationProjectSettings,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getProjectSettings: (
    input: GetVerificationProjectSettingsInput,
  ) => Effect.Effect<
    Option.Option<ProjectionVerificationProjectSettings>,
    ProjectionRepositoryError
  >;
  readonly upsertProfile: (
    row: ProjectionVerificationProfile,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getProfileById: (
    input: GetVerificationProfileInput,
  ) => Effect.Effect<Option.Option<ProjectionVerificationProfile>, ProjectionRepositoryError>;
  readonly listProfilesByProjectId: (
    input: ListVerificationProfilesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationProfile>, ProjectionRepositoryError>;
  readonly upsertGate: (
    row: ProjectionVerificationGate,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getGateById: (
    input: GetVerificationGateInput,
  ) => Effect.Effect<Option.Option<ProjectionVerificationGate>, ProjectionRepositoryError>;
  readonly listGatesByProfileId: (
    input: ListVerificationGatesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationGate>, ProjectionRepositoryError>;
  readonly upsertCheckDefinition: (
    row: ProjectionVerificationCheckDefinition,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getCheckDefinitionById: (
    input: GetVerificationCheckDefinitionInput,
  ) => Effect.Effect<
    Option.Option<ProjectionVerificationCheckDefinition>,
    ProjectionRepositoryError
  >;
  readonly listCheckDefinitionsByGateId: (
    input: ListVerificationCheckDefinitionsInput,
  ) => Effect.Effect<
    ReadonlyArray<ProjectionVerificationCheckDefinition>,
    ProjectionRepositoryError
  >;
  readonly saveProfileGraph: (
    input: SaveVerificationProfileGraphInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionVerificationConfigurationRepository extends Context.Service<
  ProjectionVerificationConfigurationRepository,
  ProjectionVerificationConfigurationRepositoryShape
>()(
  "t3/persistence/Services/ProjectionVerificationConfiguration/ProjectionVerificationConfigurationRepository",
) {}
