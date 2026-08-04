import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  AgentHandoffId,
  ApprovalRequestId,
  AgentRunId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  ManagedWorktreeId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  RoutingDecisionId,
  TaskDependencyId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
  TurnId,
  VerificationCheckRunId,
  VerificationGateId,
  VerificationOverrideId,
  VerificationProfileId,
  VerificationRepairAttemptId,
  VerificationRunId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { RuntimeErrorClass } from "./providerRuntime.ts";
import {
  AgentHandoff,
  AgentHandoffChangedFile,
  AgentPermissions,
  AgentRole,
  AgentRun,
  AgentRunPurpose,
  ManagedWorktree,
  ManagedWorktreeStatus,
  Mission,
  MissionAgent,
  MissionBoardSnapshot,
  MissionSchedulerStatus,
  MissionStatus,
  MissionSummary,
  MissionTeamSettings,
  MissionTask,
  MissionTaskStatus,
  TaskDependency,
  TaskIntegrationStatus,
} from "./mission.ts";
import {
  VerificationArtifact,
  VerificationCheckRun,
  VerificationDiagnostic,
  VerificationFailureCategory,
  VerificationOverride,
  VerificationProfile,
  VerificationProjectSettings,
  VerificationRepairAttempt,
  VerificationRequestScope,
  VerificationRun,
  VerificationRunTrigger,
} from "./verification.ts";
import {
  GitHubAccountId,
  GitHubIssueRecordId,
  PullRequestRecordId,
  RepositoryConnectionId,
  ReviewCommentRecordId,
  ReviewThreadRecordId,
} from "./github.ts";
import {
  MemoryAggregateId,
  MemoryEventReferencePayload,
  MemoryOrchestrationEventType,
} from "./memory.ts";
import {
  ModelProfileId,
  ProviderProfileId,
  RoutingOverrideId,
  RoutingReasoningLevel,
  TaskRoutingAssessmentId,
} from "./routing.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  searchThreads: "orchestration.searchThreads",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  subscribeMissions: "orchestration.subscribeMissions",
  subscribeMission: "orchestration.subscribeMission",
} as const;

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  /**
   * URL to open in the in-app browser preview when this script runs (or
   * when the user explicitly requests a preview). Optional; only honored on
   * the desktop build.
   */
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  /**
   * When true, automatically open the preview panel pointed at `previewUrl`
   * the moment this script starts. Ignored without `previewUrl` or on web.
   */
  autoOpenPreview: Schema.optional(Schema.Boolean),
});
export type ProjectScript = typeof ProjectScript.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  providerSessionId: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  runtimeErrorClass: Schema.optional(Schema.NullOr(RuntimeErrorClass)),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const ThreadTitleRegeneration = Schema.Struct({
  requestId: CommandId,
  startedAt: IsoDateTime,
});
export type ThreadTitleRegeneration = typeof ThreadTitleRegeneration.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // Snooze is an overlay on the active lifecycle, not a fourth destination:
  // a snoozed thread stays "active" in the model and is only suppressed from
  // the inbox until snoozedUntil passes (or the thread raises its hand).
  // Optional so payloads from pre-snooze servers still decode.
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Pending-only state. Optional so older servers remain compatible.
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  missions: Schema.optionalKey(Schema.Array(Mission)),
  missionTasks: Schema.optionalKey(Schema.Array(MissionTask)),
  agentRuns: Schema.optionalKey(Schema.Array(AgentRun)),
  agentRoles: Schema.optionalKey(Schema.Array(AgentRole)),
  missionAgents: Schema.optionalKey(Schema.Array(MissionAgent)),
  taskDependencies: Schema.optionalKey(Schema.Array(TaskDependency)),
  managedWorktrees: Schema.optionalKey(Schema.Array(ManagedWorktree)),
  agentHandoffs: Schema.optionalKey(Schema.Array(AgentHandoff)),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("synchronized"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeShellInput = Schema.Struct({
  /**
   * When provided, the server skips the initial full shell snapshot and instead
   * replays shell events after this sequence before streaming live events.
   * Clients that already hold a cached (or HTTP-loaded) shell snapshot pass its
   * sequence here so the subscription resumes without re-sending the entire
   * projects/threads list (overlapping events are deduped by sequence on the
   * client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Requests an explicit marker after the subscription has emitted its initial
   * snapshot or catch-up replay and before it begins emitting live events.
   */
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeShellInput = typeof OrchestrationSubscribeShellInput.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
  /**
   * When provided, the server skips the initial snapshot frame and instead
   * replays events after this sequence before streaming live events. Clients
   * that load the snapshot over HTTP pass the snapshot's sequence here so the
   * live subscription resumes without a gap (overlapping events are deduped by
   * sequence on the client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Requests an explicit marker after the subscription has emitted its initial
   * snapshot or catch-up replay and before it begins emitting live events.
   */
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationSubscribeMissionsInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  afterSequence: Schema.optionalKey(NonNegativeInt),
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeMissionsInput = typeof OrchestrationSubscribeMissionsInput.Type;

export const OrchestrationSubscribeMissionInput = Schema.Struct({
  missionId: MissionId,
  afterSequence: Schema.optionalKey(NonNegativeInt),
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeMissionInput = typeof OrchestrationSubscribeMissionInput.Type;

export const OrchestrationMissionBoardStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: MissionBoardSnapshot }),
  Schema.Struct({
    kind: Schema.Literal("mission-upserted"),
    sequence: NonNegativeInt,
    summary: MissionSummary,
  }),
  Schema.Struct({
    kind: Schema.Literal("mission-removed"),
    sequence: NonNegativeInt,
    missionId: MissionId,
  }),
]);
export type OrchestrationMissionBoardStreamItem = typeof OrchestrationMissionBoardStreamItem.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadSettleCommand = Schema.Struct({
  type: Schema.Literal("thread.settle"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnsettleCommand = Schema.Struct({
  type: Schema.Literal("thread.unsettle"),
  commandId: CommandId,
  threadId: ThreadId,
  // Commands only carry "user": activity un-settles are decided server-side
  // (the decider emits thread.unsettled(reason: "activity") events directly,
  // never through this command), so a client cannot forge the neutral reset.
  reason: Schema.Literal("user"),
});

const ThreadSnoozeCommand = Schema.Struct({
  type: Schema.Literal("thread.snooze"),
  commandId: CommandId,
  threadId: ThreadId,
  // The wake time. Event-based wake conditions (PR merged, review posted)
  // will arrive as an optional condition field alongside this; time-based
  // snooze is just the first kind of condition.
  snoozedUntil: IsoDateTime,
});

const ThreadUnsnoozeCommand = Schema.Struct({
  type: Schema.Literal("thread.unsnooze"),
  commandId: CommandId,
  threadId: ThreadId,
  // Commands only carry "user": activity wakes are decided server-side (the
  // decider emits thread.unsnoozed(reason: "activity") directly), and timer
  // wakes need no event at all — clients derive visibility from snoozedUntil,
  // so a passed wake time simply stops classifying as snoozed.
  reason: Schema.Literal("user"),
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  expectedBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
}).check(
  Schema.makeFilter(
    (input) =>
      !(input.title !== undefined && input.regenerateTitle === true) ||
      "title and regenerateTitle cannot be specified together",
  ),
);

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const MissionCreateCommand = Schema.Struct({
  type: Schema.Literal("mission.create"),
  commandId: CommandId,
  missionId: MissionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  createdAt: IsoDateTime,
});

export const MissionUpdateCommand = Schema.Struct({
  type: Schema.Literal("mission.update"),
  commandId: CommandId,
  missionId: MissionId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  status: Schema.optional(MissionStatus),
  updatedAt: IsoDateTime,
});

export const MissionTaskCreateCommand = Schema.Struct({
  type: Schema.Literal("mission.task.create"),
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  position: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const MissionTaskUpdateCommand = Schema.Struct({
  type: Schema.Literal("mission.task.update"),
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  status: Schema.optional(MissionTaskStatus),
  position: Schema.optional(NonNegativeInt),
  assignedMissionAgentId: Schema.optional(Schema.NullOr(MissionAgentId)),
  maximumAttempts: Schema.optional(PositiveInt),
  requiresDependencyHandoffs: Schema.optional(Schema.Boolean),
  updatedAt: IsoDateTime,
});

const MissionRunStartFields = {
  commandId: CommandId,
  missionId: MissionId,
  taskId: Schema.optional(MissionTaskId),
  agentRunId: AgentRunId,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  missionAgentId: Schema.optional(MissionAgentId),
  worktreeId: Schema.optional(ManagedWorktreeId),
  attemptNumber: Schema.optional(PositiveInt),
  permissions: Schema.optional(AgentPermissions),
  writeCapable: Schema.optional(Schema.Boolean),
  purpose: Schema.optional(AgentRunPurpose),
  repairAttemptId: Schema.optional(VerificationRepairAttemptId),
  routingDecisionId: Schema.optional(RoutingDecisionId),
  reasoningLevel: Schema.optional(RoutingReasoningLevel),
  createdAt: IsoDateTime,
} as const;

export const MissionStartCommand = Schema.Struct({
  type: Schema.Literal("mission.start"),
  ...MissionRunStartFields,
});

export const MissionRetryCommand = Schema.Struct({
  type: Schema.Literal("mission.retry"),
  ...MissionRunStartFields,
});

export const MissionCancelCommand = Schema.Struct({
  type: Schema.Literal("mission.cancel"),
  commandId: CommandId,
  missionId: MissionId,
  createdAt: IsoDateTime,
});

export const MissionTeamConfigureCommand = Schema.Struct({
  type: Schema.Literal("mission.team.configure"),
  commandId: CommandId,
  missionId: MissionId,
  settings: MissionTeamSettings,
  updatedAt: IsoDateTime,
});

export const MissionAgentUpsertCommand = Schema.Struct({
  type: Schema.Literal("mission.agent.upsert"),
  commandId: CommandId,
  missionId: MissionId,
  agent: MissionAgent,
});

export const MissionAgentRemoveCommand = Schema.Struct({
  type: Schema.Literal("mission.agent.remove"),
  commandId: CommandId,
  missionId: MissionId,
  missionAgentId: MissionAgentId,
  removedAt: IsoDateTime,
});

export const MissionAgentPermissionsUpdateCommand = Schema.Struct({
  type: Schema.Literal("mission.agent.permissions.update"),
  commandId: CommandId,
  missionId: MissionId,
  missionAgentId: MissionAgentId,
  permissions: AgentPermissions,
  updatedAt: IsoDateTime,
});

export const MissionTaskDependencyAddCommand = Schema.Struct({
  type: Schema.Literal("mission.task.dependency.add"),
  commandId: CommandId,
  missionId: MissionId,
  dependency: TaskDependency,
});

export const MissionTaskDependencyRemoveCommand = Schema.Struct({
  type: Schema.Literal("mission.task.dependency.remove"),
  commandId: CommandId,
  missionId: MissionId,
  dependencyId: TaskDependencyId,
  taskId: MissionTaskId,
  dependsOnTaskId: MissionTaskId,
  removedAt: IsoDateTime,
});

export const MissionTaskRetryCommand = Schema.Struct({
  type: Schema.Literal("mission.task.retry"),
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  reason: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

export const MissionTaskCancelCommand = Schema.Struct({
  type: Schema.Literal("mission.task.cancel"),
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  requestedAt: IsoDateTime,
});

const MissionSchedulerCommandFields = {
  commandId: CommandId,
  missionId: MissionId,
  requestedAt: IsoDateTime,
} as const;

export const MissionSchedulerStartCommand = Schema.Struct({
  type: Schema.Literal("mission.scheduler.start"),
  ...MissionSchedulerCommandFields,
});

export const MissionSchedulerPauseCommand = Schema.Struct({
  type: Schema.Literal("mission.scheduler.pause"),
  ...MissionSchedulerCommandFields,
});

export const MissionSchedulerResumeCommand = Schema.Struct({
  type: Schema.Literal("mission.scheduler.resume"),
  ...MissionSchedulerCommandFields,
});

const MissionIntegrationCommandFields = {
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  worktreeId: ManagedWorktreeId,
  requestedAt: IsoDateTime,
} as const;

export const MissionIntegrationRequestCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.request"),
  ...MissionIntegrationCommandFields,
});

export const MissionIntegrationApproveCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.approve"),
  ...MissionIntegrationCommandFields,
});

export const MissionIntegrationAbortCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.abort"),
  ...MissionIntegrationCommandFields,
  reason: TrimmedNonEmptyString,
});

export const MissionWorktreeRemoveCommand = Schema.Struct({
  type: Schema.Literal("mission.worktree.remove"),
  commandId: CommandId,
  missionId: MissionId,
  worktreeId: ManagedWorktreeId,
  requestedAt: IsoDateTime,
});

export const VerificationRequestCommand = Schema.Struct({
  type: Schema.Literal("verification.request"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  worktreeId: Schema.NullOr(ManagedWorktreeId),
  profileId: Schema.NullOr(VerificationProfileId),
  requestedBy: TrimmedNonEmptyString,
  trigger: VerificationRunTrigger,
  scope: Schema.optionalKey(VerificationRequestScope),
  requestedAt: IsoDateTime,
});

export const VerificationSettingsUpdateCommand = Schema.Struct({
  type: Schema.Literal("verification.settings.update"),
  commandId: CommandId,
  settings: VerificationProjectSettings,
  actor: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});

export const VerificationCancelCommand = Schema.Struct({
  type: Schema.Literal("verification.cancel"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

export const VerificationRepairRequestCommand = Schema.Struct({
  type: Schema.Literal("verification.repair.request"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: MissionId,
  taskId: MissionTaskId,
  verificationRunId: VerificationRunId,
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

export const VerificationOverrideRequestCommand = Schema.Struct({
  type: Schema.Literal("verification.override.request"),
  commandId: CommandId,
  overrideId: VerificationOverrideId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: MissionTaskId,
  verificationRunId: Schema.NullOr(VerificationRunId),
  sourceFingerprint: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSettleCommand,
  ThreadUnsettleCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  MissionCreateCommand,
  MissionUpdateCommand,
  MissionTaskCreateCommand,
  MissionTaskUpdateCommand,
  MissionStartCommand,
  MissionRetryCommand,
  MissionCancelCommand,
  MissionTeamConfigureCommand,
  MissionAgentUpsertCommand,
  MissionAgentRemoveCommand,
  MissionAgentPermissionsUpdateCommand,
  MissionTaskDependencyAddCommand,
  MissionTaskDependencyRemoveCommand,
  MissionTaskRetryCommand,
  MissionTaskCancelCommand,
  MissionSchedulerStartCommand,
  MissionSchedulerPauseCommand,
  MissionSchedulerResumeCommand,
  MissionIntegrationRequestCommand,
  MissionIntegrationApproveCommand,
  MissionIntegrationAbortCommand,
  MissionWorktreeRemoveCommand,
  VerificationSettingsUpdateCommand,
  VerificationRequestCommand,
  VerificationCancelCommand,
  VerificationRepairRequestCommand,
  VerificationOverrideRequestCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSettleCommand,
  ThreadUnsettleCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  MissionCreateCommand,
  MissionUpdateCommand,
  MissionTaskCreateCommand,
  MissionTaskUpdateCommand,
  MissionStartCommand,
  MissionRetryCommand,
  MissionCancelCommand,
  MissionTeamConfigureCommand,
  MissionAgentUpsertCommand,
  MissionAgentRemoveCommand,
  MissionAgentPermissionsUpdateCommand,
  MissionTaskDependencyAddCommand,
  MissionTaskDependencyRemoveCommand,
  MissionTaskRetryCommand,
  MissionTaskCancelCommand,
  MissionSchedulerStartCommand,
  MissionSchedulerPauseCommand,
  MissionSchedulerResumeCommand,
  MissionIntegrationRequestCommand,
  MissionIntegrationApproveCommand,
  MissionIntegrationAbortCommand,
  MissionWorktreeRemoveCommand,
  VerificationSettingsUpdateCommand,
  VerificationRequestCommand,
  VerificationCancelCommand,
  VerificationRepairRequestCommand,
  VerificationOverrideRequestCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadTitleRegenerationCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.title.regeneration.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: CommandId,
  title: Schema.optional(TrimmedNonEmptyString),
});

export const MissionAgentRunMarkRunningCommand = Schema.Struct({
  type: Schema.Literal("mission.agent-run.mark-running"),
  commandId: CommandId,
  missionId: MissionId,
  agentRunId: AgentRunId,
  providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
});

export const MissionAgentRunCompleteCommand = Schema.Struct({
  type: Schema.Literal("mission.agent-run.complete"),
  commandId: CommandId,
  missionId: MissionId,
  agentRunId: AgentRunId,
  requiresVerification: Schema.optional(Schema.Boolean),
  completedAt: IsoDateTime,
});

export const MissionAgentRunFailCommand = Schema.Struct({
  type: Schema.Literal("mission.agent-run.fail"),
  commandId: CommandId,
  missionId: MissionId,
  agentRunId: AgentRunId,
  errorSummary: TrimmedNonEmptyString,
  runtimeErrorClass: Schema.optional(Schema.NullOr(RuntimeErrorClass)),
  failedAt: IsoDateTime,
});

export const MissionAgentRunCancelCommand = Schema.Struct({
  type: Schema.Literal("mission.agent-run.cancel"),
  commandId: CommandId,
  missionId: MissionId,
  agentRunId: AgentRunId,
  cancelledAt: IsoDateTime,
});

export const MissionAgentRunInterruptCommand = Schema.Struct({
  type: Schema.Literal("mission.agent-run.interrupt"),
  commandId: CommandId,
  missionId: MissionId,
  agentRunId: AgentRunId,
  reason: TrimmedNonEmptyString,
  interruptedAt: IsoDateTime,
});

export const MissionManagedWorktreeRecordCommand = Schema.Struct({
  type: Schema.Literal("mission.worktree.record"),
  commandId: CommandId,
  missionId: MissionId,
  worktree: ManagedWorktree,
});

export const MissionManagedWorktreeStatusUpdateCommand = Schema.Struct({
  type: Schema.Literal("mission.worktree.status.update"),
  commandId: CommandId,
  missionId: MissionId,
  worktreeId: ManagedWorktreeId,
  status: ManagedWorktreeStatus,
  headCommit: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  changedFileCount: Schema.optional(NonNegativeInt),
  hasUncommittedChanges: Schema.optional(Schema.Boolean),
  conflictingFiles: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  errorSummary: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  removedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  updatedAt: IsoDateTime,
});

export const MissionAgentHandoffCreateCommand = Schema.Struct({
  type: Schema.Literal("mission.handoff.create"),
  commandId: CommandId,
  missionId: MissionId,
  handoff: AgentHandoff,
});

export const MissionAgentHandoffReconcileCommand = Schema.Struct({
  type: Schema.Literal("mission.handoff.reconcile"),
  commandId: CommandId,
  missionId: MissionId,
  handoffId: AgentHandoffId,
  reconciliationStatus: Schema.Literals(["matched", "corrected"]),
  changedFiles: Schema.Array(AgentHandoffChangedFile),
  reconciledAt: IsoDateTime,
});

export const MissionTaskMarkReadyCommand = Schema.Struct({
  type: Schema.Literal("mission.task.mark-ready"),
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  readyAt: IsoDateTime,
});

export const MissionTaskMarkBlockedCommand = Schema.Struct({
  type: Schema.Literal("mission.task.mark-blocked"),
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  reason: TrimmedNonEmptyString,
  blockedAt: IsoDateTime,
});

export const MissionSchedulerConcurrencyLimitCommand = Schema.Struct({
  type: Schema.Literal("mission.scheduler.concurrency-limit"),
  commandId: CommandId,
  missionId: MissionId,
  maximumConcurrentAgents: PositiveInt,
  maximumConcurrentWriteAgents: PositiveInt,
  observedAt: IsoDateTime,
});

const MissionIntegrationResultCommandFields = {
  commandId: CommandId,
  missionId: MissionId,
  taskId: MissionTaskId,
  worktreeId: ManagedWorktreeId,
  occurredAt: IsoDateTime,
} as const;

export const MissionIntegrationStartCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.start"),
  ...MissionIntegrationResultCommandFields,
});

export const MissionIntegrationCompleteCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.complete"),
  ...MissionIntegrationResultCommandFields,
  headCommit: TrimmedNonEmptyString,
});

export const MissionIntegrationConflictCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.conflict"),
  ...MissionIntegrationResultCommandFields,
  conflictingFiles: Schema.Array(TrimmedNonEmptyString),
});

export const MissionIntegrationFailCommand = Schema.Struct({
  type: Schema.Literal("mission.integration.fail"),
  ...MissionIntegrationResultCommandFields,
  errorSummary: TrimmedNonEmptyString,
});

export const VerificationProfileRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.profile.record"),
  commandId: CommandId,
  profile: VerificationProfile,
  operation: Schema.Literals(["created", "updated"]),
  occurredAt: IsoDateTime,
});

export const VerificationRunRecordAction = Schema.Literals([
  "plan_created",
  "queued",
  "started",
  "cancelled",
  "interrupted",
  "passed",
  "passed_with_warnings",
  "failed",
  "invalidated",
]);
export type VerificationRunRecordAction = typeof VerificationRunRecordAction.Type;

export const VerificationRequestRejectCommand = Schema.Struct({
  type: Schema.Literal("verification.request.reject"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  failureCategory: VerificationFailureCategory,
  summary: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
});

export const VerificationRunRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.run.record"),
  commandId: CommandId,
  run: VerificationRun,
  action: VerificationRunRecordAction,
  occurredAt: IsoDateTime,
});

