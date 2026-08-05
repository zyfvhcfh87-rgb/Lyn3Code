import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "./background.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import { AssetAccessError, AssetCreateUrlInput, AssetCreateUrlResult } from "./assets.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationSearchThreadsInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationRpcSchemas,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsError,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  DiscoveredLocalServerList,
  PreviewCloseInput,
  PreviewError,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewNavigateInput,
  PreviewOpenInput,
  PreviewRefreshInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewSessionSnapshot,
} from "./preview.ts";
import {
  PreviewAutomationError,
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
} from "./previewAutomation.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerSelfUpdateInput,
  ServerSelfUpdateProgressEvent,
  ServerSelfUpdateResult,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import {
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryRetryResult,
  ResourceTelemetrySnapshot,
} from "./resourceTelemetry.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";
import {
  GitHubAccount,
  GitHubAccountId,
  GitHubBranchObservation,
  GitHubIssuePageSnapshot,
  GitHubIssueState,
  GitHubPullRequestDetailSnapshot,
  GitHubPullRequestPageSnapshot,
  GitHubRepositoryWorkspaceSnapshot,
  GitHubSyncResourceType,
  GitHubWorkspaceMutationError,
  GitHubWorkspaceQueryError,
  IssueMissionLink,
  IssueMissionLinkType,
  MissionPullRequestLink,
  PullRequestRecord,
  PullRequestState,
  RepositoryConnection,
  RepositoryConnectionId,
  ReviewCommentRecordId,
  ReviewCommentTaskLink,
  ReviewThreadRecord,
  ReviewThreadRecordId,
} from "./github.ts";
import {
  AddMemorySourceInput,
  CreateMemoryEntryInput,
  CreateMemoryProposalInput,
  CreateMemoryRelationInput,
  IndexedSourceListInput,
  IndexedSourcePage,
  MemoryConflictError,
  MemoryEntry,
  MemoryEntryActionInput,
  MemoryEntryDetail,
  MemoryEntryId,
  MemoryEntryPage,
  MemoryExportBundle,
  MemoryImportInput,
  MemoryImportResult,
  MemoryIndexOperation,
  MemoryIndexRequest,
  MemoryListFilter,
  MemoryNotFoundError,
  MemoryProposal,
  MemoryProposalListFilter,
  MemoryProposalPage,
  MemoryRelation,
  MemoryRetrievalListInput,
  MemoryRetrievalRecord,
  MemoryRetrievalRecordId,
  MemoryRetrievalRecordPage,
  MemorySearchInput,
  MemorySearchResult,
  MemorySource,
  MemoryUnavailableError,
  MemoryValidationError,
  MemoryWorkspaceSnapshot,
  ReviewMemoryProposalInput,
  SupersedeMemoryEntryInput,
  UpdateMemoryEntryInput,
  UpdateMemorySettingsInput,
} from "./memory.ts";
import {
  VerificationLogPage,
  VerificationArtifactAccessError,
  VerificationArtifactAccessUrl,
  VerificationQueryError,
  VerificationRunComparison,
  VerificationRunEvidence,
  VerificationRunHistoryPage,
  VerificationTaskSummary,
  VerificationProjectConfigurationSnapshot,
} from "./verification.ts";
import {
  RoutingAssessmentMutationResult,
  RoutingCapabilitySnapshotMutationResult,
  RoutingDecisionDetail,
  RoutingDecisionLookupInput,
  RoutingHistoryInput,
  RoutingHistoryPage,
  RoutingOverrideMutationResult,
  RoutingModelProfileMutationResult,
  RoutingPolicyMutationResult,
  RoutingProviderProfileMutationResult,
  RoutingRefreshRegistryInput,
  RoutingRegistrySnapshot,
  RoutingRevokeOverrideInput,
  RoutingRpcError,
  RoutingRuleMutationResult,
  RoutingSaveAssessmentInput,
  RoutingSaveCapabilitySnapshotInput,
  RoutingSaveModelProfileInput,
  RoutingSaveOverrideInput,
  RoutingSavePolicyInput,
  RoutingSaveProviderProfileInput,
  RoutingSaveRuleInput,
  RoutingSimulationInput,
  RoutingSimulationResult,
  RoutingStartMissionInput,
  RoutingStartMissionResult,
  RoutingWorkspaceScope,
  RoutingWorkspaceSnapshot,
} from "./routingRpc.ts";
import {
  AnalyticsAggregateRebuildInput,
  AnalyticsAlert,
  AnalyticsAlertAcknowledgeInput,
  AnalyticsAnnotation,
  AnalyticsAnnotationSaveInput,
  AnalyticsExport,
  AnalyticsExportCreateInput,
  AnalyticsFilterInput,
  AnalyticsNotFoundError,
  AnalyticsRetentionOperation,
  AnalyticsRetentionStartInput,
  AnalyticsRunDetail,
  AnalyticsRunDetailInput,
  AnalyticsSettings,
  AnalyticsSettingsUpdateInput,
  AnalyticsUnavailableError,
  AnalyticsValidationError,
  AnalyticsWorkspaceSnapshot,
  BudgetEvent,
  BudgetEventAcknowledgeInput,
  BudgetOverride,
  BudgetOverrideCreateInput,
  BudgetPolicy,
  BudgetPolicySaveInput,
  HumanDispositionRecord,
  HumanDispositionRecordInput,
  ExchangeRateSnapshot,
  ExchangeRateSnapshotSaveInput,
  PricingSnapshot,
  PricingSnapshotSaveInput,
  SubscriptionAttributionRule,
  SubscriptionAttributionRuleSaveInput,
} from "./analytics.ts";
import {
  MissionTaskId,
  MissionId,
  MissionAgentId,
  ProjectId,
  VerificationCheckRunId,
  VerificationArtifactId,
  VerificationRunId,
} from "./baseSchemas.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",
  assetsCreateUrl: "assets.createUrl",

  // Verification evidence and configuration
  verificationGetProjectConfiguration: "verification.getProjectConfiguration",
  verificationListRuns: "verification.listRuns",
  verificationGetRunEvidence: "verification.getRunEvidence",
  verificationGetTaskSummaries: "verification.getTaskSummaries",
  verificationCompareRuns: "verification.compareRuns",
  verificationReadLog: "verification.readLog",
  verificationCreateArtifactUrl: "verification.createArtifactUrl",
  verificationSubscribeRun: "verification.subscribeRun",

  // GitHub engineering workspace
  githubListAccounts: "github.listAccounts",
  githubConnectAccount: "github.connectAccount",
  githubDisconnectAccount: "github.disconnectAccount",
  githubConnectRepository: "github.connectRepository",
  githubDisconnectRepository: "github.disconnectRepository",
  githubGetWorkspace: "github.getWorkspace",
  githubListIssues: "github.listIssues",
  githubListPullRequests: "github.listPullRequests",
  githubGetPullRequest: "github.getPullRequest",
  githubRefresh: "github.refresh",
  githubCreateMissionFromIssue: "github.createMissionFromIssue",
  githubLinkIssueMission: "github.linkIssueMission",
  githubCreateReviewTask: "github.createReviewTask",
  githubPushBranch: "github.pushBranch",
  githubCreatePullRequest: "github.createPullRequest",
  githubUpdatePullRequest: "github.updatePullRequest",
  githubMarkReadyForReview: "github.markReadyForReview",
  githubResolveReviewThread: "github.resolveReviewThread",
  githubSubscribeWorkspace: "github.subscribeWorkspace",

  // Persistent project memory
  memoryGetWorkspace: "memory.getWorkspace",
  memoryListEntries: "memory.listEntries",
  memoryGetEntry: "memory.getEntry",
  memoryCreateEntry: "memory.createEntry",
  memoryUpdateEntry: "memory.updateEntry",
  memoryActionEntry: "memory.actionEntry",
  memorySupersedeEntry: "memory.supersedeEntry",
  memoryAddSource: "memory.addSource",
  memoryCreateRelation: "memory.createRelation",
  memoryListProposals: "memory.listProposals",
  memoryCreateProposal: "memory.createProposal",
  memoryReviewProposal: "memory.reviewProposal",
  memoryListIndexedSources: "memory.listIndexedSources",
  memoryRequestIndex: "memory.requestIndex",
  memorySearch: "memory.search",
  memoryListRetrievals: "memory.listRetrievals",
  memoryGetRetrieval: "memory.getRetrieval",
  memoryUpdateSettings: "memory.updateSettings",
  memoryExport: "memory.export",
  memoryImport: "memory.import",
  memorySubscribeWorkspace: "memory.subscribeWorkspace",

  // Intelligent provider and model routing
  routingGetRegistry: "routing.getRegistry",
  routingGetWorkspace: "routing.getWorkspace",
  routingGetDecision: "routing.getDecision",
  routingListHistory: "routing.listHistory",
  routingSimulate: "routing.simulate",
  routingStartMission: "routing.startMission",
  routingSavePolicy: "routing.savePolicy",
  routingSaveRule: "routing.saveRule",
  routingSaveOverride: "routing.saveOverride",
  routingRevokeOverride: "routing.revokeOverride",
  routingSaveAssessment: "routing.saveAssessment",
  routingSaveProviderProfile: "routing.saveProviderProfile",
  routingSaveModelProfile: "routing.saveModelProfile",
  routingSaveCapabilitySnapshot: "routing.saveCapabilitySnapshot",
  routingRefreshRegistry: "routing.refreshRegistry",
  routingSubscribeWorkspace: "routing.subscribeWorkspace",

  // Usage, cost, performance, and outcome analytics
  analyticsGetWorkspace: "analytics.getWorkspace",
  analyticsGetRunDetail: "analytics.getRunDetail",
  analyticsUpdateSettings: "analytics.updateSettings",
  analyticsSaveBudget: "analytics.saveBudget",
  analyticsSavePricingSnapshot: "analytics.savePricingSnapshot",
  analyticsSaveSubscriptionAttributionRule: "analytics.saveSubscriptionAttributionRule",
  analyticsSaveExchangeRateSnapshot: "analytics.saveExchangeRateSnapshot",
  analyticsAcknowledgeBudgetEvent: "analytics.acknowledgeBudgetEvent",
  analyticsCreateBudgetOverride: "analytics.createBudgetOverride",
  analyticsAcknowledgeAlert: "analytics.acknowledgeAlert",
  analyticsSaveAnnotation: "analytics.saveAnnotation",
  analyticsRecordHumanDisposition: "analytics.recordHumanDisposition",
  analyticsCreateExport: "analytics.createExport",
  analyticsStartRetention: "analytics.startRetention",
  analyticsRebuildAggregates: "analytics.rebuildAggregates",
  analyticsSubscribeWorkspace: "analytics.subscribeWorkspace",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Review methods
  reviewGetDiffPreview: "review.getDiffPreview",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Preview methods
  previewOpen: "preview.open",
  previewNavigate: "preview.navigate",
  previewResize: "preview.resize",
  previewRefresh: "preview.refresh",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewReportStatus: "preview.reportStatus",
  previewAutomationConnect: "previewAutomation.connect",
  previewAutomationRespond: "previewAutomation.respond",
  previewAutomationFocusHost: "previewAutomation.focusHost",

  // Server meta
  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",

  // Cloud environment methods
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeBackgroundPolicy: "subscribeBackgroundPolicy",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
  error: EnvironmentAuthorizationError,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateServerRpc = Rpc.make(WS_METHODS.serverUpdateServer, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateServerWithProgressRpc = Rpc.make(
  WS_METHODS.serverUpdateServerWithProgress,
  {
    payload: ServerSelfUpdateInput,
    success: ServerSelfUpdateProgressEvent,
    error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
    error: EnvironmentAuthorizationError,
  },
);

export const WsServerGetResourceTelemetryHistoryRpc = Rpc.make(
  WS_METHODS.serverGetResourceTelemetryHistory,
  {
    payload: ResourceTelemetryHistoryInput,
    success: ResourceTelemetryHistory,
    error: EnvironmentAuthorizationError,
  },
);

export const WsServerRetryResourceTelemetryRpc = Rpc.make(WS_METHODS.serverRetryResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetryRetryResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
  error: EnvironmentAuthorizationError,
});

