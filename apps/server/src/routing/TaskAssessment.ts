import type {
  MissionTaskId,
  RoutingAgentRoleKind,
  RoutingCapabilityName,
  RoutingPrivacyClassification,
  RoutingReasoningLevel,
  RoutingTaskComplexity,
  RoutingTaskType,
  TaskRoutingAssessment,
  TaskRoutingAssessmentId,
} from "@t3tools/contracts";

import type { ProviderHarnessCapabilities } from "../provider/ProviderDriver.ts";

export type RoutingHarnessCapabilityName = keyof ProviderHarnessCapabilities;
export type DeterministicTaskComplexity = Exclude<RoutingTaskComplexity, "unknown">;

export interface DeterministicTaskAssessmentInput {
  readonly roleKind: RoutingAgentRoleKind;
  readonly title: string;
  readonly description: string;
  readonly projectLanguages?: ReadonlyArray<string>;
  readonly affectedFiles?: ReadonlyArray<string>;
  readonly requiredTools?: ReadonlyArray<string>;
  readonly writeAccessRequired: boolean;
  readonly verificationCategory?: string | null;
  readonly attachmentKinds?: ReadonlyArray<"image" | "audio" | "file" | "other">;
  readonly estimatedMemoryTokens?: number | null;
  readonly estimatedSourceTokens?: number | null;
  readonly predecessorHandoffTokens?: number | null;
  readonly verificationFailureTokens?: number | null;
  readonly expectedOutputTokens?: number | null;
  readonly estimatedToolDefinitionTokens?: number | null;
  readonly privacyClassification?: RoutingPrivacyClassification;
  readonly visionRequired?: boolean;
  readonly structuredOutputRequired?: boolean;
  readonly architectureChange?: boolean;
  readonly databaseMigration?: boolean;
  readonly securitySensitive?: boolean;
  readonly unknownRepositoryArea?: boolean;
  readonly crossPackageImpact?: boolean;
  readonly dependencyCount?: number;
  readonly verificationBreadth?: "narrow" | "focused" | "broad";
  readonly explicitRequiredModelCapabilities?: ReadonlyArray<RoutingCapabilityName>;
  readonly explicitPreferredModelCapabilities?: ReadonlyArray<RoutingCapabilityName>;
  readonly explicitReasoningLevel?: RoutingReasoningLevel;
}

export interface RoutingAssessmentForEngine {
  readonly agentRole: RoutingAgentRoleKind;
  readonly taskType: RoutingTaskType;
  readonly complexity: RoutingTaskComplexity;
  /** Model facts. Unknown values fail closed later in the routing engine. */
  readonly requiredModelCapabilities: ReadonlyArray<RoutingCapabilityName>;
  /** Harness facts stay separate so a capable harness cannot imply a capable model. */
  readonly requiredHarnessCapabilities: ReadonlyArray<RoutingHarnessCapabilityName>;
  readonly preferredModelCapabilities: ReadonlyArray<RoutingCapabilityName>;
  readonly requiredTools: ReadonlyArray<string>;
  readonly requiredModalities: ReadonlyArray<string>;
  readonly estimatedContextTokens: number | null;
  readonly privacyClassification: RoutingPrivacyClassification;
  readonly writeAccessRequired: boolean;
  readonly visionRequired: boolean;
  readonly structuredOutputRequired: boolean;
  readonly recommendedReasoningLevel: RoutingReasoningLevel;
  readonly source: "deterministic" | "manual" | "inferred" | "system";
  readonly explanation: string;
}

export interface DeterministicTaskAssessment extends RoutingAssessmentForEngine {
  readonly complexity: DeterministicTaskComplexity;
  readonly estimatedContextTokens: number;
  readonly source: "deterministic";
  readonly evidence: ReadonlyArray<string>;
}

const includesAny = (text: string, patterns: ReadonlyArray<RegExp>) =>
  patterns.some((pattern) => pattern.test(text));

const classifyTaskType = (
  input: DeterministicTaskAssessmentInput,
  normalizedText: string,
): RoutingTaskType => {
  if (input.roleKind === "memory_extractor") return "memory_extraction";
  if (input.roleKind === "repair_agent" || input.verificationCategory) return "repair";
  if (input.roleKind === "reviewer") {
    if (includesAny(normalizedText, [/\bsecurity\b/, /\bthreat\b/, /\bvulnerab/])) {
      return "security_review";
    }
    if (includesAny(normalizedText, [/\bperformance\b/, /\blatency\b/, /\bprofil/])) {
      return "performance_review";
    }
    return "review";
  }
  if (input.roleKind === "verifier") return "verification";
  if (input.roleKind === "researcher") return "research";
  if (input.roleKind === "coordinator") return "planning";

  if (includesAny(normalizedText, [/\bconflict\b/, /\brebase\b/, /\bmerge collision\b/])) {
    return "conflict_resolution";
  }
  if (includesAny(normalizedText, [/\bgithub\b/, /\bpull request\b/, /\bworkflow\b/, /\bci\b/])) {
    return "github_workflow";
  }
  if (includesAny(normalizedText, [/\barchitecture\b/, /\bdesign\b/, /\bsystem model\b/])) {
    return "architecture";
  }
  if (includesAny(normalizedText, [/\brefactor\b/, /\brestructure\b/, /\bcleanup\b/])) {
    return "refactor";
  }
  if (includesAny(normalizedText, [/\bbug\b/, /\bfix\b/, /\bregression\b/, /\bcrash\b/])) {
    return "bug_fix";
  }
  if (includesAny(normalizedText, [/\btest\b/, /\bspec\b/, /\bcoverage\b/])) {
    return "test_authoring";
  }
  if (includesAny(normalizedText, [/\bdocs?\b/, /\breadme\b/, /\bdocumentation\b/])) {
    return "documentation";
  }
  if (includesAny(normalizedText, [/\bresearch\b/, /\binvestigate\b/, /\bcompare\b/])) {
    return "research";
  }
  return "implementation";
};