export const VerificationGateRecordAction = Schema.Literals([
  "started",
  "completed",
  "failed",
  "skipped",
]);
export type VerificationGateRecordAction = typeof VerificationGateRecordAction.Type;

export const VerificationGateRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.gate.record"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  gateId: VerificationGateId,
  name: TrimmedNonEmptyString,
  action: VerificationGateRecordAction,
  summary: Schema.NullOr(Schema.String),
  occurredAt: IsoDateTime,
});

export const VerificationCheckRecordAction = Schema.Literals([
  "started",
  "passed",
  "warned",
  "failed",
  "timed_out",
  "cancelled",
  "interrupted",
  "skipped",
]);
export type VerificationCheckRecordAction = typeof VerificationCheckRecordAction.Type;

export const VerificationCheckRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.check.record"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  checkRun: VerificationCheckRun,
  action: VerificationCheckRecordAction,
  occurredAt: IsoDateTime,
});

export const VerificationCheckOutputRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.check.output.record"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  checkRunId: VerificationCheckRunId,
  logReference: TrimmedNonEmptyString,
  stdoutBytes: NonNegativeInt,
  stderrBytes: NonNegativeInt,
  truncated: Schema.Boolean,
  occurredAt: IsoDateTime,
});

export const VerificationDiagnosticRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.diagnostic.record"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  diagnostic: VerificationDiagnostic,
  occurredAt: IsoDateTime,
});

