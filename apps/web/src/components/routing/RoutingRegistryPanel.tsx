import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  CloudIcon,
  KeyRoundIcon,
  LaptopIcon,
  RefreshCwIcon,
  SaveIcon,
} from "lucide-react";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  capabilityKnowledgeLabel,
  routingStatusLabel,
  routingTokenLimitLabel,
  type RoutingModelView,
  type RoutingProviderView,
  type CapabilityCorrectionDraft,
} from "./routingView";

function statusBadgeVariant(status: string) {
  if (status === "available" || status === "authenticated") return "success" as const;
  if (
    status === "offline" ||
    status === "error" ||
    status === "credentials_expired" ||
    status === "authentication_required"
  ) {
    return "error" as const;
  }
  if (status === "degraded" || status === "rate_limited" || status === "preview") {
    return "warning" as const;
  }
  return "outline" as const;
}

function CapabilityFact({ label, value }: { label: string; value: boolean | null }) {
  const text = capabilityKnowledgeLabel(value);
  const Icon =
    value === true ? CheckCircle2Icon : value === false ? AlertTriangleIcon : CircleHelpIcon;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3" /> {label}: {text}
    </span>
  );
}

function CapabilityCorrectionSelect({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: boolean | null;
  readonly onChange: (value: boolean | null) => void;
}) {
  const encoded = value === null ? "unknown" : value ? "supported" : "unsupported";
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={encoded}
        onValueChange={(next) =>
          onChange(next === "supported" ? true : next === "unsupported" ? false : null)
        }
      >
        <SelectTrigger aria-label={`${label} capability correction`}>
          <SelectValue>{capabilityKnowledgeLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="unknown">Unknown</SelectItem>
          <SelectItem value="supported">Supported</SelectItem>
          <SelectItem value="unsupported">Unsupported</SelectItem>
        </SelectPopup>
      </Select>
    </label>
  );
}

function CapabilityCorrectionEditor({
  model,
  isSaving,
  onSave,
}: {
  readonly model: RoutingModelView;
  readonly isSaving: boolean;
  readonly onSave: (draft: CapabilityCorrectionDraft) => void;
}) {
  const [draft, setDraft] = useState<CapabilityCorrectionDraft>({
    toolCalling: model.toolCalling,
    structuredOutput: model.structuredOutput,
    visionInput: model.visionInput,
    maximumInputTokens: model.maximumInputTokens,
  });
  return (
    <details className="mb-2 rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Manual capability correction</summary>
      <div className="mt-3 grid gap-3">
        <p className="text-xs text-muted-foreground">
          Saved corrections create a new immutable snapshot labelled{" "}
          <strong>manual override</strong>. Unknown remains distinct from unsupported.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CapabilityCorrectionSelect
            label="Tool calling"
            value={draft.toolCalling}
            onChange={(toolCalling) => setDraft((current) => ({ ...current, toolCalling }))}
          />
          <CapabilityCorrectionSelect
            label="Structured output"
            value={draft.structuredOutput}
            onChange={(structuredOutput) =>
              setDraft((current) => ({ ...current, structuredOutput }))
            }
          />
          <CapabilityCorrectionSelect
            label="Vision input"
            value={draft.visionInput}
            onChange={(visionInput) => setDraft((current) => ({ ...current, visionInput }))}
          />
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Maximum input tokens</span>
            <Input
              nativeInput
              type="number"
              min={1}
              step={1_000}
              value={draft.maximumInputTokens ?? ""}
              placeholder="Unknown"
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                setDraft((current) => ({
                  ...current,
                  maximumInputTokens: Number.isFinite(value) ? value : null,
                }));
              }}
            />
          </label>
        </div>
        <div>
          <Button size="sm" disabled={isSaving} onClick={() => onSave(draft)}>
            <SaveIcon /> {isSaving ? "Saving" : "Save manual correction"}
          </Button>
        </div>
      </div>
    </details>
  );
}