export const WsCloudGetRelayClientStatusRpc = Rpc.make(WS_METHODS.cloudGetRelayClientStatus, {
  payload: Schema.Struct({}),
  success: RelayClientStatusSchema,
  error: EnvironmentAuthorizationError,
});

export const WsCloudInstallRelayClientRpc = Rpc.make(WS_METHODS.cloudInstallRelayClient, {
  payload: Schema.Struct({}),
  success: RelayClientInstallProgressEventSchema,
  error: Schema.Union([RelayClientInstallFailedError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsServerReportClientActivityRpc = Rpc.make(WS_METHODS.serverReportClientActivity, {
  payload: ClientActivityReportInput,
  error: EnvironmentAuthorizationError,
});

export const WsServerReportHostPowerStateRpc = Rpc.make(WS_METHODS.serverReportHostPowerState, {
  payload: HostPowerSnapshot,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetBackgroundPolicyRpc = Rpc.make(WS_METHODS.serverGetBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
});

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

export const WsSourceControlPublishRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlPublishRepository,
  {
    payload: SourceControlPublishRepositoryInput,
    success: SourceControlPublishRepositoryResult,
    error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

export const WsProjectsSearchContentsRpc = Rpc.make(WS_METHODS.projectsSearchContents, {
  payload: ProjectSearchContentsInput,
  success: ProjectSearchContentsResult,
  error: Schema.Union([ProjectSearchContentsError, EnvironmentAuthorizationError]),
});

export const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: Schema.Union([ProjectListEntriesError, EnvironmentAuthorizationError]),
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: Schema.Union([ProjectReadFileError, EnvironmentAuthorizationError]),
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError]),
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

export const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

export const WsVerificationGetProjectConfigurationRpc = Rpc.make(
  WS_METHODS.verificationGetProjectConfiguration,
  {
    payload: Schema.Struct({ projectId: ProjectId }),
    success: VerificationProjectConfigurationSnapshot,
    error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
  },
);

export const WsVerificationListRunsRpc = Rpc.make(WS_METHODS.verificationListRuns, {
  payload: Schema.Struct({
    projectId: ProjectId,
    taskId: Schema.NullOr(MissionTaskId),
    cursor: Schema.NullOr(Schema.String),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  }),
  success: VerificationRunHistoryPage,
  error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
});

export const WsVerificationGetRunEvidenceRpc = Rpc.make(WS_METHODS.verificationGetRunEvidence, {
  payload: Schema.Struct({ verificationRunId: VerificationRunId }),
  success: VerificationRunEvidence,
  error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
});

export const WsVerificationGetTaskSummariesRpc = Rpc.make(WS_METHODS.verificationGetTaskSummaries, {
  payload: Schema.Struct({ projectId: ProjectId, taskIds: Schema.Array(MissionTaskId) }),
  success: Schema.Array(VerificationTaskSummary),
  error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
});

export const WsVerificationCompareRunsRpc = Rpc.make(WS_METHODS.verificationCompareRuns, {
  payload: Schema.Struct({
    previousRunId: VerificationRunId,
    currentRunId: VerificationRunId,
  }),
  success: VerificationRunComparison,
  error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
});

export const WsVerificationReadLogRpc = Rpc.make(WS_METHODS.verificationReadLog, {
  payload: Schema.Struct({
    verificationRunId: VerificationRunId,
    checkRunId: VerificationCheckRunId,
    cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
  }),
  success: VerificationLogPage,
  error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
});

export const WsVerificationCreateArtifactUrlRpc = Rpc.make(
  WS_METHODS.verificationCreateArtifactUrl,
  {
    payload: Schema.Struct({
      verificationRunId: VerificationRunId,
      artifactId: VerificationArtifactId,
    }),
    success: VerificationArtifactAccessUrl,
    error: Schema.Union([VerificationArtifactAccessError, EnvironmentAuthorizationError]),
  },
);

export const WsVerificationSubscribeRunRpc = Rpc.make(WS_METHODS.verificationSubscribeRun, {
  payload: Schema.Struct({ verificationRunId: VerificationRunId }),
  success: VerificationRunEvidence,
  error: Schema.Union([VerificationQueryError, EnvironmentAuthorizationError]),
  stream: true,
});

const GitHubReadRpcError = Schema.Union([GitHubWorkspaceQueryError, EnvironmentAuthorizationError]);
const GitHubMutationRpcError = Schema.Union([
  GitHubWorkspaceMutationError,
  EnvironmentAuthorizationError,
]);

export const GitHubConnectAccountInput = Schema.Struct({
  serverUrl: Schema.String,
});
export type GitHubConnectAccountInput = typeof GitHubConnectAccountInput.Type;

export const GitHubConnectRepositoryInput = Schema.Struct({
  projectId: ProjectId,
  githubAccountId: GitHubAccountId,
  repositoryUrl: Schema.NullOr(Schema.String),
  owner: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  remoteName: Schema.NullOr(Schema.String),
});
export type GitHubConnectRepositoryInput = typeof GitHubConnectRepositoryInput.Type;

export const GitHubIssueQueryInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  state: Schema.NullOr(GitHubIssueState),
  search: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.String),
  assignee: Schema.NullOr(Schema.String),
  milestone: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.NullOr(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  refresh: Schema.Boolean,
});
export type GitHubIssueQueryInput = typeof GitHubIssueQueryInput.Type;

export const GitHubPullRequestQueryInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  state: Schema.NullOr(PullRequestState),
  search: Schema.NullOr(Schema.String),
  cursor: Schema.NullOr(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  refresh: Schema.Boolean,
});
export type GitHubPullRequestQueryInput = typeof GitHubPullRequestQueryInput.Type;

export const GitHubCreateMissionFromIssueInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  issueNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  linkType: IssueMissionLinkType,
  selectedCommentIds: Schema.Array(Schema.String).pipe(Schema.mutable),
});
export type GitHubCreateMissionFromIssueInput = typeof GitHubCreateMissionFromIssueInput.Type;

