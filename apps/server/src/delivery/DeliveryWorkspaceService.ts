import type {
  ApprovalDecision,
  ApprovalDecisionResult,
  ApprovalRequest,
  AssessMergeInput,
  CancelDeploymentInput,
  DecideApprovalInput,
  DeliveryAuditEntry,
  DeliveryOrchestrationEventType,
  DeliveryPolicy,
  DeliveryPublicMetadata,
  DeliveryWindow,
  DeliveryWorkspaceSnapshot,
  DeploymentEnvironment,
  DeploymentExecution,
  DeploymentPlan,
  DeploymentValidationRun,
  ExecuteDeploymentInput,
  ExecuteMergeInput,
  ExecuteRollbackInput,
  MergeExecution,
  MergeReadinessAssessment,
  ProjectId,
  ProposeDeploymentPlanInput,
  ProposeReleasePlanInput,
  PublishReleaseInput,
  ReleaseConfiguration,
  ReleasePlan,
  RequestApprovalInput,
  RollbackExecution,
  RollbackPlan,
  SaveDeploymentEnvironmentInput,
  SavePolicyInput,
  SaveReleaseConfigurationInput,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import {
  ApprovalDecisionId,
  DeliveryAggregateId,
  DeliveryApprovalRequestId,
  DeliveryAuditEntryId,
  DeliveryConflictError,
  DeliveryNotFoundError,
  DeliveryUnavailableError,
  DeliveryValidationError,
  DeploymentExecutionId,
  DeploymentPlanId,
  DeploymentValidationRunId,
  MergeExecutionId,
  MergeReadinessAssessmentId,
  ReleasePlanId,
  RollbackExecutionId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { GitHubApiClient, type GitHubApiError } from "../github/GitHubApiClient.ts";
import { GitHubWorkspaceService } from "../github/GitHubWorkspaceService.ts";
import { ProjectionDeliveryRepository } from "../persistence/Services/ProjectionDelivery.ts";
import { ProjectionGitHubWorkspaceRepository } from "../persistence/Services/ProjectionGitHubWorkspace.ts";
import { ProjectionMissionRepository } from "../persistence/Services/ProjectionMissions.ts";
import { ProjectionMissionTaskRepository } from "../persistence/Services/ProjectionMissionTasks.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { VerificationPathGuard } from "../verification/VerificationPathGuard.ts";
import { VerificationProcessRunner } from "../verification/VerificationProcessRunner.ts";
import { VerificationQueryService } from "../verification/VerificationQueryService.ts";
import { VerificationSourceCapture } from "../verification/VerificationSourceCapture.ts";
import { inspectReleaseArtifact } from "./ArtifactIntegrity.ts";
import { executeControlledMerge } from "./ControlledMergeExecution.ts";
import { DeliveryEventRecorder } from "./DeliveryEventRecorder.ts";
import {
  deploymentConfigurationSnapshot,
  proposalDigest,
  releaseEvidenceNarrative,
  selectCurrentReleaseVerification,
  tagPrefixFromPattern,
} from "./DeliveryPlanProposal.ts";
import {
  approvalRequestIsCurrent,
  validateApprovalDecisionBinding,
  validateApprovedPlanMutation,
  validatePlanTransition,
} from "./DeliveryLifecycle.ts";
import { evaluateMergeReadiness } from "./MergeReadinessEvaluator.ts";
import type { PostDeploymentCheck } from "./PostDeploymentValidation.ts";
import { runPostDeploymentValidation } from "./PostDeploymentValidation.ts";
import {
  makeRepositoryScriptDeploymentAdapter,
  REPOSITORY_SCRIPT_PROVIDER_KIND,
} from "./RepositoryScriptDeploymentAdapter.ts";
import { planRelease } from "./ReleasePlanner.ts";

export type DeliveryServiceError =
  | DeliveryValidationError
  | DeliveryNotFoundError
  | DeliveryConflictError
  | DeliveryUnavailableError;

export interface DeliveryWorkspaceChange {
  readonly projectId: ProjectId;
}

export interface DeliveryWorkspaceServiceShape {
  readonly getWorkspace: (
    projectId: ProjectId,
  ) => Effect.Effect<DeliveryWorkspaceSnapshot, DeliveryServiceError>;
  readonly savePolicy: (
    input: SavePolicyInput,
  ) => Effect.Effect<DeliveryPolicy, DeliveryServiceError>;
  readonly saveReleaseConfiguration: (
    input: SaveReleaseConfigurationInput,
  ) => Effect.Effect<ReleaseConfiguration, DeliveryServiceError>;
  readonly saveDeploymentEnvironment: (
    input: SaveDeploymentEnvironmentInput,
  ) => Effect.Effect<DeploymentEnvironment, DeliveryServiceError>;
  readonly assessMerge: (
    input: AssessMergeInput,
  ) => Effect.Effect<MergeReadinessAssessment, DeliveryServiceError>;
  readonly requestApproval: (
    input: RequestApprovalInput,
  ) => Effect.Effect<ApprovalRequest, DeliveryServiceError>;
  readonly decideApproval: (
    input: DecideApprovalInput,
  ) => Effect.Effect<ApprovalDecisionResult, DeliveryServiceError>;
  readonly executeMerge: (
    input: ExecuteMergeInput,
  ) => Effect.Effect<MergeExecution, DeliveryServiceError>;
  readonly proposeReleasePlan: (
    input: ProposeReleasePlanInput,
  ) => Effect.Effect<ReleasePlan, DeliveryServiceError>;
  readonly saveReleasePlan: (plan: ReleasePlan) => Effect.Effect<ReleasePlan, DeliveryServiceError>;
  readonly publishRelease: (
    input: PublishReleaseInput,
  ) => Effect.Effect<ReleasePlan, DeliveryServiceError>;
  readonly proposeDeploymentPlan: (
    input: ProposeDeploymentPlanInput,
  ) => Effect.Effect<DeploymentPlan, DeliveryServiceError>;
  readonly saveDeploymentPlan: (
    plan: DeploymentPlan,
  ) => Effect.Effect<DeploymentPlan, DeliveryServiceError>;
  readonly executeDeployment: (
    input: ExecuteDeploymentInput,
  ) => Effect.Effect<DeploymentExecution, DeliveryServiceError>;
  readonly cancelDeployment: (
    input: CancelDeploymentInput,
  ) => Effect.Effect<DeploymentExecution, DeliveryServiceError>;
  readonly saveRollbackPlan: (
    plan: RollbackPlan,
  ) => Effect.Effect<RollbackPlan, DeliveryServiceError>;
  readonly executeRollback: (
    input: ExecuteRollbackInput,
  ) => Effect.Effect<RollbackExecution, DeliveryServiceError>;
  readonly recoverInterrupted: () => Effect.Effect<void, never>;
  readonly changes: Stream.Stream<DeliveryWorkspaceChange>;
}

const unavailableDefault = () =>
  Effect.fail(
    new DeliveryUnavailableError({ message: "The controlled delivery service is unavailable." }),
  );

export class DeliveryWorkspaceService extends Context.Reference<DeliveryWorkspaceServiceShape>(
  "t3/delivery/DeliveryWorkspaceService",
  {
    defaultValue: () => ({
      getWorkspace: unavailableDefault,
      savePolicy: unavailableDefault,
      saveReleaseConfiguration: unavailableDefault,
      saveDeploymentEnvironment: unavailableDefault,
      assessMerge: unavailableDefault,
      requestApproval: unavailableDefault,
      decideApproval: unavailableDefault,
      executeMerge: unavailableDefault,
      proposeReleasePlan: unavailableDefault,
      saveReleasePlan: unavailableDefault,
      publishRelease: unavailableDefault,
      proposeDeploymentPlan: unavailableDefault,
      saveDeploymentPlan: unavailableDefault,
      executeDeployment: unavailableDefault,
      cancelDeployment: unavailableDefault,
      saveRollbackPlan: unavailableDefault,
      executeRollback: unavailableDefault,
      recoverInterrupted: () => Effect.void,
      changes: Stream.empty,
    }),
  },
) {}

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const unavailable = (action: string, cause: unknown) =>
  new DeliveryUnavailableError({
    message:
      `${action} is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`.slice(
        0,
        2_000,
      ),
  });
const mapUnavailable =
  (action: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, DeliveryUnavailableError, R> =>
    effect.pipe(Effect.mapError((cause) => unavailable(action, cause)));

const notFound = (entity: string, id: string) => new DeliveryNotFoundError({ entity, id });
const validation = (message: string) => new DeliveryValidationError({ message });
const conflict = (message: string) => new DeliveryConflictError({ message });

const requireOption = <A>(entity: string, id: string, option: Option.Option<A>) =>
  Option.match(option, {
    onNone: () => Effect.fail(notFound(entity, id)),
    onSome: Effect.succeed,
  });

const metadataString = (
  metadata: DeliveryPublicMetadata,
  key: string,
  fallback?: string,
): string | undefined => {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

const metadataNumber = (
  metadata: DeliveryPublicMetadata,
  key: string,
  fallback: number,
): number => {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const evaluateAbsoluteWindows = (
  deliveryWindows: ReadonlyArray<DeliveryWindow>,
  freezeWindows: ReadonlyArray<DeliveryWindow>,
  observedAt: string,
): { readonly withinWindow: boolean; readonly activeFreeze: DeliveryWindow | null } => {
  const observed = Option.getOrNull(DateTime.make(observedAt));
  if (observed === null) return { withinWindow: false, activeFreeze: null };
  const observedMillis = DateTime.toEpochMillis(observed);
  const contains = (window: DeliveryWindow): boolean => {
    const startsAt = Option.getOrNull(DateTime.make(window.startsAt));
    const endsAt = Option.getOrNull(DateTime.make(window.endsAt));
    return (
      startsAt !== null &&
      endsAt !== null &&
      DateTime.toEpochMillis(startsAt) < DateTime.toEpochMillis(endsAt) &&
      observedMillis >= DateTime.toEpochMillis(startsAt) &&
      observedMillis < DateTime.toEpochMillis(endsAt)
    );
  };
  return {
    withinWindow: deliveryWindows.length === 0 || deliveryWindows.some(contains),
    activeFreeze: freezeWindows.find(contains) ?? null,
  };
};

const parseStringArray = (value: string | undefined, label: string): ReadonlyArray<string> => {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error("expected a string array");
    }
    return Object.freeze(parsed);
  } catch (cause) {
    throw validation(`${label} must be a JSON array of strings (${String(cause)}).`);
  }
};

const parseValidationChecks = (value: string | undefined): ReadonlyArray<PostDeploymentCheck> => {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    for (const entry of parsed) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("id" in entry) ||
        typeof entry.id !== "string" ||
        !("kind" in entry) ||
        (entry.kind !== "http" && entry.kind !== "version") ||
        !("url" in entry) ||
        typeof entry.url !== "string"
      ) {
        throw new Error("each check needs a string id, supported kind, and URL");
      }
    }
    return parsed as ReadonlyArray<PostDeploymentCheck>;
  } catch (cause) {
    throw validation(`validationChecksJson is invalid (${String(cause)}).`);
  }
};