export function RoutingRegistryPanel({
  providers,
  models,
  isRefreshing,
  onRefresh,
  onManageCredentials,
  isProviderSaving,
  isModelSaving,
  isCapabilitySaving,
  onProviderEnabledChange,
  onModelEnabledChange,
  onModelDeprecatedChange,
  onModelConcurrencyChange,
  onSaveCapabilityCorrection,
}: {
  readonly providers: ReadonlyArray<RoutingProviderView>;
  readonly models: ReadonlyArray<RoutingModelView>;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onManageCredentials: (providerId: string) => void;
  readonly isProviderSaving: (providerId: string) => boolean;
  readonly isModelSaving: (modelId: string) => boolean;
  readonly isCapabilitySaving: (modelId: string) => boolean;
  readonly onProviderEnabledChange: (providerId: string, enabled: boolean) => void;
  readonly onModelEnabledChange: (modelId: string, enabled: boolean) => void;
  readonly onModelDeprecatedChange: (modelId: string, deprecated: boolean) => void;
  readonly onModelConcurrencyChange: (modelId: string, limit: number | null) => void;
  readonly onSaveCapabilityCorrection: (modelId: string, draft: CapabilityCorrectionDraft) => void;
}) {
  return (
    <>
      <SettingsSection
        id="routing-registry"
        title="Providers"
        headerAction={
          <Button size="sm" variant="outline" disabled={isRefreshing} onClick={onRefresh}>
            <RefreshCwIcon />
            {isRefreshing ? "Refreshing" : "Refresh health"}
          </Button>
        }
      >
        {providers.length === 0 ? (
          <SettingsRow
            title="No routing providers"
            description="Enable a provider in Provider settings, then refresh routing health and model discovery."
          />
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_9rem]"
            >
              <SettingsRow
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {provider.isLocal ? (
                      <LaptopIcon className="size-4" />
                    ) : (
                      <CloudIcon className="size-4" />
                    )}
                    {provider.name}
                    {!provider.enabled ? <Badge variant="outline">Disabled</Badge> : null}
                    {provider.isHealthStale ? <Badge variant="warning">Stale health</Badge> : null}
                  </span>
                }
                description={`${provider.connectionType} · ${provider.isLocal ? "Local" : "Remote"}`}
                status={
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    <span>Account: {provider.accountIdentity ?? "Not reported"}</span>
                    <span>
                      Validated:{" "}
                      {provider.lastValidatedAt
                        ? formatRelativeTimeLabel(provider.lastValidatedAt)
                        : "Never"}
                    </span>
                  </span>
                }
                control={
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge variant={statusBadgeVariant(provider.authenticationState)}>
                      {routingStatusLabel(provider.authenticationState)}
                    </Badge>
                    <Badge variant={statusBadgeVariant(provider.availability)}>
                      {routingStatusLabel(provider.availability)}
                    </Badge>
                    {provider.rateLimitState !== "ok" && provider.rateLimitState !== "clear" ? (
                      <Badge variant="warning">{routingStatusLabel(provider.rateLimitState)}</Badge>
                    ) : null}
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onManageCredentials(provider.id)}
                    >
                      <KeyRoundIcon /> Manage credentials
                    </Button>
                    <label className="inline-flex items-center gap-2 text-xs">
                      Enabled
                      <Switch
                        checked={provider.enabled}
                        disabled={isProviderSaving(provider.id)}
                        onCheckedChange={(checked) =>
                          onProviderEnabledChange(provider.id, Boolean(checked))
                        }
                        aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.name} for routing`}
                      />
                    </label>
                  </div>
                }
              />
            </div>
          ))
        )}
      </SettingsSection>

      <SettingsSection id="routing-models" title="Models and capabilities">
        {models.length === 0 ? (
          <SettingsRow
            title="No discovered models"
            description="Refresh provider health to discover models. Unknown metadata stays unknown until a trusted source reports it."
          />
        ) : (
          models.map((model) => (
            <div
              key={model.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_11rem]"
            >
              <SettingsRow
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {model.name}
                    {model.releaseChannel ? (
                      <Badge variant="outline">{model.releaseChannel}</Badge>
                    ) : null}
                    {model.deprecated ? <Badge variant="warning">Deprecated</Badge> : null}
                    {model.hasManualOverrides ? (
                      <Badge variant="info">Manual override</Badge>
                    ) : null}
                    {model.isDiscoveryStale ? (
                      <Badge variant="warning">Stale discovery</Badge>
                    ) : null}
                  </span>
                }
                description={`${model.providerName} · ${model.enabled ? "Enabled" : "Disabled"} · ${routingStatusLabel(model.availability)}`}
                status={
                  <div className="grid gap-1.5 pt-1">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <CapabilityFact label="Tools" value={model.toolCalling} />
                      <CapabilityFact label="Structured output" value={model.structuredOutput} />
                      <CapabilityFact label="Vision" value={model.visionInput} />
                    </div>
                    <span>
                      Source: {routingStatusLabel(model.capabilitySource)} · Discovered:{" "}
                      {model.lastDiscoveredAt
                        ? formatRelativeTimeLabel(model.lastDiscoveredAt)
                        : "Never"}
                    </span>
                  </div>
                }
                control={
                  <div className="grid justify-items-end gap-2 text-right text-xs">
                    <span>
                      Context: <strong>{routingTokenLimitLabel(model.maximumInputTokens)}</strong>
                    </span>
                    <span className="text-muted-foreground">
                      Reasoning:{" "}
                      {model.reasoningLevels.length > 0
                        ? model.reasoningLevels.join(", ")
                        : "Unknown"}
                    </span>
                    <span className="text-muted-foreground">
                      Modalities:{" "}
                      {model.modalities.length > 0 ? model.modalities.join(", ") : "Unknown"}
                    </span>
                    <div className="flex flex-wrap justify-end gap-3">
                      <label className="inline-flex items-center gap-2">
                        Enabled
                        <Switch
                          checked={model.enabled}
                          disabled={isModelSaving(model.id)}
                          onCheckedChange={(checked) =>
                            onModelEnabledChange(model.id, Boolean(checked))
                          }
                          aria-label={`${model.enabled ? "Disable" : "Enable"} ${model.name} for routing`}
                        />
                      </label>
                      <label className="inline-flex items-center gap-2">
                        Model sessions
                        <Input
                          key={`${model.id}:${model.maximumConcurrentSessions ?? "none"}`}
                          nativeInput
                          className="h-8 w-20"
                          type="number"
                          min={1}
                          defaultValue={model.maximumConcurrentSessions ?? ""}
                          placeholder="None"
                          disabled={isModelSaving(model.id)}
                          aria-label={`${model.name} maximum concurrent sessions`}
                          onBlur={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            onModelConcurrencyChange(
                              model.id,
                              Number.isFinite(value) && value > 0 ? Math.floor(value) : null,
                            );
                          }}
                        />
                      </label>
                      <label className="inline-flex items-center gap-2">
                        Deprecated
                        <Switch
                          checked={model.deprecated}
                          disabled={isModelSaving(model.id)}
                          onCheckedChange={(checked) =>
                            onModelDeprecatedChange(model.id, Boolean(checked))
                          }
                          aria-label={`Mark ${model.name} deprecated`}
                        />
                      </label>
                    </div>
                  </div>
                }
              >
                <CapabilityCorrectionEditor
                  key={`${model.id}:${model.capabilitySource}:${model.maximumInputTokens}:${model.toolCalling}:${model.structuredOutput}:${model.visionInput}`}
                  model={model}
                  isSaving={isCapabilitySaving(model.id)}
                  onSave={(draft) => onSaveCapabilityCorrection(model.id, draft)}
                />
              </SettingsRow>
            </div>
          ))
        )}
      </SettingsSection>
    </>
  );
}