export const GitHubCreateMissionFromIssueResult = Schema.Struct({
  missionId: MissionId,
  link: IssueMissionLink,
  duplicatePrevented: Schema.Boolean,
});
export type GitHubCreateMissionFromIssueResult = typeof GitHubCreateMissionFromIssueResult.Type;

export const GitHubLinkIssueMissionInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  issueNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  missionId: MissionId,
  linkType: IssueMissionLinkType,
});
export type GitHubLinkIssueMissionInput = typeof GitHubLinkIssueMissionInput.Type;

export const GitHubCreateReviewTaskInput = Schema.Struct({
  reviewCommentRecordId: ReviewCommentRecordId,
  missionId: MissionId,
  assignedMissionAgentId: Schema.NullOr(MissionAgentId),
  title: Schema.NullOr(Schema.String),
});
export type GitHubCreateReviewTaskInput = typeof GitHubCreateReviewTaskInput.Type;

export const GitHubCreateReviewTaskResult = Schema.Struct({
  taskId: MissionTaskId,
  link: ReviewCommentTaskLink,
});
export type GitHubCreateReviewTaskResult = typeof GitHubCreateReviewTaskResult.Type;

export const GitHubPushBranchInput = Schema.Struct({
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  repositoryConnectionId: RepositoryConnectionId,
  branchName: Schema.String,
  expectedHeadSha: Schema.String,
  confirmation: Schema.Literal(true),
});
export type GitHubPushBranchInput = typeof GitHubPushBranchInput.Type;