export const VerificationArtifactRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.artifact.record"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  artifact: VerificationArtifact,
  occurredAt: IsoDateTime,
});

export const VerificationRepairRecordAction = Schema.Literals([
  "started",
  "completed",
  "failed",
  "limit_reached",
]);
export type VerificationRepairRecordAction = typeof VerificationRepairRecordAction.Type;

export const VerificationRepairRecordCommand = Schema.Struct({
  type: Schema.Literal("verification.repair.record"),
  commandId: CommandId,
  projectId: ProjectId,
  missionId: MissionId,
  attempt: VerificationRepairAttempt,
  action: VerificationRepairRecordAction,
  summary: Schema.NullOr(Schema.String),
  occurredAt: IsoDateTime,
});

export const VerificationOverrideApplyCommand = Schema.Struct({
  type: Schema.Literal("verification.override.apply"),
  commandId: CommandId,
  override: VerificationOverride,
  occurredAt: IsoDateTime,
});

/**
 * Reference-sized GitHub integration events. Remote bodies, diffs, logs, and
 * credentials stay in their dedicated stores and never enter the append-only
 * orchestration log.
 */
export const GitHubOrchestrationEventType = Schema.Literals([
  "github.account_connected",
  "github.account_disconnected",
  "github.authentication_expired",
  "github.permissions_changed",
  "github.rate_limited",
  "github.repository_connected",
  "github.repository_disconnected",
  "github.sync_started",
  "github.sync_completed",
  "github.sync_partially_failed",
  "github.sync_failed",
  "github.issue_linked",
  "github.issue_unlinked",
  "github.issue_mission_created",
  "github.branch_push_requested",
  "github.branch_push_started",
  "github.branch_pushed",
  "github.branch_push_rejected",
  "github.branch_diverged",
  "github.pull_request_creation_requested",
  "github.pull_request_created",
  "github.pull_request_updated",
  "github.pull_request_ready_for_review",
  "github.pull_request_closed",
  "github.pull_request_merged",
  "github.review_received",
  "github.changes_requested",
  "github.review_thread_linked",
  "github.review_task_created",
  "github.review_thread_resolved",
  "github.check_queued",
  "github.check_started",
  "github.check_completed",
  "github.check_failed",
  "github.check_stale",
]);
export type GitHubOrchestrationEventType = typeof GitHubOrchestrationEventType.Type;

