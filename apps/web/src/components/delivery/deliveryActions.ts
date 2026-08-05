export interface DeliveryActionContext {
  readonly targetId: string;
  readonly reason: string;
}

export interface DeliveryApprovalDecisionContext extends DeliveryActionContext {
  readonly decision: "approve" | "reject";
}

export interface ReleasePlanProposalContext {
  readonly releaseConfigurationId: string;
  readonly deliveryPolicyId: string;
  readonly bump: "major" | "minor" | "patch" | null;
  readonly requestedVersion: string | null;
  readonly releaseNotesSupplement: string | null;
}

export interface DeploymentPlanProposalContext {
  readonly releasePlanId: string | null;
  readonly deploymentEnvironmentId: string;
  readonly deliveryPolicyId: string;
  readonly strategy:
    | "standard"
    | "rolling"
    | "canary"
    | "blue_green"
    | "provider_default"
    | "custom";
}

export interface DeliveryWorkspaceActions {
  readonly onAssessReadiness?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onRequestApproval?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onDecideApproval?: (context: DeliveryApprovalDecisionContext) => void | Promise<void>;
  readonly onExecuteMerge?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onCreateReleasePlan?: (context: ReleasePlanProposalContext) => void | Promise<void>;
  readonly onExecuteRelease?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onCreateDeploymentPlan?: (
    context: DeploymentPlanProposalContext,
  ) => void | Promise<void>;
  readonly onExecuteDeployment?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onCancelDeployment?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onRunValidation?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onCreateRollbackPlan?: (context: DeliveryActionContext) => void | Promise<void>;
  readonly onExecuteRollback?: (context: DeliveryActionContext) => void | Promise<void>;
}