export const GitHubPushBranchResult = Schema.Struct({
  observation: GitHubBranchObservation,
  confirmedRemoteSha: Schema.String,
});
export type GitHubPushBranchResult = typeof GitHubPushBranchResult.Type;

export const GitHubCreatePullRequestInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  headBranch: Schema.String,
  baseBranch: Schema.String,
  title: Schema.String,
  draft: Schema.Boolean,
  linkedIssueNumber: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  closeLinkedIssue: Schema.Boolean,
  bodyOverride: Schema.NullOr(Schema.String),
  expectedHeadSha: Schema.String,
  confirmation: Schema.Literal(true),
});
export type GitHubCreatePullRequestInput = typeof GitHubCreatePullRequestInput.Type;

export const GitHubCreatePullRequestResult = Schema.Struct({
  pullRequest: PullRequestRecord,
  missionLink: MissionPullRequestLink,
});
export type GitHubCreatePullRequestResult = typeof GitHubCreatePullRequestResult.Type;

export const GitHubUpdatePullRequestInput = Schema.Struct({
  repositoryConnectionId: RepositoryConnectionId,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
});
export type GitHubUpdatePullRequestInput = typeof GitHubUpdatePullRequestInput.Type;

export const WsGitHubListAccountsRpc = Rpc.make(WS_METHODS.githubListAccounts, {
  payload: Schema.Struct({ includeDisconnected: Schema.Boolean }),
  success: Schema.Array(GitHubAccount),
  error: GitHubReadRpcError,
});

export const WsGitHubConnectAccountRpc = Rpc.make(WS_METHODS.githubConnectAccount, {
  payload: GitHubConnectAccountInput,
  success: GitHubAccount,
  error: GitHubMutationRpcError,
});

export const WsGitHubDisconnectAccountRpc = Rpc.make(WS_METHODS.githubDisconnectAccount, {
  payload: Schema.Struct({ githubAccountId: GitHubAccountId }),
  success: GitHubAccount,
  error: GitHubMutationRpcError,
});

export const WsGitHubConnectRepositoryRpc = Rpc.make(WS_METHODS.githubConnectRepository, {
  payload: GitHubConnectRepositoryInput,
  success: RepositoryConnection,
  error: GitHubMutationRpcError,
});

export const WsGitHubDisconnectRepositoryRpc = Rpc.make(WS_METHODS.githubDisconnectRepository, {
  payload: Schema.Struct({ repositoryConnectionId: RepositoryConnectionId }),
  success: Schema.Void,
  error: GitHubMutationRpcError,
});

export const WsGitHubGetWorkspaceRpc = Rpc.make(WS_METHODS.githubGetWorkspace, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: Schema.NullOr(GitHubRepositoryWorkspaceSnapshot),
  error: GitHubReadRpcError,
});

export const WsGitHubListIssuesRpc = Rpc.make(WS_METHODS.githubListIssues, {
  payload: GitHubIssueQueryInput,
  success: GitHubIssuePageSnapshot,
  error: GitHubReadRpcError,
});

export const WsGitHubListPullRequestsRpc = Rpc.make(WS_METHODS.githubListPullRequests, {
  payload: GitHubPullRequestQueryInput,
  success: GitHubPullRequestPageSnapshot,
  error: GitHubReadRpcError,
});

export const WsGitHubGetPullRequestRpc = Rpc.make(WS_METHODS.githubGetPullRequest, {
  payload: Schema.Struct({
    repositoryConnectionId: RepositoryConnectionId,
    number: Schema.Int.check(Schema.isGreaterThan(0)),
    refresh: Schema.Boolean,
  }),
  success: GitHubPullRequestDetailSnapshot,
  error: GitHubReadRpcError,
});