const complexityFromScore = (score: number): DeterministicTaskComplexity => {
  if (score >= 8) return "very_high";
  if (score >= 5) return "high";
  if (score >= 2) return "medium";
  if (score >= 1) return "low";
  return "trivial";
};

const reasoningForComplexity = (complexity: DeterministicTaskComplexity): RoutingReasoningLevel => {
  switch (complexity) {
    case "trivial":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "very_high":
      return "extra_high";
  }
};

const nonNegative = (value: number | null | undefined) =>
  value === undefined || value === null || !Number.isFinite(value) ? 0 : Math.max(0, value);

export const assessTaskDeterministically = (
  input: DeterministicTaskAssessmentInput,
): DeterministicTaskAssessment => {
  const normalizedText = `${input.title}\n${input.description}`.toLowerCase();
  const taskType = classifyTaskType(input, normalizedText);
  const evidence: Array<string> = [`role=${input.roleKind}`, `task_type=${taskType}`];
  if ((input.projectLanguages?.length ?? 0) > 0) {
    evidence.push(`languages=${input.projectLanguages?.toSorted().join("+")}`);
  }
  if ((input.affectedFiles?.length ?? 0) > 0) {
    evidence.push(`affected_files=${input.affectedFiles?.length}`);
  }
  if ((input.requiredTools?.length ?? 0) > 0) {
    evidence.push(`required_tools=${input.requiredTools?.toSorted().join("+")}`);
  }
  let complexityScore =
    taskType === "implementation" || taskType === "refactor" || taskType === "bug_fix" ? 2 : 0;

  const addFactor = (condition: boolean | undefined, score: number, label: string) => {
    if (!condition) return;
    complexityScore += score;
    evidence.push(label);
  };
  addFactor(input.architectureChange || taskType === "architecture", 3, "architecture_change");
  addFactor(input.databaseMigration, 3, "database_migration");
  addFactor(input.securitySensitive || taskType === "security_review", 2, "security_sensitive");
  addFactor(input.crossPackageImpact, 2, "cross_package_impact");
  addFactor(input.unknownRepositoryArea, 1, "unknown_repository_area");
  addFactor(nonNegative(input.dependencyCount) >= 3, 1, "multiple_dependencies");
  addFactor(input.verificationBreadth === "broad", 1, "broad_verification");
  addFactor((input.affectedFiles?.length ?? 0) > 10, 2, "many_affected_files");
  addFactor(
    (input.affectedFiles?.length ?? 0) > 4 && (input.affectedFiles?.length ?? 0) <= 10,
    1,
    "several_affected_files",
  );
  addFactor(taskType === "repair" || taskType === "conflict_resolution", 1, "repair_or_conflict");

  const instructionTokens = Math.ceil(`${input.title}\n${input.description}`.length / 4);
  const estimatedContextTokens =
    instructionTokens +
    nonNegative(input.estimatedMemoryTokens) +
    nonNegative(input.estimatedSourceTokens) +
    nonNegative(input.predecessorHandoffTokens) +
    nonNegative(input.verificationFailureTokens) +
    nonNegative(input.expectedOutputTokens) +
    nonNegative(input.estimatedToolDefinitionTokens);
  addFactor(estimatedContextTokens >= 100_000, 2, "very_large_context");
  addFactor(
    estimatedContextTokens >= 40_000 && estimatedContextTokens < 100_000,
    1,
    "large_context",
  );

  const complexity = complexityFromScore(complexityScore);
  const visionRequired =
    input.visionRequired === true || input.attachmentKinds?.includes("image") === true;
  const structuredOutputRequired = input.structuredOutputRequired === true;
  const mutatingTask =
    input.writeAccessRequired ||
    taskType === "implementation" ||
    taskType === "refactor" ||
    taskType === "bug_fix" ||
    taskType === "test_authoring" ||
    taskType === "repair" ||
    taskType === "conflict_resolution";
  const requiredModelCapabilities = new Set<RoutingCapabilityName>();
  const requiredHarnessCapabilities = new Set<RoutingHarnessCapabilityName>();
  if (mutatingTask) {
    requiredModelCapabilities.add("tool_calling");
    requiredHarnessCapabilities.add("toolExecution");
    requiredHarnessCapabilities.add("codeEditing");
  } else if ((input.requiredTools?.length ?? 0) > 0) {
    requiredModelCapabilities.add("tool_calling");
    requiredHarnessCapabilities.add("toolExecution");
  }
  if (visionRequired) requiredModelCapabilities.add("vision_input");
  if (structuredOutputRequired) requiredModelCapabilities.add("structured_output");
  if (input.attachmentKinds?.includes("file") === true) requiredModelCapabilities.add("file_input");
  if (input.attachmentKinds?.includes("audio") === true)
    requiredModelCapabilities.add("audio_input");
  for (const capability of input.explicitRequiredModelCapabilities ?? []) {
    requiredModelCapabilities.add(capability);
  }

  const preferredModelCapabilities = new Set<RoutingCapabilityName>();
  if (complexity === "high" || complexity === "very_high") {
    preferredModelCapabilities.add("parallel_tool_calls");
  }
  for (const capability of input.explicitPreferredModelCapabilities ?? []) {
    preferredModelCapabilities.add(capability);
  }

  const requiredModalities = [
    ...(visionRequired ? ["image"] : []),
    ...(input.attachmentKinds?.includes("audio") === true ? ["audio"] : []),
    ...(input.attachmentKinds?.includes("file") === true ? ["file"] : []),
  ];

  return {
    agentRole: input.roleKind,
    taskType,
    complexity,
    requiredModelCapabilities: [...requiredModelCapabilities].toSorted(),
    requiredHarnessCapabilities: [...requiredHarnessCapabilities].toSorted(),
    preferredModelCapabilities: [...preferredModelCapabilities].toSorted(),
    requiredTools: [...(input.requiredTools ?? [])].toSorted(),
    requiredModalities,
    estimatedContextTokens,
    privacyClassification: input.privacyClassification ?? "normal",
    writeAccessRequired: input.writeAccessRequired,
    visionRequired,
    structuredOutputRequired,
    recommendedReasoningLevel: input.explicitReasoningLevel ?? reasoningForComplexity(complexity),
    source: "deterministic",
    explanation: `Classified as ${taskType} with ${complexity} complexity from ${evidence.join(", ")}.`,
    evidence,
  };
};

