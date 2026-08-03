import * as Schema from "effect/Schema";

import {
  AgentRunId,
  IsoDateTime,
  ManagedWorktreeId,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  VerificationArtifactId,
  VerificationCheckDefinitionId,
  VerificationCheckRunId,
  VerificationDiagnosticId,
  VerificationGateId,
  VerificationOverrideId,
  VerificationProfileId,
  VerificationRepairAttemptId,
  VerificationRunId,
} from "./baseSchemas.ts";

export const VerificationTriggerMode = Schema.Literals([
  "manual",
  "on_task_completion",
  "before_integration",
  "after_integration",
]);
export type VerificationTriggerMode = typeof VerificationTriggerMode.Type;

export const VerificationConfigurationSource = Schema.Literals([
  "explicit_project_setting",
  "repository",
  "inferred",
  "none",
]);
export type VerificationConfigurationSource = typeof VerificationConfigurationSource.Type;

export const VerificationCategory = Schema.Literals([
  "install",
  "format",
  "lint",
  "typecheck",
  "unit_test",
  "integration_test",
  "build",
  "ui_smoke",
  "security",
  "custom",
]);
export type VerificationCategory = typeof VerificationCategory.Type;

export const VerificationExecutionMode = Schema.Literals(["sequential", "parallel_safe"]);
export type VerificationExecutionMode = typeof VerificationExecutionMode.Type;

export const VerificationFailurePolicy = Schema.Literals(["block", "warn", "informational"]);
export type VerificationFailurePolicy = typeof VerificationFailurePolicy.Type;

export const VerificationPlatform = Schema.Literals(["win32", "darwin", "linux"]);
export type VerificationPlatform = typeof VerificationPlatform.Type;

export const VerificationDiagnosticParser = Schema.Literals([
  "none",
  "typescript",
  "eslint",
  "test",
  "build",
  "generic",
]);
export type VerificationDiagnosticParser = typeof VerificationDiagnosticParser.Type;

export const VerificationEnvironmentReference = Schema.Struct({
  name: TrimmedNonEmptyString,
  valueFrom: TrimmedNonEmptyString,
});
export type VerificationEnvironmentReference = typeof VerificationEnvironmentReference.Type;

