import type {
  AgentRoleRoutingProfile,
  AgentRunId,
  ModelCapabilitySnapshot,
  ModelCapabilitySnapshotId,
  ModelProfile,
  ModelProfileId,
  ProjectId,
  ProviderHealthRecord,
  ProviderProfile,
  ProviderProfileId,
  RoutedRunOutcome,
  RoutingCandidateRecord,
  RoutingDecision,
  RoutingDecisionId,
  RoutingOverride,
  RoutingPolicy,
  RoutingPolicyId,
  RoutingRule,
  TaskRoutingAssessment,
  TaskRoutingAssessmentId,
} from "@t3tools/contracts";
import {
  AgentRunId as AgentRunIdSchema,
  ModelCapabilitySnapshot as ModelCapabilitySnapshotSchema,
  ModelProfileId as ModelProfileIdSchema,
  ProjectId as ProjectIdSchema,
  ProviderProfileId as ProviderProfileIdSchema,
  RoutingAgentRoleKind as RoutingAgentRoleKindSchema,
  RoutingCandidateRecord as RoutingCandidateRecordSchema,
  RoutingDecision as RoutingDecisionSchema,
  RoutingDecisionId as RoutingDecisionIdSchema,
  RoutingOverrideId as RoutingOverrideIdSchema,
  RoutingPolicyId as RoutingPolicyIdSchema,
  TaskRoutingAssessment as TaskRoutingAssessmentSchema,
  TaskRoutingAssessmentId as TaskRoutingAssessmentIdSchema,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetProviderProfileInput = Schema.Struct({
  providerProfileId: ProviderProfileIdSchema,
});
export type GetProviderProfileInput = typeof GetProviderProfileInput.Type;
export const ListModelProfilesInput = Schema.Struct({
  providerProfileId: Schema.NullOr(ProviderProfileIdSchema),
});
export type ListModelProfilesInput = typeof ListModelProfilesInput.Type;
export const GetModelProfileInput = Schema.Struct({ modelProfileId: ModelProfileIdSchema });
export type GetModelProfileInput = typeof GetModelProfileInput.Type;
export const GetCapabilitySnapshotInput = Schema.Struct({
  capabilitySnapshotId: ModelCapabilitySnapshotSchema.fields.id,
});
export type GetCapabilitySnapshotInput = typeof GetCapabilitySnapshotInput.Type;
export const GetLatestCapabilitySnapshotInput = Schema.Struct({
  modelProfileId: ModelProfileIdSchema,
  observedAt: Schema.String,
});
export type GetLatestCapabilitySnapshotInput = typeof GetLatestCapabilitySnapshotInput.Type;
export const ListCapabilitySnapshotsInput = Schema.Struct({ modelProfileId: ModelProfileIdSchema });
export type ListCapabilitySnapshotsInput = typeof ListCapabilitySnapshotsInput.Type;

export const GetRoutingPolicyInput = Schema.Struct({ routingPolicyId: RoutingPolicyIdSchema });
export type GetRoutingPolicyInput = typeof GetRoutingPolicyInput.Type;
export const ListRoutingResolutionInput = Schema.Struct({
  projectId: ProjectIdSchema,
  missionId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  roleKind: Schema.NullOr(RoutingAgentRoleKindSchema),
  observedAt: Schema.String,
});
export type ListRoutingResolutionInput = typeof ListRoutingResolutionInput.Type;
export const ListRulesByPolicyIdsInput = Schema.Struct({
  routingPolicyIds: Schema.Array(RoutingPolicyIdSchema).check(Schema.isMaxLength(64)),
});
export type ListRulesByPolicyIdsInput = typeof ListRulesByPolicyIdsInput.Type;

export const ListRoleRoutingProfilesInput = Schema.Struct({ projectId: ProjectIdSchema });
export type ListRoleRoutingProfilesInput = typeof ListRoleRoutingProfilesInput.Type;
export const ListCurrentProviderHealthInput = Schema.Struct({ observedAt: Schema.String });
export type ListCurrentProviderHealthInput = typeof ListCurrentProviderHealthInput.Type;
export const RevokeRoutingOverrideInput = Schema.Struct({
  routingOverrideId: RoutingOverrideIdSchema,
  revokedAt: Schema.String,
});
export type RevokeRoutingOverrideInput = typeof RevokeRoutingOverrideInput.Type;
export const GetRoutingOverrideInput = Schema.Struct({
  routingOverrideId: RoutingOverrideIdSchema,
});
export type GetRoutingOverrideInput = typeof GetRoutingOverrideInput.Type;

export const GetTaskAssessmentInput = Schema.Struct({ taskId: Schema.String });
export type GetTaskAssessmentInput = typeof GetTaskAssessmentInput.Type;
export const GetTaskAssessmentByIdInput = Schema.Struct({
  assessmentId: TaskRoutingAssessmentIdSchema,
});
export type GetTaskAssessmentByIdInput = typeof GetTaskAssessmentByIdInput.Type;
export const SaveTaskAssessmentInput = Schema.Struct({ assessment: TaskRoutingAssessmentSchema });
export type SaveTaskAssessmentInput = typeof SaveTaskAssessmentInput.Type;

export const CreateRoutingDecisionInput = Schema.Struct({
  decision: RoutingDecisionSchema,
  candidates: Schema.Array(RoutingCandidateRecordSchema).check(Schema.isMaxLength(64)),
}).check(
  Schema.makeFilter((input) =>
    input.decision.status !== "planned"
      ? "new routing decisions must be planned"
      : input.candidates.every((candidate) => candidate.routingDecisionId === input.decision.id)
        ? true
        : "all candidates must belong to the created routing decision",
  ),
);
export type CreateRoutingDecisionInput = typeof CreateRoutingDecisionInput.Type;
export const GetRoutingDecisionInput = Schema.Struct({
  routingDecisionId: RoutingDecisionIdSchema,
});
export type GetRoutingDecisionInput = typeof GetRoutingDecisionInput.Type;
export const GetRoutingDecisionByRunInput = Schema.Struct({ agentRunId: AgentRunIdSchema });
export type GetRoutingDecisionByRunInput = typeof GetRoutingDecisionByRunInput.Type;
export const ApplyRoutingDecisionInput = Schema.Struct({
  routingDecisionId: RoutingDecisionIdSchema,
  agentRunId: AgentRunIdSchema,
  appliedAt: Schema.String,
});
export type ApplyRoutingDecisionInput = typeof ApplyRoutingDecisionInput.Type;
export const MarkRoutingDecisionTerminalInput = Schema.Struct({
  routingDecisionId: RoutingDecisionIdSchema,
  status: Schema.Literals(["failed", "cancelled"]),
  terminalAt: Schema.String,
  failureSummary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_000))),
});
export type MarkRoutingDecisionTerminalInput = typeof MarkRoutingDecisionTerminalInput.Type;
export const SupersedeRoutingDecisionInput = Schema.Struct({
  routingDecisionId: RoutingDecisionIdSchema,
  supersededById: RoutingDecisionIdSchema,
  terminalAt: Schema.String,
});
export type SupersedeRoutingDecisionInput = typeof SupersedeRoutingDecisionInput.Type;
export const ListRoutingDecisionHistoryInput = Schema.Struct({
  projectId: ProjectIdSchema,
  missionId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ListRoutingDecisionHistoryInput = typeof ListRoutingDecisionHistoryInput.Type;
export const ListRecoverableRoutingDecisionsInput = Schema.Struct({
  createdBefore: Schema.String,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
});
export type ListRecoverableRoutingDecisionsInput = typeof ListRecoverableRoutingDecisionsInput.Type;

export const GetRoutedRunOutcomeInput = Schema.Struct({ agentRunId: AgentRunIdSchema });
export type GetRoutedRunOutcomeInput = typeof GetRoutedRunOutcomeInput.Type;

export interface RoutingDecisionDetail {
  readonly decision: RoutingDecision;
  readonly candidates: ReadonlyArray<RoutingCandidateRecord>;
}

export interface RoutingWorkspaceSnapshot {
  readonly providers: ReadonlyArray<ProviderProfile>;
  readonly models: ReadonlyArray<ModelProfile>;
  readonly capabilitySnapshots: ReadonlyArray<ModelCapabilitySnapshot>;
  readonly policies: ReadonlyArray<RoutingPolicy>;
  readonly rules: ReadonlyArray<RoutingRule>;
  readonly roleProfiles: ReadonlyArray<AgentRoleRoutingProfile>;
  readonly overrides: ReadonlyArray<RoutingOverride>;
  readonly health: ReadonlyArray<ProviderHealthRecord>;
  readonly assessments: ReadonlyArray<TaskRoutingAssessment>;
  readonly decisions: ReadonlyArray<RoutingDecision>;
  readonly outcomes: ReadonlyArray<RoutedRunOutcome>;
}

export interface ProjectionRoutingRepositoryShape {
  readonly upsertProviderProfile: (
    row: ProviderProfile,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getProviderProfile: (
    input: GetProviderProfileInput,
  ) => Effect.Effect<Option.Option<ProviderProfile>, ProjectionRepositoryError>;
  readonly listProviderProfiles: () => Effect.Effect<
    ReadonlyArray<ProviderProfile>,
    ProjectionRepositoryError
  >;

  readonly upsertModelProfile: (
    row: ModelProfile,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getModelProfile: (
    input: GetModelProfileInput,
  ) => Effect.Effect<Option.Option<ModelProfile>, ProjectionRepositoryError>;
  readonly listModelProfiles: (
    input: ListModelProfilesInput,
  ) => Effect.Effect<ReadonlyArray<ModelProfile>, ProjectionRepositoryError>;

  readonly insertCapabilitySnapshot: (
    row: ModelCapabilitySnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getCapabilitySnapshot: (
    input: GetCapabilitySnapshotInput,
  ) => Effect.Effect<Option.Option<ModelCapabilitySnapshot>, ProjectionRepositoryError>;
  readonly getLatestCapabilitySnapshot: (
    input: GetLatestCapabilitySnapshotInput,
  ) => Effect.Effect<Option.Option<ModelCapabilitySnapshot>, ProjectionRepositoryError>;
  readonly listCapabilitySnapshots: (
    input: ListCapabilitySnapshotsInput,
  ) => Effect.Effect<ReadonlyArray<ModelCapabilitySnapshot>, ProjectionRepositoryError>;

  readonly upsertPolicy: (row: RoutingPolicy) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getPolicy: (
    input: GetRoutingPolicyInput,
  ) => Effect.Effect<Option.Option<RoutingPolicy>, ProjectionRepositoryError>;
  readonly listActivePolicies: (
    input: ListRoutingResolutionInput,
  ) => Effect.Effect<ReadonlyArray<RoutingPolicy>, ProjectionRepositoryError>;
  readonly upsertRule: (row: RoutingRule) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listRulesByPolicyIds: (
    input: ListRulesByPolicyIdsInput,
  ) => Effect.Effect<ReadonlyArray<RoutingRule>, ProjectionRepositoryError>;
  readonly upsertRoleProfile: (
    row: AgentRoleRoutingProfile,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listRoleProfiles: (
    input: ListRoleRoutingProfilesInput,
  ) => Effect.Effect<ReadonlyArray<AgentRoleRoutingProfile>, ProjectionRepositoryError>;

  readonly insertProviderHealth: (
    row: ProviderHealthRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listCurrentProviderHealth: (
    input: ListCurrentProviderHealthInput,
  ) => Effect.Effect<ReadonlyArray<ProviderHealthRecord>, ProjectionRepositoryError>;
  readonly createOverride: (row: RoutingOverride) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getOverride: (
    input: GetRoutingOverrideInput,
  ) => Effect.Effect<Option.Option<RoutingOverride>, ProjectionRepositoryError>;
  readonly revokeOverride: (
    input: RevokeRoutingOverrideInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listActiveOverrides: (
    input: ListRoutingResolutionInput,
  ) => Effect.Effect<ReadonlyArray<RoutingOverride>, ProjectionRepositoryError>;

  readonly saveAssessment: (
    input: SaveTaskAssessmentInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getAssessmentById: (
    input: GetTaskAssessmentByIdInput,
  ) => Effect.Effect<Option.Option<TaskRoutingAssessment>, ProjectionRepositoryError>;
  readonly getLatestAssessment: (
    input: GetTaskAssessmentInput,
  ) => Effect.Effect<Option.Option<TaskRoutingAssessment>, ProjectionRepositoryError>;
  readonly listAssessmentHistory: (
    input: GetTaskAssessmentInput,
  ) => Effect.Effect<ReadonlyArray<TaskRoutingAssessment>, ProjectionRepositoryError>;

  readonly createDecision: (
    input: CreateRoutingDecisionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly applyDecision: (
    input: ApplyRoutingDecisionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly markDecisionTerminal: (
    input: MarkRoutingDecisionTerminalInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly supersedeDecision: (
    input: SupersedeRoutingDecisionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getDecision: (
    input: GetRoutingDecisionInput,
  ) => Effect.Effect<Option.Option<RoutingDecisionDetail>, ProjectionRepositoryError>;
  readonly getDecisionByRun: (
    input: GetRoutingDecisionByRunInput,
  ) => Effect.Effect<Option.Option<RoutingDecisionDetail>, ProjectionRepositoryError>;
  readonly listDecisionHistory: (
    input: ListRoutingDecisionHistoryInput,
  ) => Effect.Effect<ReadonlyArray<RoutingDecision>, ProjectionRepositoryError>;
  readonly listRecoverableDecisions: (
    input: ListRecoverableRoutingDecisionsInput,
  ) => Effect.Effect<ReadonlyArray<RoutingDecision>, ProjectionRepositoryError>;

  readonly getWorkspace: (
    input: ListRoutingResolutionInput,
  ) => Effect.Effect<RoutingWorkspaceSnapshot, ProjectionRepositoryError>;
  readonly upsertOutcome: (row: RoutedRunOutcome) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getOutcomeByRun: (
    input: GetRoutedRunOutcomeInput,
  ) => Effect.Effect<Option.Option<RoutedRunOutcome>, ProjectionRepositoryError>;
}

export class ProjectionRoutingRepository extends Context.Service<
  ProjectionRoutingRepository,
  ProjectionRoutingRepositoryShape
>()("t3/persistence/Services/ProjectionRouting/ProjectionRoutingRepository") {}

export type RoutingRepositoryIdentity = {
  readonly providerProfileId: ProviderProfileId;
  readonly modelProfileId: ModelProfileId;
  readonly capabilitySnapshotId: ModelCapabilitySnapshotId;
  readonly routingDecisionId: RoutingDecisionId;
  readonly agentRunId: AgentRunId;
  readonly projectId: ProjectId;
  readonly routingPolicyId: RoutingPolicyId;
  readonly assessmentId: TaskRoutingAssessmentId;
};
