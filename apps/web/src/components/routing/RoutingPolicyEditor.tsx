import { ArrowDownIcon, ArrowUpIcon, SaveIcon, Trash2Icon } from "lucide-react";

import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import type { RoutingPolicyDraft, RoutingSelectOption } from "./routingView";

const PRIVACY_OPTIONS = [
  ["inherit", "Inherit"],
  ["remote_allowed", "Remote allowed"],
  ["approved_remote_only", "Approved remote only"],
  ["local_preferred", "Local preferred"],
  ["local_only", "Local only"],
] as const;

const FALLBACK_OPTIONS = [
  ["none", "No fallback"],
  ["same_model_retry", "Retry same model"],
  ["same_provider", "Same provider"],
  ["configured_chain", "Configured chain"],
  ["any_compatible", "Any compatible model"],
] as const;

function withToggledValue(values: ReadonlyArray<string>, value: string): ReadonlyArray<string> {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function OptionChecklist({
  label,
  options,
  values,
  onChange,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<RoutingSelectOption>;
  readonly values: ReadonlyArray<string>;
  readonly onChange: (values: ReadonlyArray<string>) => void;
}) {
  return (
    <fieldset className="grid gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{label}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options available.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const checked = values.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex min-h-7 items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  checked={checked}
                  disabled={option.unavailable && !checked}
                  onCheckedChange={() => onChange(withToggledValue(values, option.value))}
                />
                <span className="min-w-0 truncate">{option.label}</span>
                {option.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function PolicySelect({
  value,
  label,
  options,
  inheritLabel,
  onChange,
}: {
  readonly value: string | null;
  readonly label: string;
  readonly options: ReadonlyArray<RoutingSelectOption>;
  readonly inheritLabel: string;
  readonly onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      value={value ?? "inherit"}
      onValueChange={(next) => onChange(next === "inherit" ? null : next)}
    >
      <SelectTrigger className="w-full sm:w-64" aria-label={label}>
        <SelectValue>
          <span className="flex items-center gap-2">
            {selected?.label ?? inheritLabel}
            {selected?.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem value="inherit">{inheritLabel}</SelectItem>
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
  );
}

function FallbackChainEditor({
  modelOptions,
  modelIds,
  onChange,
}: {
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelIds: ReadonlyArray<string>;
  readonly onChange: (values: ReadonlyArray<string>) => void;
}) {
  const addableModels = modelOptions.filter((option) => !modelIds.includes(option.value));
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= modelIds.length) return;
    const next = [...modelIds];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      {modelIds.length === 0 ? (
        <p className="text-xs text-muted-foreground">No explicit fallback models configured.</p>
      ) : (
        <ol className="grid gap-1.5">
          {modelIds.map((modelId, index) => {
            const option = modelOptions.find((candidate) => candidate.value === modelId);
            return (
              <li
                key={modelId}
                className="flex min-w-0 items-center gap-2 rounded-md bg-muted/50 p-2"
              >
                <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{option?.label ?? modelId}</span>
                {option?.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${option?.label ?? modelId} up`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={index === modelIds.length - 1}
                  aria-label={`Move ${option?.label ?? modelId} down`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${option?.label ?? modelId} from fallback chain`}
                  onClick={() => onChange(modelIds.filter((id) => id !== modelId))}
                >
                  <Trash2Icon />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      {addableModels.length > 0 ? (
        <Select value={null} onValueChange={(value) => value && onChange([...modelIds, value])}>
          <SelectTrigger className="w-full" aria-label="Add fallback model">
            <SelectValue placeholder="Add fallback model" />
          </SelectTrigger>
          <SelectPopup>
            {addableModels.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
    </div>
  );
}

export function RoutingPolicyEditor({
  draft,
  providerOptions,
  modelOptions,
  reasoningOptions,
  capabilityOptions,
  validationErrors,
  isSaving,
  onChange,
  onSave,
}: {
  readonly draft: RoutingPolicyDraft;
  readonly providerOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly reasoningOptions: ReadonlyArray<RoutingSelectOption>;
  readonly capabilityOptions: ReadonlyArray<RoutingSelectOption>;
  readonly validationErrors: ReadonlyArray<string>;
  readonly isSaving: boolean;
  readonly onChange: (draft: RoutingPolicyDraft) => void;
  readonly onSave: () => void;
}) {
  const patchDraft = (patch: Partial<RoutingPolicyDraft>) => onChange({ ...draft, ...patch });

  return (
    <>
      <SettingsSection id="routing-defaults" title="Routing defaults">
        <SettingsRow
          title="Default provider"
          description="Used when no higher-precedence role, mission, task, or manual pin chooses a provider."
          control={
            <PolicySelect
              value={draft.defaultProviderId}
              label="Default routing provider"
              options={providerOptions}
              inheritLabel="Automatic"
              onChange={(defaultProviderId) => patchDraft({ defaultProviderId })}
            />
          }
        />
        <SettingsRow
          title="Default model"
          description="A default narrows automatic routing. An unavailable saved model remains visible until you replace it."
          control={
            <PolicySelect
              value={draft.defaultModelId}
              label="Default routing model"
              options={modelOptions}
              inheritLabel="Automatic"
              onChange={(defaultModelId) => patchDraft({ defaultModelId })}
            />
          }
        />
        <SettingsRow
          title="Default reasoning"
          description="The routing engine applies this only when the selected model supports the level."
          control={
            <PolicySelect
              value={draft.defaultReasoningLevel}
              label="Default reasoning level"
              options={reasoningOptions}
              inheritLabel="Model default"
              onChange={(defaultReasoningLevel) => patchDraft({ defaultReasoningLevel })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="routing-policies" title="Policy and constraints">
        <SettingsRow
          title="Privacy mode"
          description="Privacy constraints filter candidates before scoring. Local-only never silently falls back to a remote provider."
          control={
            <Select
              value={draft.privacyMode}
              onValueChange={(privacyMode) => privacyMode && patchDraft({ privacyMode })}
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Routing privacy mode">
                <SelectValue>
                  {PRIVACY_OPTIONS.find(([value]) => value === draft.privacyMode)?.[1] ??
                    draft.privacyMode}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {PRIVACY_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Prefer local models"
          description="Ranks compatible local candidates higher without rejecting remote candidates."
          control={
            <Switch
              checked={draft.localPreference}
              onCheckedChange={(checked) => patchDraft({ localPreference: Boolean(checked) })}
              aria-label="Prefer local models"
            />
          }
        />
        <SettingsRow
          title="Capability and provider rules"
          description="Required capabilities are hard filters. Preferred and excluded providers affect eligibility and ranking."
        >
          <div className="grid gap-3 py-3">
            <OptionChecklist
              label="Required model capabilities"
              options={capabilityOptions}
              values={draft.requiredCapabilities}
              onChange={(requiredCapabilities) => patchDraft({ requiredCapabilities })}
            />
            <OptionChecklist
              label="Preferred providers"
              options={providerOptions}
              values={draft.preferredProviderIds}
              onChange={(preferredProviderIds) => patchDraft({ preferredProviderIds })}
            />
            <OptionChecklist
              label="Excluded providers"
              options={providerOptions}
              values={draft.excludedProviderIds}
              onChange={(excludedProviderIds) => patchDraft({ excludedProviderIds })}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="routing-fallbacks" title="Fallback behaviour">
        <SettingsRow
          title="Fallback mode"
          description="Fallback applies only to eligible transient failures. Each reroute creates a new immutable decision and run."
          control={
            <Select
              value={draft.fallbackMode}
              onValueChange={(fallbackMode) => fallbackMode && patchDraft({ fallbackMode })}
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Routing fallback mode">
                <SelectValue>
                  {FALLBACK_OPTIONS.find(([value]) => value === draft.fallbackMode)?.[1] ??
                    draft.fallbackMode}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {FALLBACK_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Configured fallback chain"
          description="Order compatible alternatives. Saved unavailable pins stay visible and are never silently replaced."
        >
          <div className="py-3">
            <FallbackChainEditor
              modelOptions={modelOptions}
              modelIds={draft.fallbackModelIds}
              onChange={(fallbackModelIds) => patchDraft({ fallbackModelIds })}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Save policy">
        <SettingsRow
          title={`${draft.scope.replaceAll("_", " ")} policy`}
          description="Conflicts are validated before this versioned policy replaces the active policy for its scope."
          status={
            validationErrors.length > 0 ? (
              <ul className="grid gap-1 text-destructive-foreground">
                {validationErrors.map((error) => (
                  <li key={error}>• {error}</li>
                ))}
              </ul>
            ) : (
              "No policy conflicts detected."
            )
          }
          control={
            <Button disabled={isSaving || validationErrors.length > 0} onClick={onSave}>
              <SaveIcon /> {isSaving ? "Saving" : "Save policy"}
            </Button>
          }
        />
      </SettingsSection>
    </>
  );
}
