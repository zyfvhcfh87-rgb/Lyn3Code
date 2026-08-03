import {
  MissionTaskId,
  ProjectId,
  VerificationArtifact,
  VerificationCheckRun,
  VerificationCheckRunId,
  VerificationDiagnostic,
  VerificationOverride,
  VerificationOverrideId,
  VerificationProfileId,
  VerificationRepairAttempt,
  VerificationRepairAttemptId,
  VerificationRun,
  VerificationRunId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionVerificationRun = VerificationRun;
export type ProjectionVerificationRun = typeof ProjectionVerificationRun.Type;
export const ProjectionVerificationCheckRun = VerificationCheckRun;
export type ProjectionVerificationCheckRun = typeof ProjectionVerificationCheckRun.Type;
export const ProjectionVerificationDiagnostic = VerificationDiagnostic;
export type ProjectionVerificationDiagnostic = typeof ProjectionVerificationDiagnostic.Type;
export const ProjectionVerificationArtifact = VerificationArtifact;
export type ProjectionVerificationArtifact = typeof ProjectionVerificationArtifact.Type;
export const ProjectionVerificationRepairAttempt = VerificationRepairAttempt;
export type ProjectionVerificationRepairAttempt = typeof ProjectionVerificationRepairAttempt.Type;
export const ProjectionVerificationOverride = VerificationOverride;
export type ProjectionVerificationOverride = typeof ProjectionVerificationOverride.Type;

export const GetVerificationRunInput = Schema.Struct({ verificationRunId: VerificationRunId });
export type GetVerificationRunInput = typeof GetVerificationRunInput.Type;
export const ListVerificationRunsByProjectInput = Schema.Struct({ projectId: ProjectId });
export type ListVerificationRunsByProjectInput = typeof ListVerificationRunsByProjectInput.Type;
export const ListVerificationRunsByTaskInput = Schema.Struct({ taskId: MissionTaskId });
export type ListVerificationRunsByTaskInput = typeof ListVerificationRunsByTaskInput.Type;
export const ListVerificationRunsByProfileInput = Schema.Struct({
  profileId: VerificationProfileId,
});
export type ListVerificationRunsByProfileInput = typeof ListVerificationRunsByProfileInput.Type;
export const InvalidateVerificationRunInput = Schema.Struct({
  verificationRunId: VerificationRunId,
  invalidatedAt: Schema.String,
  reason: Schema.String,
});
export type InvalidateVerificationRunInput = typeof InvalidateVerificationRunInput.Type;
export const GetVerificationCheckRunInput = Schema.Struct({
  checkRunId: VerificationCheckRunId,
});
export type GetVerificationCheckRunInput = typeof GetVerificationCheckRunInput.Type;
export const ListVerificationCheckRunsInput = Schema.Struct({
  verificationRunId: VerificationRunId,
});
export type ListVerificationCheckRunsInput = typeof ListVerificationCheckRunsInput.Type;
export const ListVerificationDiagnosticsInput = Schema.Struct({
  checkRunId: VerificationCheckRunId,
});
export type ListVerificationDiagnosticsInput = typeof ListVerificationDiagnosticsInput.Type;
export const ListVerificationArtifactsInput = Schema.Struct({
  verificationRunId: VerificationRunId,
});
export type ListVerificationArtifactsInput = typeof ListVerificationArtifactsInput.Type;
export const GetVerificationRepairAttemptInput = Schema.Struct({
  repairAttemptId: VerificationRepairAttemptId,
});
export type GetVerificationRepairAttemptInput = typeof GetVerificationRepairAttemptInput.Type;
export const RevokeVerificationOverrideInput = Schema.Struct({
  overrideId: VerificationOverrideId,
  revokedAt: Schema.String,
});
export type RevokeVerificationOverrideInput = typeof RevokeVerificationOverrideInput.Type;

export interface ProjectionVerificationRunRepositoryShape {
  readonly saveRun: (
    row: ProjectionVerificationRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getRunById: (
    input: GetVerificationRunInput,
  ) => Effect.Effect<Option.Option<ProjectionVerificationRun>, ProjectionRepositoryError>;
  readonly listRunsByProjectId: (
    input: ListVerificationRunsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationRun>, ProjectionRepositoryError>;
  readonly listRunsByTaskId: (
    input: ListVerificationRunsByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationRun>, ProjectionRepositoryError>;
  readonly listRunsByProfileId: (
    input: ListVerificationRunsByProfileInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationRun>, ProjectionRepositoryError>;
  readonly listActiveRuns: () => Effect.Effect<
    ReadonlyArray<ProjectionVerificationRun>,
    ProjectionRepositoryError
  >;
  readonly invalidateRun: (
    input: InvalidateVerificationRunInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly saveCheckRun: (
    row: ProjectionVerificationCheckRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getCheckRunById: (
    input: GetVerificationCheckRunInput,
  ) => Effect.Effect<Option.Option<ProjectionVerificationCheckRun>, ProjectionRepositoryError>;
  readonly listCheckRunsByRunId: (
    input: ListVerificationCheckRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationCheckRun>, ProjectionRepositoryError>;
  readonly appendDiagnostic: (
    row: ProjectionVerificationDiagnostic,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listDiagnosticsByCheckRunId: (
    input: ListVerificationDiagnosticsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationDiagnostic>, ProjectionRepositoryError>;
  readonly appendArtifact: (
    row: ProjectionVerificationArtifact,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listArtifactsByRunId: (
    input: ListVerificationArtifactsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationArtifact>, ProjectionRepositoryError>;
  readonly saveRepairAttempt: (
    row: ProjectionVerificationRepairAttempt,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getRepairAttemptById: (
    input: GetVerificationRepairAttemptInput,
  ) => Effect.Effect<Option.Option<ProjectionVerificationRepairAttempt>, ProjectionRepositoryError>;
  readonly listRepairAttemptsByRunId: (
    input: ListVerificationCheckRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationRepairAttempt>, ProjectionRepositoryError>;
  readonly appendOverride: (
    row: ProjectionVerificationOverride,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listOverridesByTaskId: (
    input: ListVerificationRunsByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionVerificationOverride>, ProjectionRepositoryError>;
  readonly revokeOverride: (
    input: RevokeVerificationOverrideInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionVerificationRunRepository extends Context.Service<
  ProjectionVerificationRunRepository,
  ProjectionVerificationRunRepositoryShape
>()("t3/persistence/Services/ProjectionVerificationRuns/ProjectionVerificationRunRepository") {}