export const GitHubEventReferencePayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  accountId: Schema.NullOr(GitHubAccountId),
  repositoryConnectionId: Schema.NullOr(RepositoryConnectionId),
  issueRecordId: Schema.NullOr(GitHubIssueRecordId),
  pullRequestRecordId: Schema.NullOr(PullRequestRecordId),
  reviewThreadRecordId: Schema.NullOr(ReviewThreadRecordId),
  reviewCommentRecordId: Schema.NullOr(ReviewCommentRecordId),
  issueNumber: Schema.NullOr(PositiveInt),
  pullRequestNumber: Schema.NullOr(PositiveInt),
  headSha: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
  occurredAt: IsoDateTime,
});
export type GitHubEventReferencePayload = typeof GitHubEventReferencePayload.Type;

export const GitHubEventRecordCommand = Schema.Struct({
  type: Schema.Literal("github.event.record"),
  commandId: CommandId,
  eventType: GitHubOrchestrationEventType,
  payload: GitHubEventReferencePayload,
});

export const MemoryEventRecordCommand = Schema.Struct({
  type: Schema.Literal("memory.event.record"),
  commandId: CommandId,
  eventType: MemoryOrchestrationEventType,
  payload: MemoryEventReferencePayload,
});

export const RoutingOrchestrationEventType = Schema.Literals([
  "routing.provider_registered",
  "routing.provider_updated",
  "routing.provider_enabled",
  "routing.provider_disabled",
  "routing.provider_health_changed",
  "routing.provider_rate_limited",
  "routing.provider_authentication_failed",
  "routing.model_discovered",
  "routing.model_updated",
  "routing.model_enabled",
  "routing.model_disabled",
  "routing.model_deprecated",
  "routing.capability_snapshot_created",
  "routing.policy_created",
  "routing.policy_updated",
  "routing.policy_disabled",
  "routing.policy_conflict_detected",
  "routing.assessment_created",
  "routing.assessment_updated",
  "routing.simulation_completed",
  "routing.decision_requested",
  "routing.decision_created",
  "routing.decision_applied",
  "routing.decision_failed",
  "routing.decision_superseded",
  "routing.manual_override_created",
  "routing.manual_override_revoked",
  "routing.fallback_started",
  "routing.fallback_candidate_selected",
  "routing.fallback_cancelled",
  "routing.fallback_exhausted",
  "routing.reroute_created",
  "routing.context_reduction_applied",
  "routing.context_incompatible",
  "routing.no_eligible_candidate",
]);
export type RoutingOrchestrationEventType = typeof RoutingOrchestrationEventType.Type;

