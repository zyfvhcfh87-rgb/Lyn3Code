import { ClockIcon, PinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { RoutingOverrideDraft, RoutingOverrideView, RoutingSelectOption } from "./routingView";

function OverrideSelect({
  label,
  value,
  automaticLabel,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly automaticLabel: string;
  readonly options: ReadonlyArray<RoutingSelectOption>;
  readonly onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={value ?? "inherit"}
        onValueChange={(next) => onChange(next === "inherit" ? null : next)}
      >
        <SelectTrigger aria-label={`Override ${label.toLocaleLowerCase()}`}>
          <SelectValue>
            <span className="flex items-center gap-2">
              {selected?.label ?? automaticLabel}
              {selected?.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="inherit">{automaticLabel}</SelectItem>
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

export function RoutingOverrideManager({
  initialDraft,
  overrides,
  scopeOptions,
  providerOptions,
  modelOptions,
  reasoningOptions,
  fallbackOptions,
  validationErrors,
  isSaving,
  isRevoking,
  onSave,
  onRevoke,
}: {
  readonly initialDraft: RoutingOverrideDraft;
  readonly overrides: ReadonlyArray<RoutingOverrideView>;
  readonly scopeOptions: ReadonlyArray<RoutingSelectOption>;
  readonly providerOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly reasoningOptions: ReadonlyArray<RoutingSelectOption>;
  readonly fallbackOptions: ReadonlyArray<RoutingSelectOption>;
  readonly validationErrors: ReadonlyArray<string>;
  readonly isSaving: boolean;
  readonly isRevoking: (overrideId: string) => boolean;
  readonly onSave: (draft: RoutingOverrideDraft) => void;
  readonly onRevoke: (overrideId: string) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const patchDraft = (patch: Partial<RoutingOverrideDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const hasPin =
    draft.providerId !== null ||
    draft.modelId !== null ||
    draft.reasoningLevel !== null ||
    draft.fallbackMode !== null;
  const canSave = hasPin && draft.reason.trim().length > 0 && validationErrors.length === 0;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSave) onSave(draft);
  };

  return (
    <SettingsSection id="routing-overrides" title="Temporary overrides and pins">
      {overrides.length === 0 ? (
        <SettingsRow
          title="No active overrides"
          description="Temporary pins can target a project, mission, role, task, or the current user."
        />
      ) : (
        overrides.map((override) => (
          <SettingsRow
            key={override.id}
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                <PinIcon className="size-3.5" /> {override.scopeLabel}
                {override.unavailable ? (
                  <Badge variant="warning">Pinned target unavailable</Badge>
                ) : null}
              </span>
            }
            description={override.reason}
            status={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {override.providerLabel ? <span>Provider: {override.providerLabel}</span> : null}
                {override.modelLabel ? <span>Model: {override.modelLabel}</span> : null}
                {override.reasoningLevel ? <span>Reasoning: {override.reasoningLevel}</span> : null}
                {override.fallbackMode ? (
                  <span>Fallback: {override.fallbackMode.replaceAll("_", " ")}</span>
                ) : null}
                <span>
                  <ClockIcon className="mr-1 inline size-3" />
                  {override.expiresAt
                    ? `Expires ${formatRelativeTimeLabel(override.expiresAt)}`
                    : "No expiration"}
                </span>
              </span>
            }
            control={
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={isRevoking(override.id)}
                onClick={() => onRevoke(override.id)}
              >
                <Trash2Icon /> {isRevoking(override.id) ? "Revoking" : "Revoke"}
              </Button>
            }
          />
        ))
      )}

      <SettingsRow
        title="Add override"
        description="Manual intent outranks automatic routing. Impossible or unsafe pins fail explicitly instead of silently changing models."
      >
        <form className="grid gap-4 py-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <OverrideSelect
              label="Scope"
              value={draft.scope}
              automaticLabel="Choose scope"
              options={scopeOptions}
              onChange={(scope) => scope && patchDraft({ scope })}
            />
            <OverrideSelect
              label="Provider pin"
              value={draft.providerId}
              automaticLabel="No provider pin"
              options={providerOptions}
              onChange={(providerId) => patchDraft({ providerId })}
            />
            <OverrideSelect
              label="Model pin"
              value={draft.modelId}
              automaticLabel="No model pin"
              options={modelOptions}
              onChange={(modelId) => patchDraft({ modelId })}
            />
            <OverrideSelect
              label="Reasoning pin"
              value={draft.reasoningLevel}
              automaticLabel="No reasoning pin"
              options={reasoningOptions}
              onChange={(reasoningLevel) => patchDraft({ reasoningLevel })}
            />
            <OverrideSelect
              label="Fallback"
              value={draft.fallbackMode}
              automaticLabel="Inherit fallback"
              options={fallbackOptions}
              onChange={(fallbackMode) => patchDraft({ fallbackMode })}
            />
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Expires at</span>
              <Input
                nativeInput
                type="datetime-local"
                value={draft.expiresAt ?? ""}
                onChange={(event) => patchDraft({ expiresAt: event.currentTarget.value || null })}
              />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Reason</span>
            <Input
              nativeInput
              value={draft.reason}
              placeholder="Why is this override needed?"
              maxLength={4_000}
              onChange={(event) => patchDraft({ reason: event.currentTarget.value })}
            />
          </label>
          {validationErrors.length > 0 ? (
            <ul className="grid gap-1 text-xs text-destructive-foreground" role="alert">
              {validationErrors.map((error) => (
                <li key={error}>• {error}</li>
              ))}
            </ul>
          ) : null}
          <div>
            <Button type="submit" disabled={!canSave || isSaving}>
              <PlusIcon /> {isSaving ? "Saving" : "Add override"}
            </Button>
          </div>
        </form>
      </SettingsRow>
    </SettingsSection>
  );
}
