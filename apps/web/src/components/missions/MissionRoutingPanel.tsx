import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  IsoDateTime,
  ModelProfileId,
  ProviderInstanceId,
  RoutingOverrideId,
  RoutingPolicyId,
  RoutingRuleId,
  TaskRoutingAssessmentId,
  type EnvironmentId,
  type Mission,
  type MissionTask,
  type MissionTeamSettings,
  type RoutingPolicy,
  type RoutingRegistrySnapshot,
  type RoutingRule,
  type RoutingWorkspaceSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { ChevronRightIcon, FlaskConicalIcon, RouteIcon, SaveIcon } from "lucide-react";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { routingEnvironment } from "../../state/routing";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import type {
  MissionRoutingPolicyDraft,
  RoutingSelectOption,
  TaskRoutingAssessmentView,
} from "../routing/routingView";

function MissionPolicySelect({
  value,
  label,
  automaticLabel,
  options,
  disabled,
  onChange,
}: {
  readonly value: string | null;
  readonly label: string;
  readonly automaticLabel: string;
  readonly options: ReadonlyArray<RoutingSelectOption>;
  readonly disabled: boolean;
  readonly onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={value ?? "automatic"}
        disabled={disabled}
        onValueChange={(next) => onChange(next === "automatic" ? null : next)}
      >
        <SelectTrigger aria-label={`Mission ${label.toLocaleLowerCase()}`}>
          <SelectValue>
            <span className="flex items-center gap-2">
              {selected?.label ?? automaticLabel}
              {selected?.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="automatic">{automaticLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                {option.label}
                {option.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

function TaskAssessmentRow({
  assessment,
  taskTypes,
  complexities,
  providerOptions,
  modelOptions,
  reasoningOptions,
  isSaving,
  isPinSaving,
  onCorrect,
  onSavePins,
  onSimulate,
}: {
  readonly assessment: TaskRoutingAssessmentView;
  readonly taskTypes: ReadonlyArray<RoutingSelectOption>;
  readonly complexities: ReadonlyArray<RoutingSelectOption>;
  readonly providerOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly reasoningOptions: ReadonlyArray<RoutingSelectOption>;
  readonly isSaving: boolean;
  readonly isPinSaving: boolean;
  readonly onCorrect: (taskType: string, complexity: string) => void;
  readonly onSavePins: (
    providerId: string | null,
    modelId: string | null,
    reasoningLevel: string | null,
  ) => void;
  readonly onSimulate: () => void;
}) {
  const [taskType, setTaskType] = useState(assessment.taskType);
  const [complexity, setComplexity] = useState(assessment.complexity);
  const [providerPin, setProviderPin] = useState(assessment.providerPin);
  const [modelPin, setModelPin] = useState(assessment.modelPin);
  const [reasoningPin, setReasoningPin] = useState(assessment.reasoningPin);
  const [showFallback, setShowFallback] = useState(false);
  const isChanged = taskType !== assessment.taskType || complexity !== assessment.complexity;
  const pinsChanged =
    providerPin !== assessment.providerPin ||
    modelPin !== assessment.modelPin ||
    reasoningPin !== assessment.reasoningPin;

  return (
    <article className="grid gap-3 rounded-lg border border-border p-3 [content-visibility:auto] [contain-intrinsic-size:auto_12rem]">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium">{assessment.taskTitle}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{assessment.explanation}</p>
        </div>
        <Badge variant={assessment.source === "manual" ? "info" : "outline"}>
          {assessment.source}
        </Badge>
        <Badge
          variant={
            assessment.providerPin || assessment.modelPin || assessment.reasoningPin
              ? "info"
              : "outline"
          }
        >
          {assessment.providerPin || assessment.modelPin || assessment.reasoningPin
            ? "Manually pinned"
            : "Automatic routing"}
        </Badge>
        <Badge variant="outline">{assessment.privacyClassification.replaceAll("_", " ")}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MissionPolicySelect
          value={providerPin}
          label="Task provider pin"
          automaticLabel="Automatic"
          options={providerOptions}
          disabled={isPinSaving}
          onChange={setProviderPin}
        />
        <MissionPolicySelect
          value={modelPin}
          label="Task model pin"
          automaticLabel="Automatic"
          options={modelOptions}
          disabled={isPinSaving}
          onChange={setModelPin}
        />
        <MissionPolicySelect
          value={reasoningPin}
          label="Task reasoning pin"
          automaticLabel="Model default"
          options={reasoningOptions}
          disabled={isPinSaving}
          onChange={setReasoningPin}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <MissionPolicySelect
          value={taskType}
          label="Task type"
          automaticLabel="Unknown"
          options={taskTypes}
          disabled={isSaving}
          onChange={(value) => value && setTaskType(value)}
        />
        <MissionPolicySelect
          value={complexity}
          label="Complexity"
          automaticLabel="Unknown"
          options={complexities}
          disabled={isSaving}
          onChange={(value) => value && setComplexity(value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Required:{" "}
          {assessment.requiredCapabilities.length > 0
            ? assessment.requiredCapabilities.join(", ")
            : "none"}
        </span>
        <span>
          Context:{" "}
          {assessment.estimatedContextTokens === null
            ? "unknown"
            : assessment.estimatedContextTokens.toLocaleString()}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          disabled={!isChanged || isSaving}
          onClick={() => onCorrect(taskType, complexity)}
        >
          <SaveIcon /> {isSaving ? "Saving" : "Save correction"}
        </Button>
        <Button size="xs" variant="outline" onClick={onSimulate}>
          <FlaskConicalIcon /> Simulate routing
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!pinsChanged || isPinSaving}
          onClick={() => onSavePins(providerPin, modelPin, reasoningPin)}
        >
          <SaveIcon /> {isPinSaving ? "Saving pins" : "Save task pins"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={showFallback}
          onClick={() => setShowFallback((current) => !current)}
        >
          Inspect fallback <ChevronRightIcon />
        </Button>
      </div>
      {showFallback ? (
        assessment.fallbackPlan.length > 0 ? (
          <ol className="grid gap-1 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            {assessment.fallbackPlan.map((step, index) => (
              <li key={step}>
                {index + 1}. {step}
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            No fallback plan has been recorded for this task yet.
          </p>
        )
      ) : null}
    </article>
  );
}

export function MissionRoutingPanel({
  draft,
  providerOptions,
  modelOptions,
  reasoningOptions,
  privacyOptions,
  taskTypeOptions,
  complexityOptions,
  assessments,
  validationErrors,
  canMutate,
  isSavingPolicy,
  isAssessmentSaving,
  isTaskPinSaving,
  onChange,
  onSavePolicy,
  onCorrectAssessment,
  onSaveTaskPins,
  onSimulateTask,
}: {
  readonly draft: MissionRoutingPolicyDraft;
  readonly providerOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly reasoningOptions: ReadonlyArray<RoutingSelectOption>;
  readonly privacyOptions: ReadonlyArray<RoutingSelectOption>;
  readonly taskTypeOptions: ReadonlyArray<RoutingSelectOption>;
  readonly complexityOptions: ReadonlyArray<RoutingSelectOption>;
  readonly assessments: ReadonlyArray<TaskRoutingAssessmentView>;
  readonly validationErrors: ReadonlyArray<string>;
  readonly canMutate: boolean;
  readonly isSavingPolicy: boolean;
  readonly isAssessmentSaving: (assessmentId: string) => boolean;
  readonly isTaskPinSaving: (taskId: string) => boolean;
  readonly onChange: (draft: MissionRoutingPolicyDraft) => void;
  readonly onSavePolicy: () => void;
  readonly onCorrectAssessment: (
    assessmentId: string,
    taskType: string,
    complexity: string,
  ) => void;
  readonly onSaveTaskPins: (
    taskId: string,
    providerId: string | null,
    modelId: string | null,
    reasoningLevel: string | null,
  ) => void;
  readonly onSimulateTask: (taskId: string) => void;
}) {
  const patchDraft = (patch: Partial<MissionRoutingPolicyDraft>) =>
    onChange({ ...draft, ...patch });
  const controlsDisabled = !canMutate || draft.inheritProjectPolicy;

  return (
    <section aria-labelledby="mission-routing-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <RouteIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-routing-heading" className="text-sm font-semibold">
          Routing
        </h2>
        <Badge variant={draft.inheritProjectPolicy ? "outline" : "info"}>
          {draft.inheritProjectPolicy ? "Project policy" : "Mission override"}
        </Badge>
      </div>

      <div className="grid gap-4 rounded-xl border border-border p-4">
        <label className="flex items-start justify-between gap-4 text-sm">
          <span>
            <strong className="block font-medium">Inherit project policy</strong>
            <span className="text-xs text-muted-foreground">
              Turn off to configure mission-only constraints and pins.
            </span>
          </span>
          <Switch
            checked={draft.inheritProjectPolicy}
            disabled={!canMutate}
            onCheckedChange={(checked) => patchDraft({ inheritProjectPolicy: Boolean(checked) })}
            aria-label="Inherit project routing policy"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MissionPolicySelect
            value={draft.providerId}
            label="Provider"
            automaticLabel="Automatic"
            options={providerOptions}
            disabled={controlsDisabled}
            onChange={(providerId) => patchDraft({ providerId })}
          />
          <MissionPolicySelect
            value={draft.modelId}
            label="Model"
            automaticLabel="Automatic"
            options={modelOptions}
            disabled={controlsDisabled}
            onChange={(modelId) => patchDraft({ modelId })}
          />
          <MissionPolicySelect
            value={draft.reasoningLevel}
            label="Reasoning"
            automaticLabel="Model default"
            options={reasoningOptions}
            disabled={controlsDisabled}
            onChange={(reasoningLevel) => patchDraft({ reasoningLevel })}
          />
          <MissionPolicySelect
            value={draft.privacyMode}
            label="Privacy"
            automaticLabel="Inherit"
            options={privacyOptions}
            disabled={controlsDisabled}
            onChange={(privacyMode) => privacyMode && patchDraft({ privacyMode })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 p-3 text-sm">
            Disable fallback
            <Switch
              checked={draft.disableFallback}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => patchDraft({ disableFallback: Boolean(checked) })}
              aria-label="Disable mission routing fallback"
            />
          </label>
          <label className="grid gap-1.5 rounded-lg bg-muted/40 p-3 text-sm">
            <span>Maximum concurrent remote agents</span>
            <Input
              nativeInput
              type="number"
              min={0}
              max={64}
              value={draft.maximumConcurrentRemoteAgents}
              disabled={controlsDisabled}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 0) {
                  patchDraft({ maximumConcurrentRemoteAgents: value });
                }
              }}
            />
          </label>
        </div>

        <fieldset
          className="grid gap-2 rounded-lg border border-border p-3"
          disabled={controlsDisabled}
        >
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            Restrict providers
          </legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {providerOptions.map((provider) => {
              const checked = draft.restrictedProviderIds.includes(provider.value);
              return (
                <label key={provider.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      const restrictedProviderIds = checked
                        ? draft.restrictedProviderIds.filter((value) => value !== provider.value)
                        : [...draft.restrictedProviderIds, provider.value];
                      patchDraft({ restrictedProviderIds });
                    }}
                  />
                  <span className="truncate">{provider.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {validationErrors.length > 0 ? (
          <ul className="grid gap-1 text-xs text-destructive-foreground" role="alert">
            {validationErrors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button
            size="sm"
            disabled={!canMutate || isSavingPolicy || validationErrors.length > 0}
            onClick={onSavePolicy}
          >
            <SaveIcon /> {isSavingPolicy ? "Saving" : "Save mission routing"}
          </Button>
        </div>
      </div>

      {assessments.length > 0 ? (
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Task assessments ({assessments.length})
          </summary>
          <div className="mt-4 grid gap-3">
            {assessments.map((assessment) => (
              <TaskAssessmentRow
                key={assessment.id}
                assessment={assessment}
                taskTypes={taskTypeOptions}
                complexities={complexityOptions}
                providerOptions={providerOptions}
                modelOptions={modelOptions}
                reasoningOptions={reasoningOptions}
                isSaving={isAssessmentSaving(assessment.id)}
                isPinSaving={isTaskPinSaving(assessment.taskId)}
                onCorrect={(taskType, complexity) =>
                  onCorrectAssessment(assessment.id, taskType, complexity)
                }
                onSavePins={(providerId, modelId, reasoningLevel) =>
                  onSaveTaskPins(assessment.taskId, providerId, modelId, reasoningLevel)
                }
                onSimulate={() => onSimulateTask(assessment.taskId)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

const MISSION_REASONING_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "extra_high", label: "Extra high" },
];

const MISSION_PRIVACY_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  { value: "inherit", label: "Inherit" },
  { value: "remote_allowed", label: "Remote allowed" },
  { value: "approved_remote_only", label: "Approved remote only" },
  { value: "local_preferred", label: "Local preferred" },
  { value: "local_only", label: "Local only" },
];

const TASK_TYPE_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  "planning",
  "architecture",
  "implementation",
  "refactor",
  "bug_fix",
  "test_authoring",
  "verification",
  "review",
  "security_review",
  "performance_review",
  "research",
  "documentation",
  "memory_extraction",
  "github_workflow",
  "conflict_resolution",
  "repair",
  "custom",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const COMPLEXITY_OPTIONS: ReadonlyArray<RoutingSelectOption> = [
  "trivial",
  "low",
  "medium",
  "high",
  "very_high",
  "unknown",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

function missionPolicyDraft(
  mission: Mission,
  workspace: RoutingWorkspaceSnapshot,
): MissionRoutingPolicyDraft {
  const policy = workspace.policies
    .filter((candidate) => candidate.scopeType === "mission" && candidate.scopeId === mission.id)
    .toSorted(
      (left, right) =>
        right.priority - left.priority || right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  const rule = policy
    ? workspace.rules
        .filter((candidate) => candidate.routingPolicyId === policy.id)
        .toSorted((left, right) => right.priority - left.priority)[0]
    : undefined;
  return {
    inheritProjectPolicy: policy === undefined,
    providerId: policy?.defaultProviderProfileId ?? null,
    modelId: policy?.defaultModelProfileId ?? null,
    reasoningLevel: policy?.defaultReasoningLevel ?? null,
    privacyMode: policy?.privacyMode ?? "inherit",
    disableFallback: policy?.fallbackMode === "none",
    maximumConcurrentRemoteAgents: mission.teamSettings.maximumConcurrentAgents,
    restrictedProviderIds: rule?.requirements.requiredProviderProfileIds ?? [],
  };
}

function missionRegistryOptions(
  registry: RoutingRegistrySnapshot,
  draft: MissionRoutingPolicyDraft,
): {
  readonly providers: ReadonlyArray<RoutingSelectOption>;
  readonly models: ReadonlyArray<RoutingSelectOption>;
} {
  const providerById = new Map(
    registry.providers.map((provider) => [provider.id, provider] as const),
  );
  const providers: ReadonlyArray<RoutingSelectOption> = registry.providers.map((provider) => ({
    value: provider.id,
    label: provider.displayName,
    unavailable:
      !provider.isEnabled || (provider.status !== "available" && provider.status !== "degraded"),
  }));
  const models: ReadonlyArray<RoutingSelectOption> = registry.models.map((model) => ({
    value: model.id,
    label: `${model.displayName} · ${providerById.get(model.providerProfileId)?.displayName ?? model.providerProfileId}`,
    unavailable:
      !model.isEnabled ||
      model.status === "disabled" ||
      model.status === "unavailable" ||
      model.status === "unknown",
  }));
  const withPinnedProvider =
    draft.providerId && !providers.some((item) => item.value === draft.providerId)
      ? [...providers, { value: draft.providerId, label: draft.providerId, unavailable: true }]
      : providers;
  const withRestrictedProviders: RoutingSelectOption[] = [...withPinnedProvider];
  for (const providerId of draft.restrictedProviderIds) {
    if (!withRestrictedProviders.some((item) => item.value === providerId)) {
      withRestrictedProviders.push({ value: providerId, label: providerId, unavailable: true });
    }
  }
  const withPinnedModel =
    draft.modelId && !models.some((item) => item.value === draft.modelId)
      ? [...models, { value: draft.modelId, label: draft.modelId, unavailable: true }]
      : models;
  return {
    providers: withRestrictedProviders,
    models: withPinnedModel,
  };
}

function missionDraftErrors(
  draft: MissionRoutingPolicyDraft,
  registry: RoutingRegistrySnapshot,
): ReadonlyArray<string> {
  if (draft.inheritProjectPolicy) return [];
  const errors: string[] = [];
  if (
    draft.providerId &&
    draft.restrictedProviderIds.length > 0 &&
    !draft.restrictedProviderIds.includes(draft.providerId)
  ) {
    errors.push("The pinned provider must be included in the mission provider restriction.");
  }
  const selectedModel = registry.models.find((model) => model.id === draft.modelId);
  if (draft.providerId && selectedModel && selectedModel.providerProfileId !== draft.providerId) {
    errors.push("The pinned model belongs to a different provider.");
  }
  if (draft.maximumConcurrentRemoteAgents < 1) {
    errors.push("The current mission scheduler requires at least one concurrent agent.");
  }
  return errors;
}

export function MissionRoutingWorkspacePanel({
  environmentId,
  mission,
  tasks,
  canMutate,
  onConfigureTeam,
}: {
  readonly environmentId: EnvironmentId;
  readonly mission: Mission;
  readonly tasks: ReadonlyArray<MissionTask>;
  readonly canMutate: boolean;
  readonly onConfigureTeam: (settings: MissionTeamSettings) => Promise<void>;
}) {
  const navigate = useNavigate();
  const registryResult = useAtomValue(
    routingEnvironment.registryAtom({ environmentId, input: {} }),
  );
  const workspaceResult = useAtomValue(
    routingEnvironment.workspaceSubscriptionAtom({
      environmentId,
      input: { projectId: mission.projectId, missionId: mission.id },
    }),
  );
  const savePolicyCommand = useAtomCommand(routingEnvironment.savePolicy, { reportFailure: false });
  const saveRuleCommand = useAtomCommand(routingEnvironment.saveRule, { reportFailure: false });
  const saveAssessmentCommand = useAtomCommand(routingEnvironment.saveAssessment, {
    reportFailure: false,
  });
  const saveOverrideCommand = useAtomCommand(routingEnvironment.saveOverride, {
    reportFailure: false,
  });
  const revokeOverrideCommand = useAtomCommand(routingEnvironment.revokeOverride, {
    reportFailure: false,
  });
  const [draftOverride, setDraftOverride] = useState<MissionRoutingPolicyDraft | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [savingAssessmentId, setSavingAssessmentId] = useState<string | null>(null);
  const [savingTaskPinId, setSavingTaskPinId] = useState<string | null>(null);
  const [optimisticTaskPins, setOptimisticTaskPins] = useState<
    Readonly<
      Record<
        string,
        {
          readonly providerId: string | null;
          readonly modelId: string | null;
          readonly reasoningLevel: string | null;
        }
      >
    >
  >({});
  const registry = Option.getOrNull(AsyncResult.value(registryResult));
  const workspace = Option.getOrNull(AsyncResult.value(workspaceResult));

  if (!registry || !workspace) {
    return (
      <section aria-labelledby="mission-routing-heading" className="grid gap-2">
        <div className="flex items-center gap-2">
          <RouteIcon className="size-4 text-muted-foreground" />
          <h2 id="mission-routing-heading" className="text-sm font-semibold">
            Routing
          </h2>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {registryResult._tag === "Failure" || workspaceResult._tag === "Failure"
            ? "Routing configuration is unavailable. Existing mission settings are unchanged."
            : "Loading mission routing…"}
        </p>
      </section>
    );
  }

  const serverDraft = missionPolicyDraft(mission, workspace);
  const draft = draftOverride ?? serverDraft;
  const options = missionRegistryOptions(registry, draft);
  const validationErrors = missionDraftErrors(draft, registry);
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const providerById = new Map(
    registry.providers.map((provider) => [provider.id, provider] as const),
  );
  const modelById = new Map(registry.models.map((model) => [model.id, model] as const));
  const assessments = workspace.assessments
    .filter((assessment) => assessment.supersededById === null && taskById.has(assessment.taskId))
    .map((assessment): TaskRoutingAssessmentView => {
      const decision = workspace.decisions
        .filter((candidate) => candidate.taskId === assessment.taskId)
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      const taskOverrides = workspace.overrides
        .filter(
          (override) =>
            override.scopeType === "task" &&
            override.scopeId === assessment.taskId &&
            override.revokedAt === null,
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
      const optimisticPins = optimisticTaskPins[assessment.taskId];
      return {
        id: assessment.id,
        taskId: assessment.taskId,
        taskTitle: taskById.get(assessment.taskId)?.title ?? assessment.taskId,
        taskType: assessment.taskType,
        complexity: assessment.complexity,
        source: assessment.assessmentSource,
        explanation: assessment.assessmentExplanation,
        requiredCapabilities: assessment.requiredCapabilities,
        estimatedContextTokens: assessment.estimatedContextTokens,
        privacyClassification: assessment.privacyClassification,
        fallbackPlan:
          decision?.fallbackPlan.map((step) => {
            const provider =
              providerById.get(step.providerProfileId)?.displayName ?? step.providerProfileId;
            const model = modelById.get(step.modelProfileId)?.displayName ?? step.modelProfileId;
            return `${provider} · ${model}${step.reason ? ` — ${step.reason}` : ""}`;
          }) ?? [],
        providerPin:
          optimisticPins !== undefined
            ? optimisticPins.providerId
            : (taskOverrides.find((override) => override.providerProfileId !== null)
                ?.providerProfileId ?? null),
        modelPin:
          optimisticPins !== undefined
            ? optimisticPins.modelId
            : (taskOverrides.find((override) => override.modelProfileId !== null)?.modelProfileId ??
              null),
        reasoningPin:
          optimisticPins !== undefined
            ? optimisticPins.reasoningLevel
            : (taskOverrides.find((override) => override.reasoningLevel !== null)?.reasoningLevel ??
              null),
      };
    });
  const taskProviderOptions: RoutingSelectOption[] = [...options.providers];
  const taskModelOptions: RoutingSelectOption[] = [...options.models];
  for (const assessment of assessments) {
    if (
      assessment.providerPin &&
      !taskProviderOptions.some((item) => item.value === assessment.providerPin)
    ) {
      taskProviderOptions.push({
        value: assessment.providerPin,
        label: assessment.providerPin,
        unavailable: true,
      });
    }
    if (
      assessment.modelPin &&
      !taskModelOptions.some((item) => item.value === assessment.modelPin)
    ) {
      taskModelOptions.push({
        value: assessment.modelPin,
        label: assessment.modelPin,
        unavailable: true,
      });
    }
  }

  const savePolicy = async () => {
    const now = IsoDateTime.make(new Date().toISOString());
    const existingPolicy = workspace.policies.find(
      (candidate) => candidate.scopeType === "mission" && candidate.scopeId === mission.id,
    );
    setIsSavingPolicy(true);
    try {
      if (draft.inheritProjectPolicy) {
        if (existingPolicy) {
          const result = await savePolicyCommand({
            environmentId,
            input: { policy: { ...existingPolicy, isEnabled: false, updatedAt: now } },
          });
          if (result._tag === "Failure") {
            toastManager.add({ type: "error", title: "Mission routing policy was not removed" });
            return;
          }
        }
      } else {
        const policy: RoutingPolicy = {
          id: existingPolicy?.id ?? RoutingPolicyId.make(`mission-${mission.id}-${randomUUID()}`),
          scopeType: "mission",
          scopeId: mission.id,
          name: existingPolicy?.name ?? "Mission routing policy",
          description: existingPolicy?.description ?? "Mission-specific routing constraints.",
          priority: existingPolicy?.priority ?? 200,
          isEnabled: true,
          defaultProviderProfileId: draft.providerId
            ? ProviderInstanceId.make(draft.providerId)
            : null,
          defaultModelProfileId: draft.modelId ? ModelProfileId.make(draft.modelId) : null,
          defaultReasoningLevel: draft.reasoningLevel as RoutingPolicy["defaultReasoningLevel"],
          fallbackMode: draft.disableFallback ? "none" : "any_compatible",
          privacyMode: draft.privacyMode as RoutingPolicy["privacyMode"],
          budgetMode: existingPolicy?.budgetMode ?? "balanced",
          createdAt: existingPolicy?.createdAt ?? now,
          updatedAt: now,
        };
        const policyResult = await savePolicyCommand({ environmentId, input: { policy } });
        if (policyResult._tag === "Failure") {
          toastManager.add({ type: "error", title: "Mission routing policy was not saved" });
          return;
        }
        const existingRule = workspace.rules.find(
          (candidate) => candidate.routingPolicyId === policy.id,
        );
        const rule: RoutingRule = {
          id: existingRule?.id ?? RoutingRuleId.make(`mission-rule-${mission.id}-${randomUUID()}`),
          routingPolicyId: policy.id,
          name: existingRule?.name ?? "Mission provider restrictions",
          description:
            existingRule?.description ?? "Provider restrictions for this mission's routed work.",
          priority: existingRule?.priority ?? 200,
          isEnabled: true,
          conditions: existingRule?.conditions ?? {
            taskTypes: [],
            agentRoles: [],
            complexities: [],
            repositoryLanguages: [],
            changedFilePatterns: [],
            requiredModalities: [],
            requiredTools: [],
            minimumContextTokens: null,
            privacyClassifications: [],
            missionStatuses: [],
            verificationFailureCategories: [],
            providerStatuses: [],
            rateLimitStates: [],
            manualPinState: "any",
          },
          requirements: {
            ...(existingRule?.requirements ?? {
              excludedProviderProfileIds: [],
              requiredModelProfileIds: [],
              excludedModelProfileIds: [],
              minimumCapabilities: [],
              reasoningLevel: null,
              maximumContextTarget: null,
              fallbackChain: [],
              maximumRetries: 0,
            }),
            requiredProviderProfileIds: draft.restrictedProviderIds.map((providerId) =>
              ProviderInstanceId.make(providerId),
            ),
          },
          preferences: existingRule?.preferences ?? {
            preferredProviderProfileIds: [],
            preferredModelProfileIds: [],
            preferredCapabilities: [],
            preferLocal: false,
            preferLowLatency: false,
            preferLowCost: false,
          },
          result: existingRule?.result ?? {
            providerProfileId: null,
            modelProfileId: null,
            reasoningLevel: null,
            fallbackMode: null,
            allowDeprecatedModel: false,
          },
          createdAt: existingRule?.createdAt ?? now,
          updatedAt: now,
        };
        const ruleResult = await saveRuleCommand({ environmentId, input: { rule } });
        if (ruleResult._tag === "Failure") {
          toastManager.add({
            type: "warning",
            title: "Mission defaults saved, but provider restrictions were rejected",
          });
          return;
        }
        if (draft.maximumConcurrentRemoteAgents !== mission.teamSettings.maximumConcurrentAgents) {
          await onConfigureTeam({
            ...mission.teamSettings,
            maximumConcurrentAgents: draft.maximumConcurrentRemoteAgents,
            maximumConcurrentWriteAgents: Math.min(
              mission.teamSettings.maximumConcurrentWriteAgents,
              draft.maximumConcurrentRemoteAgents,
            ),
          });
        }
      }
      setDraftOverride(null);
      toastManager.add({ type: "success", title: "Mission routing saved" });
    } catch {
      toastManager.add({ type: "error", title: "Mission routing could not be saved" });
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const saveTaskPins = async (
    taskId: string,
    providerId: string | null,
    modelId: string | null,
    reasoningLevel: string | null,
  ) => {
    const managedOverrides = workspace.overrides.filter(
      (override) =>
        override.scopeType === "task" &&
        override.scopeId === taskId &&
        override.revokedAt === null &&
        override.reason === "Task routing pins",
    );
    const now = IsoDateTime.make(new Date().toISOString());
    setSavingTaskPinId(taskId);
    try {
      if (providerId || modelId || reasoningLevel) {
        const saveResult = await saveOverrideCommand({
          environmentId,
          input: {
            override: {
              id: RoutingOverrideId.make(`task-pin-${taskId}-${randomUUID()}`),
              scopeType: "task",
              scopeId: taskId,
              providerProfileId: providerId ? ProviderInstanceId.make(providerId) : null,
              modelProfileId: modelId ? ModelProfileId.make(modelId) : null,
              reasoningLevel: reasoningLevel as RoutingPolicy["defaultReasoningLevel"],
              fallbackMode: null,
              expiresAt: null,
              reason: "Task routing pins",
              createdBy: "user",
              createdAt: now,
              revokedAt: null,
            },
          },
        });
        if (saveResult._tag === "Failure") {
          toastManager.add({ type: "error", title: "Task routing pins were not saved" });
          return;
        }
      }
      for (const existing of managedOverrides) {
        const revokeResult = await revokeOverrideCommand({
          environmentId,
          input: { overrideId: existing.id, revokedAt: now },
        });
        if (revokeResult._tag === "Failure") {
          toastManager.add({
            type: "warning",
            title: "New task pins saved, but an older pin could not be revoked",
          });
          return;
        }
      }
      toastManager.add({
        type: "success",
        title:
          providerId || modelId || reasoningLevel
            ? "Task routing pins saved"
            : "Task routing is automatic",
      });
      setOptimisticTaskPins((current) => ({
        ...current,
        [taskId]: { providerId, modelId, reasoningLevel },
      }));
    } finally {
      setSavingTaskPinId(null);
    }
  };

  const correctAssessment = async (assessmentId: string, taskType: string, complexity: string) => {
    const current = workspace.assessments.find((assessment) => assessment.id === assessmentId);
    if (!current) return;
    const now = IsoDateTime.make(new Date().toISOString());
    setSavingAssessmentId(assessmentId);
    try {
      const result = await saveAssessmentCommand({
        environmentId,
        input: {
          assessment: {
            ...current,
            id: TaskRoutingAssessmentId.make(`manual-${current.taskId}-${randomUUID()}`),
            taskType: taskType as typeof current.taskType,
            complexity: complexity as typeof current.complexity,
            assessmentSource: "manual",
            assessmentExplanation: `Manually corrected from ${current.taskType}/${current.complexity}.`,
            version: current.version + 1,
            createdAt: now,
            updatedAt: now,
            supersededById: null,
          },
        },
      });
      toastManager.add({
        type: result._tag === "Success" ? "success" : "error",
        title:
          result._tag === "Success"
            ? "Task routing assessment corrected"
            : "Task routing assessment was not saved",
      });
    } finally {
      setSavingAssessmentId(null);
    }
  };

  const openRoutingSimulator = () =>
    void navigate({
      to: "/settings/routing",
      hash: "routing-simulator",
      hashScrollIntoView: true,
    });

  return (
    <MissionRoutingPanel
      draft={draft}
      providerOptions={taskProviderOptions}
      modelOptions={taskModelOptions}
      reasoningOptions={MISSION_REASONING_OPTIONS}
      privacyOptions={MISSION_PRIVACY_OPTIONS}
      taskTypeOptions={TASK_TYPE_OPTIONS}
      complexityOptions={COMPLEXITY_OPTIONS}
      assessments={assessments}
      validationErrors={validationErrors}
      canMutate={canMutate}
      isSavingPolicy={isSavingPolicy}
      isAssessmentSaving={(assessmentId) => assessmentId === savingAssessmentId}
      isTaskPinSaving={(taskId) => taskId === savingTaskPinId}
      onChange={setDraftOverride}
      onSavePolicy={() => void savePolicy()}
      onCorrectAssessment={(assessmentId, taskType, complexity) =>
        void correctAssessment(assessmentId, taskType, complexity)
      }
      onSaveTaskPins={(taskId, providerId, modelId, reasoningLevel) =>
        void saveTaskPins(taskId, providerId, modelId, reasoningLevel)
      }
      onSimulateTask={openRoutingSimulator}
    />
  );
}
