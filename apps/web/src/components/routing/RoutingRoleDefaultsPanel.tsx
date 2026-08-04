import { SaveIcon } from "lucide-react";

import { SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { RoutingRoleDefaultDraft, RoutingSelectOption } from "./routingView";

function RoleDefaultSelect({
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
        value={value ?? "automatic"}
        onValueChange={(next) => onChange(next === "automatic" ? null : next)}
      >
        <SelectTrigger aria-label={`${label} for role`}>
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

export function RoutingRoleDefaultsPanel({
  drafts,
  providerOptions,
  modelOptions,
  reasoningOptions,
  fallbackOptions,
  isSaving,
  onChange,
  onSave,
}: {
  readonly drafts: ReadonlyArray<RoutingRoleDefaultDraft>;
  readonly providerOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly reasoningOptions: ReadonlyArray<RoutingSelectOption>;
  readonly fallbackOptions: ReadonlyArray<RoutingSelectOption>;
  readonly isSaving: (role: string) => boolean;
  readonly onChange: (draft: RoutingRoleDefaultDraft) => void;
  readonly onSave: (role: string) => void;
}) {
  return (
    <SettingsSection id="routing-role-defaults" title="Agent role defaults">
      <p className="px-1 text-sm text-muted-foreground">
        These project role policies are more specific than the project default and remain visible
        when a saved provider or model later becomes unavailable.
      </p>
      <div className="grid gap-3 xl:grid-cols-2">
        {drafts.map((draft) => (
          <article
            key={draft.role}
            className="grid gap-3 rounded-xl border border-border p-4 [content-visibility:auto] [contain-intrinsic-size:auto_13rem]"
          >
            <h3 className="text-sm font-semibold">{draft.label}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <RoleDefaultSelect
                label="Provider"
                value={draft.providerId}
                automaticLabel="Project default"
                options={providerOptions}
                onChange={(providerId) => onChange({ ...draft, providerId })}
              />
              <RoleDefaultSelect
                label="Model"
                value={draft.modelId}
                automaticLabel="Project default"
                options={modelOptions}
                onChange={(modelId) => onChange({ ...draft, modelId })}
              />
              <RoleDefaultSelect
                label="Reasoning"
                value={draft.reasoningLevel}
                automaticLabel="Model default"
                options={reasoningOptions}
                onChange={(reasoningLevel) => onChange({ ...draft, reasoningLevel })}
              />
              <RoleDefaultSelect
                label="Fallback"
                value={draft.fallbackMode}
                automaticLabel="Project default"
                options={fallbackOptions}
                onChange={(fallbackMode) => fallbackMode && onChange({ ...draft, fallbackMode })}
              />
            </div>
            <div>
              <Button size="sm" disabled={isSaving(draft.role)} onClick={() => onSave(draft.role)}>
                <SaveIcon /> {isSaving(draft.role) ? "Saving" : `Save ${draft.label}`}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </SettingsSection>
  );
}