/** Materialize a deterministic assessment as the durable routing contract. */
export const toTaskRoutingAssessment = (input: {
  readonly assessment: DeterministicTaskAssessment;
  readonly id: TaskRoutingAssessmentId;
  readonly taskId: MissionTaskId;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly supersededById?: TaskRoutingAssessmentId | null;
}): TaskRoutingAssessment => ({
  id: input.id,
  taskId: input.taskId,
  agentRole: input.assessment.agentRole,
  taskType: input.assessment.taskType,
  complexity: input.assessment.complexity,
  requiredCapabilities: [...input.assessment.requiredModelCapabilities],
  preferredCapabilities: [...input.assessment.preferredModelCapabilities],
  estimatedContextTokens:
    input.assessment.estimatedContextTokens > 0 ? input.assessment.estimatedContextTokens : null,
  privacyClassification: input.assessment.privacyClassification,
  writeAccessRequired: input.assessment.writeAccessRequired,
  visionRequired: input.assessment.visionRequired,
  structuredOutputRequired: input.assessment.structuredOutputRequired,
  assessmentSource: "system",
  assessmentExplanation: input.assessment.explanation,
  version: input.version,
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  supersededById: input.supersededById ?? null,
});

/** Adapt a corrected/manual persisted assessment back into the pure engine. */
export const persistedAssessmentForRouting = (
  assessment: TaskRoutingAssessment,
): RoutingAssessmentForEngine => {
  const requiredHarnessCapabilities = new Set<RoutingHarnessCapabilityName>();
  if (assessment.requiredCapabilities.includes("tool_calling")) {
    requiredHarnessCapabilities.add("toolExecution");
  }
  if (assessment.writeAccessRequired) {
    requiredHarnessCapabilities.add("toolExecution");
    requiredHarnessCapabilities.add("codeEditing");
  }
  const normalizedComplexity =
    assessment.complexity === "unknown" ? "medium" : assessment.complexity;

  return {
    agentRole: assessment.agentRole,
    taskType: assessment.taskType,
    complexity: assessment.complexity,
    requiredModelCapabilities: [...assessment.requiredCapabilities],
    requiredHarnessCapabilities: [...requiredHarnessCapabilities].toSorted(),
    preferredModelCapabilities: [...assessment.preferredCapabilities],
    requiredTools: [],
    requiredModalities: assessment.visionRequired ? ["image"] : [],
    estimatedContextTokens: assessment.estimatedContextTokens,
    privacyClassification: assessment.privacyClassification,
    writeAccessRequired: assessment.writeAccessRequired,
    visionRequired: assessment.visionRequired,
    structuredOutputRequired: assessment.structuredOutputRequired,
    recommendedReasoningLevel: reasoningForComplexity(normalizedComplexity),
    source: assessment.assessmentSource,
    explanation: assessment.assessmentExplanation,
  };
};
