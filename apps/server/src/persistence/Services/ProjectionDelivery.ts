import type {
  ApprovalDecision,
  ApprovalDecisionResult,
  ApprovalRequest,
  DeliveryApprovalRequestId,
  DeliveryAuditEntry,
  DeliveryAuditEntryId,
  DeliveryPolicy,
  DeliveryPolicyId,
  DeliveryWorkspaceSnapshot,
  DeploymentEnvironment,
  DeploymentEnvironmentId,
  DeploymentExecution,
  DeploymentExecutionId,
  DeploymentPlan,
  DeploymentPlanId,
  DeploymentValidationRun,
  DeploymentValidationRunId,
  MergeExecution,
  MergeExecutionId,
  MergeReadinessAssessment,
  MergeReadinessAssessmentId,
  ProjectId,
  ReleaseArtifact,
  ReleaseArtifactId,
  ReleaseConfiguration,
  ReleaseConfigurationId,
  ReleasePlan,
  ReleasePlanId,
  RollbackExecution,
  RollbackExecutionId,
  RollbackPlan,
  RollbackPlanId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

type RepositoryEffect<A> = Effect.Effect<A, ProjectionRepositoryError>;

export interface ProjectionDeliveryRepositoryShape {
  readonly savePolicy: (entity: DeliveryPolicy) => RepositoryEffect<void>;
  readonly getPolicy: (id: DeliveryPolicyId) => RepositoryEffect<Option.Option<DeliveryPolicy>>;
  readonly listPolicies: (projectId: ProjectId) => RepositoryEffect<ReadonlyArray<DeliveryPolicy>>;

  readonly saveMergeReadinessAssessment: (
    entity: MergeReadinessAssessment,
  ) => RepositoryEffect<void>;
  readonly getMergeReadinessAssessment: (
    id: MergeReadinessAssessmentId,
  ) => RepositoryEffect<Option.Option<MergeReadinessAssessment>>;
  readonly listMergeReadinessAssessments: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<MergeReadinessAssessment>>;

  readonly saveApprovalRequest: (entity: ApprovalRequest) => RepositoryEffect<void>;
  readonly getApprovalRequest: (
    id: DeliveryApprovalRequestId,
  ) => RepositoryEffect<Option.Option<ApprovalRequest>>;
  readonly listApprovalRequests: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<ApprovalRequest>>;
  readonly listApprovalDecisions: (
    requestId: DeliveryApprovalRequestId,
  ) => RepositoryEffect<ReadonlyArray<ApprovalDecision>>;
  readonly recordApprovalDecision: (
    decision: ApprovalDecision,
  ) => RepositoryEffect<ApprovalDecisionResult>;

  readonly saveMergeExecution: (entity: MergeExecution) => RepositoryEffect<void>;
  readonly getMergeExecution: (
    id: MergeExecutionId,
  ) => RepositoryEffect<Option.Option<MergeExecution>>;
  readonly listMergeExecutions: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<MergeExecution>>;
  readonly listRecoverableMergeExecutions: () => RepositoryEffect<ReadonlyArray<MergeExecution>>;

  readonly saveReleaseConfiguration: (entity: ReleaseConfiguration) => RepositoryEffect<void>;
  readonly getReleaseConfiguration: (
    id: ReleaseConfigurationId,
  ) => RepositoryEffect<Option.Option<ReleaseConfiguration>>;
  readonly listReleaseConfigurations: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<ReleaseConfiguration>>;
  readonly saveReleasePlan: (entity: ReleasePlan) => RepositoryEffect<void>;
  readonly getReleasePlan: (id: ReleasePlanId) => RepositoryEffect<Option.Option<ReleasePlan>>;
  readonly listReleasePlans: (projectId: ProjectId) => RepositoryEffect<ReadonlyArray<ReleasePlan>>;
  readonly listRecoverableReleasePlans: () => RepositoryEffect<ReadonlyArray<ReleasePlan>>;
  readonly saveReleaseArtifact: (entity: ReleaseArtifact) => RepositoryEffect<void>;
  readonly getReleaseArtifact: (
    id: ReleaseArtifactId,
  ) => RepositoryEffect<Option.Option<ReleaseArtifact>>;
  readonly listReleaseArtifacts: (
    releasePlanId: ReleasePlanId,
  ) => RepositoryEffect<ReadonlyArray<ReleaseArtifact>>;

  readonly saveDeploymentEnvironment: (entity: DeploymentEnvironment) => RepositoryEffect<void>;
  readonly getDeploymentEnvironment: (
    id: DeploymentEnvironmentId,
  ) => RepositoryEffect<Option.Option<DeploymentEnvironment>>;
  readonly listDeploymentEnvironments: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<DeploymentEnvironment>>;
  readonly saveDeploymentPlan: (entity: DeploymentPlan) => RepositoryEffect<void>;
  readonly getDeploymentPlan: (
    id: DeploymentPlanId,
  ) => RepositoryEffect<Option.Option<DeploymentPlan>>;
  readonly listDeploymentPlans: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<DeploymentPlan>>;
  readonly listRecoverableDeploymentPlans: () => RepositoryEffect<ReadonlyArray<DeploymentPlan>>;
  readonly saveDeploymentExecution: (entity: DeploymentExecution) => RepositoryEffect<void>;
  readonly getDeploymentExecution: (
    id: DeploymentExecutionId,
  ) => RepositoryEffect<Option.Option<DeploymentExecution>>;
  readonly listDeploymentExecutions: (
    deploymentPlanId: DeploymentPlanId,
  ) => RepositoryEffect<ReadonlyArray<DeploymentExecution>>;
  readonly listRecoverableDeploymentExecutions: () => RepositoryEffect<
    ReadonlyArray<DeploymentExecution>
  >;
  readonly saveDeploymentValidationRun: (entity: DeploymentValidationRun) => RepositoryEffect<void>;
  readonly getDeploymentValidationRun: (
    id: DeploymentValidationRunId,
  ) => RepositoryEffect<Option.Option<DeploymentValidationRun>>;
  readonly listDeploymentValidationRuns: (
    deploymentExecutionId: DeploymentExecutionId,
  ) => RepositoryEffect<ReadonlyArray<DeploymentValidationRun>>;
  readonly listRecoverableDeploymentValidationRuns: () => RepositoryEffect<
    ReadonlyArray<DeploymentValidationRun>
  >;

  readonly saveRollbackPlan: (entity: RollbackPlan) => RepositoryEffect<void>;
  readonly getRollbackPlan: (id: RollbackPlanId) => RepositoryEffect<Option.Option<RollbackPlan>>;
  readonly listRollbackPlans: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<RollbackPlan>>;
  readonly listRecoverableRollbackPlans: () => RepositoryEffect<ReadonlyArray<RollbackPlan>>;
  readonly saveRollbackExecution: (entity: RollbackExecution) => RepositoryEffect<void>;
  readonly getRollbackExecution: (
    id: RollbackExecutionId,
  ) => RepositoryEffect<Option.Option<RollbackExecution>>;
  readonly listRollbackExecutions: (
    rollbackPlanId: RollbackPlanId,
  ) => RepositoryEffect<ReadonlyArray<RollbackExecution>>;
  readonly listRecoverableRollbackExecutions: () => RepositoryEffect<
    ReadonlyArray<RollbackExecution>
  >;

  readonly appendAuditEntry: (entity: DeliveryAuditEntry) => RepositoryEffect<void>;
  readonly getAuditEntry: (
    id: DeliveryAuditEntryId,
  ) => RepositoryEffect<Option.Option<DeliveryAuditEntry>>;
  readonly listAuditEntries: (
    projectId: ProjectId,
  ) => RepositoryEffect<ReadonlyArray<DeliveryAuditEntry>>;
  readonly getWorkspaceSnapshot: (
    projectId: ProjectId,
  ) => RepositoryEffect<DeliveryWorkspaceSnapshot>;
}

export class ProjectionDeliveryRepository extends Context.Service<
  ProjectionDeliveryRepository,
  ProjectionDeliveryRepositoryShape
>()("t3/persistence/Services/ProjectionDelivery/ProjectionDeliveryRepository") {}