const isNotFoundApiError = (error: GitHubApiError): boolean =>
  error._tag === "GitHubApiResponseError" && error.kind === "not_found";

export const make = Effect.gen(function* () {
  const repository = yield* ProjectionDeliveryRepository;
  const githubRepository = yield* ProjectionGitHubWorkspaceRepository;
  const missions = yield* ProjectionMissionRepository;
  const missionTasks = yield* ProjectionMissionTaskRepository;
  const projects = yield* ProjectionProjectRepository;
  const githubWorkspace = yield* GitHubWorkspaceService;
  const githubApi = yield* GitHubApiClient;
  const verificationQuery = yield* VerificationQueryService;
  const pathGuard = yield* VerificationPathGuard;
  const sourceCapture = yield* VerificationSourceCapture;
  const processRunner = yield* VerificationProcessRunner;
  const hostEnvironment = yield* HostProcessEnvironment;
  const eventRecorder = yield* DeliveryEventRecorder;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const changes = yield* PubSub.unbounded<DeliveryWorkspaceChange>();

  const uuid = crypto.randomUUIDv4.pipe(
    Effect.orDie,
    Effect.map((value) => value.toLowerCase()),
  );
  const publishChange = (projectId: ProjectId) =>
    PubSub.publish(changes, { projectId }).pipe(Effect.asVoid);

  const appendAudit = Effect.fn("DeliveryWorkspaceService.appendAudit")(function* (input: {
    readonly projectId: ProjectId;
    readonly missionId: DeliveryAuditEntry["missionId"];
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly action: string;
    readonly actorType: DeliveryAuditEntry["actorType"];
    readonly actorId: string | null;
    readonly sourceCommit: string | null;
    readonly publicMetadata?: DeliveryPublicMetadata;
    readonly eventType?: DeliveryOrchestrationEventType;
    readonly summary?: string;
  }) {
    const [id, occurredAt] = yield* Effect.all([uuid, nowIso]);
    const entry: DeliveryAuditEntry = {
      id: DeliveryAuditEntryId.make(id),
      projectId: input.projectId,
      missionId: input.missionId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      action: input.action,
      actorType: input.actorType,
      actorId: input.actorId,
      sourceCommit: input.sourceCommit,
      publicMetadata: input.publicMetadata ?? {},
      occurredAt,
    };
    yield* mapUnavailable("Delivery audit persistence")(repository.appendAuditEntry(entry));
    if (input.eventType !== undefined) {
      yield* eventRecorder
        .record({
          eventType: input.eventType,
          aggregateId: input.aggregateId,
          payload: {
            projectId: input.projectId,
            missionId: input.missionId,
            resourceType: input.aggregateType,
            resourceId: DeliveryAggregateId.make(input.aggregateId),
            sourceCommit: input.sourceCommit,
            summary: input.summary ?? input.action,
            occurredAt,
          },
        })
        .pipe(Effect.ignore);
    }
    yield* publishChange(input.projectId);
  });

  const getProject = Effect.fn("DeliveryWorkspaceService.getProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* mapUnavailable("Project lookup")(projects.getById({ projectId }));
    return yield* requireOption("project", projectId, project);
  });

  const getConnection = Effect.fn("DeliveryWorkspaceService.getConnection")(function* (
    connectionId: Parameters<
      typeof githubRepository.getRepositoryConnectionById
    >[0]["repositoryConnectionId"],
  ) {
    const connection = yield* mapUnavailable("GitHub repository connection lookup")(
      githubRepository.getRepositoryConnectionById({ repositoryConnectionId: connectionId }),
    );
    return yield* requireOption("repository_connection", connectionId, connection);
  });

  const githubInput = Effect.fn("DeliveryWorkspaceService.githubInput")(function* (
    connectionId: Parameters<
      typeof githubRepository.getRepositoryConnectionById
    >[0]["repositoryConnectionId"],
  ) {
    const connection = yield* getConnection(connectionId);
    const project = yield* getProject(connection.projectId);
    let hostname: string;
    try {
      hostname = new URL(connection.serverUrl).host.toLowerCase();
    } catch {
      return yield* validation("The GitHub server URL is invalid.");
    }
    return {
      connection,
      project,
      api: {
        cwd: project.workspaceRoot,
        hostname,
        owner: connection.owner,
        repository: connection.repository,
      },
    };
  });

  const captureProjectSource = Effect.fn("DeliveryWorkspaceService.captureProjectSource")(
    function* (projectId: ProjectId) {
      const project = yield* getProject(projectId);
      const authorized = yield* mapUnavailable("Delivery source authorization")(
        pathGuard.authorizeWorktree({
          assignedWorktreeRoot: project.workspaceRoot,
          registeredWorktreeRoots: [project.workspaceRoot],
        }),
      );
      return yield* mapUnavailable("Delivery source capture")(
        sourceCapture.capture({ worktree: authorized }),
      );
    },
  );

  const approvalFor = Effect.fn("DeliveryWorkspaceService.approvalFor")(function* (input: {
    readonly projectId: ProjectId;
    readonly targetId: string;
    readonly approvalType: ApprovalRequest["approvalType"];
    readonly planDigest: string;
    readonly sourceCommit: string;
    readonly required: boolean;
  }) {
    if (!input.required) return null;
    const requests = yield* mapUnavailable("Delivery approval lookup")(
      repository.listApprovalRequests(input.projectId),
    );
    const now = yield* nowIso;
    for (const request of requests) {
      if (request.targetId !== input.targetId || request.approvalType !== input.approvalType)
        continue;
      const decisions = yield* mapUnavailable("Delivery approval decision lookup")(
        repository.listApprovalDecisions(request.id),
      );
      const approvalCount = new Set(
        decisions
          .filter((decision) => decision.decision === "approve")
          .map((decision) => decision.actorId),
      ).size;
      if (
        approvalRequestIsCurrent({
          request,
          approvalCount,
          expectedPlanDigest: input.planDigest,
          expectedSourceCommit: input.sourceCommit,
          now,
        })
      ) {
        return request;
      }
    }
    return yield* conflict(
      "A current, quorum-approved request is required for this exact plan and source.",
    );
  });

  const evaluateAuthoritativeMerge = Effect.fn(
    "DeliveryWorkspaceService.evaluateAuthoritativeMerge",
  )(function* (input: AssessMergeInput) {
    const policyOption = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(input.policyId),
    );
    const policy = yield* requireOption("delivery_policy", input.policyId, policyOption);
    if (policy.projectId !== input.projectId || !policy.enabled) {
      return yield* validation("The selected delivery policy is not enabled for this project.");
    }
    const { connection, api } = yield* githubInput(input.repositoryConnectionId);
    if (connection.projectId !== input.projectId) {
      return yield* validation("The GitHub repository connection belongs to another project.");
    }
    const detail = yield* mapUnavailable("Authoritative pull request refresh")(
      githubWorkspace.getPullRequest({
        repositoryConnectionId: input.repositoryConnectionId,
        number: input.pullRequestNumber,
        refresh: true,
      }),
    );
    const source = yield* captureProjectSource(input.projectId);
    const verificationPage = yield* mapUnavailable("Verification evidence lookup")(
      verificationQuery.listRuns({
        projectId: input.projectId,
        taskId: null,
        cursor: null,
        limit: 250,
      }),
    );
    const requiredProfiles = policy.mergePolicy.requiredLocalVerificationProfiles;
    const currentRuns = verificationPage.runs.filter(
      (run) =>
        requiredProfiles.includes(run.profileId) &&
        run.commitHash === detail.pullRequest.headSha &&
        run.sourceFingerprint === source.sourceFingerprint &&
        run.invalidatedAt === null &&
        (run.result === "passed" || run.result === "passed_with_warnings"),
    );
    const passedProfiles = [...new Set(currentRuns.map((run) => run.profileId))];
    const hasWarnings = currentRuns.some((run) => run.result === "passed_with_warnings");
    const localStatus =
      requiredProfiles.length === 0
        ? "passed"
        : passedProfiles.length !== requiredProfiles.length
          ? "failed"
          : hasWarnings
            ? "passed_with_warnings"
            : "passed";
    const branch = yield* mapUnavailable("GitHub target branch lookup")(
      githubApi.getBranch({ ...api, branch: detail.pullRequest.baseRef }),
    );
    let branchProtection: Parameters<typeof evaluateMergeReadiness>[0]["branchProtection"] = {
      state: branch.data?.protected === false ? "unprotected" : "unknown",
      requiredCheckNames: [],
      requiredApprovalCount: 0,
      requireConversationResolution: false,
      allowedMergeStrategies: [],
      observedAt: detail.syncedAt,
    };
    if (branch.data?.protected === true) {
      const protection = yield* mapUnavailable("GitHub branch protection lookup")(
        githubApi.getBranchProtection({ ...api, branch: detail.pullRequest.baseRef }),
      );
      if (protection.data !== null) {
        branchProtection = {
          state: "protected",
          requiredCheckNames: protection.data.requiredStatusChecks?.contexts ?? [],
          requiredApprovalCount: protection.data.requiredApprovingReviewCount,
          requireConversationResolution: protection.data.requireConversationResolution,
          allowedMergeStrategies: [],
          observedAt: detail.syncedAt,
        };
      }
    }
    const remoteRepository = yield* mapUnavailable("GitHub repository capability lookup")(
      githubApi.getRepository(api),
    );
    if (remoteRepository.data !== null) {
      branchProtection = {
        ...branchProtection,
        allowedMergeStrategies: remoteRepository.data.allowedMergeStrategies,
      };
    }
    const evaluation = evaluateMergeReadiness({
      pullRequest: detail.pullRequest,
      expectedHeadSha: input.expectedHeadSha,
      expectedBaseSha: input.expectedBaseSha,
      strategy: input.strategy,
      policy: policy.mergePolicy,
      localVerification: {
        status: localStatus,
        fingerprintCurrent:
          !policy.mergePolicy.requireCurrentVerificationFingerprint ||
          requiredProfiles.length === 0 ||
          (passedProfiles.length === requiredProfiles.length &&
            currentRuns.every((run) => run.sourceFingerprint === source.sourceFingerprint)),
        requiredProfiles,
        passedProfiles,
        evidenceReferences: currentRuns.map(
          (run) => `verification:${run.id}:${run.sourceFingerprint}`,
        ),
      },
      checks: detail.checks,
      reviews: detail.reviews,
      threads: detail.threads,
      branchProtection,
      repositoryPermission: connection.permissions.level,
      secretScan: {
        status: input.secretScan.status,
        evidenceReferences: input.secretScan.evidence,
      },
      deliveryWindow: input.deliveryWindow,
    });
    return { policy, detail, source, evaluation, currentRuns };
  });

  const getWorkspace: DeliveryWorkspaceServiceShape["getWorkspace"] = Effect.fn(
    "DeliveryWorkspaceService.getWorkspace",
  )(function* (projectId) {
    yield* getProject(projectId);
    return yield* mapUnavailable("Delivery workspace lookup")(
      repository.getWorkspaceSnapshot(projectId),
    );
  });

  const savePolicy: DeliveryWorkspaceServiceShape["savePolicy"] = Effect.fn(
    "DeliveryWorkspaceService.savePolicy",
  )(function* ({ policy }) {
    yield* getProject(policy.projectId);
    yield* mapUnavailable("Delivery policy persistence")(repository.savePolicy(policy));
    yield* appendAudit({
      projectId: policy.projectId,
      missionId: null,
      aggregateType: "delivery_policy",
      aggregateId: policy.id,
      action: "policy.saved",
      actorType: "user",
      actorId: null,
      sourceCommit: null,
      publicMetadata: { version: policy.version, digest: policy.policyDigest },
    });
    return policy;
  });

  const saveReleaseConfiguration: DeliveryWorkspaceServiceShape["saveReleaseConfiguration"] =
    Effect.fn("DeliveryWorkspaceService.saveReleaseConfiguration")(function* ({ configuration }) {
      yield* getProject(configuration.projectId);
      yield* mapUnavailable("Release configuration persistence")(
        repository.saveReleaseConfiguration(configuration),
      );
      yield* appendAudit({
        projectId: configuration.projectId,
        missionId: null,
        aggregateType: "release_configuration",
        aggregateId: configuration.id,
        action: "release.configuration_saved",
        actorType: "user",
        actorId: null,
        sourceCommit: null,
        publicMetadata: { digest: configuration.configurationDigest },
      });
      return configuration;
    });

  const saveDeploymentEnvironment: DeliveryWorkspaceServiceShape["saveDeploymentEnvironment"] =
    Effect.fn("DeliveryWorkspaceService.saveDeploymentEnvironment")(function* ({ environment }) {
      yield* getProject(environment.projectId);
      yield* mapUnavailable("Deployment environment persistence")(
        repository.saveDeploymentEnvironment(environment),
      );
      yield* appendAudit({
        projectId: environment.projectId,
        missionId: null,
        aggregateType: "deployment_environment",
        aggregateId: environment.id,
        action: "deployment.environment_saved",
        actorType: "user",
        actorId: null,
        sourceCommit: null,
        eventType: "deployment.environment_created",
        publicMetadata: { tier: environment.tier, providerType: environment.providerType },
      });
      return environment;
    });

  const assessMerge: DeliveryWorkspaceServiceShape["assessMerge"] = Effect.fn(
    "DeliveryWorkspaceService.assessMerge",
  )(function* (input) {
    const observed = yield* evaluateAuthoritativeMerge(input);
    const [id, observedAt] = yield* Effect.all([uuid, nowIso]);
    const assessment: MergeReadinessAssessment = {
      id: MergeReadinessAssessmentId.make(id),
      projectId: input.projectId,
      missionId: input.missionId,
      repositoryConnectionId: input.repositoryConnectionId,
      pullRequestRecordId: observed.detail.pullRequest.id,
      deliveryPolicyId: observed.policy.id,
      policyDigest: observed.policy.policyDigest,
      headSha: observed.detail.pullRequest.headSha,
      baseSha: observed.detail.pullRequest.baseSha,
      sourceCommit: observed.detail.pullRequest.headSha,
      sourceFingerprint: observed.source.sourceFingerprint,
      verificationRunId: observed.currentRuns[0]?.id ?? null,
      result: observed.evaluation.result,
      states: observed.evaluation.states,
      blockingReasons: observed.evaluation.blockingReasons,
      warningReasons: observed.evaluation.warningReasons,
      evidenceSnapshot: observed.evaluation.evidenceSnapshot,
      observedAt,
      expiresAt: null,
      invalidatedAt: null,
    };
    yield* mapUnavailable("Merge readiness persistence")(
      repository.saveMergeReadinessAssessment(assessment),
    );
    yield* appendAudit({
      projectId: assessment.projectId,
      missionId: assessment.missionId,
      aggregateType: "merge_readiness_assessment",
      aggregateId: assessment.id,
      action: `delivery.readiness_${assessment.result}`,
      actorType: "system",
      actorId: null,
      sourceCommit: assessment.sourceCommit,
      eventType:
        assessment.result === "blocked" || assessment.result === "unknown"
          ? "delivery.blocked"
          : "delivery.readiness_completed",
      publicMetadata: { result: assessment.result, policyDigest: assessment.policyDigest },
    });
    return assessment;
  });

  const requestApproval: DeliveryWorkspaceServiceShape["requestApproval"] = Effect.fn(
    "DeliveryWorkspaceService.requestApproval",
  )(function* (input) {
    const policy = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(input.policyId),
    );
    const selectedPolicy = yield* requireOption("delivery_policy", input.policyId, policy);
    if (selectedPolicy.projectId !== input.projectId) {
      return yield* validation("The approval policy belongs to another project.");
    }
    const [id, requestedAt] = yield* Effect.all([uuid, nowIso]);
    const request: ApprovalRequest = {
      id: DeliveryApprovalRequestId.make(id),
      projectId: input.projectId,
      missionId: input.missionId,
      deliveryPolicyId: input.policyId,
      approvalType: input.approvalType,
      targetType: input.targetType,
      targetId: input.targetId,
      planDigest: input.planDigest,
      sourceCommit: input.sourceCommit,
      status: "pending",
      requiredDecisionCount: input.requiredDecisionCount,
      policySnapshot: input.policySnapshot,
      contextSnapshot: input.contextSnapshot,
      requestedBy: input.requestedBy,
      requestedAt,
      resolvedAt: null,
      expiresAt: input.expiresAt,
    };
    yield* mapUnavailable("Approval request persistence")(repository.saveApprovalRequest(request));
    yield* appendAudit({
      projectId: request.projectId,
      missionId: request.missionId,
      aggregateType: "approval_request",
      aggregateId: request.id,
      action: "approval.requested",
      actorType: "user",
      actorId: request.requestedBy,
      sourceCommit: request.sourceCommit,
      eventType: "approval.requested",
      publicMetadata: { approvalType: request.approvalType, planDigest: request.planDigest },
    });
    return request;
  });

  const decideApproval: DeliveryWorkspaceServiceShape["decideApproval"] = Effect.fn(
    "DeliveryWorkspaceService.decideApproval",
  )(function* (input) {
    const option = yield* mapUnavailable("Approval request lookup")(
      repository.getApprovalRequest(input.approvalRequestId),
    );
    const request = yield* requireOption("approval_request", input.approvalRequestId, option);
    const id = yield* uuid;
    const decision: ApprovalDecision = {
      id: ApprovalDecisionId.make(id),
      approvalRequestId: request.id,
      actorId: input.actorId,
      actorType: input.actorType,
      decision: input.decision,
      reason: input.reason,
      planDigest: request.planDigest,
      sourceCommit: request.sourceCommit,
      decidedAt: input.decidedAt,
    };
    const binding = validateApprovalDecisionBinding({ request, decision, now: yield* nowIso });
    if (!binding.allowed) return yield* conflict(binding.reason);
    const result = yield* mapUnavailable("Approval decision persistence")(
      repository.recordApprovalDecision(decision),
    );
    yield* appendAudit({
      projectId: request.projectId,
      missionId: request.missionId,
      aggregateType: "approval_request",
      aggregateId: request.id,
      action: `approval.${input.decision}`,
      actorType: input.actorType === "system" ? "system" : "user",
      actorId: input.actorId,
      sourceCommit: request.sourceCommit,
      eventType: input.decision === "approve" ? "approval.approved" : "approval.rejected",
      publicMetadata: { decision: input.decision, planDigest: request.planDigest },
    });
    return result;
  });

  const executeMerge: DeliveryWorkspaceServiceShape["executeMerge"] = Effect.fn(
    "DeliveryWorkspaceService.executeMerge",
  )(function* (input) {
    const assessmentOption = yield* mapUnavailable("Merge readiness lookup")(
      repository.getMergeReadinessAssessment(input.readinessAssessmentId),
    );
    const assessment = yield* requireOption(
      "merge_readiness_assessment",
      input.readinessAssessmentId,
      assessmentOption,
    );
    const policyOption = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(assessment.deliveryPolicyId),
    );
    const policy = yield* requireOption(
      "delivery_policy",
      assessment.deliveryPolicyId,
      policyOption,
    );
    const approval = yield* approvalFor({
      projectId: assessment.projectId,
      targetId: assessment.id,
      approvalType: "merge",
      planDigest: assessment.policyDigest,
      sourceCommit: assessment.sourceCommit,
      required: policy.mergePolicy.requiredApprovalCount > 0,
    });
    const { api } = yield* githubInput(assessment.repositoryConnectionId);
    const pullRequestRecord = yield* mapUnavailable("Pull request record lookup")(
      githubRepository.getPullRequestById({ pullRequestRecordId: assessment.pullRequestRecordId }),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("pull_request", assessment.pullRequestRecordId, value),
      ),
    );
    const detail = yield* mapUnavailable("Pull request lookup")(
      githubWorkspace.getPullRequest({
        repositoryConnectionId: assessment.repositoryConnectionId,
        number: pullRequestRecord.number,
        refresh: true,
      }),
    );
    if (detail.pullRequest.id !== assessment.pullRequestRecordId) {
      return yield* conflict(
        "The authoritative pull request no longer matches the readiness record.",
      );
    }
    const [id, createdAt] = yield* Effect.all([uuid, nowIso]);
    const execution: MergeExecution = {
      id: MergeExecutionId.make(id),
      idempotencyKey: `merge:${assessment.id}:${assessment.headSha}:${assessment.evidenceSnapshot.strategy}`,
      projectId: assessment.projectId,
      missionId: assessment.missionId,
      repositoryConnectionId: assessment.repositoryConnectionId,
      pullRequestRecordId: assessment.pullRequestRecordId,
      readinessAssessmentId: assessment.id,
      approvalRequestId: approval?.id ?? null,
      deliveryPolicyId: assessment.deliveryPolicyId,
      mergeStrategy: assessment.evidenceSnapshot.strategy,
      expectedHeadSha: assessment.headSha,
      expectedBaseSha: assessment.baseSha,
      sourceCommit: assessment.sourceCommit,
      status: "queued",
      remoteMergeSha: null,
      errorCode: null,
      errorMessage: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    };
    let acceptedMergeSha: string | null = null;
    const completed = yield* executeControlledMerge({
      execution,
      dependencies: {
        persist: (next) =>
          mapUnavailable("Merge execution persistence")(repository.saveMergeExecution(next)),
        refreshAndAssess: () =>
          Effect.gen(function* () {
            const refreshed = yield* evaluateAuthoritativeMerge({
              projectId: assessment.projectId,
              policyId: assessment.deliveryPolicyId,
              repositoryConnectionId: assessment.repositoryConnectionId,
              pullRequestNumber: detail.pullRequest.number,
              missionId: assessment.missionId,
              expectedHeadSha: assessment.headSha,
              expectedBaseSha: assessment.baseSha,
              strategy: assessment.evidenceSnapshot.strategy,
              secretScan: {
                status:
                  assessment.states.secretScan === "passed"
                    ? "passed"
                    : assessment.states.secretScan === "blocked"
                      ? "failed"
                      : "unknown",
                evidence: assessment.evidenceSnapshot.secretScanEvidence,
              },
              deliveryWindow: {
                state:
                  assessment.states.deliveryWindow === "passed"
                    ? "allowed"
                    : assessment.states.deliveryWindow === "blocked"
                      ? "outside_window"
                      : "unknown",
                policyReference: assessment.evidenceSnapshot.deliveryWindowPolicyReference,
              },
            });
            const currentApproval = yield* approvalFor({
              projectId: assessment.projectId,
              targetId: assessment.id,
              approvalType: "merge",
              planDigest: assessment.policyDigest,
              sourceCommit: assessment.sourceCommit,
              required: policy.mergePolicy.requiredApprovalCount > 0,
            }).pipe(Effect.option);
            return {
              readiness: assessment.invalidatedAt === null ? refreshed.evaluation.result : "stale",
              headSha: refreshed.detail.pullRequest.headSha,
              baseSha: refreshed.detail.pullRequest.baseSha,
              approvalCurrent:
                !policy.mergePolicy.requiredApprovalCount || Option.isSome(currentApproval),
              policyAllowsStrategy: policy.mergePolicy.allowedMergeStrategies.includes(
                execution.mergeStrategy,
              ),
            };
          }),
        mergeExactHead: ({ expectedHeadSha, strategy }) =>
          githubApi
            .mergePullRequest({
              ...api,
              number: detail.pullRequest.number,
              expectedHeadSha,
              strategy,
              retry: { maxRetries: 0 },
            })
            .pipe(
              Effect.map((result) => ({
                accepted: result.data?.merged === true,
                mergedCommitSha: (acceptedMergeSha = result.data?.mergedCommitSha ?? null),
                failureSummary: result.data?.message ?? null,
                outcomeAmbiguous: false,
              })),
              Effect.catch((error) =>
                Effect.succeed({
                  accepted: false,
                  mergedCommitSha: null,
                  failureSummary: error.message,
                  outcomeAmbiguous:
                    error._tag === "GitHubApiTransportError" ||
                    (error._tag === "GitHubApiResponseError" && error.kind === "transient"),
                }),
              ),
            ),
        confirmRemote: () =>
          githubWorkspace
            .getPullRequest({
              repositoryConnectionId: assessment.repositoryConnectionId,
              number: detail.pullRequest.number,
              refresh: true,
            })
            .pipe(
              Effect.map((fresh) => ({
                state: fresh.pullRequest.state,
                headSha: fresh.pullRequest.headSha,
                mergedCommitSha: fresh.pullRequest.state === "merged" ? acceptedMergeSha : null,
              })),
              Effect.catch(() =>
                Effect.succeed({
                  state: "unknown" as const,
                  headSha: assessment.headSha,
                  mergedCommitSha: null,
                }),
              ),
            ),
        now: () => nowIso,
      },
    });
    yield* appendAudit({
      projectId: completed.projectId,
      missionId: completed.missionId,
      aggregateType: "merge_execution",
      aggregateId: completed.id,
      action: `merge.${completed.status}`,
      actorType: "user",
      actorId: input.requestedBy,
      sourceCommit: completed.sourceCommit,
      eventType: completed.status === "succeeded" ? "merge.completed" : "merge.failed",
      publicMetadata: {
        status: completed.status,
        strategy: completed.mergeStrategy,
        remoteMergeSha: completed.remoteMergeSha,
      },
    });
    return completed;
  });

  const proposeReleasePlan: DeliveryWorkspaceServiceShape["proposeReleasePlan"] = Effect.fn(
    "DeliveryWorkspaceService.proposeReleasePlan",
  )(function* (input) {
    yield* getProject(input.projectId);
    const configuration = yield* mapUnavailable("Release configuration lookup")(
      repository.getReleaseConfiguration(input.releaseConfigurationId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("release_configuration", input.releaseConfigurationId, value),
      ),
    );
    if (configuration.projectId !== input.projectId || !configuration.enabled) {
      return yield* validation("The release configuration is not enabled for this project.");
    }
    const policy = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(input.deliveryPolicyId),
    ).pipe(
      Effect.flatMap((value) => requireOption("delivery_policy", input.deliveryPolicyId, value)),
    );
    if (policy.projectId !== input.projectId || !policy.enabled) {
      return yield* validation("The delivery policy is not enabled for this project.");
    }
    if (!policy.releasePolicy.allowedChannels.includes(configuration.releaseChannel)) {
      return yield* validation("The release channel is not allowed by the selected policy.");
    }

    const mission =
      input.missionId === null
        ? null
        : yield* mapUnavailable("Mission lookup")(
            missions.getById({ missionId: input.missionId }),
          ).pipe(Effect.flatMap((value) => requireOption("mission", input.missionId!, value)));
    if (mission !== null && mission.projectId !== input.projectId) {
      return yield* validation("The mission belongs to another project.");
    }
    const tasks =
      mission === null
        ? []
        : yield* mapUnavailable("Mission task lookup")(
            missionTasks.listByMissionId({ missionId: mission.id }),
          );
    const links =
      mission === null
        ? []
        : yield* mapUnavailable("Mission pull request link lookup")(
            githubRepository.listMissionPullRequestLinks({
              missionId: mission.id,
              pullRequestRecordId: null,
            }),
          );
    const pullRequestOptions = yield* Effect.forEach(links, (link) =>
      mapUnavailable("Pull request lookup")(
        githubRepository.getPullRequestById({ pullRequestRecordId: link.pullRequestRecordId }),
      ),
    );
    const pullRequests = pullRequestOptions.flatMap((value) =>
      Option.isSome(value) ? [value.value] : [],
    );
    const source = yield* captureProjectSource(input.projectId);
    if (source.commitHash === null || source.dirtyStateFingerprint !== null) {
      return yield* conflict("Release planning requires a committed, clean project source.");
    }
    const verificationPage = yield* mapUnavailable("Verification evidence lookup")(
      verificationQuery.listRuns({
        projectId: input.projectId,
        taskId: null,
        cursor: null,
        limit: 250,
      }),
    );
    const candidateEvidence = yield* Effect.forEach(
      verificationPage.runs.filter(
        (run) =>
          run.result === "passed" &&
          run.invalidatedAt === null &&
          run.commitHash === source.commitHash &&
          run.sourceFingerprint === source.sourceFingerprint,
      ),
      (run) =>
        mapUnavailable("Verification evidence lookup")(verificationQuery.getRunEvidence(run.id)),
      { concurrency: 4 },
    );
    const verification = selectCurrentReleaseVerification(
      candidateEvidence.map((evidence) => evidence.run),
      source,
    );
    if (verification === null) {
      return yield* conflict(
        "Release planning requires a passing full-profile verification for the exact current source.",
      );
    }
    const narrative = releaseEvidenceNarrative({
      mission,
      tasks,
      pullRequests,
      verification,
      supplement: input.releaseNotesSupplement,
    });
    const priorPlans = yield* mapUnavailable("Release plan history lookup")(
      repository.listReleasePlans(input.projectId),
    );
    const latestVersion = priorPlans
      .filter((plan) => plan.releaseConfigurationId === configuration.id)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]?.version;
    const configuredVersion = metadataString(configuration.publicMetadata, "currentVersion");
    const currentVersion = latestVersion ?? configuredVersion ?? "0.0.0";
    const proposalKind =
      configuration.versionStrategy === "calendar"
        ? ("calendar" as const)
        : configuration.versionStrategy === "semantic_explicit"
          ? ("explicit_semver" as const)
          : ("manual" as const);
    const proposedAt = yield* nowIso;
    const planned = planRelease({
      proposalKind,
      currentVersion,
      ...(input.requestedVersion === null ? {} : { requestedVersion: input.requestedVersion }),
      ...(input.bump === null ? {} : { bump: input.bump }),
      proposedAt,
      tagPrefix: tagPrefixFromPattern(configuration.tagPattern),
      evidence: {
        sourceFingerprint: source.sourceFingerprint,
        commitSha: source.commitHash,
        verificationRunId: verification.id,
        verificationResult: "passed",
        authorizationScope: "full_profile",
      },
      changelogEntries: narrative.changelogEntries,
      releaseNotes: narrative.releaseNotes,
    });
    if (!planned.accepted) return yield* validation(planned.detail);
    const id = ReleasePlanId.make(yield* uuid);
    const approvalRequired = policy.releasePolicy.requiresApproval;
    const plan: ReleasePlan = {
      id,
      projectId: input.projectId,
      missionId: input.missionId,
      releaseConfigurationId: configuration.id,
      deliveryPolicyId: policy.id,
      planDigest: planned.plan.planFingerprint,
      sourceCommit: planned.plan.commitSha,
      version: planned.plan.version,
      tagName: planned.plan.tag,
      releaseName: `${mission?.title ?? configuration.name} ${planned.plan.version}`.slice(0, 512),
      sourceBranch: source.branchName,
      changeSummary: narrative.changeSummary,
      changelogDraft: planned.plan.changelogEntries.map((entry) => `- ${entry}`).join("\n"),
      releaseNotesDraft: planned.plan.releaseNotes,
      includedMissions: mission === null ? [] : [mission.id],
      includedPullRequests: pullRequests.map((pullRequest) => pullRequest.id),
      artifactPlan: {
        configurationDigest: configuration.configurationDigest,
        artifactGlobs: configuration.artifactGlobs.join("\n"),
      },
      publicationPlan: {
        githubReleaseEnabled: configuration.githubReleaseEnabled,
        packagePublishingEnabled: configuration.packagePublishingEnabled,
        releaseChannel: configuration.releaseChannel,
      },
      status: approvalRequired ? "draft" : "approved",
      approvalRequestId: null,
      approvedAt: approvalRequired ? null : proposedAt,
      createdAt: proposedAt,
      updatedAt: proposedAt,
      completedAt: null,
    };
    yield* mapUnavailable("Release plan persistence")(repository.saveReleasePlan(plan));
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "release_plan",
      aggregateId: plan.id,
      action: "release.plan_created",
      actorType: "user",
      actorId: input.requestedBy,
      sourceCommit: plan.sourceCommit,
      eventType: "release.plan_created",
      publicMetadata: {
        planDigest: plan.planDigest,
        verificationRunId: verification.id,
        status: plan.status,
      },
    });
    return plan;
  });

  const saveReleasePlan: DeliveryWorkspaceServiceShape["saveReleasePlan"] = Effect.fn(
    "DeliveryWorkspaceService.saveReleasePlan",
  )(function* (plan) {
    yield* getProject(plan.projectId);
    const current = yield* mapUnavailable("Release plan lookup")(
      repository.getReleasePlan(plan.id),
    );
    if (Option.isSome(current)) {
      const mutation = validateApprovedPlanMutation({
        currentStatus: current.value.status,
        currentDigest: current.value.planDigest,
        currentSourceCommit: current.value.sourceCommit,
        nextDigest: plan.planDigest,
        nextSourceCommit: plan.sourceCommit,
      });
      if (!mutation.allowed) return yield* conflict(mutation.reason);
      const transition = validatePlanTransition(current.value.status, plan.status);
      if (!transition.allowed) return yield* conflict(transition.reason);
    }
    yield* mapUnavailable("Release plan persistence")(repository.saveReleasePlan(plan));
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "release_plan",
      aggregateId: plan.id,
      action: Option.isSome(current) ? "release.plan_updated" : "release.plan_created",
      actorType: "user",
      actorId: null,
      sourceCommit: plan.sourceCommit,
      eventType: Option.isSome(current) ? "release.plan_updated" : "release.plan_created",
      publicMetadata: { planDigest: plan.planDigest, status: plan.status },
    });
    return plan;
  });

  const publishRelease: DeliveryWorkspaceServiceShape["publishRelease"] = Effect.fn(
    "DeliveryWorkspaceService.publishRelease",
  )(function* (input) {
    const option = yield* mapUnavailable("Release plan lookup")(
      repository.getReleasePlan(input.releasePlanId),
    );
    const plan = yield* requireOption("release_plan", input.releasePlanId, option);
    if (plan.status !== "approved" && plan.status !== "interrupted") {
      return yield* conflict("Only an approved or explicitly resumed release plan can publish.");
    }
    const policy = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(plan.deliveryPolicyId),
    ).pipe(
      Effect.flatMap((value) => requireOption("delivery_policy", plan.deliveryPolicyId, value)),
    );
    const releaseWindowState = evaluateAbsoluteWindows(
      policy.releasePolicy.deliveryWindows,
      policy.releasePolicy.freezeWindows,
      yield* nowIso,
    );
    if (releaseWindowState.activeFreeze !== null) {
      return yield* conflict(
        `Release publication is frozen by ${releaseWindowState.activeFreeze.name}.`,
      );
    }
    if (!releaseWindowState.withinWindow) {
      return yield* conflict("Release publication is outside the configured delivery window.");
    }
    yield* approvalFor({
      projectId: plan.projectId,
      targetId: plan.id,
      approvalType: "release",
      planDigest: plan.planDigest,
      sourceCommit: plan.sourceCommit,
      required: policy.releasePolicy.requiresApproval,
    });
    const configuration = yield* mapUnavailable("Release configuration lookup")(
      repository.getReleaseConfiguration(plan.releaseConfigurationId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("release_configuration", plan.releaseConfigurationId, value),
      ),
    );
    if (!configuration.githubReleaseEnabled) {
      return yield* validation(
        "The selected release configuration does not enable GitHub Releases.",
      );
    }
    if (configuration.packagePublishingEnabled) {
      return yield* validation(
        "Package publication is configured, but no package publication adapter is registered.",
      );
    }
    const { connection, project, api } = yield* githubInput(input.repositoryConnectionId);
    if (connection.projectId !== plan.projectId) {
      return yield* validation("The release repository belongs to another project.");
    }
    const source = yield* captureProjectSource(plan.projectId);
    if (source.commitHash !== plan.sourceCommit || source.dirtyStateFingerprint !== null) {
      return yield* conflict(
        "Release publication requires the exact planned commit in a clean worktree.",
      );
    }
    const artifacts = yield* mapUnavailable("Release artifact lookup")(
      repository.listReleaseArtifacts(plan.id),
    );
    const preparedArtifacts = yield* Effect.forEach(artifacts, (artifact) =>
      Effect.gen(function* () {
        const integrity = yield* inspectReleaseArtifact({
          managedRoot: project.workspaceRoot,
          artifactPath: artifact.relativePath,
          sourceFingerprint: plan.planDigest,
          sourceCommitSha: plan.sourceCommit,
          generatedAt: artifact.createdAt,
          maximumSizeBytes: metadataNumber(
            configuration.artifactConfiguration,
            "maximumArtifactBytes",
            512 * 1024 * 1024,
          ),
        }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError((error) => validation(error.message)),
        );
        if (artifact.checksum !== null && artifact.checksum.toLowerCase() !== integrity.sha256) {
          return yield* conflict(
            `Artifact ${artifact.name} changed after its checksum was recorded.`,
          );
        }
        const collected = {
          ...artifact,
          relativePath: integrity.managedRelativePath,
          checksum: integrity.sha256,
          sizeBytes: integrity.sizeBytes,
          status: "collected" as const,
        };
        yield* mapUnavailable("Release artifact persistence")(
          repository.saveReleaseArtifact(collected),
        );
        return { collected, integrity };
      }),
    );
    const existingTag = yield* githubApi.getTagReference({ ...api, tagName: plan.tagName }).pipe(
      Effect.map((result) => Option.fromNullishOr(result.data)),
      Effect.catch((error) =>
        isNotFoundApiError(error)
          ? Effect.succeed(Option.none())
          : Effect.fail(unavailable("Tag lookup", error)),
      ),
    );
    if (Option.isSome(existingTag) && existingTag.value.objectSha !== plan.sourceCommit) {
      return yield* conflict(
        "The release tag already exists and points at a different source commit.",
      );
    }
    const existingRelease = yield* githubApi
      .getReleaseByTag({ ...api, tagName: plan.tagName })
      .pipe(
        Effect.map((result) => Option.fromNullishOr(result.data)),
        Effect.catch((error) =>
          isNotFoundApiError(error)
            ? Effect.succeed(Option.none())
            : Effect.fail(unavailable("GitHub release lookup", error)),
        ),
      );
    if (Option.isSome(existingRelease) && Option.isNone(existingTag)) {
      return yield* conflict(
        "GitHub reports a release without a confirmable immutable tag reference.",
      );
    }
    const executingAt = yield* nowIso;
    const executing: ReleasePlan = { ...plan, status: "executing", updatedAt: executingAt };
    yield* mapUnavailable("Release plan persistence")(repository.saveReleasePlan(executing));
    const failPublication = Effect.fn("DeliveryWorkspaceService.failReleasePublication")(function* (
      error: DeliveryServiceError,
    ) {
      const failedAt = yield* nowIso;
      yield* repository
        .saveReleasePlan({ ...executing, status: "failed", updatedAt: failedAt })
        .pipe(Effect.ignore);
      return yield* error;
    });
    const release = Option.isSome(existingRelease)
      ? existingRelease.value
      : yield* mapUnavailable("GitHub release publication")(
          githubApi.createRelease({
            ...api,
            tagName: plan.tagName,
            targetCommitish: plan.sourceCommit,
            name: plan.releaseName,
            body: plan.releaseNotesDraft,
            draft: input.draft,
            prerelease: input.prerelease,
            retry: { maxRetries: 0 },
          }),
        ).pipe(
          Effect.flatMap((result) =>
            result.data === null
              ? Effect.fail(unavailable("GitHub release publication", "empty response"))
              : Effect.succeed(result.data),
          ),
          Effect.catch(failPublication),
        );
    for (const { collected, integrity } of preparedArtifacts) {
      yield* mapUnavailable("GitHub release artifact upload")(
        githubApi.uploadReleaseArtifact({
          ...api,
          tagName: plan.tagName,
          artifactPath: path.resolve(project.workspaceRoot, integrity.managedRelativePath),
          displayName: collected.name,
        }),
      ).pipe(
        Effect.catch((error) =>
          repository
            .saveReleaseArtifact({ ...collected, status: "failed" })
            .pipe(Effect.ignore, Effect.andThen(failPublication(error))),
        ),
      );
      yield* mapUnavailable("Release artifact persistence")(
        repository.saveReleaseArtifact({
          ...collected,
          status: "published",
          remoteUrl: release.htmlUrl,
          publishedAt: yield* nowIso,
        }),
      );
    }
    const completedAt = yield* nowIso;
    const completed: ReleasePlan = {
      ...executing,
      status: "completed",
      updatedAt: completedAt,
      completedAt,
    };
    yield* mapUnavailable("Release plan persistence")(repository.saveReleasePlan(completed));
    yield* appendAudit({
      projectId: completed.projectId,
      missionId: completed.missionId,
      aggregateType: "release_plan",
      aggregateId: completed.id,
      action: "release.published",
      actorType: "system",
      actorId: null,
      sourceCommit: completed.sourceCommit,
      eventType: "release.published",
      publicMetadata: { tagName: completed.tagName, releaseUrl: release.htmlUrl },
    });
    return completed;
  });

  const proposeDeploymentPlan: DeliveryWorkspaceServiceShape["proposeDeploymentPlan"] = Effect.fn(
    "DeliveryWorkspaceService.proposeDeploymentPlan",
  )(function* (input) {
    yield* getProject(input.projectId);
    const environment = yield* mapUnavailable("Deployment environment lookup")(
      repository.getDeploymentEnvironment(input.deploymentEnvironmentId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("deployment_environment", input.deploymentEnvironmentId, value),
      ),
    );
    const policy = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(input.deliveryPolicyId),
    ).pipe(
      Effect.flatMap((value) => requireOption("delivery_policy", input.deliveryPolicyId, value)),
    );
    if (environment.projectId !== input.projectId || environment.status !== "active") {
      return yield* validation("The deployment environment is not active for this project.");
    }
    if (policy.projectId !== input.projectId || !policy.enabled) {
      return yield* validation("The delivery policy is not enabled for this project.");
    }
    if (!policy.deploymentPolicy.allowedStrategies.includes(input.strategy)) {
      return yield* validation("The deployment strategy is not allowed by the selected policy.");
    }
    if (input.missionId !== null) {
      const mission = yield* mapUnavailable("Mission lookup")(
        missions.getById({ missionId: input.missionId }),
      ).pipe(Effect.flatMap((value) => requireOption("mission", input.missionId!, value)));
      if (mission.projectId !== input.projectId) {
        return yield* validation("The mission belongs to another project.");
      }
    }

    let releasePlan: ReleasePlan | null = null;
    let sourceCommit: string;
    let sourceFingerprint: string;
    let sourceReference: string;
    let sourceType: DeploymentPlan["sourceType"];
    if (input.releasePlanId !== null) {
      releasePlan = yield* mapUnavailable("Release plan lookup")(
        repository.getReleasePlan(input.releasePlanId),
      ).pipe(Effect.flatMap((value) => requireOption("release_plan", input.releasePlanId!, value)));
      if (releasePlan.projectId !== input.projectId || releasePlan.status !== "completed") {
        return yield* conflict("Deployment from a release requires a completed project release.");
      }
      sourceCommit = releasePlan.sourceCommit;
      sourceFingerprint = releasePlan.planDigest;
      sourceReference = releasePlan.tagName;
      sourceType = "release";
    } else {
      const source = yield* captureProjectSource(input.projectId);
      if (source.commitHash === null || source.dirtyStateFingerprint !== null) {
        return yield* conflict("Deployment planning requires a committed, clean project source.");
      }
      const verificationPage = yield* mapUnavailable("Verification evidence lookup")(
        verificationQuery.listRuns({
          projectId: input.projectId,
          taskId: null,
          cursor: null,
          limit: 250,
        }),
      );
      const candidateEvidence = yield* Effect.forEach(
        verificationPage.runs.filter(
          (run) =>
            run.result === "passed" &&
            run.invalidatedAt === null &&
            run.commitHash === source.commitHash &&
            run.sourceFingerprint === source.sourceFingerprint,
        ),
        (run) =>
          mapUnavailable("Verification evidence lookup")(verificationQuery.getRunEvidence(run.id)),
        { concurrency: 4 },
      );
      if (
        selectCurrentReleaseVerification(
          candidateEvidence.map((evidence) => evidence.run),
          source,
        ) === null
      ) {
        return yield* conflict(
          "Deployment planning requires a passing full-profile verification for the exact current source.",
        );
      }
      sourceCommit = source.commitHash;
      sourceFingerprint = source.sourceFingerprint;
      sourceReference = source.commitHash;
      sourceType = "commit";
    }
    const configurationSnapshot = deploymentConfigurationSnapshot({
      environmentDigest: environment.configurationDigest,
      policyDigest: policy.policyDigest,
      sourceFingerprint,
      environmentMetadata: environment.publicMetadata,
    });
    const configuration: DeliveryPublicMetadata = {
      environmentName: environment.name,
      environmentTier: environment.tier,
      provider: environment.provider,
      providerType: environment.providerType,
    };
    const unsigned = {
      projectId: input.projectId,
      missionId: input.missionId,
      releasePlanId: input.releasePlanId,
      deploymentEnvironmentId: environment.id,
      deliveryPolicyId: policy.id,
      sourceCommit,
      sourceType,
      sourceReference,
      strategy: input.strategy,
      configuration,
      configurationSnapshot,
      validationProfileId: input.validationProfileId,
    };
    const createdAt = yield* nowIso;
    const approvalRequired =
      environment.requiresApproval ||
      policy.deploymentPolicy.requiresApproval ||
      (environment.tier === "production" && policy.deploymentPolicy.productionRequiresApproval);
    const plan: DeploymentPlan = {
      id: DeploymentPlanId.make(yield* uuid),
      ...unsigned,
      planDigest: proposalDigest(unsigned),
      rollbackPlanId: null,
      status: approvalRequired ? "draft" : "approved",
      approvalRequestId: null,
      approvedAt: approvalRequired ? null : createdAt,
      createdAt,
      updatedAt: createdAt,
    };
    yield* mapUnavailable("Deployment plan persistence")(repository.saveDeploymentPlan(plan));
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "deployment_plan",
      aggregateId: plan.id,
      action: "deployment.plan_created",
      actorType: "user",
      actorId: input.requestedBy,
      sourceCommit: plan.sourceCommit,
      eventType: "deployment.plan_created",
      publicMetadata: {
        planDigest: plan.planDigest,
        environmentId: environment.id,
        status: plan.status,
      },
    });
    return plan;
  });

  const saveDeploymentPlan: DeliveryWorkspaceServiceShape["saveDeploymentPlan"] = Effect.fn(
    "DeliveryWorkspaceService.saveDeploymentPlan",
  )(function* (plan) {
    yield* getProject(plan.projectId);
    const current = yield* mapUnavailable("Deployment plan lookup")(
      repository.getDeploymentPlan(plan.id),
    );
    if (Option.isSome(current)) {
      const mutation = validateApprovedPlanMutation({
        currentStatus: current.value.status,
        currentDigest: current.value.planDigest,
        currentSourceCommit: current.value.sourceCommit,
        nextDigest: plan.planDigest,
        nextSourceCommit: plan.sourceCommit,
      });
      if (!mutation.allowed) return yield* conflict(mutation.reason);
      const transition = validatePlanTransition(current.value.status, plan.status);
      if (!transition.allowed) return yield* conflict(transition.reason);
    }
    yield* mapUnavailable("Deployment plan persistence")(repository.saveDeploymentPlan(plan));
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "deployment_plan",
      aggregateId: plan.id,
      action: "deployment.plan_saved",
      actorType: "user",
      actorId: null,
      sourceCommit: plan.sourceCommit,
      eventType: "deployment.plan_created",
      publicMetadata: { planDigest: plan.planDigest, strategy: plan.strategy },
    });
    return plan;
  });

  const adapterFor = Effect.fn("DeliveryWorkspaceService.adapterFor")(function* (
    environment: DeploymentEnvironment,
    projectRoot: string,
  ) {
    if (environment.providerType !== REPOSITORY_SCRIPT_PROVIDER_KIND) {
      return yield* validation(
        `No truthful deployment adapter is registered for ${environment.providerType}.`,
      );
    }
    const executable = metadataString(environment.configurationMetadata, "scriptExecutable");
    if (executable === undefined) return yield* validation("scriptExecutable is required.");
    const authorized = yield* mapUnavailable("Deployment worktree authorization")(
      pathGuard.authorizeWorktree({
        assignedWorktreeRoot: projectRoot,
        registeredWorktreeRoots: [projectRoot],
      }),
    );
    const workingDirectory = yield* mapUnavailable("Deployment working directory resolution")(
      pathGuard.resolveDirectory({
        worktree: authorized,
        relativePath: metadataString(
          environment.configurationMetadata,
          "scriptWorkingDirectory",
          ".",
        )!,
      }),
    );
    const args = parseStringArray(
      metadataString(environment.configurationMetadata, "scriptArgumentsJson", "[]"),
      "scriptArgumentsJson",
    );
    return yield* makeRepositoryScriptDeploymentAdapter({
      executable,
      args,
      workingDirectory,
      timeoutSeconds: metadataNumber(
        environment.configurationMetadata,
        "scriptTimeoutSeconds",
        900,
      ),
      maximumLogBytes: metadataNumber(
        environment.configurationMetadata,
        "maximumLogBytes",
        1024 * 1024,
      ),
      environment: [],
    }).pipe(
      Effect.provideService(VerificationProcessRunner, processRunner),
      Effect.mapError((error) => validation(error.message)),
    );
  });

  const executeDeployment: DeliveryWorkspaceServiceShape["executeDeployment"] = Effect.fn(
    "DeliveryWorkspaceService.executeDeployment",
  )(function* (input) {
    const plan = yield* mapUnavailable("Deployment plan lookup")(
      repository.getDeploymentPlan(input.deploymentPlanId),
    ).pipe(
      Effect.flatMap((value) => requireOption("deployment_plan", input.deploymentPlanId, value)),
    );
    if (plan.status !== "approved" && plan.status !== "interrupted") {
      return yield* conflict("Only an approved or explicitly resumed deployment plan can execute.");
    }
    if (!/^[a-f0-9]{64}$/i.test(plan.planDigest)) {
      return yield* validation("Deployment plan digests must be SHA-256 fingerprints.");
    }
    const environment = yield* mapUnavailable("Deployment environment lookup")(
      repository.getDeploymentEnvironment(plan.deploymentEnvironmentId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("deployment_environment", plan.deploymentEnvironmentId, value),
      ),
    );
    if (environment.status !== "active")
      return yield* conflict("The deployment environment is not active.");
    const policy = yield* mapUnavailable("Delivery policy lookup")(
      repository.getPolicy(plan.deliveryPolicyId),
    ).pipe(
      Effect.flatMap((value) => requireOption("delivery_policy", plan.deliveryPolicyId, value)),
    );
    if (!policy.deploymentPolicy.allowedStrategies.includes(plan.strategy)) {
      return yield* conflict("The deployment strategy is not allowed by policy.");
    }
    const deploymentWindowState = evaluateAbsoluteWindows(
      policy.deploymentPolicy.deliveryWindows,
      policy.deploymentPolicy.freezeWindows,
      yield* nowIso,
    );
    if (deploymentWindowState.activeFreeze !== null) {
      return yield* conflict(`Deployment is frozen by ${deploymentWindowState.activeFreeze.name}.`);
    }
    if (!deploymentWindowState.withinWindow) {
      return yield* conflict("Deployment is outside the configured delivery window.");
    }
    if (environment.windowPolicy.freezeActive === true) {
      return yield* conflict("The deployment environment reports an active freeze.");
    }
    if (environment.windowPolicy.deliveryAllowed === false) {
      return yield* conflict("The deployment environment is outside its delivery window.");
    }
    const approvalType = environment.tier === "production" ? "production_deployment" : "deployment";
    yield* approvalFor({
      projectId: plan.projectId,
      targetId: plan.id,
      approvalType,
      planDigest: plan.planDigest,
      sourceCommit: plan.sourceCommit,
      required:
        environment.requiresApproval ||
        policy.deploymentPolicy.requiresApproval ||
        (environment.tier === "production" && policy.deploymentPolicy.productionRequiresApproval),
    });
    const releasePlanId = plan.releasePlanId;
    if (releasePlanId !== null) {
      const releasePlan = yield* mapUnavailable("Deployment release source lookup")(
        repository.getReleasePlan(releasePlanId),
      ).pipe(Effect.flatMap((value) => requireOption("release_plan", releasePlanId, value)));
      if (releasePlan.status !== "completed" || releasePlan.sourceCommit !== plan.sourceCommit) {
        return yield* conflict(
          "Deployment requires a completed release for the exact planned source commit.",
        );
      }
    } else {
      const source = yield* captureProjectSource(plan.projectId);
      if (source.commitHash !== plan.sourceCommit || source.dirtyStateFingerprint !== null) {
        return yield* conflict("Deployment requires the exact planned commit in a clean worktree.");
      }
    }
    const project = yield* getProject(plan.projectId);
    const adapter = yield* adapterFor(environment, project.workspaceRoot);
    if (!adapter.capabilities.strategies.includes(plan.strategy)) {
      return yield* validation(
        `The ${environment.providerType} adapter does not support ${plan.strategy}.`,
      );
    }
    const prior = yield* mapUnavailable("Deployment execution lookup")(
      repository.listDeploymentExecutions(plan.id),
    );
    const [id, createdAt] = yield* Effect.all([uuid, nowIso]);
    let execution: DeploymentExecution = {
      id: DeploymentExecutionId.make(id),
      deploymentPlanId: plan.id,
      idempotencyKey: `deployment:${plan.id}:${plan.planDigest}:${prior.length + 1}`,
      attemptNumber: prior.length + 1,
      sourceCommit: plan.sourceCommit,
      status: "preparing",
      providerState: { providerType: environment.providerType },
      remoteExecutionId: null,
      endpoint: null,
      deploymentUrl: null,
      logReference: null,
      errorCode: null,
      errorMessage: null,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
    };
    yield* mapUnavailable("Deployment intent persistence")(
      repository.saveDeploymentExecution(execution),
    );
    yield* mapUnavailable("Deployment plan persistence")(
      repository.saveDeploymentPlan({ ...plan, status: "executing", updatedAt: createdAt }),
    );
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "deployment_execution",
      aggregateId: execution.id,
      action: "deployment.started",
      actorType: "user",
      actorId: input.requestedBy,
      sourceCommit: plan.sourceCommit,
      eventType: "deployment.started",
      publicMetadata: { strategy: plan.strategy, environment: environment.name },
    });
    const runtimeRoot = path.join(config.stateDir, "delivery", execution.id);
    const managedHome = path.join(runtimeRoot, "home");
    const managedTemp = path.join(runtimeRoot, "temp");
    const logDir = path.join(config.logsDir, "delivery");
    yield* mapUnavailable("Deployment runtime directory creation")(
      Effect.all([
        fileSystem.makeDirectory(managedHome, { recursive: true }),
        fileSystem.makeDirectory(managedTemp, { recursive: true }),
        fileSystem.makeDirectory(logDir, { recursive: true }),
      ]),
    );
    const result = yield* adapter
      .start({
        deploymentId: plan.id,
        executionId: execution.id,
        idempotencyKey: execution.idempotencyKey,
        sourceFingerprint: plan.planDigest,
        sourceCommitSha: plan.sourceCommit,
        strategy: plan.strategy,
        hostEnvironment,
        managedHome,
        managedTemp,
      })
      .pipe(
        Effect.catch(() =>
          Effect.succeed({
            deploymentId: plan.id,
            executionId: execution.id,
            providerKind: environment.providerType,
            status: "failed" as const,
            providerDeploymentId: null,
            sourceFingerprint: plan.planDigest,
            sourceCommitSha: plan.sourceCommit,
            exitCode: null,
            logText: "Deployment adapter failed before provider success was confirmed.\n",
            logTruncated: false,
          }),
        ),
      );
    const logPath = path.join(logDir, `${execution.id}.log`);
    yield* mapUnavailable("Deployment log persistence")(
      fileSystem.writeFileString(logPath, result.logText),
    );
    const providerFinished = yield* nowIso;
    execution = {
      ...execution,
      status:
        result.status === "succeeded"
          ? "validating"
          : result.status === "cancelled"
            ? "cancelled"
            : "failed",
      remoteExecutionId: result.providerDeploymentId,
      logReference: path.relative(config.stateDir, logPath).replaceAll("\\", "/"),
      providerState: {
        providerType: result.providerKind,
        providerStatus: result.status,
        exitCode: result.exitCode,
        logTruncated: result.logTruncated,
      },
      errorCode: result.status === "succeeded" ? null : `provider_${result.status}`,
      errorMessage:
        result.status === "succeeded" ? null : "The deployment provider did not succeed.",
      finishedAt: result.status === "succeeded" ? null : providerFinished,
    };
    yield* mapUnavailable("Deployment execution persistence")(
      repository.saveDeploymentExecution(execution),
    );
    if (result.status !== "succeeded") {
      yield* mapUnavailable("Deployment plan persistence")(
        repository.saveDeploymentPlan({ ...plan, status: "failed", updatedAt: providerFinished }),
      );
      yield* appendAudit({
        projectId: plan.projectId,
        missionId: plan.missionId,
        aggregateType: "deployment_execution",
        aggregateId: execution.id,
        action: `deployment.${execution.status}`,
        actorType: "system",
        actorId: null,
        sourceCommit: plan.sourceCommit,
        eventType: execution.status === "cancelled" ? "deployment.cancelled" : "deployment.failed",
        publicMetadata: { status: execution.status },
      });
      return execution;
    }
    const checks = parseValidationChecks(
      metadataString(environment.configurationMetadata, "validationChecksJson"),
    );
    const validationConfigurationMissing = plan.validationProfileId !== null && checks.length === 0;
    const [validationId, validationStartedAt] = yield* Effect.all([uuid, nowIso]);
    let validationRun: DeploymentValidationRun = {
      id: DeploymentValidationRunId.make(validationId),
      deploymentExecutionId: execution.id,
      kind: "post_deployment",
      status: "running",
      result: null,
      sourceCommit: plan.sourceCommit,
      evidence: { checkCount: checks.length },
      errorMessage: null,
      createdAt: validationStartedAt,
      startedAt: validationStartedAt,
      finishedAt: null,
    };
    yield* mapUnavailable("Deployment validation persistence")(
      repository.saveDeploymentValidationRun(validationRun),
    );
    const validated: Awaited<ReturnType<typeof runPostDeploymentValidation>> =
      validationConfigurationMissing
        ? {
            providerStatus: "succeeded",
            status: "validation_failed",
            durableStatus: "failed",
            checks: [
              {
                checkId: "validation-plan",
                kind: "http",
                url: "[validation plan]",
                status: "failed",
                httpStatus: null,
                detail: "A required validation profile has no configured checks.",
              },
            ],
          }
        : yield* Effect.tryPromise({
            try: () => runPostDeploymentValidation({ providerStatus: "succeeded", checks }),
            catch: (cause) => unavailable("Post-deployment validation", cause),
          });
    const finishedAt = yield* nowIso;
    const evidence: Record<string, string | number | boolean | null> = {
      checkCount: validated.checks.length,
    };
    for (const [index, check] of validated.checks.entries()) {
      if (index >= 8) break;
      evidence[`check${index + 1}`] = `${check.checkId}:${check.status}`;
    }
    validationRun = {
      ...validationRun,
      status: validated.durableStatus,
      result: validated.status === "passed" ? "passed" : "failed",
      evidence,
      errorMessage: validated.status === "passed" ? null : "Post-deployment validation failed.",
      finishedAt,
    };
    yield* mapUnavailable("Deployment validation persistence")(
      repository.saveDeploymentValidationRun(validationRun),
    );
    execution = {
      ...execution,
      status: validated.status === "passed" ? "succeeded" : "failed",
      errorCode: validated.status === "passed" ? null : "validation_failed",
      errorMessage: validated.status === "passed" ? null : "Post-deployment validation failed.",
      finishedAt,
    };
    yield* mapUnavailable("Deployment execution persistence")(
      repository.saveDeploymentExecution(execution),
    );
    yield* mapUnavailable("Deployment plan persistence")(
      repository.saveDeploymentPlan({
        ...plan,
        status: validated.status === "passed" ? "completed" : "failed",
        updatedAt: finishedAt,
      }),
    );
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "deployment_execution",
      aggregateId: execution.id,
      action: `deployment.${execution.status}`,
      actorType: "system",
      actorId: null,
      sourceCommit: plan.sourceCommit,
      eventType: execution.status === "succeeded" ? "deployment.succeeded" : "deployment.failed",
      publicMetadata: { status: execution.status, validationStatus: validated.status },
    });
    return execution;
  });

  const cancelDeployment: DeliveryWorkspaceServiceShape["cancelDeployment"] = Effect.fn(
    "DeliveryWorkspaceService.cancelDeployment",
  )(function* (input) {
    const execution = yield* mapUnavailable("Deployment execution lookup")(
      repository.getDeploymentExecution(input.deploymentExecutionId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("deployment_execution", input.deploymentExecutionId, value),
      ),
    );
    if (
      execution.status !== "queued" &&
      execution.status !== "preparing" &&
      execution.status !== "running" &&
      execution.status !== "validating" &&
      execution.status !== "indeterminate"
    ) {
      return yield* conflict("This deployment is no longer cancellable.");
    }
    const plan = yield* mapUnavailable("Deployment plan lookup")(
      repository.getDeploymentPlan(execution.deploymentPlanId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("deployment_plan", execution.deploymentPlanId, value),
      ),
    );
    const environment = yield* mapUnavailable("Deployment environment lookup")(
      repository.getDeploymentEnvironment(plan.deploymentEnvironmentId),
    ).pipe(
      Effect.flatMap((value) =>
        requireOption("deployment_environment", plan.deploymentEnvironmentId, value),
      ),
    );
    const project = yield* getProject(plan.projectId);
    const adapter = yield* adapterFor(environment, project.workspaceRoot);
    if (adapter.cancel === undefined || !adapter.capabilities.cancel) {
      return yield* validation("The deployment provider does not support cancellation.");
    }
    const accepted = yield* adapter
      .cancel({
        deploymentId: plan.id,
        executionId: execution.id,
        providerDeploymentId: execution.remoteExecutionId,
      })
      .pipe(Effect.mapError((error) => unavailable("Deployment cancellation", error)));
    if (!accepted) return yield* conflict("The provider could not confirm cancellation.");
    const finishedAt = yield* nowIso;
    const cancelled: DeploymentExecution = {
      ...execution,
      status: "cancelled",
      errorCode: "cancelled_by_user",
      errorMessage: input.reason,
      finishedAt,
    };
    yield* mapUnavailable("Deployment execution persistence")(
      repository.saveDeploymentExecution(cancelled),
    );
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "deployment_execution",
      aggregateId: cancelled.id,
      action: "deployment.cancelled",
      actorType: "user",
      actorId: input.requestedBy,
      sourceCommit: cancelled.sourceCommit,
      eventType: "deployment.cancelled",
      publicMetadata: { reason: input.reason },
    });
    return cancelled;
  });

  const saveRollbackPlan: DeliveryWorkspaceServiceShape["saveRollbackPlan"] = Effect.fn(
    "DeliveryWorkspaceService.saveRollbackPlan",
  )(function* (plan) {
    yield* getProject(plan.projectId);
    const current = yield* mapUnavailable("Rollback plan lookup")(
      repository.getRollbackPlan(plan.id),
    );
    if (Option.isSome(current)) {
      const mutation = validateApprovedPlanMutation({
        currentStatus: current.value.status,
        currentDigest: current.value.planDigest,
        currentSourceCommit: current.value.sourceCommit,
        nextDigest: plan.planDigest,
        nextSourceCommit: plan.sourceCommit,
      });
      if (!mutation.allowed) return yield* conflict(mutation.reason);
      const transition = validatePlanTransition(current.value.status, plan.status);
      if (!transition.allowed) return yield* conflict(transition.reason);
    }
    yield* mapUnavailable("Rollback plan persistence")(repository.saveRollbackPlan(plan));
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "rollback_plan",
      aggregateId: plan.id,
      action: "rollback.plan_saved",
      actorType: "user",
      actorId: null,
      sourceCommit: plan.sourceCommit,
      eventType: "rollback.plan_created",
      publicMetadata: { planDigest: plan.planDigest, rollbackType: plan.rollbackType },
    });
    return plan;
  });

  const executeRollback: DeliveryWorkspaceServiceShape["executeRollback"] = Effect.fn(
    "DeliveryWorkspaceService.executeRollback",
  )(function* (input) {
    const plan = yield* mapUnavailable("Rollback plan lookup")(
      repository.getRollbackPlan(input.rollbackPlanId),
    ).pipe(Effect.flatMap((value) => requireOption("rollback_plan", input.rollbackPlanId, value)));
    if (plan.status !== "approved" && plan.status !== "interrupted") {
      return yield* conflict("Only an approved or explicitly resumed rollback plan can execute.");
    }
    yield* approvalFor({
      projectId: plan.projectId,
      targetId: plan.id,
      approvalType: "rollback",
      planDigest: plan.planDigest,
      sourceCommit: plan.sourceCommit,
      required: plan.requiresApproval,
    });
    const [id, now] = yield* Effect.all([uuid, nowIso]);
    const failed: RollbackExecution = {
      id: RollbackExecutionId.make(id),
      rollbackPlanId: plan.id,
      idempotencyKey: `rollback:${plan.id}:${plan.planDigest}`,
      sourceCommit: plan.sourceCommit,
      status: "failed",
      remoteExecutionId: null,
      resultReference: null,
      errorCode: "unsupported_provider_rollback",
      errorMessage:
        "The configured deployment adapter cannot prove a safe rollback. Manual recovery is required.",
      createdAt: now,
      startedAt: now,
      finishedAt: now,
    };
    yield* mapUnavailable("Rollback execution persistence")(
      repository.saveRollbackExecution(failed),
    );
    yield* mapUnavailable("Rollback plan persistence")(
      repository.saveRollbackPlan({ ...plan, status: "failed", updatedAt: now }),
    );
    yield* appendAudit({
      projectId: plan.projectId,
      missionId: plan.missionId,
      aggregateType: "rollback_execution",
      aggregateId: failed.id,
      action: "rollback.failed",
      actorType: "user",
      actorId: input.requestedBy,
      sourceCommit: plan.sourceCommit,
      eventType: "rollback.failed",
      publicMetadata: { errorCode: failed.errorCode },
    });
    return failed;
  });

  const recoverInterrupted: DeliveryWorkspaceServiceShape["recoverInterrupted"] = Effect.fn(
    "DeliveryWorkspaceService.recoverInterrupted",
  )(function* () {
    const recoveredAt = yield* nowIso;
    const [merges, releases, deployments, validations, rollbacks] = yield* Effect.all([
      repository.listRecoverableMergeExecutions(),
      repository.listRecoverableReleasePlans(),
      repository.listRecoverableDeploymentExecutions(),
      repository.listRecoverableDeploymentValidationRuns(),
      repository.listRecoverableRollbackExecutions(),
    ]).pipe(Effect.catch(() => Effect.succeed([[], [], [], [], []] as const)));
    yield* Effect.forEach(
      merges,
      (execution) =>
        repository.saveMergeExecution({
          ...execution,
          status: "indeterminate",
          errorCode: "server_restart",
          errorMessage: "The server restarted before the remote merge outcome was confirmed.",
          finishedAt: recoveredAt,
        }),
      { discard: true },
    ).pipe(Effect.ignore);
    yield* Effect.forEach(
      releases,
      (plan) =>
        repository.saveReleasePlan({ ...plan, status: "interrupted", updatedAt: recoveredAt }),
      { discard: true },
    ).pipe(Effect.ignore);
    yield* Effect.forEach(
      deployments,
      (execution) =>
        repository.saveDeploymentExecution({
          ...execution,
          status: "interrupted",
          errorCode: "server_restart",
          errorMessage: "The server restarted; provider state requires inspection before retry.",
          finishedAt: recoveredAt,
        }),
      { discard: true },
    ).pipe(Effect.ignore);
    yield* Effect.forEach(
      validations,
      (run) =>
        repository.saveDeploymentValidationRun({
          ...run,
          status: "interrupted",
          result: "unknown",
          errorMessage: "The server restarted during validation.",
          finishedAt: recoveredAt,
        }),
      { discard: true },
    ).pipe(Effect.ignore);
    yield* Effect.forEach(
      rollbacks,
      (execution) =>
        repository.saveRollbackExecution({
          ...execution,
          status: "indeterminate",
          errorCode: "server_restart",
          errorMessage: "The server restarted before the rollback outcome was confirmed.",
          finishedAt: recoveredAt,
        }),
      { discard: true },
    ).pipe(Effect.ignore);
  });

  return DeliveryWorkspaceService.of({
    getWorkspace,
    savePolicy,
    saveReleaseConfiguration,
    saveDeploymentEnvironment,
    assessMerge,
    requestApproval,
    decideApproval,
    executeMerge,
    proposeReleasePlan,
    saveReleasePlan,
    publishRelease,
    proposeDeploymentPlan,
    saveDeploymentPlan,
    executeDeployment,
    cancelDeployment,
    saveRollbackPlan,
    executeRollback,
    recoverInterrupted,
    changes: Stream.fromPubSub(changes),
  });
});

export const layer = Layer.effect(DeliveryWorkspaceService, make);