export const WsGitHubRefreshRpc = Rpc.make(WS_METHODS.githubRefresh, {
  payload: Schema.Struct({
    repositoryConnectionId: RepositoryConnectionId,
    resources: Schema.Array(GitHubSyncResourceType),
  }),
  success: GitHubRepositoryWorkspaceSnapshot,
  error: GitHubMutationRpcError,
});

export const WsGitHubCreateMissionFromIssueRpc = Rpc.make(WS_METHODS.githubCreateMissionFromIssue, {
  payload: GitHubCreateMissionFromIssueInput,
  success: GitHubCreateMissionFromIssueResult,
  error: GitHubMutationRpcError,
});

export const WsGitHubLinkIssueMissionRpc = Rpc.make(WS_METHODS.githubLinkIssueMission, {
  payload: GitHubLinkIssueMissionInput,
  success: IssueMissionLink,
  error: GitHubMutationRpcError,
});

export const WsGitHubCreateReviewTaskRpc = Rpc.make(WS_METHODS.githubCreateReviewTask, {
  payload: GitHubCreateReviewTaskInput,
  success: GitHubCreateReviewTaskResult,
  error: GitHubMutationRpcError,
});

export const WsGitHubPushBranchRpc = Rpc.make(WS_METHODS.githubPushBranch, {
  payload: GitHubPushBranchInput,
  success: GitHubPushBranchResult,
  error: GitHubMutationRpcError,
});

export const WsGitHubCreatePullRequestRpc = Rpc.make(WS_METHODS.githubCreatePullRequest, {
  payload: GitHubCreatePullRequestInput,
  success: GitHubCreatePullRequestResult,
  error: GitHubMutationRpcError,
});

export const WsGitHubUpdatePullRequestRpc = Rpc.make(WS_METHODS.githubUpdatePullRequest, {
  payload: GitHubUpdatePullRequestInput,
  success: PullRequestRecord,
  error: GitHubMutationRpcError,
});

export const WsGitHubMarkReadyForReviewRpc = Rpc.make(WS_METHODS.githubMarkReadyForReview, {
  payload: Schema.Struct({
    repositoryConnectionId: RepositoryConnectionId,
    number: Schema.Int.check(Schema.isGreaterThan(0)),
    confirmation: Schema.Literal(true),
  }),
  success: PullRequestRecord,
  error: GitHubMutationRpcError,
});

export const WsGitHubResolveReviewThreadRpc = Rpc.make(WS_METHODS.githubResolveReviewThread, {
  payload: Schema.Struct({
    reviewThreadRecordId: ReviewThreadRecordId,
    confirmation: Schema.Literal(true),
  }),
  success: ReviewThreadRecord,
  error: GitHubMutationRpcError,
});

export const WsGitHubSubscribeWorkspaceRpc = Rpc.make(WS_METHODS.githubSubscribeWorkspace, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: Schema.NullOr(GitHubRepositoryWorkspaceSnapshot),
  error: GitHubReadRpcError,
  stream: true,
});

const MemoryRpcError = Schema.Union([
  MemoryValidationError,
  MemoryNotFoundError,
  MemoryConflictError,
  MemoryUnavailableError,
  EnvironmentAuthorizationError,
]);

export const WsMemoryGetWorkspaceRpc = Rpc.make(WS_METHODS.memoryGetWorkspace, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: MemoryWorkspaceSnapshot,
  error: MemoryRpcError,
});

export const WsMemoryListEntriesRpc = Rpc.make(WS_METHODS.memoryListEntries, {
  payload: MemoryListFilter,
  success: MemoryEntryPage,
  error: MemoryRpcError,
});

export const WsMemoryGetEntryRpc = Rpc.make(WS_METHODS.memoryGetEntry, {
  payload: Schema.Struct({ memoryEntryId: MemoryEntryId }),
  success: MemoryEntryDetail,
  error: MemoryRpcError,
});

export const WsMemoryCreateEntryRpc = Rpc.make(WS_METHODS.memoryCreateEntry, {
  payload: CreateMemoryEntryInput,
  success: MemoryEntryDetail,
  error: MemoryRpcError,
});

export const WsMemoryUpdateEntryRpc = Rpc.make(WS_METHODS.memoryUpdateEntry, {
  payload: UpdateMemoryEntryInput,
  success: MemoryEntryDetail,
  error: MemoryRpcError,
});

export const WsMemoryActionEntryRpc = Rpc.make(WS_METHODS.memoryActionEntry, {
  payload: MemoryEntryActionInput,
  success: MemoryEntryDetail,
  error: MemoryRpcError,
});

export const WsMemorySupersedeEntryRpc = Rpc.make(WS_METHODS.memorySupersedeEntry, {
  payload: SupersedeMemoryEntryInput,
  success: Schema.Struct({ superseded: MemoryEntry, replacement: MemoryEntry }),
  error: MemoryRpcError,
});

export const WsMemoryAddSourceRpc = Rpc.make(WS_METHODS.memoryAddSource, {
  payload: AddMemorySourceInput,
  success: MemorySource,
  error: MemoryRpcError,
});

export const WsMemoryCreateRelationRpc = Rpc.make(WS_METHODS.memoryCreateRelation, {
  payload: CreateMemoryRelationInput,
  success: MemoryRelation,
  error: MemoryRpcError,
});

export const WsMemoryListProposalsRpc = Rpc.make(WS_METHODS.memoryListProposals, {
  payload: MemoryProposalListFilter,
  success: MemoryProposalPage,
  error: MemoryRpcError,
});

export const WsMemoryCreateProposalRpc = Rpc.make(WS_METHODS.memoryCreateProposal, {
  payload: CreateMemoryProposalInput,
  success: MemoryProposal,
  error: MemoryRpcError,
});

export const WsMemoryReviewProposalRpc = Rpc.make(WS_METHODS.memoryReviewProposal, {
  payload: ReviewMemoryProposalInput,
  success: Schema.Struct({
    proposal: MemoryProposal,
    memory: Schema.NullOr(MemoryEntryDetail),
  }),
  error: MemoryRpcError,
});