/**
 * Routing audit events intentionally carry references and a bounded summary,
 * never prompts, source context, provider credentials, or full candidate sets.
 */
export const RoutingEventReferencePayload = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  routingDecisionId: Schema.NullOr(RoutingDecisionId),
  assessmentId: Schema.NullOr(TaskRoutingAssessmentId),
  providerProfileId: Schema.NullOr(ProviderProfileId),
  modelProfileId: Schema.NullOr(ModelProfileId),
  overrideId: Schema.NullOr(RoutingOverrideId),
  summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
  occurredAt: IsoDateTime,
});
export type RoutingEventReferencePayload = typeof RoutingEventReferencePayload.Type;

export const RoutingAggregateId = TrimmedNonEmptyString.pipe(Schema.brand("RoutingAggregateId"));
export type RoutingAggregateId = typeof RoutingAggregateId.Type;

export const RoutingEventRecordCommand = Schema.Struct({
  type: Schema.Literal("routing.event.record"),
  commandId: CommandId,
  aggregateId: RoutingAggregateId,
  eventType: RoutingOrchestrationEventType,
  payload: RoutingEventReferencePayload,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  ThreadTitleRegenerationCompleteCommand,
  MissionAgentRunMarkRunningCommand,
  MissionAgentRunCompleteCommand,
  MissionAgentRunFailCommand,
  MissionAgentRunCancelCommand,
  MissionAgentRunInterruptCommand,
  MissionManagedWorktreeRecordCommand,
  MissionManagedWorktreeStatusUpdateCommand,
  MissionAgentHandoffCreateCommand,
  MissionAgentHandoffReconcileCommand,
  MissionTaskMarkReadyCommand,
  MissionTaskMarkBlockedCommand,
  MissionSchedulerConcurrencyLimitCommand,
  MissionIntegrationStartCommand,
  MissionIntegrationCompleteCommand,
  MissionIntegrationConflictCommand,
  MissionIntegrationFailCommand,
  VerificationProfileRecordCommand,
  VerificationRequestRejectCommand,
  VerificationRunRecordCommand,
  VerificationGateRecordCommand,
  VerificationCheckRecordCommand,
  VerificationCheckOutputRecordCommand,
  VerificationDiagnosticRecordCommand,
  VerificationArtifactRecordCommand,
  VerificationRepairRecordCommand,
  VerificationOverrideApplyCommand,
  GitHubEventRecordCommand,
  MemoryEventRecordCommand,
  RoutingEventRecordCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.settled",
  "thread.unsettled",
  "thread.snoozed",
  "thread.unsnoozed",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "mission.created",
  "mission.updated",
  "mission.started",
  "mission.cancellation-requested",
  "mission.cancelled",
  "mission.completed",
  "mission.failed",
  "mission.recovery-blocked",
  "task.created",
  "task.updated",
  "task.started",
  "task.implementation-completed",
  "task.completed",
  "task.cancelled",
  "task.failed",
  "agent_run.started",
  "agent_run.running",
  "agent_run.cancellation-requested",
  "agent_run.completed",
  "agent_run.cancelled",
  "agent_run.failed",
  "agent_run.interrupted",
  "mission.team-configured",
  "mission.agent-upserted",
  "mission.agent-removed",
  "mission.agent-permissions-updated",
  "task.dependency-added",
  "task.dependency-removed",
  "task.ready",
  "task.blocked",
  "task.retry-requested",
  "task.cancellation-requested",
  "managed_worktree.recorded",
  "managed_worktree.status-updated",
  "managed_worktree.removal-requested",
  "agent_handoff.created",
  "agent_handoff.reconciled",
  "scheduler.started",
  "scheduler.paused",
  "scheduler.resumed",
  "scheduler.concurrency-limited",
  "integration.requested",
  "integration.approved",
  "integration.started",
  "integration.completed",
  "integration.conflicted",
  "integration.aborted",
  "integration.failed",
  "verification.settings_updated",
  "verification.profile_created",
  "verification.profile_updated",
  "verification.requested",
  "verification.request_failed",
  "verification.plan_created",
  "verification.queued",
  "verification.started",
  "verification.cancel_requested",
  "verification.cancelled",
  "verification.interrupted",
  "verification.passed",
  "verification.passed_with_warnings",
  "verification.failed",
  "verification.invalidated",
  "verification.gate_started",
  "verification.gate_completed",
  "verification.gate_failed",
  "verification.gate_skipped",
  "verification.check_started",
  "verification.check_output",
  "verification.check_passed",
  "verification.check_warned",
  "verification.check_failed",
  "verification.check_timed_out",
  "verification.check_cancelled",
  "verification.check_interrupted",
  "verification.check_skipped",
  "verification.diagnostic_created",
  "verification.artifact_created",
  "verification.repair_requested",
  "verification.repair_started",
  "verification.repair_completed",
  "verification.repair_failed",
  "verification.repair_limit_reached",
  "verification.override_requested",
  "verification.override_applied",
  "github.account_connected",
  "github.account_disconnected",
  "github.authentication_expired",
  "github.permissions_changed",
  "github.rate_limited",
  "github.repository_connected",
  "github.repository_disconnected",
  "github.sync_started",
  "github.sync_completed",
  "github.sync_partially_failed",
  "github.sync_failed",
  "github.issue_linked",
  "github.issue_unlinked",
  "github.issue_mission_created",
  "github.branch_push_requested",
  "github.branch_push_started",
  "github.branch_pushed",
  "github.branch_push_rejected",
  "github.branch_diverged",
  "github.pull_request_creation_requested",
  "github.pull_request_created",
  "github.pull_request_updated",
  "github.pull_request_ready_for_review",
  "github.pull_request_closed",
  "github.pull_request_merged",
  "github.review_received",
  "github.changes_requested",
  "github.review_thread_linked",
  "github.review_task_created",
  "github.review_thread_resolved",
  "github.check_queued",
  "github.check_started",
  "github.check_completed",
  "github.check_failed",
  "github.check_stale",
  "memory.entry_created",
  "memory.entry_updated",
  "memory.entry_activated",
  "memory.entry_marked_stale",
  "memory.entry_superseded",
  "memory.entry_disputed",
  "memory.entry_rejected",
  "memory.entry_archived",
  "memory.source_added",
  "memory.source_changed",
  "memory.source_missing",
  "memory.proposal_created",
  "memory.proposal_accepted",
  "memory.proposal_edited_and_accepted",
  "memory.proposal_rejected",
  "memory.proposal_marked_duplicate",
  "memory.contradiction_detected",
  "memory.contradiction_resolved",
  "memory.index_requested",
  "memory.index_started",
  "memory.index_source_completed",
  "memory.index_source_failed",
  "memory.index_completed",
  "memory.index_interrupted",
  "memory.embedding_started",
  "memory.embedding_completed",
  "memory.embedding_failed",
  "memory.embedding_provider_changed",
  "memory.retrieval_started",
  "memory.retrieval_completed",
  "memory.retrieval_failed",
  "memory.feedback_received",
  "routing.provider_registered",
  "routing.provider_updated",
  "routing.provider_enabled",
  "routing.provider_disabled",
  "routing.provider_health_changed",
  "routing.provider_rate_limited",
  "routing.provider_authentication_failed",
  "routing.model_discovered",
  "routing.model_updated",
  "routing.model_enabled",
  "routing.model_disabled",
  "routing.model_deprecated",
  "routing.capability_snapshot_created",
  "routing.policy_created",
  "routing.policy_updated",
  "routing.policy_disabled",
  "routing.policy_conflict_detected",
  "routing.assessment_created",
  "routing.assessment_updated",
  "routing.simulation_completed",
  "routing.decision_requested",
  "routing.decision_created",
  "routing.decision_applied",
  "routing.decision_failed",
  "routing.decision_superseded",
  "routing.manual_override_created",
  "routing.manual_override_revoked",
  "routing.fallback_started",
  "routing.fallback_candidate_selected",
  "routing.fallback_cancelled",
  "routing.fallback_exhausted",
  "routing.reroute_created",
  "routing.context_reduction_applied",
  "routing.context_incompatible",
  "routing.no_eligible_candidate",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals([
  "project",
  "thread",
  "mission",
  "memory",
  "routing",
]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadSettledPayload = Schema.Struct({
  threadId: ThreadId,
  settledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsettledPayload = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadSnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  snoozedUntil: IsoDateTime,
  snoozedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  // user: explicit "wake now". activity: real work arrived (user message /
  // session coming alive) and the decider cleared the snooze — mirrors
  // thread.unsettled's activity resets. Timer wakes emit no event: clients
  // derive them from snoozedUntil passing.
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  /** Intent marker consumed by the title-generation reactor. Keeping this on
      the existing event lets older clients safely ignore the new field. */
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  /** Title at request time, used to avoid overwriting a later manual rename. */
  previousTitle: Schema.optional(TrimmedNonEmptyString),
  /** Pending state shared with clients. Null clears a matching request. */
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const MissionCreatedPayload = Schema.Struct({
  mission: Mission,
});

export const MissionUpdatedPayload = Schema.Struct({
  missionId: MissionId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  status: Schema.optional(MissionStatus),
  updatedAt: IsoDateTime,
});

export const MissionStartedPayload = Schema.Struct({
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: AgentRunId,
  startedAt: IsoDateTime,
});

export const MissionCancellationRequestedPayload = Schema.Struct({
  missionId: MissionId,
  // Kept for decoding Phase 1 events. New events populate `agentRunIds` and
  // set this to the first active run (or null) for older clients.
  agentRunId: Schema.NullOr(AgentRunId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  agentRunIds: Schema.Array(AgentRunId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  requestedAt: IsoDateTime,
});

export const missionCancellationAgentRunIds = (
  payload: typeof MissionCancellationRequestedPayload.Type,
): ReadonlyArray<AgentRunId> =>
  payload.agentRunIds.length > 0
    ? payload.agentRunIds
    : payload.agentRunId === null
      ? []
      : [payload.agentRunId];

export const MissionCancelledPayload = Schema.Struct({
  missionId: MissionId,
  agentRunId: Schema.NullOr(AgentRunId),
  cancelledAt: IsoDateTime,
});

export const MissionCompletedPayload = Schema.Struct({
  missionId: MissionId,
  agentRunId: Schema.NullOr(AgentRunId),
  completedAt: IsoDateTime,
});

export const MissionFailedPayload = Schema.Struct({
  missionId: MissionId,
  agentRunId: AgentRunId,
  errorSummary: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
});

export const MissionRecoveryBlockedPayload = Schema.Struct({
  missionId: MissionId,
  agentRunId: AgentRunId,
  reason: TrimmedNonEmptyString,
  recoveredAt: IsoDateTime,
});

export const MissionTaskCreatedPayload = Schema.Struct({
  task: MissionTask,
});

export const MissionTaskUpdatedPayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  status: Schema.optional(MissionTaskStatus),
  position: Schema.optional(NonNegativeInt),
  assignedMissionAgentId: Schema.optional(Schema.NullOr(MissionAgentId)),
  maximumAttempts: Schema.optional(PositiveInt),
  requiresDependencyHandoffs: Schema.optional(Schema.Boolean),
  updatedAt: IsoDateTime,
});

export const MissionTaskLifecyclePayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  agentRunId: Schema.NullOr(AgentRunId),
  occurredAt: IsoDateTime,
  errorSummary: Schema.optional(TrimmedNonEmptyString),
});

export const AgentRunStartedPayload = Schema.Struct({
  run: AgentRun,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
});

export const AgentRunLifecyclePayload = Schema.Struct({
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  agentRunId: AgentRunId,
  providerSessionId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  occurredAt: IsoDateTime,
  errorSummary: Schema.optional(TrimmedNonEmptyString),
  runtimeErrorClass: Schema.optional(Schema.NullOr(RuntimeErrorClass)),
});

export const MissionTeamConfiguredPayload = Schema.Struct({
  missionId: MissionId,
  settings: MissionTeamSettings,
  updatedAt: IsoDateTime,
});

export const MissionAgentUpsertedPayload = Schema.Struct({
  agent: MissionAgent,
});

export const MissionAgentRemovedPayload = Schema.Struct({
  missionId: MissionId,
  missionAgentId: MissionAgentId,
  removedAt: IsoDateTime,
});

export const MissionAgentPermissionsUpdatedPayload = Schema.Struct({
  missionId: MissionId,
  missionAgentId: MissionAgentId,
  permissions: AgentPermissions,
  updatedAt: IsoDateTime,
});

export const MissionTaskDependencyAddedPayload = Schema.Struct({
  dependency: TaskDependency,
});

export const MissionTaskDependencyRemovedPayload = Schema.Struct({
  missionId: MissionId,
  dependencyId: TaskDependencyId,
  taskId: MissionTaskId,
  dependsOnTaskId: MissionTaskId,
  removedAt: IsoDateTime,
});

export const MissionTaskReadyPayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  readyAt: IsoDateTime,
});

export const MissionTaskBlockedPayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  reason: TrimmedNonEmptyString,
  blockedAt: IsoDateTime,
});

export const MissionTaskRetryRequestedPayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  reason: TrimmedNonEmptyString,
  attemptNumber: PositiveInt,
  requestedAt: IsoDateTime,
});

export const MissionTaskCancellationRequestedPayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  requestedAt: IsoDateTime,
});

export const ManagedWorktreeRecordedPayload = Schema.Struct({
  worktree: ManagedWorktree,
});

export const ManagedWorktreeStatusUpdatedPayload = Schema.Struct({
  missionId: MissionId,
  worktreeId: ManagedWorktreeId,
  status: ManagedWorktreeStatus,
  headCommit: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  changedFileCount: Schema.optional(NonNegativeInt),
  hasUncommittedChanges: Schema.optional(Schema.Boolean),
  conflictingFiles: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  errorSummary: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  removedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  updatedAt: IsoDateTime,
});

export const ManagedWorktreeRemovalRequestedPayload = Schema.Struct({
  missionId: MissionId,
  worktreeId: ManagedWorktreeId,
  requestedAt: IsoDateTime,
});

export const AgentHandoffCreatedPayload = Schema.Struct({
  handoff: AgentHandoff,
});

export const AgentHandoffReconciledPayload = Schema.Struct({
  missionId: MissionId,
  handoffId: AgentHandoffId,
  reconciliationStatus: Schema.Literals(["matched", "corrected"]),
  changedFiles: Schema.Array(AgentHandoffChangedFile),
  reconciledAt: IsoDateTime,
});