export const VerificationProjectSettings = Schema.Struct({
  projectId: ProjectId,
  configurationPath: Schema.NullOr(TrimmedNonEmptyString),
  configurationSource: VerificationConfigurationSource,
  acceptedConfigurationDigest: Schema.NullOr(TrimmedNonEmptyString),
  acceptedAt: Schema.NullOr(IsoDateTime),
  acceptedBy: Schema.NullOr(TrimmedNonEmptyString),
  defaultProfileId: Schema.NullOr(VerificationProfileId),
  preIntegrationProfileId: Schema.NullOr(VerificationProfileId),
  automaticTaskVerificationEnabled: Schema.Boolean,
  maximumRepairAttempts: NonNegativeInt,
  automaticRepairEnabled: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VerificationProjectSettings = typeof VerificationProjectSettings.Type;

export const VerificationProfile = Schema.Struct({
  id: VerificationProfileId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  isDefault: Schema.Boolean,
  triggerModes: Schema.Array(VerificationTriggerMode),
  configurationRevision: TrimmedNonEmptyString,
  configurationDigest: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VerificationProfile = typeof VerificationProfile.Type;

export const VerificationGate = Schema.Struct({
  id: VerificationGateId,
  profileId: VerificationProfileId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  category: VerificationCategory,
  position: NonNegativeInt,
  required: Schema.Boolean,
  enabled: Schema.Boolean,
  executionMode: VerificationExecutionMode,
  failurePolicy: VerificationFailurePolicy,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VerificationGate = typeof VerificationGate.Type;

export const VerificationCheckDefinition = Schema.Struct({
  id: VerificationCheckDefinitionId,
  gateId: VerificationGateId,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  arguments: Schema.Array(Schema.String),
  requiresShell: Schema.Boolean,
  workingDirectory: TrimmedNonEmptyString,
  environmentOverrides: Schema.Array(VerificationEnvironmentReference),
  timeoutSeconds: PositiveInt,
  allowedExitCodes: Schema.Array(Schema.Int),
  continueOnFailure: Schema.Boolean,
  applicableFilePatterns: Schema.Array(TrimmedNonEmptyString),
  excludedFilePatterns: Schema.Array(TrimmedNonEmptyString),
  platforms: Schema.Array(VerificationPlatform),
  artifactPatterns: Schema.Array(TrimmedNonEmptyString),
  diagnosticParser: VerificationDiagnosticParser,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VerificationCheckDefinition = typeof VerificationCheckDefinition.Type;

export const VerificationSourceSnapshot = Schema.Struct({
  worktreeRoot: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString,
  commitHash: Schema.NullOr(TrimmedNonEmptyString),
  dirtyStateFingerprint: Schema.NullOr(TrimmedNonEmptyString),
  sourceFingerprint: TrimmedNonEmptyString,
});
export type VerificationSourceSnapshot = typeof VerificationSourceSnapshot.Type;

export const VerificationEnvironmentSnapshot = Schema.Struct({
  platform: TrimmedNonEmptyString,
  architecture: TrimmedNonEmptyString,
  runtimeVersions: Schema.Record(TrimmedNonEmptyString, Schema.String),
  continuousIntegration: Schema.Boolean,
});
export type VerificationEnvironmentSnapshot = typeof VerificationEnvironmentSnapshot.Type;

export const VerificationPlannedEnvironmentValue = Schema.Struct({
  name: TrimmedNonEmptyString,
  source: Schema.Literals(["literal", "host_environment"]),
  value: Schema.optionalKey(Schema.String),
  fromEnvironment: Schema.optionalKey(TrimmedNonEmptyString),
  sensitive: Schema.Boolean,
});
export type VerificationPlannedEnvironmentValue = typeof VerificationPlannedEnvironmentValue.Type;

export const VerificationPlannedArtifactRule = Schema.Struct({
  pattern: TrimmedNonEmptyString,
  type: Schema.Literals([
    "log",
    "report",
    "coverage",
    "screenshot",
    "video",
    "trace",
    "test_result",
    "bundle_stats",
    "custom",
  ]),
  name: Schema.optionalKey(TrimmedNonEmptyString),
  required: Schema.Boolean,
  maxBytes: Schema.optionalKey(PositiveInt),
});
export type VerificationPlannedArtifactRule = typeof VerificationPlannedArtifactRule.Type;

export const VerificationPlannedCheck = Schema.Struct({
  checkDefinitionId: VerificationCheckDefinitionId,
  gateId: VerificationGateId,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  arguments: Schema.Array(Schema.String),
  requiresShell: Schema.Boolean,
  workingDirectory: TrimmedNonEmptyString,
  environment: Schema.Array(VerificationPlannedEnvironmentValue),
  timeoutSeconds: PositiveInt,
  allowedExitCodes: Schema.Array(Schema.Int),
  continueOnFailure: Schema.Boolean,
  artifacts: Schema.Array(VerificationPlannedArtifactRule),
  diagnosticParser: VerificationDiagnosticParser,
  selectionReason: TrimmedNonEmptyString,
  selectionSource: Schema.Literal("explicit_configuration"),
  required: Schema.Boolean,
  failurePolicy: VerificationFailurePolicy,
  position: NonNegativeInt,
});
export type VerificationPlannedCheck = typeof VerificationPlannedCheck.Type;

export const VerificationPlannedGate = Schema.Struct({
  gateId: VerificationGateId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  category: VerificationCategory,
  position: NonNegativeInt,
  required: Schema.Boolean,
  executionMode: VerificationExecutionMode,
  failurePolicy: VerificationFailurePolicy,
  checks: Schema.Array(VerificationPlannedCheck),
});
export type VerificationPlannedGate = typeof VerificationPlannedGate.Type;

export const VerificationSkippedCheck = Schema.Struct({
  checkDefinitionId: VerificationCheckDefinitionId,
  gateId: VerificationGateId,
  name: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  required: Schema.Boolean,
  explicitlyNotApplicable: Schema.Boolean,
  selectionSource: Schema.Literal("explicit_configuration"),
});
export type VerificationSkippedCheck = typeof VerificationSkippedCheck.Type;

export const VerificationExecutionPlan = Schema.Struct({
  version: Schema.Literal(1),
  profileId: VerificationProfileId,
  profileName: TrimmedNonEmptyString,
  configurationPath: TrimmedNonEmptyString,
  configurationRevision: TrimmedNonEmptyString,
  configurationDigest: TrimmedNonEmptyString,
  source: VerificationSourceSnapshot,
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  environment: VerificationEnvironmentSnapshot,
  gates: Schema.Array(VerificationPlannedGate),
  skippedChecks: Schema.Array(VerificationSkippedCheck),
  createdAt: IsoDateTime,
});
export type VerificationExecutionPlan = typeof VerificationExecutionPlan.Type;

export const VerificationRunTrigger = Schema.Literals([
  "manual",
  "task_completion",
  "before_integration",
  "after_integration",
  "retry_failed_gate",
  "retry_profile",
  "repair_retry",
  "recovery",
]);
export type VerificationRunTrigger = typeof VerificationRunTrigger.Type;

export const VerificationRequestScope = Schema.Struct({
  kind: Schema.Literal("failed_gate"),
  sourceVerificationRunId: VerificationRunId,
  gateId: VerificationGateId,
});
export type VerificationRequestScope = typeof VerificationRequestScope.Type;

export const VerificationAuthorizationScope = Schema.Literals([
  "full_profile",
  "diagnostic_subset",
]);
export type VerificationAuthorizationScope = typeof VerificationAuthorizationScope.Type;

export const VerificationRunStatus = Schema.Literals([
  "queued",
  "preparing",
  "running",
  "cancelling",
  "passed",
  "passed_with_warnings",
  "failed",
  "cancelled",
  "interrupted",
  "invalidated",
]);
export type VerificationRunStatus = typeof VerificationRunStatus.Type;

export const VerificationRunResult = Schema.Literals([
  "passed",
  "passed_with_warnings",
  "failed",
  "cancelled",
  "interrupted",
]);
export type VerificationRunResult = typeof VerificationRunResult.Type;

export const VerificationRun = Schema.Struct({
  id: VerificationRunId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  worktreeId: Schema.NullOr(ManagedWorktreeId),
  agentRunId: Schema.NullOr(AgentRunId),
  profileId: VerificationProfileId,
  requestedBy: TrimmedNonEmptyString,
  trigger: VerificationRunTrigger,
  authorizationScope: VerificationAuthorizationScope,
  sourceVerificationRunId: Schema.NullOr(VerificationRunId),
  status: VerificationRunStatus,
  configurationRevision: TrimmedNonEmptyString,
  configurationDigest: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString,
  commitHash: Schema.NullOr(TrimmedNonEmptyString),
  dirtyStateFingerprint: Schema.NullOr(TrimmedNonEmptyString),
  sourceFingerprint: TrimmedNonEmptyString,
  changedFilesSnapshot: Schema.Array(TrimmedNonEmptyString),
  environmentSnapshot: VerificationEnvironmentSnapshot,
  executionPlan: VerificationExecutionPlan,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  result: Schema.NullOr(VerificationRunResult),
  failureSummary: Schema.NullOr(Schema.String),
  invalidatedAt: Schema.NullOr(IsoDateTime),
  invalidationReason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});
export type VerificationRun = typeof VerificationRun.Type;

export const VerificationCheckRunStatus = Schema.Literals([
  "queued",
  "running",
  "passed",
  "warned",
  "failed",
  "skipped",
  "cancelled",
  "interrupted",
]);
export type VerificationCheckRunStatus = typeof VerificationCheckRunStatus.Type;

export const VerificationCheckResult = Schema.Literals([
  "passed",
  "warned",
  "failed",
  "skipped",
  "cancelled",
  "interrupted",
]);
export type VerificationCheckResult = typeof VerificationCheckResult.Type;

export const VerificationFailureCategory = Schema.Literals([
  "source_error",
  "test_failure",
  "type_error",
  "lint_error",
  "build_error",
  "dependency_error",
  "environment_error",
  "timeout",
  "process_crash",
  "configuration_error",
  "permission_error",
  "cancelled",
  "unknown",
]);
export type VerificationFailureCategory = typeof VerificationFailureCategory.Type;

export const VerificationCheckRun = Schema.Struct({
  id: VerificationCheckRunId,
  verificationRunId: VerificationRunId,
  gateId: VerificationGateId,
  checkDefinitionId: VerificationCheckDefinitionId,
  nameSnapshot: TrimmedNonEmptyString,
  commandSnapshot: TrimmedNonEmptyString,
  argumentsSnapshot: Schema.Array(Schema.String),
  workingDirectorySnapshot: TrimmedNonEmptyString,
  selectionReason: TrimmedNonEmptyString,
  status: VerificationCheckRunStatus,
  position: NonNegativeInt,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  exitCode: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(Schema.String),
  durationMilliseconds: Schema.NullOr(NonNegativeInt),
  timedOut: Schema.Boolean,
  result: Schema.NullOr(VerificationCheckResult),
  failureCategory: Schema.NullOr(VerificationFailureCategory),
  summary: Schema.NullOr(Schema.String),
  logReference: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type VerificationCheckRun = typeof VerificationCheckRun.Type;

export const VerificationDiagnosticSeverity = Schema.Literals([
  "info",
  "warning",
  "error",
  "fatal",
]);
export type VerificationDiagnosticSeverity = typeof VerificationDiagnosticSeverity.Type;

export const VerificationDiagnostic = Schema.Struct({
  id: VerificationDiagnosticId,
  checkRunId: VerificationCheckRunId,
  severity: VerificationDiagnosticSeverity,
  category: TrimmedNonEmptyString,
  message: Schema.String,
  filePath: Schema.NullOr(Schema.String),
  line: Schema.NullOr(PositiveInt),
  column: Schema.NullOr(PositiveInt),
  code: Schema.NullOr(Schema.String),
  rawReference: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});
export type VerificationDiagnostic = typeof VerificationDiagnostic.Type;

export const VerificationArtifactType = Schema.Literals([
  "log",
  "report",
  "coverage",
  "screenshot",
  "video",
  "trace",
  "test_result",
  "bundle_stats",
  "custom",
]);
export type VerificationArtifactType = typeof VerificationArtifactType.Type;

export const VerificationArtifact = Schema.Struct({
  id: VerificationArtifactId,
  verificationRunId: VerificationRunId,
  checkRunId: Schema.NullOr(VerificationCheckRunId),
  type: VerificationArtifactType,
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  mimeType: Schema.NullOr(TrimmedNonEmptyString),
  sizeBytes: Schema.NullOr(NonNegativeInt),
  checksum: Schema.NullOr(TrimmedNonEmptyString),
  metadata: Schema.Record(TrimmedNonEmptyString, Schema.Unknown),
  createdAt: IsoDateTime,
});
export type VerificationArtifact = typeof VerificationArtifact.Type;

export const VerificationRepairAttemptStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type VerificationRepairAttemptStatus = typeof VerificationRepairAttemptStatus.Type;

export const VerificationFailureSnapshot = Schema.Struct({
  summary: Schema.String.check(Schema.isMaxLength(20_000)),
  failedCheckRunIds: Schema.Array(VerificationCheckRunId).check(Schema.isMaxLength(500)),
  diagnosticIds: Schema.Array(VerificationDiagnosticId).check(Schema.isMaxLength(2_000)),
  logReferences: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(500)),
});
export type VerificationFailureSnapshot = typeof VerificationFailureSnapshot.Type;

export const VerificationRepairAttempt = Schema.Struct({
  id: VerificationRepairAttemptId,
  verificationRunId: VerificationRunId,
  taskId: MissionTaskId,
  agentRunId: Schema.NullOr(AgentRunId),
  attemptNumber: PositiveInt,
  failureSnapshot: VerificationFailureSnapshot,
  status: VerificationRepairAttemptStatus,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});
export type VerificationRepairAttempt = typeof VerificationRepairAttempt.Type;

export const VerificationOverride = Schema.Struct({
  id: VerificationOverrideId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: MissionTaskId,
  verificationRunId: Schema.NullOr(VerificationRunId),
  sourceFingerprint: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  requestedBy: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type VerificationOverride = typeof VerificationOverride.Type;

/** Read-model contracts kept deliberately smaller than persisted execution evidence. */
export const VerificationConfigurationTrust = Schema.Literals([
  "accepted",
  "requires_acceptance",
  "not_configured",
]);
export type VerificationConfigurationTrust = typeof VerificationConfigurationTrust.Type;

export const VerificationCommandSuggestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  category: VerificationCategory,
  executable: TrimmedNonEmptyString,
  arguments: Schema.Array(Schema.String),
  reason: TrimmedNonEmptyString,
  trusted: Schema.Literal(false),
});
export type VerificationCommandSuggestion = typeof VerificationCommandSuggestion.Type;

export const VerificationDiscoveredCheck = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  executable: TrimmedNonEmptyString,
  arguments: Schema.Array(Schema.String),
  workingDirectory: TrimmedNonEmptyString,
  timeoutSeconds: PositiveInt,
  allowedExitCodes: Schema.Array(Schema.Int),
  continueOnFailure: Schema.Boolean,
  applicableFilePatterns: Schema.Array(TrimmedNonEmptyString),
  excludedFilePatterns: Schema.Array(TrimmedNonEmptyString),
  allowRequiredSkip: Schema.Boolean,
  platforms: Schema.Array(VerificationPlatform),
  artifactPatterns: Schema.Array(TrimmedNonEmptyString),
  diagnosticParser: VerificationDiagnosticParser,
});
export type VerificationDiscoveredCheck = typeof VerificationDiscoveredCheck.Type;

export const VerificationDiscoveredGate = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  category: VerificationCategory,
  required: Schema.Boolean,
  enabled: Schema.Boolean,
  executionMode: VerificationExecutionMode,
  failurePolicy: VerificationFailurePolicy,
  checks: Schema.Array(VerificationDiscoveredCheck),
});
export type VerificationDiscoveredGate = typeof VerificationDiscoveredGate.Type;

export const VerificationDiscoveredProfile = Schema.Struct({
  id: TrimmedNonEmptyString,
  persistedProfileId: VerificationProfileId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  triggerModes: Schema.Array(VerificationTriggerMode),
  gates: Schema.Array(VerificationDiscoveredGate),
});
export type VerificationDiscoveredProfile = typeof VerificationDiscoveredProfile.Type;

export const VerificationConfigurationDiscovery = Schema.Struct({
  source: Schema.Literals(["repository", "none"]),
  configPath: TrimmedNonEmptyString,
  revision: Schema.NullOr(TrimmedNonEmptyString),
  trust: VerificationConfigurationTrust,
  profiles: Schema.Array(VerificationDiscoveredProfile),
  suggestions: Schema.Array(VerificationCommandSuggestion),
});
export type VerificationConfigurationDiscovery = typeof VerificationConfigurationDiscovery.Type;

export const VerificationProfileGraph = Schema.Struct({
  profile: VerificationProfile,
  gates: Schema.Array(
    Schema.Struct({
      gate: VerificationGate,
      checks: Schema.Array(VerificationCheckDefinition),
    }),
  ),
});
export type VerificationProfileGraph = typeof VerificationProfileGraph.Type;

export const VerificationProjectConfigurationSnapshot = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  settings: Schema.NullOr(VerificationProjectSettings),
  discovery: VerificationConfigurationDiscovery,
  acceptedProfiles: Schema.Array(VerificationProfileGraph),
});
export type VerificationProjectConfigurationSnapshot =
  typeof VerificationProjectConfigurationSnapshot.Type;

export const VerificationRunSummary = Schema.Struct({
  id: VerificationRunId,
  projectId: ProjectId,
  missionId: Schema.NullOr(MissionId),
  taskId: Schema.NullOr(MissionTaskId),
  profileId: VerificationProfileId,
  profileName: TrimmedNonEmptyString,
  trigger: VerificationRunTrigger,
  status: VerificationRunStatus,
  result: Schema.NullOr(VerificationRunResult),
  sourceFingerprint: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString,
  commitHash: Schema.NullOr(TrimmedNonEmptyString),
  dirtyStateFingerprint: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  durationMilliseconds: Schema.NullOr(NonNegativeInt),
  failureSummary: Schema.NullOr(Schema.String),
  failedCheckNames: Schema.Array(TrimmedNonEmptyString),
  repairAttemptCount: NonNegativeInt,
  invalidatedAt: Schema.NullOr(IsoDateTime),
});
export type VerificationRunSummary = typeof VerificationRunSummary.Type;

export const VerificationIntegrationAuthorizationStatus = Schema.Literals([
  "not_required",
  "missing",
  "queued",
  "running",
  "passed",
  "passed_with_warnings",
  "failed",
  "cancelled",
  "interrupted",
  "invalidated",
  "overridden",
]);
export type VerificationIntegrationAuthorizationStatus =
  typeof VerificationIntegrationAuthorizationStatus.Type;

export const VerificationIntegrationAuthorization = Schema.Struct({
  status: VerificationIntegrationAuthorizationStatus,
  required: Schema.Boolean,
  allowed: Schema.Boolean,
  blockingReason: Schema.NullOr(Schema.String),
  verificationRunId: Schema.NullOr(VerificationRunId),
  override: Schema.NullOr(VerificationOverride),
});
export type VerificationIntegrationAuthorization = typeof VerificationIntegrationAuthorization.Type;

export const VerificationTaskSummary = Schema.Struct({
  taskId: MissionTaskId,
  latestRun: Schema.NullOr(VerificationRunSummary),
  authorization: VerificationIntegrationAuthorization,
  repairRunning: Schema.Boolean,
});
export type VerificationTaskSummary = typeof VerificationTaskSummary.Type;

export const VerificationArtifactEvidence = Schema.Struct({
  artifact: VerificationArtifact,
  available: Schema.Boolean,
  unavailableReason: Schema.NullOr(Schema.String),
});
export type VerificationArtifactEvidence = typeof VerificationArtifactEvidence.Type;

export const VerificationArtifactAccessUrl = Schema.Struct({
  relativeUrl: TrimmedNonEmptyString,
  expiresAt: Schema.Number,
});
export type VerificationArtifactAccessUrl = typeof VerificationArtifactAccessUrl.Type;

export class VerificationArtifactAccessError extends Schema.TaggedErrorClass<VerificationArtifactAccessError>()(
  "VerificationArtifactAccessError",
  {
    reason: Schema.Literals([
      "not_found",
      "unavailable",
      "unsafe_path",
      "persistence_error",
      "signing_error",
    ]),
    message: Schema.String,
  },
) {}

export const VerificationRunEvidence = Schema.Struct({
  run: VerificationRun,
  checks: Schema.Array(VerificationCheckRun),
  diagnostics: Schema.Array(VerificationDiagnostic),
  artifacts: Schema.Array(VerificationArtifactEvidence),
  repairAttempts: Schema.Array(VerificationRepairAttempt),
  overrides: Schema.Array(VerificationOverride),
});
export type VerificationRunEvidence = typeof VerificationRunEvidence.Type;

export const VerificationRunHistoryPage = Schema.Struct({
  runs: Schema.Array(VerificationRunSummary),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type VerificationRunHistoryPage = typeof VerificationRunHistoryPage.Type;

export const VerificationRunComparison = Schema.Struct({
  previousRunId: VerificationRunId,
  currentRunId: VerificationRunId,
  previouslyFailingNowPassing: Schema.Array(TrimmedNonEmptyString),
  newlyFailing: Schema.Array(TrimmedNonEmptyString),
  noLongerApplicable: Schema.Array(TrimmedNonEmptyString),
  durationDeltaMilliseconds: Schema.NullOr(Schema.Int),
});
export type VerificationRunComparison = typeof VerificationRunComparison.Type;

export const VerificationLogRecord = Schema.Struct({
  cursor: NonNegativeInt,
  observedAt: IsoDateTime,
  stream: Schema.Literals(["stdout", "stderr", "system"]),
  text: Schema.String,
  truncated: Schema.Boolean,
});
export type VerificationLogRecord = typeof VerificationLogRecord.Type;

export const VerificationLogPage = Schema.Struct({
  records: Schema.Array(VerificationLogRecord),
  nextCursor: NonNegativeInt,
  hasMore: Schema.Boolean,
  logAvailable: Schema.Boolean,
  unavailableReason: Schema.NullOr(Schema.String),
});
export type VerificationLogPage = typeof VerificationLogPage.Type;

export class VerificationQueryError extends Schema.TaggedErrorClass<VerificationQueryError>()(
  "VerificationQueryError",
  {
    reason: Schema.Literals([
      "project_not_found",
      "run_not_found",
      "check_not_found",
      "configuration_error",
      "log_unavailable",
      "persistence_error",
    ]),
    message: Schema.String,
  },
) {}

const runTransitions: Readonly<Record<VerificationRunStatus, ReadonlySet<VerificationRunStatus>>> =
  {
    queued: new Set(["preparing", "cancelling", "cancelled", "interrupted"]),
    preparing: new Set([
      "running",
      "cancelling",
      "failed",
      "cancelled",
      "interrupted",
      "invalidated",
    ]),
    running: new Set([
      "cancelling",
      "passed",
      "passed_with_warnings",
      "failed",
      "cancelled",
      "interrupted",
      "invalidated",
    ]),
    cancelling: new Set(["failed", "cancelled", "interrupted"]),
    passed: new Set(["invalidated"]),
    passed_with_warnings: new Set(["invalidated"]),
    failed: new Set(),
    cancelled: new Set(),
    interrupted: new Set(),
    invalidated: new Set(),
  };

const checkTransitions: Readonly<
  Record<VerificationCheckRunStatus, ReadonlySet<VerificationCheckRunStatus>>
> = {
  queued: new Set(["running", "skipped", "cancelled", "interrupted"]),
  running: new Set(["passed", "warned", "failed", "cancelled", "interrupted"]),
  passed: new Set(),
  warned: new Set(),
  failed: new Set(),
  skipped: new Set(),
  cancelled: new Set(),
  interrupted: new Set(),
};

const repairTransitions: Readonly<
  Record<VerificationRepairAttemptStatus, ReadonlySet<VerificationRepairAttemptStatus>>
> = {
  queued: new Set(["running", "cancelled", "interrupted", "failed"]),
  running: new Set(["completed", "failed", "cancelled", "interrupted"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  interrupted: new Set(),
};

export const canTransitionVerificationRun = (
  from: VerificationRunStatus,
  to: VerificationRunStatus,
): boolean => from === to || runTransitions[from].has(to);

export const canTransitionVerificationCheckRun = (
  from: VerificationCheckRunStatus,
  to: VerificationCheckRunStatus,
): boolean => from === to || checkTransitions[from].has(to);

export const canTransitionVerificationRepairAttempt = (
  from: VerificationRepairAttemptStatus,
  to: VerificationRepairAttemptStatus,
): boolean => from === to || repairTransitions[from].has(to);

export const isActiveVerificationRunStatus = (status: VerificationRunStatus): boolean =>
  status === "queued" || status === "preparing" || status === "running" || status === "cancelling";

export const isAuthorizingVerificationRun = (run: VerificationRun): boolean =>
  run.authorizationScope === "full_profile" &&
  run.sourceVerificationRunId === null &&
  run.invalidatedAt === null &&
  (run.status === "passed" || run.status === "passed_with_warnings") &&
  (run.result === "passed" || run.result === "passed_with_warnings");