export const WsMemoryListIndexedSourcesRpc = Rpc.make(WS_METHODS.memoryListIndexedSources, {
  payload: IndexedSourceListInput,
  success: IndexedSourcePage,
  error: MemoryRpcError,
});

export const WsMemoryRequestIndexRpc = Rpc.make(WS_METHODS.memoryRequestIndex, {
  payload: MemoryIndexRequest,
  success: MemoryIndexOperation,
  error: MemoryRpcError,
});

export const WsMemorySearchRpc = Rpc.make(WS_METHODS.memorySearch, {
  payload: MemorySearchInput,
  success: MemorySearchResult,
  error: MemoryRpcError,
});

export const WsMemoryListRetrievalsRpc = Rpc.make(WS_METHODS.memoryListRetrievals, {
  payload: MemoryRetrievalListInput,
  success: MemoryRetrievalRecordPage,
  error: MemoryRpcError,
});

export const WsMemoryGetRetrievalRpc = Rpc.make(WS_METHODS.memoryGetRetrieval, {
  payload: Schema.Struct({ retrievalRecordId: MemoryRetrievalRecordId }),
  success: MemoryRetrievalRecord,
  error: MemoryRpcError,
});

export const WsMemoryUpdateSettingsRpc = Rpc.make(WS_METHODS.memoryUpdateSettings, {
  payload: UpdateMemorySettingsInput,
  success: MemoryWorkspaceSnapshot,
  error: MemoryRpcError,
});

export const WsMemoryExportRpc = Rpc.make(WS_METHODS.memoryExport, {
  payload: Schema.Struct({ projectId: Schema.NullOr(ProjectId) }),
  success: MemoryExportBundle,
  error: MemoryRpcError,
});

export const WsMemoryImportRpc = Rpc.make(WS_METHODS.memoryImport, {
  payload: MemoryImportInput,
  success: MemoryImportResult,
  error: MemoryRpcError,
});

export const WsMemorySubscribeWorkspaceRpc = Rpc.make(WS_METHODS.memorySubscribeWorkspace, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: MemoryWorkspaceSnapshot,
  error: MemoryRpcError,
  stream: true,
});

const RoutingRpcErrorSchema = Schema.Union([RoutingRpcError, EnvironmentAuthorizationError]);