export const MissionSchedulerLifecyclePayload = Schema.Struct({
  missionId: MissionId,
  status: MissionSchedulerStatus,
  occurredAt: IsoDateTime,
});

export const MissionSchedulerConcurrencyLimitedPayload = Schema.Struct({
  missionId: MissionId,
  maximumConcurrentAgents: PositiveInt,
  maximumConcurrentWriteAgents: PositiveInt,
  observedAt: IsoDateTime,
});

export const MissionIntegrationLifecyclePayload = Schema.Struct({
  missionId: MissionId,
  taskId: MissionTaskId,
  worktreeId: ManagedWorktreeId,
  integrationStatus: TaskIntegrationStatus,
  occurredAt: IsoDateTime,
  headCommit: Schema.optional(TrimmedNonEmptyString),
  conflictingFiles: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  errorSummary: Schema.optional(TrimmedNonEmptyString),
});

export const VerificationProfileLifecyclePayload = Schema.Struct({
  profile: VerificationProfile,
  occurredAt: IsoDateTime,
});

export const VerificationSettingsUpdatedPayload = Schema.Struct({
  settings: VerificationProjectSettings,
  actor: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
});

export const VerificationRequestedPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  worktreeId: Schema.NullOr(ManagedWorktreeId),
  profileId: Schema.NullOr(VerificationProfileId),
  requestedBy: TrimmedNonEmptyString,
  trigger: VerificationRunTrigger,
  scope: Schema.NullOr(VerificationRequestScope),
  requestedAt: IsoDateTime,
});

export const VerificationRequestFailedPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  failureCategory: VerificationFailureCategory,
  summary: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
});

export const VerificationRunLifecyclePayload = Schema.Struct({
  run: VerificationRun,
  occurredAt: IsoDateTime,
});

export const VerificationCancelRequestedPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

export const VerificationGateLifecyclePayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  gateId: VerificationGateId,
  name: TrimmedNonEmptyString,
  summary: Schema.NullOr(Schema.String),
  occurredAt: IsoDateTime,
});

export const VerificationCheckLifecyclePayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  checkRun: VerificationCheckRun,
  occurredAt: IsoDateTime,
});

export const VerificationCheckOutputPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  checkRunId: VerificationCheckRunId,
  logReference: TrimmedNonEmptyString,
  stdoutBytes: NonNegativeInt,
  stderrBytes: NonNegativeInt,
  truncated: Schema.Boolean,
  occurredAt: IsoDateTime,
});

export const VerificationDiagnosticCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  verificationRunId: VerificationRunId,
  diagnostic: VerificationDiagnostic,
  occurredAt: IsoDateTime,
});

export const VerificationArtifactCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  artifact: VerificationArtifact,
  occurredAt: IsoDateTime,
});