export const WsRoutingGetRegistryRpc = Rpc.make(WS_METHODS.routingGetRegistry, {
  payload: Schema.Struct({}),
  success: RoutingRegistrySnapshot,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingGetWorkspaceRpc = Rpc.make(WS_METHODS.routingGetWorkspace, {
  payload: RoutingWorkspaceScope,
  success: RoutingWorkspaceSnapshot,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingGetDecisionRpc = Rpc.make(WS_METHODS.routingGetDecision, {
  payload: RoutingDecisionLookupInput,
  success: RoutingDecisionDetail,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingListHistoryRpc = Rpc.make(WS_METHODS.routingListHistory, {
  payload: RoutingHistoryInput,
  success: RoutingHistoryPage,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSimulateRpc = Rpc.make(WS_METHODS.routingSimulate, {
  payload: RoutingSimulationInput,
  success: RoutingSimulationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingStartMissionRpc = Rpc.make(WS_METHODS.routingStartMission, {
  payload: RoutingStartMissionInput,
  success: RoutingStartMissionResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSavePolicyRpc = Rpc.make(WS_METHODS.routingSavePolicy, {
  payload: RoutingSavePolicyInput,
  success: RoutingPolicyMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSaveRuleRpc = Rpc.make(WS_METHODS.routingSaveRule, {
  payload: RoutingSaveRuleInput,
  success: RoutingRuleMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSaveOverrideRpc = Rpc.make(WS_METHODS.routingSaveOverride, {
  payload: RoutingSaveOverrideInput,
  success: RoutingOverrideMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingRevokeOverrideRpc = Rpc.make(WS_METHODS.routingRevokeOverride, {
  payload: RoutingRevokeOverrideInput,
  success: RoutingOverrideMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSaveAssessmentRpc = Rpc.make(WS_METHODS.routingSaveAssessment, {
  payload: RoutingSaveAssessmentInput,
  success: RoutingAssessmentMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSaveProviderProfileRpc = Rpc.make(WS_METHODS.routingSaveProviderProfile, {
  payload: RoutingSaveProviderProfileInput,
  success: RoutingProviderProfileMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSaveModelProfileRpc = Rpc.make(WS_METHODS.routingSaveModelProfile, {
  payload: RoutingSaveModelProfileInput,
  success: RoutingModelProfileMutationResult,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSaveCapabilitySnapshotRpc = Rpc.make(
  WS_METHODS.routingSaveCapabilitySnapshot,
  {
    payload: RoutingSaveCapabilitySnapshotInput,
    success: RoutingCapabilitySnapshotMutationResult,
    error: RoutingRpcErrorSchema,
  },
);

export const WsRoutingRefreshRegistryRpc = Rpc.make(WS_METHODS.routingRefreshRegistry, {
  payload: RoutingRefreshRegistryInput,
  success: RoutingRegistrySnapshot,
  error: RoutingRpcErrorSchema,
});

export const WsRoutingSubscribeWorkspaceRpc = Rpc.make(WS_METHODS.routingSubscribeWorkspace, {
  payload: RoutingWorkspaceScope,
  success: RoutingWorkspaceSnapshot,
  error: RoutingRpcErrorSchema,
  stream: true,
});

const UsageAnalyticsRpcErrorSchema = Schema.Union([
  AnalyticsValidationError,
  AnalyticsNotFoundError,
  AnalyticsUnavailableError,
  EnvironmentAuthorizationError,
]);

export const WsAnalyticsGetWorkspaceRpc = Rpc.make(WS_METHODS.analyticsGetWorkspace, {
  payload: AnalyticsFilterInput,
  success: AnalyticsWorkspaceSnapshot,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsGetRunDetailRpc = Rpc.make(WS_METHODS.analyticsGetRunDetail, {
  payload: AnalyticsRunDetailInput,
  success: AnalyticsRunDetail,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsUpdateSettingsRpc = Rpc.make(WS_METHODS.analyticsUpdateSettings, {
  payload: AnalyticsSettingsUpdateInput,
  success: AnalyticsSettings,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsSaveBudgetRpc = Rpc.make(WS_METHODS.analyticsSaveBudget, {
  payload: BudgetPolicySaveInput,
  success: BudgetPolicy,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsSavePricingSnapshotRpc = Rpc.make(WS_METHODS.analyticsSavePricingSnapshot, {
  payload: PricingSnapshotSaveInput,
  success: PricingSnapshot,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsSaveSubscriptionAttributionRuleRpc = Rpc.make(
  WS_METHODS.analyticsSaveSubscriptionAttributionRule,
  {
    payload: SubscriptionAttributionRuleSaveInput,
    success: SubscriptionAttributionRule,
    error: UsageAnalyticsRpcErrorSchema,
  },
);

export const WsAnalyticsSaveExchangeRateSnapshotRpc = Rpc.make(
  WS_METHODS.analyticsSaveExchangeRateSnapshot,
  {
    payload: ExchangeRateSnapshotSaveInput,
    success: ExchangeRateSnapshot,
    error: UsageAnalyticsRpcErrorSchema,
  },
);

export const WsAnalyticsAcknowledgeBudgetEventRpc = Rpc.make(
  WS_METHODS.analyticsAcknowledgeBudgetEvent,
  {
    payload: BudgetEventAcknowledgeInput,
    success: BudgetEvent,
    error: UsageAnalyticsRpcErrorSchema,
  },
);

export const WsAnalyticsCreateBudgetOverrideRpc = Rpc.make(
  WS_METHODS.analyticsCreateBudgetOverride,
  {
    payload: BudgetOverrideCreateInput,
    success: BudgetOverride,
    error: UsageAnalyticsRpcErrorSchema,
  },
);

export const WsAnalyticsAcknowledgeAlertRpc = Rpc.make(WS_METHODS.analyticsAcknowledgeAlert, {
  payload: AnalyticsAlertAcknowledgeInput,
  success: AnalyticsAlert,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsSaveAnnotationRpc = Rpc.make(WS_METHODS.analyticsSaveAnnotation, {
  payload: AnalyticsAnnotationSaveInput,
  success: AnalyticsAnnotation,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsRecordHumanDispositionRpc = Rpc.make(
  WS_METHODS.analyticsRecordHumanDisposition,
  {
    payload: HumanDispositionRecordInput,
    success: HumanDispositionRecord,
    error: UsageAnalyticsRpcErrorSchema,
  },
);

export const WsAnalyticsCreateExportRpc = Rpc.make(WS_METHODS.analyticsCreateExport, {
  payload: AnalyticsExportCreateInput,
  success: AnalyticsExport,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsStartRetentionRpc = Rpc.make(WS_METHODS.analyticsStartRetention, {
  payload: AnalyticsRetentionStartInput,
  success: AnalyticsRetentionOperation,
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsRebuildAggregatesRpc = Rpc.make(WS_METHODS.analyticsRebuildAggregates, {
  payload: AnalyticsAggregateRebuildInput,
  success: Schema.Struct({ accepted: Schema.Boolean }),
  error: UsageAnalyticsRpcErrorSchema,
});

export const WsAnalyticsSubscribeWorkspaceRpc = Rpc.make(WS_METHODS.analyticsSubscribeWorkspace, {
  payload: AnalyticsFilterInput,
  success: AnalyticsWorkspaceSnapshot,
  error: UsageAnalyticsRpcErrorSchema,
  stream: true,
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

/**
 * Ephemeral live diff preview for compact/mobile surfaces.
 * Not the persisted T3 Review model. Future review sessions should use
 * review.open* + review.getSnapshot.
 */
export const WsReviewGetDiffPreviewRpc = Rpc.make(WS_METHODS.reviewGetDiffPreview, {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsPreviewOpenRpc = Rpc.make(WS_METHODS.previewOpen, {
  payload: PreviewOpenInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewNavigateRpc = Rpc.make(WS_METHODS.previewNavigate, {
  payload: PreviewNavigateInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewResizeRpc = Rpc.make(WS_METHODS.previewResize, {
  payload: PreviewResizeInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewRefreshRpc = Rpc.make(WS_METHODS.previewRefresh, {
  payload: PreviewRefreshInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewCloseRpc = Rpc.make(WS_METHODS.previewClose, {
  payload: PreviewCloseInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewListRpc = Rpc.make(WS_METHODS.previewList, {
  payload: PreviewListInput,
  success: PreviewListResult,
  error: EnvironmentAuthorizationError,
});

export const WsPreviewReportStatusRpc = Rpc.make(WS_METHODS.previewReportStatus, {
  payload: PreviewReportStatusInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewAutomationConnectRpc = Rpc.make(WS_METHODS.previewAutomationConnect, {
  payload: PreviewAutomationHost,
  success: PreviewAutomationStreamEvent,
  error: Schema.Union([PreviewAutomationError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsPreviewAutomationRespondRpc = Rpc.make(WS_METHODS.previewAutomationRespond, {
  payload: PreviewAutomationResponse,
  error: Schema.Union([PreviewAutomationError, EnvironmentAuthorizationError]),
});

export const WsPreviewAutomationFocusHostRpc = Rpc.make(WS_METHODS.previewAutomationFocusHost, {
  payload: PreviewAutomationHostFocus,
  error: EnvironmentAuthorizationError,
});

export const WsSubscribePreviewEventsRpc = Rpc.make(WS_METHODS.subscribePreviewEvents, {
  payload: Schema.Struct({}),
  success: PreviewEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeDiscoveredLocalServersRpc = Rpc.make(
  WS_METHODS.subscribeDiscoveredLocalServers,
  {
    payload: Schema.Struct({}),
    success: DiscoveredLocalServerList,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationSearchThreadsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.searchThreads, {
  payload: OrchestrationSearchThreadsInput,
  success: OrchestrationRpcSchemas.searchThreads.output,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsOrchestrationSubscribeMissionsRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeMissions,
  {
    payload: OrchestrationRpcSchemas.subscribeMissions.input,
    success: OrchestrationRpcSchemas.subscribeMissions.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsOrchestrationSubscribeMissionRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeMission,
  {
    payload: OrchestrationRpcSchemas.subscribeMission.input,
    success: OrchestrationRpcSchemas.subscribeMission.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeBackgroundPolicyRpc = Rpc.make(WS_METHODS.subscribeBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeResourceTelemetryRpc = Rpc.make(WS_METHODS.subscribeResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetrySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerUpdateServerRpc,
  WsServerUpdateServerWithProgressRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetResourceTelemetryHistoryRpc,
  WsServerRetryResourceTelemetryRpc,
  WsServerSignalProcessRpc,
  WsServerReportClientActivityRpc,
  WsServerReportHostPowerStateRpc,
  WsServerGetBackgroundPolicyRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsProjectsListEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchContentsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsAssetsCreateUrlRpc,
  WsVerificationGetProjectConfigurationRpc,
  WsVerificationListRunsRpc,
  WsVerificationGetRunEvidenceRpc,
  WsVerificationGetTaskSummariesRpc,
  WsVerificationCompareRunsRpc,
  WsVerificationReadLogRpc,
  WsVerificationCreateArtifactUrlRpc,
  WsVerificationSubscribeRunRpc,
  WsGitHubListAccountsRpc,
  WsGitHubConnectAccountRpc,
  WsGitHubDisconnectAccountRpc,
  WsGitHubConnectRepositoryRpc,
  WsGitHubDisconnectRepositoryRpc,
  WsGitHubGetWorkspaceRpc,
  WsGitHubListIssuesRpc,
  WsGitHubListPullRequestsRpc,
  WsGitHubGetPullRequestRpc,
  WsGitHubRefreshRpc,
  WsGitHubCreateMissionFromIssueRpc,
  WsGitHubLinkIssueMissionRpc,
  WsGitHubCreateReviewTaskRpc,
  WsGitHubPushBranchRpc,
  WsGitHubCreatePullRequestRpc,
  WsGitHubUpdatePullRequestRpc,
  WsGitHubMarkReadyForReviewRpc,
  WsGitHubResolveReviewThreadRpc,
  WsGitHubSubscribeWorkspaceRpc,
  WsMemoryGetWorkspaceRpc,
  WsMemoryListEntriesRpc,
  WsMemoryGetEntryRpc,
  WsMemoryCreateEntryRpc,
  WsMemoryUpdateEntryRpc,
  WsMemoryActionEntryRpc,
  WsMemorySupersedeEntryRpc,
  WsMemoryAddSourceRpc,
  WsMemoryCreateRelationRpc,
  WsMemoryListProposalsRpc,
  WsMemoryCreateProposalRpc,
  WsMemoryReviewProposalRpc,
  WsMemoryListIndexedSourcesRpc,
  WsMemoryRequestIndexRpc,
  WsMemorySearchRpc,
  WsMemoryListRetrievalsRpc,
  WsMemoryGetRetrievalRpc,
  WsMemoryUpdateSettingsRpc,
  WsMemoryExportRpc,
  WsMemoryImportRpc,
  WsMemorySubscribeWorkspaceRpc,
  WsRoutingGetRegistryRpc,
  WsRoutingGetWorkspaceRpc,
  WsRoutingGetDecisionRpc,
  WsRoutingListHistoryRpc,
  WsRoutingSimulateRpc,
  WsRoutingStartMissionRpc,
  WsRoutingSavePolicyRpc,
  WsRoutingSaveRuleRpc,
  WsRoutingSaveOverrideRpc,
  WsRoutingRevokeOverrideRpc,
  WsRoutingSaveAssessmentRpc,
  WsRoutingSaveProviderProfileRpc,
  WsRoutingSaveModelProfileRpc,
  WsRoutingSaveCapabilitySnapshotRpc,
  WsRoutingRefreshRegistryRpc,
  WsRoutingSubscribeWorkspaceRpc,
  WsAnalyticsGetWorkspaceRpc,
  WsAnalyticsGetRunDetailRpc,
  WsAnalyticsUpdateSettingsRpc,
  WsAnalyticsSaveBudgetRpc,
  WsAnalyticsSavePricingSnapshotRpc,
  WsAnalyticsSaveSubscriptionAttributionRuleRpc,
  WsAnalyticsSaveExchangeRateSnapshotRpc,
  WsAnalyticsAcknowledgeBudgetEventRpc,
  WsAnalyticsCreateBudgetOverrideRpc,
  WsAnalyticsAcknowledgeAlertRpc,
  WsAnalyticsSaveAnnotationRpc,
  WsAnalyticsRecordHumanDispositionRpc,
  WsAnalyticsCreateExportRpc,
  WsAnalyticsStartRetentionRpc,
  WsAnalyticsRebuildAggregatesRpc,
  WsAnalyticsSubscribeWorkspaceRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsReviewGetDiffPreviewRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsPreviewOpenRpc,
  WsPreviewNavigateRpc,
  WsPreviewResizeRpc,
  WsPreviewRefreshRpc,
  WsPreviewCloseRpc,
  WsPreviewListRpc,
  WsPreviewReportStatusRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsSubscribePreviewEventsRpc,
  WsSubscribeDiscoveredLocalServersRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeBackgroundPolicyRpc,
  WsSubscribeResourceTelemetryRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationSearchThreadsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestrationSubscribeMissionsRpc,
  WsOrchestrationSubscribeMissionRpc,
);