export const VerificationRepairRequestedPayload = Schema.Struct({
  projectId: ProjectId,
  missionId: MissionId,
  taskId: MissionTaskId,
  verificationRunId: VerificationRunId,
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

export const VerificationRepairLifecyclePayload = Schema.Struct({
  projectId: ProjectId,
  missionId: MissionId,
  attempt: VerificationRepairAttempt,
  summary: Schema.NullOr(Schema.String),
  occurredAt: IsoDateTime,
});

export const VerificationOverrideRequestedPayload = Schema.Struct({
  overrideId: VerificationOverrideId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: MissionTaskId,
  verificationRunId: Schema.NullOr(VerificationRunId),
  sourceFingerprint: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});

export const VerificationOverrideAppliedPayload = Schema.Struct({
  override: VerificationOverride,
  occurredAt: IsoDateTime,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([
    ProjectId,
    ThreadId,
    MissionId,
    MemoryAggregateId,
    RoutingAggregateId,
  ]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.settled"),
    payload: ThreadSettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unsettled"),
    payload: ThreadUnsettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.snoozed"),
    payload: ThreadSnoozedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unsnoozed"),
    payload: ThreadUnsnoozedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.created"),
    payload: MissionCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.updated"),
    payload: MissionUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.started"),
    payload: MissionStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.cancellation-requested"),
    payload: MissionCancellationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.cancelled"),
    payload: MissionCancelledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.completed"),
    payload: MissionCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.failed"),
    payload: MissionFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.recovery-blocked"),
    payload: MissionRecoveryBlockedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.created"),
    payload: MissionTaskCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.updated"),
    payload: MissionTaskUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.started"),
    payload: MissionTaskLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.implementation-completed"),
    payload: MissionTaskLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.completed"),
    payload: MissionTaskLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.cancelled"),
    payload: MissionTaskLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.failed"),
    payload: MissionTaskLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.started"),
    payload: AgentRunStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.running"),
    payload: AgentRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.cancellation-requested"),
    payload: AgentRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.completed"),
    payload: AgentRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.cancelled"),
    payload: AgentRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.failed"),
    payload: AgentRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_run.interrupted"),
    payload: AgentRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.team-configured"),
    payload: MissionTeamConfiguredPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.agent-upserted"),
    payload: MissionAgentUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.agent-removed"),
    payload: MissionAgentRemovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("mission.agent-permissions-updated"),
    payload: MissionAgentPermissionsUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.dependency-added"),
    payload: MissionTaskDependencyAddedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.dependency-removed"),
    payload: MissionTaskDependencyRemovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.ready"),
    payload: MissionTaskReadyPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.blocked"),
    payload: MissionTaskBlockedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.retry-requested"),
    payload: MissionTaskRetryRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.cancellation-requested"),
    payload: MissionTaskCancellationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("managed_worktree.recorded"),
    payload: ManagedWorktreeRecordedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("managed_worktree.status-updated"),
    payload: ManagedWorktreeStatusUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("managed_worktree.removal-requested"),
    payload: ManagedWorktreeRemovalRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_handoff.created"),
    payload: AgentHandoffCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("agent_handoff.reconciled"),
    payload: AgentHandoffReconciledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("scheduler.started"),
    payload: MissionSchedulerLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("scheduler.paused"),
    payload: MissionSchedulerLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("scheduler.resumed"),
    payload: MissionSchedulerLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("scheduler.concurrency-limited"),
    payload: MissionSchedulerConcurrencyLimitedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.requested"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.approved"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.started"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.completed"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.conflicted"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.aborted"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("integration.failed"),
    payload: MissionIntegrationLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.settings_updated"),
    payload: VerificationSettingsUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.profile_created"),
    payload: VerificationProfileLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.profile_updated"),
    payload: VerificationProfileLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.requested"),
    payload: VerificationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.request_failed"),
    payload: VerificationRequestFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.plan_created"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.queued"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.started"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.cancel_requested"),
    payload: VerificationCancelRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.cancelled"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.interrupted"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.passed"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.passed_with_warnings"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.failed"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.invalidated"),
    payload: VerificationRunLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.gate_started"),
    payload: VerificationGateLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.gate_completed"),
    payload: VerificationGateLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.gate_failed"),
    payload: VerificationGateLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.gate_skipped"),
    payload: VerificationGateLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_started"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_output"),
    payload: VerificationCheckOutputPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_passed"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_warned"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_failed"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_timed_out"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_cancelled"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_interrupted"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.check_skipped"),
    payload: VerificationCheckLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.diagnostic_created"),
    payload: VerificationDiagnosticCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.artifact_created"),
    payload: VerificationArtifactCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.repair_requested"),
    payload: VerificationRepairRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.repair_started"),
    payload: VerificationRepairLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.repair_completed"),
    payload: VerificationRepairLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.repair_failed"),
    payload: VerificationRepairLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.repair_limit_reached"),
    payload: VerificationRepairLifecyclePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.override_requested"),
    payload: VerificationOverrideRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("verification.override_applied"),
    payload: VerificationOverrideAppliedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: GitHubOrchestrationEventType,
    payload: GitHubEventReferencePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: MemoryOrchestrationEventType,
    payload: MemoryEventReferencePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: RoutingOrchestrationEventType,
    payload: RoutingEventReferencePayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationMissionDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  mission: Mission,
  tasks: Schema.Array(MissionTask),
  agentRuns: Schema.Array(AgentRun),
  agentRoles: Schema.Array(AgentRole).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  missionAgents: Schema.Array(MissionAgent).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  taskDependencies: Schema.Array(TaskDependency).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  managedWorktrees: Schema.Array(ManagedWorktree).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  agentHandoffs: Schema.Array(AgentHandoff).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  events: Schema.Array(OrchestrationEvent),
});
export type OrchestrationMissionDetailSnapshot = typeof OrchestrationMissionDetailSnapshot.Type;

export const OrchestrationMissionStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationMissionDetailSnapshot,
  }),
  Schema.Struct({ kind: Schema.Literal("event"), event: OrchestrationEvent }),
]);
export type OrchestrationMissionStreamItem = typeof OrchestrationMissionStreamItem.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("synchronized"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationThreadSearchSource = Schema.Literals(["user", "assistant"]);
export type OrchestrationThreadSearchSource = typeof OrchestrationThreadSearchSource.Type;

// The server's SQLite client is synchronous and single-connection. Bound both
// scan input and response size so a search cannot monopolize that connection.
export const OrchestrationSearchThreadsInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type OrchestrationSearchThreadsInput = typeof OrchestrationSearchThreadsInput.Type;

export const OrchestrationThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String.check(Schema.isMaxLength(240)),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadSearchMatch = typeof OrchestrationThreadSearchMatch.Type;

export const OrchestrationSearchThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
});
export type OrchestrationSearchThreadsResult = typeof OrchestrationSearchThreadsResult.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  searchThreads: {
    input: OrchestrationSearchThreadsInput,
    output: OrchestrationSearchThreadsResult,
  },
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: OrchestrationSubscribeShellInput,
    output: OrchestrationShellStreamItem,
  },
  subscribeMissions: {
    input: OrchestrationSubscribeMissionsInput,
    output: OrchestrationMissionBoardStreamItem,
  },
  subscribeMission: {
    input: OrchestrationSubscribeMissionInput,
    output: OrchestrationMissionStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationSearchThreadsError extends Schema.TaggedErrorClass<OrchestrationSearchThreadsError>()(
  "OrchestrationSearchThreadsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
