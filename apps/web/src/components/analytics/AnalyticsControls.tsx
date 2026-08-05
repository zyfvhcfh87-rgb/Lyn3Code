import {
  AnalyticsAnnotationId,
  BudgetOverrideId,
  BudgetPolicyId,
  ExchangeRateSnapshotId,
  ModelProfileId,
  PricingSnapshotId,
  ProviderProfileId,
  SubscriptionAttributionRuleId,
  type AnalyticsAnnotation,
  type AnalyticsFilter,
  type AnalyticsConfidence,
  type AnalyticsScopeType,
  type AnalyticsSettings,
  type BudgetAction,
  type BudgetEvent,
  type BudgetPolicy,
  type ExplicitHumanDisposition,
  type MissionTaskId,
  type PricingBillingUnit,
  type PricingSource,
  type SubscriptionAllocationMode,
  type SubscriptionFixedRateUnit,
  type SubscriptionAttributionMode,
} from "@t3tools/contracts";
import { useState } from "react";
import { randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import type { AnalyticsWorkspaceActions } from "./analyticsActions";
import {
  normalizeCurrency,
  parseOptionalNonNegativeDecimal,
  parseOptionalNonNegativeInteger,
  parseOptionalPositiveInteger,
  parseRequiredNonNegativeDecimal,
  parseRequiredPositiveInteger,
  requireTrimmed,
  toDateTimeLocalValue,
  toOptionalIsoDateTime,
  toRequiredIsoDateTime,
} from "./analyticsControlLogic";

const SELECT_CLASSNAME =
  "h-8.5 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24 disabled:opacity-64 sm:h-7.5";

const SCOPE_TYPES: ReadonlyArray<AnalyticsScopeType> = [
  "user",
  "project",
  "mission",
  "task",
  "provider",
  "model",
  "agent_role",
  "agent_run",
];

const BUDGET_ACTIONS: ReadonlyArray<BudgetAction> = [
  "notify",
  "require_approval",
  "pause_new_runs",
  "block_new_runs",
  "informational",
];

const PRICING_SOURCES: ReadonlyArray<PricingSource> = [
  "provider_reported",
  "official_catalog",
  "user_configured",
  "subscription_plan",
  "unknown",
];

const parsePricingSourcePriority = (value: string): ReadonlyArray<PricingSource> => {
  const sources = value
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source !== "");
  if (sources.length === 0) throw new Error("Configure at least one pricing source.");
  if (sources.length > PRICING_SOURCES.length) throw new Error("Too many pricing sources.");
  if (new Set(sources).size !== sources.length) {
    throw new Error("Pricing source priority cannot contain duplicates.");
  }
  const invalid = sources.find(
    (source): source is string => !PRICING_SOURCES.includes(source as PricingSource),
  );
  if (invalid) throw new Error(`Unknown pricing source: ${invalid}.`);
  return sources as ReadonlyArray<PricingSource>;
};

export interface AnalyticsPricingProfiles {
  readonly providers: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly providerProfileId: string;
    readonly label: string;
  }>;
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function FormError({ message }: { readonly message: string | null }) {
  return message ? (
    <p
      className="rounded-lg border border-destructive/36 bg-destructive/4 px-3 py-2 text-sm text-destructive-foreground"
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

function scopeOptions() {
  return SCOPE_TYPES.map((scopeType) => (
    <option key={scopeType} value={scopeType}>
      {scopeType.replaceAll("_", " ")}
    </option>
  ));
}

export function AnalyticsSettingsControls({
  settings,
  actions,
}: {
  readonly settings: AnalyticsSettings;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailRetentionDays, setDetailRetentionDays] = useState(
    String(settings.detailRetentionDays),
  );
  const [aggregateRetentionDays, setAggregateRetentionDays] = useState(
    settings.aggregateRetentionDays === null ? "" : String(settings.aggregateRetentionDays),
  );
  const [exportRetentionDays, setExportRetentionDays] = useState(
    String(settings.exportRetentionDays),
  );
  const [currency, setCurrency] = useState(settings.defaultReportingCurrency);
  const [pricingSourcePriority, setPricingSourcePriority] = useState(
    settings.pricingSourcePriority.join(", "),
  );
  const [subscriptionAttributionMode, setSubscriptionAttributionMode] =
    useState<SubscriptionAttributionMode>(settings.subscriptionAttributionMode);
  const [localComputeHourlyRate, setLocalComputeHourlyRate] = useState(
    settings.localComputeHourlyRate ?? "",
  );
  const [observationDays, setObservationDays] = useState(
    String(settings.outcomeObservationWindowDays),
  );
  const [minimumSample, setMinimumSample] = useState(String(settings.minimumComparisonSampleSize));
  const [forecastMethod, setForecastMethod] = useState(settings.forecastMethod);
  const [detailLevel, setDetailLevel] = useState(settings.detailLevel);

  const updateEnabled = async (enabled: boolean) => {
    setPending(true);
    await actions.updateSettings({
      settings: { ...settings, enabled, updatedAt: new Date().toISOString() },
    });
    setPending(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const updated: AnalyticsSettings = {
        ...settings,
        detailRetentionDays: parseRequiredPositiveInteger(detailRetentionDays, "Detail retention"),
        aggregateRetentionDays: parseOptionalPositiveInteger(
          aggregateRetentionDays,
          "Aggregate retention",
        ),
        exportRetentionDays: parseRequiredPositiveInteger(exportRetentionDays, "Export retention"),
        pricingSourcePriority: parsePricingSourcePriority(pricingSourcePriority),
        defaultReportingCurrency: normalizeCurrency(currency),
        subscriptionAttributionMode,
        localComputeHourlyRate: parseOptionalNonNegativeDecimal(
          localComputeHourlyRate,
          "Local compute hourly rate",
        ),
        outcomeObservationWindowDays: parseRequiredPositiveInteger(
          observationDays,
          "Outcome observation window",
        ),
        minimumComparisonSampleSize: parseRequiredPositiveInteger(
          minimumSample,
          "Minimum comparison sample",
        ),
        forecastMethod,
        detailLevel,
        updatedAt: new Date().toISOString(),
      };
      setPending(true);
      const succeeded = await actions.updateSettings({ settings: updated });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The analytics settings are invalid.");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit settings</DialogTrigger>
        <DialogPopup className="max-w-2xl">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Analytics settings</DialogTitle>
              <DialogDescription>
                Change collection, retention, pricing, attribution, comparison, and forecast
                behavior. Unknown values remain unknown rather than becoming zero.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="grid gap-4 sm:grid-cols-2">
              <Field label="Detail retention (days)">
                <Input
                  nativeInput
                  type="number"
                  min="1"
                  required
                  value={detailRetentionDays}
                  onChange={(event) => setDetailRetentionDays(event.target.value)}
                />
              </Field>
              <Field label="Aggregate retention (days)" hint="Leave blank for no automatic expiry.">
                <Input
                  nativeInput
                  type="number"
                  min="1"
                  value={aggregateRetentionDays}
                  onChange={(event) => setAggregateRetentionDays(event.target.value)}
                />
              </Field>
              <Field label="Export retention (days)">
                <Input
                  nativeInput
                  type="number"
                  min="1"
                  required
                  value={exportRetentionDays}
                  onChange={(event) => setExportRetentionDays(event.target.value)}
                />
              </Field>
              <Field label="Reporting currency">
                <Input
                  nativeInput
                  maxLength={3}
                  required
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                />
              </Field>
              <Field
                label="Pricing source priority"
                hint="Comma-separated, highest priority first."
              >
                <Input
                  nativeInput
                  required
                  value={pricingSourcePriority}
                  onChange={(event) => setPricingSourcePriority(event.target.value)}
                />
              </Field>
              <Field
                label="Subscription attribution"
                hint="None is safest. Flat-plan modes require period-wide plan data before costs can be allocated."
              >
                <select
                  className={SELECT_CLASSNAME}
                  value={subscriptionAttributionMode}
                  onChange={(event) =>
                    setSubscriptionAttributionMode(
                      event.target.value as SubscriptionAttributionMode,
                    )
                  }
                >
                  <option value="none">no monetary attribution</option>
                  <option value="flat_monthly_by_runs">flat monthly by runs</option>
                  <option value="flat_monthly_by_tokens">flat monthly by tokens</option>
                  <option value="flat_monthly_by_active_time">flat monthly by active time</option>
                  <option value="manual_fixed_internal_rate">manual fixed internal rate</option>
                </select>
              </Field>
              <Field
                label="Local compute hourly rate"
                hint={`Optional exact decimal in ${currency.toUpperCase() || "the reporting currency"}.`}
              >
                <Input
                  nativeInput
                  inputMode="decimal"
                  value={localComputeHourlyRate}
                  onChange={(event) => setLocalComputeHourlyRate(event.target.value)}
                />
              </Field>
              <Field label="Outcome observation window (days)">
                <Input
                  nativeInput
                  type="number"
                  min="1"
                  required
                  value={observationDays}
                  onChange={(event) => setObservationDays(event.target.value)}
                />
              </Field>
              <Field label="Minimum comparison sample">
                <Input
                  nativeInput
                  type="number"
                  min="1"
                  required
                  value={minimumSample}
                  onChange={(event) => setMinimumSample(event.target.value)}
                />
              </Field>
              <Field label="Forecast method">
                <select
                  className={SELECT_CLASSNAME}
                  value={forecastMethod}
                  onChange={(event) =>
                    setForecastMethod(event.target.value as AnalyticsSettings["forecastMethod"])
                  }
                >
                  <option value="current_period_run_rate">current period run rate</option>
                  <option value="trailing_average">trailing average</option>
                  <option value="scheduled_mission_estimate">scheduled mission estimate</option>
                </select>
              </Field>
              <Field label="Collection detail">
                <select
                  className={SELECT_CLASSNAME}
                  value={detailLevel}
                  onChange={(event) =>
                    setDetailLevel(event.target.value as AnalyticsSettings["detailLevel"])
                  }
                >
                  <option value="minimal">minimal</option>
                  <option value="standard">standard</option>
                  <option value="detailed">detailed</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <FormError message={error} />
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : "Save settings"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {settings.enabled ? (
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button size="sm" variant="destructive-outline" disabled={pending} />}
          >
            Disable collection
          </AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Disable analytics collection?</AlertDialogTitle>
              <AlertDialogDescription>
                New analytics detail will stop being collected. Existing retained records remain
                visible, and disabled never means zero usage or zero cost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <AlertDialogClose
                render={<Button variant="destructive" onClick={() => void updateEnabled(false)} />}
              >
                Disable collection
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : (
        <Button size="sm" disabled={pending} onClick={() => void updateEnabled(true)}>
          {pending ? "Enabling..." : "Enable collection"}
        </Button>
      )}
    </div>
  );
}

interface PricingRateDraft {
  inputTokenRate: string;
  outputTokenRate: string;
  reasoningTokenRate: string;
  cachedInputRate: string;
  cacheWriteRate: string;
  cacheReadRate: string;
  requestRate: string;
}

const EMPTY_PRICING_RATES: PricingRateDraft = {
  inputTokenRate: "",
  outputTokenRate: "",
  reasoningTokenRate: "",
  cachedInputRate: "",
  cacheWriteRate: "",
  cacheReadRate: "",
  requestRate: "",
};

export function PricingSnapshotDialog({
  profiles,
  actions,
}: {
  readonly profiles: AnalyticsPricingProfiles;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState(profiles.providers[0]?.id ?? "");
  const availableModels = profiles.models.filter((model) => model.providerProfileId === providerId);
  const [modelId, setModelId] = useState(availableModels[0]?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [pricingSource, setPricingSource] = useState<PricingSource>("user_configured");
  const [billingUnit, setBillingUnit] = useState<PricingBillingUnit>("per_million_tokens");
  const [confidence, setConfidence] = useState<AnalyticsConfidence>("medium");
  const [pricingVersion, setPricingVersion] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    toDateTimeLocalValue(new Date().toISOString()),
  );
  const [effectiveTo, setEffectiveTo] = useState("");
  const [rates, setRates] = useState<PricingRateDraft>(EMPTY_PRICING_RATES);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patchRate = (key: keyof PricingRateDraft, value: string) =>
    setRates((current) => ({ ...current, [key]: value }));

  const changeProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId);
    setModelId(
      profiles.models.find((model) => model.providerProfileId === nextProviderId)?.id ?? "",
    );
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const selectedModel = profiles.models.find(
        (model) => model.id === modelId && model.providerProfileId === providerId,
      );
      if (!profiles.providers.some((provider) => provider.id === providerId)) {
        throw new Error("Select a provider profile.");
      }
      if (!selectedModel) throw new Error("Select a model that belongs to the provider.");
      const parsedRates = {
        inputTokenRate: parseOptionalNonNegativeDecimal(rates.inputTokenRate, "Input rate"),
        outputTokenRate: parseOptionalNonNegativeDecimal(rates.outputTokenRate, "Output rate"),
        reasoningTokenRate: parseOptionalNonNegativeDecimal(
          rates.reasoningTokenRate,
          "Reasoning rate",
        ),
        cachedInputRate: parseOptionalNonNegativeDecimal(
          rates.cachedInputRate,
          "Cached input rate",
        ),
        cacheWriteRate: parseOptionalNonNegativeDecimal(rates.cacheWriteRate, "Cache write rate"),
        cacheReadRate: parseOptionalNonNegativeDecimal(rates.cacheReadRate, "Cache read rate"),
        requestRate: parseOptionalNonNegativeDecimal(rates.requestRate, "Request rate"),
      };
      if (Object.values(parsedRates).every((rate) => rate === null)) {
        throw new Error("Configure at least one token, cache, or request rate.");
      }
      const from = toRequiredIsoDateTime(effectiveFrom, "Effective from");
      const to = toOptionalIsoDateTime(effectiveTo, "Effective to");
      if (to !== null && from >= to) throw new Error("Effective to must be after effective from.");
      const now = new Date().toISOString();
      setPending(true);
      const succeeded = await actions.savePricingSnapshot({
        snapshot: {
          id: PricingSnapshotId.make(`pricing:${randomUUID()}`),
          providerProfileId: ProviderProfileId.make(providerId),
          modelProfileId: ModelProfileId.make(modelId),
          currency: normalizeCurrency(currency),
          pricingSource,
          pricingVersion:
            pricingVersion.trim() === ""
              ? null
              : requireTrimmed(pricingVersion, "Pricing version", 256),
          effectiveFrom: from,
          effectiveTo: to,
          ...parsedRates,
          toolRateMetadata: {},
          billingUnit,
          confidence,
          metadata: {},
          createdAt: now,
        },
      });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The pricing snapshot is invalid.");
    }
  };

  const noProfiles = profiles.providers.length === 0 || profiles.models.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={noProfiles}
            title={noProfiles ? "No provider and model profiles are available" : undefined}
          />
        }
      >
        Add price snapshot
      </DialogTrigger>
      <DialogPopup className="max-w-3xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add pricing snapshot</DialogTitle>
            <DialogDescription>
              Record an effective-dated price snapshot for one provider and model. Rates retain
              exact decimal text and never rewrite provider-reported cost. Subscription-plan costs
              are accounting allocations, not provider invoices.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider profile">
              <select
                className={SELECT_CLASSNAME}
                required
                value={providerId}
                onChange={(event) => changeProvider(event.target.value)}
              >
                {profiles.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model profile">
              <select
                className={SELECT_CLASSNAME}
                required
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Currency">
              <Input
                nativeInput
                required
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Pricing source">
              <select
                className={SELECT_CLASSNAME}
                value={pricingSource}
                onChange={(event) => setPricingSource(event.target.value as PricingSource)}
              >
                <option value="user_configured">user configured</option>
                <option value="official_catalog">official catalogue</option>
                <option value="subscription_plan">subscription plan allocation</option>
              </select>
            </Field>
            <Field label="Billing unit">
              <select
                className={SELECT_CLASSNAME}
                value={billingUnit}
                onChange={(event) => setBillingUnit(event.target.value as PricingBillingUnit)}
              >
                {[
                  "per_million_tokens",
                  "per_thousand_tokens",
                  "per_token",
                  "per_request",
                  "per_hour",
                  "flat_period",
                  "custom",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective from">
              <Input
                nativeInput
                type="datetime-local"
                required
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </Field>
            <Field label="Effective to" hint="Optional; leave blank for an open-ended snapshot.">
              <Input
                nativeInput
                type="datetime-local"
                value={effectiveTo}
                onChange={(event) => setEffectiveTo(event.target.value)}
              />
            </Field>
            <Field label="Pricing version" hint="Optional catalogue or plan version.">
              <Input
                nativeInput
                maxLength={256}
                value={pricingVersion}
                onChange={(event) => setPricingVersion(event.target.value)}
              />
            </Field>
            <Field label="Confidence">
              <select
                className={SELECT_CLASSNAME}
                value={confidence}
                onChange={(event) => setConfidence(event.target.value as AnalyticsConfidence)}
              >
                {["confirmed", "high", "medium", "low", "unknown"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            {(
              [
                ["inputTokenRate", "Input token rate"],
                ["outputTokenRate", "Output token rate"],
                ["reasoningTokenRate", "Reasoning token rate"],
                ["cachedInputRate", "Cached input rate"],
                ["cacheWriteRate", "Cache write rate"],
                ["cacheReadRate", "Cache read rate"],
                ["requestRate", "Request rate"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label} hint="Optional exact decimal; no separators.">
                <Input
                  nativeInput
                  inputMode="decimal"
                  value={rates[key]}
                  onChange={(event) => patchRate(key, event.target.value)}
                />
              </Field>
            ))}
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending || noProfiles}>
              {pending ? "Saving..." : "Save price snapshot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

const SUBSCRIPTION_MODES: ReadonlyArray<SubscriptionAllocationMode> = [
  "flat_monthly_by_runs",
  "flat_monthly_by_tokens",
  "flat_monthly_by_active_time",
  "manual_fixed_internal_rate",
];

export function SubscriptionAttributionRuleDialog({
  profiles,
  settings,
  actions,
}: {
  readonly profiles: AnalyticsPricingProfiles;
  readonly settings: AnalyticsSettings;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState(profiles.providers[0]?.id ?? "");
  const [modelId, setModelId] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<SubscriptionAllocationMode>(
    settings.subscriptionAttributionMode === "none"
      ? "flat_monthly_by_runs"
      : settings.subscriptionAttributionMode,
  );
  const [currency, setCurrency] = useState(settings.defaultReportingCurrency);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amount, setAmount] = useState("");
  const [fixedRateUnit, setFixedRateUnit] = useState<SubscriptionFixedRateUnit>("per_run");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = profiles.models.filter((model) => model.providerProfileId === providerId);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      if (!profiles.providers.some(({ id }) => id === providerId)) {
        throw new Error("Select a provider profile.");
      }
      if (modelId !== "" && !models.some(({ id }) => id === modelId)) {
        throw new Error("Select a model that belongs to the provider.");
      }
      const start = toRequiredIsoDateTime(periodStart, "Period start");
      const end = toRequiredIsoDateTime(periodEnd, "Period end");
      if (start >= end) throw new Error("Period end must be after period start.");
      const parsedAmount = parseRequiredNonNegativeDecimal(amount, "Accounting amount or rate");
      const now = new Date().toISOString();
      setPending(true);
      const succeeded = await actions.saveSubscriptionAttributionRule({
        rule: {
          id: SubscriptionAttributionRuleId.make(`subscription-rule:${randomUUID()}`),
          providerProfileId: ProviderProfileId.make(providerId),
          modelProfileId: modelId === "" ? null : ModelProfileId.make(modelId),
          label: requireTrimmed(label, "Rule label", 256),
          mode,
          periodStart: start,
          periodEnd: end,
          currency: normalizeCurrency(currency),
          monthlyAmount: mode === "manual_fixed_internal_rate" ? null : parsedAmount,
          fixedInternalRate: mode === "manual_fixed_internal_rate" ? parsedAmount : null,
          fixedRateUnit: mode === "manual_fixed_internal_rate" ? fixedRateUnit : null,
          createdAt: now,
        },
      });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The subscription rule is invalid.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Add subscription rule
      </DialogTrigger>
      <DialogPopup className="max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add subscription accounting rule</DialogTitle>
            <DialogDescription>
              Allocate an explicit plan amount or internal rate. Flat-plan allocation waits until
              the entire period is closed and is always labelled as an accounting estimate.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4 sm:grid-cols-2">
            <Field label="Rule label">
              <Input
                nativeInput
                required
                maxLength={256}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Field label="Provider">
              <select
                className={SELECT_CLASSNAME}
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setModelId("");
                }}
              >
                {profiles.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model" hint="Leave as all models for a provider-wide plan.">
              <select
                className={SELECT_CLASSNAME}
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="">All provider models</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Allocation method">
              <select
                className={SELECT_CLASSNAME}
                value={mode}
                onChange={(event) => setMode(event.target.value as SubscriptionAllocationMode)}
              >
                {SUBSCRIPTION_MODES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Period start">
              <Input
                nativeInput
                required
                type="datetime-local"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </Field>
            <Field label="Period end">
              <Input
                nativeInput
                required
                type="datetime-local"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </Field>
            <Field label={mode === "manual_fixed_internal_rate" ? "Internal rate" : "Plan amount"}>
              <Input
                nativeInput
                required
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Currency">
              <Input
                nativeInput
                required
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </Field>
            {mode === "manual_fixed_internal_rate" ? (
              <Field label="Rate unit">
                <select
                  className={SELECT_CLASSNAME}
                  value={fixedRateUnit}
                  onChange={(event) =>
                    setFixedRateUnit(event.target.value as SubscriptionFixedRateUnit)
                  }
                >
                  <option value="per_run">per run</option>
                  <option value="per_million_tokens">per million tokens</option>
                  <option value="per_active_hour">per active hour</option>
                </select>
              </Field>
            ) : null}
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save accounting rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function ExchangeRateSnapshotDialog({
  reportingCurrency,
  actions,
}: {
  readonly reportingCurrency: string;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState(reportingCurrency);
  const [rate, setRate] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(() =>
    toDateTimeLocalValue(new Date().toISOString()),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const base = normalizeCurrency(baseCurrency);
      const quote = normalizeCurrency(quoteCurrency);
      if (base === quote) throw new Error("Base and reporting currencies must differ.");
      const parsedRate = parseRequiredNonNegativeDecimal(rate, "Exchange rate");
      if (/^0(?:\.0+)?$/.test(parsedRate))
        throw new Error("Exchange rate must be greater than zero.");
      const now = new Date().toISOString();
      setPending(true);
      const succeeded = await actions.saveExchangeRateSnapshot({
        snapshot: {
          id: ExchangeRateSnapshotId.make(`exchange-rate:${randomUUID()}`),
          baseCurrency: base,
          quoteCurrency: quote,
          rate: parsedRate,
          source: "user_configured",
          effectiveAt: toRequiredIsoDateTime(effectiveAt, "Effective at"),
          createdAt: now,
        },
      });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The exchange rate is invalid.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Add exchange rate
      </DialogTrigger>
      <DialogPopup>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add manual exchange-rate snapshot</DialogTitle>
            <DialogDescription>
              Conversions are labelled and effective-dated. Original currency totals are never
              rewritten.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4 sm:grid-cols-2">
            <Field label="Base currency">
              <Input
                nativeInput
                required
                maxLength={3}
                value={baseCurrency}
                onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Reporting currency">
              <Input
                nativeInput
                required
                maxLength={3}
                value={quoteCurrency}
                onChange={(event) => setQuoteCurrency(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Rate" hint="One unit of base currency in reporting currency.">
              <Input
                nativeInput
                required
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
            </Field>
            <Field label="Effective at">
              <Input
                nativeInput
                required
                type="datetime-local"
                value={effectiveAt}
                onChange={(event) => setEffectiveAt(event.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save exchange rate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

interface BudgetDraft {
  name: string;
  scopeType: AnalyticsScopeType;
  scopeId: string;
  currency: string;
  periodType: BudgetPolicy["periodType"];
  periodStart: string;
  periodEnd: string;
  softLimit: string;
  hardLimit: string;
  tokenLimit: string;
  requestLimit: string;
  actionOnSoftLimit: BudgetAction;
  actionOnHardLimit: BudgetAction;
  conservativeWhenIncomplete: boolean;
  enabled: boolean;
}

function budgetDraft(policy: BudgetPolicy | null): BudgetDraft {
  return policy === null
    ? {
        name: "",
        scopeType: "user",
        scopeId: "",
        currency: "USD",
        periodType: "monthly",
        periodStart: "",
        periodEnd: "",
        softLimit: "",
        hardLimit: "",
        tokenLimit: "",
        requestLimit: "",
        actionOnSoftLimit: "notify",
        actionOnHardLimit: "require_approval",
        conservativeWhenIncomplete: true,
        enabled: true,
      }
    : {
        name: policy.name,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        currency: policy.currency,
        periodType: policy.periodType,
        periodStart: toDateTimeLocalValue(policy.periodStart),
        periodEnd: toDateTimeLocalValue(policy.periodEnd),
        softLimit: policy.softLimit ?? "",
        hardLimit: policy.hardLimit ?? "",
        tokenLimit: policy.tokenLimit === null ? "" : String(policy.tokenLimit),
        requestLimit: policy.requestLimit === null ? "" : String(policy.requestLimit),
        actionOnSoftLimit: policy.actionOnSoftLimit,
        actionOnHardLimit: policy.actionOnHardLimit,
        conservativeWhenIncomplete: policy.conservativeWhenIncomplete,
        enabled: policy.enabled,
      };
}

export function BudgetPolicyDialog({
  policy,
  actions,
}: {
  readonly policy: BudgetPolicy | null;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => budgetDraft(policy));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patchDraft = <K extends keyof BudgetDraft>(key: K, value: BudgetDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const now = new Date().toISOString();
      const periodStart = toOptionalIsoDateTime(draft.periodStart, "Period start");
      const periodEnd = toOptionalIsoDateTime(draft.periodEnd, "Period end");
      if ((periodStart === null) !== (periodEnd === null)) {
        throw new Error("Provide both period dates or leave both blank.");
      }
      if (periodStart !== null && periodEnd !== null && periodStart >= periodEnd) {
        throw new Error("Period end must be after period start.");
      }
      const softLimit = parseOptionalNonNegativeDecimal(draft.softLimit, "Soft limit");
      const hardLimit = parseOptionalNonNegativeDecimal(draft.hardLimit, "Hard limit");
      const tokenLimit = parseOptionalNonNegativeInteger(draft.tokenLimit, "Token limit");
      const requestLimit = parseOptionalNonNegativeInteger(draft.requestLimit, "Request limit");
      if (
        softLimit === null &&
        hardLimit === null &&
        tokenLimit === null &&
        requestLimit === null
      ) {
        throw new Error("Configure at least one money, token, or request limit.");
      }
      const nextPolicy: BudgetPolicy = {
        id: policy?.id ?? BudgetPolicyId.make(`budget:${randomUUID()}`),
        scopeType: draft.scopeType,
        scopeId: requireTrimmed(draft.scopeId, "Scope ID", 512),
        name: requireTrimmed(draft.name, "Name", 256),
        currency: normalizeCurrency(draft.currency),
        periodType: draft.periodType,
        periodStart,
        periodEnd,
        softLimit,
        hardLimit,
        tokenLimit,
        requestLimit,
        actionOnSoftLimit: draft.actionOnSoftLimit,
        actionOnHardLimit: draft.actionOnHardLimit,
        conservativeWhenIncomplete: draft.conservativeWhenIncomplete,
        enabled: draft.enabled,
        createdAt: policy?.createdAt ?? now,
        updatedAt: now,
      };
      setPending(true);
      const succeeded = await actions.saveBudget({ policy: nextPolicy });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The budget policy is invalid.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" variant={policy === null ? "default" : "outline"} />}
      >
        {policy === null ? "New budget" : "Edit"}
      </DialogTrigger>
      <DialogPopup className="max-w-3xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {policy === null ? "Create budget policy" : `Edit ${policy.name}`}
            </DialogTitle>
            <DialogDescription>
              Limits are evaluated in their own unit and currency. Blank values remain unconfigured.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                nativeInput
                required
                maxLength={256}
                value={draft.name}
                onChange={(event) => patchDraft("name", event.target.value)}
              />
            </Field>
            <Field label="Currency">
              <Input
                nativeInput
                required
                maxLength={3}
                value={draft.currency}
                onChange={(event) => patchDraft("currency", event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Scope type">
              <select
                className={SELECT_CLASSNAME}
                value={draft.scopeType}
                onChange={(event) =>
                  patchDraft("scopeType", event.target.value as AnalyticsScopeType)
                }
              >
                {scopeOptions()}
              </select>
            </Field>
            <Field label="Scope ID">
              <Input
                nativeInput
                required
                maxLength={512}
                value={draft.scopeId}
                onChange={(event) => patchDraft("scopeId", event.target.value)}
              />
            </Field>
            <Field label="Period">
              <select
                className={SELECT_CLASSNAME}
                value={draft.periodType}
                onChange={(event) =>
                  patchDraft("periodType", event.target.value as BudgetPolicy["periodType"])
                }
              >
                {[
                  "per_task",
                  "per_mission",
                  "daily",
                  "weekly",
                  "monthly",
                  "billing_cycle",
                  "custom",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <div />
            <Field label="Period start" hint="Optional; provide both dates.">
              <Input
                nativeInput
                type="datetime-local"
                value={draft.periodStart}
                onChange={(event) => patchDraft("periodStart", event.target.value)}
              />
            </Field>
            <Field label="Period end">
              <Input
                nativeInput
                type="datetime-local"
                value={draft.periodEnd}
                onChange={(event) => patchDraft("periodEnd", event.target.value)}
              />
            </Field>
            <Field label="Soft money limit" hint="Exact decimal; no separators.">
              <Input
                nativeInput
                inputMode="decimal"
                value={draft.softLimit}
                onChange={(event) => patchDraft("softLimit", event.target.value)}
              />
            </Field>
            <Field label="Hard money limit">
              <Input
                nativeInput
                inputMode="decimal"
                value={draft.hardLimit}
                onChange={(event) => patchDraft("hardLimit", event.target.value)}
              />
            </Field>
            <Field label="Token limit">
              <Input
                nativeInput
                type="number"
                min="0"
                value={draft.tokenLimit}
                onChange={(event) => patchDraft("tokenLimit", event.target.value)}
              />
            </Field>
            <Field label="Request limit">
              <Input
                nativeInput
                type="number"
                min="0"
                value={draft.requestLimit}
                onChange={(event) => patchDraft("requestLimit", event.target.value)}
              />
            </Field>
            <Field label="Soft-limit action">
              <select
                className={SELECT_CLASSNAME}
                value={draft.actionOnSoftLimit}
                onChange={(event) =>
                  patchDraft("actionOnSoftLimit", event.target.value as BudgetAction)
                }
              >
                {BUDGET_ACTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hard-limit action">
              <select
                className={SELECT_CLASSNAME}
                value={draft.actionOnHardLimit}
                onChange={(event) =>
                  patchDraft("actionOnHardLimit", event.target.value as BudgetAction)
                }
              >
                {BUDGET_ACTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.conservativeWhenIncomplete}
                onChange={(event) => patchDraft("conservativeWhenIncomplete", event.target.checked)}
              />{" "}
              Treat incomplete data conservatively
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => patchDraft("enabled", event.target.checked)}
              />{" "}
              Policy enabled
            </label>
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function BudgetEventControls({
  event,
  actions,
}: {
  readonly event: BudgetEvent;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [fallbackAllowed, setFallbackAllowed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acknowledge = async () => {
    setPending(true);
    await actions.acknowledgeBudgetEvent({
      budgetEventId: event.id,
      acknowledgedAt: new Date().toISOString(),
    });
    setPending(false);
  };

  const submitOverride = async (submitEvent: React.FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setError(null);
    try {
      const now = new Date().toISOString();
      const expiry = toRequiredIsoDateTime(expiresAt, "Expiry");
      if (expiry <= now) throw new Error("Expiry must be in the future.");
      setPending(true);
      const succeeded = await actions.createBudgetOverride({
        override: {
          id: BudgetOverrideId.make(`budget-override:${randomUUID()}`),
          budgetPolicyId: event.budgetPolicyId,
          scopeType: event.scopeType,
          scopeId: event.scopeId,
          currentValue: parseRequiredNonNegativeDecimal(event.currentValue, "Current value"),
          thresholdValue: parseRequiredNonNegativeDecimal(event.thresholdValue, "Threshold"),
          reason: requireTrimmed(reason, "Reason", 2_000),
          actor: "user",
          expiresAt: expiry,
          fallbackAllowed,
          createdAt: now,
          expiredAt: null,
        },
      });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The override is invalid.");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="xs"
        variant="outline"
        disabled={pending || event.acknowledgedAt !== null}
        onClick={() => void acknowledge()}
      >
        {event.acknowledgedAt === null ? "Acknowledge" : "Acknowledged"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="xs" variant="outline" disabled={pending} />}>
          Temporary override
        </DialogTrigger>
        <DialogPopup>
          <form onSubmit={submitOverride}>
            <DialogHeader>
              <DialogTitle>Create temporary budget override</DialogTitle>
              <DialogDescription>
                This override is explicit, expires automatically, and records whether fallback is
                allowed.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="grid gap-4">
              <Field label="Reason">
                <Textarea
                  required
                  maxLength={2_000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Field label="Expires at">
                <Input
                  nativeInput
                  type="datetime-local"
                  required
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fallbackAllowed}
                  onChange={(event) => setFallbackAllowed(event.target.checked)}
                />
                <span>
                  <span className="font-medium">Allow fallback</span>
                  <span className="block text-xs text-muted-foreground">
                    Permit the runtime to use its configured fallback while this override is active.
                  </span>
                </span>
              </label>
              <FormError message={error} />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create override"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

export function AnnotationDialog({
  actions,
  annotation = null,
}: {
  readonly actions: AnalyticsWorkspaceActions;
  readonly annotation?: AnalyticsAnnotation | null;
}) {
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<AnalyticsScopeType>(
    annotation?.scopeType ?? "project",
  );
  const [scopeId, setScopeId] = useState(annotation?.scopeId ?? "");
  const [timestamp, setTimestamp] = useState(toDateTimeLocalValue(annotation?.timestamp ?? null));
  const [title, setTitle] = useState(annotation?.title ?? "");
  const [content, setContent] = useState(annotation?.content ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const now = new Date().toISOString();
      setPending(true);
      const succeeded = await actions.saveAnnotation({
        annotation: {
          id: annotation?.id ?? AnalyticsAnnotationId.make(`analytics-annotation:${randomUUID()}`),
          scopeType,
          scopeId: requireTrimmed(scopeId, "Scope ID", 512),
          timestamp: toOptionalIsoDateTime(timestamp, "Annotation timestamp"),
          title: requireTrimmed(title, "Title", 256),
          content: requireTrimmed(content, "Content", 8_000),
          createdBy: annotation?.createdBy ?? "user",
          createdAt: annotation?.createdAt ?? now,
          updatedAt: now,
        },
      });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The annotation is invalid.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {annotation === null ? "Add annotation" : "Edit"}
      </DialogTrigger>
      <DialogPopup>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {annotation === null ? "Add analytics annotation" : "Edit analytics annotation"}
            </DialogTitle>
            <DialogDescription>
              Record context without changing the underlying measurements.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field label="Scope type">
              <select
                className={SELECT_CLASSNAME}
                value={scopeType}
                onChange={(event) => setScopeType(event.target.value as AnalyticsScopeType)}
              >
                {scopeOptions()}
              </select>
            </Field>
            <Field label="Scope ID">
              <Input
                nativeInput
                required
                maxLength={512}
                value={scopeId}
                onChange={(event) => setScopeId(event.target.value)}
              />
            </Field>
            <Field label="Timestamp" hint="Optional event time; creation time is always recorded.">
              <Input
                nativeInput
                type="datetime-local"
                value={timestamp}
                onChange={(event) => setTimestamp(event.target.value)}
              />
            </Field>
            <Field label="Title">
              <Input
                nativeInput
                required
                maxLength={256}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field label="Context">
              <Textarea
                required
                maxLength={8_000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </Field>
            <FormError message={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save annotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Mount this from a task or run-detail surface that owns a verified task/source context. */
export function HumanDispositionDialog({
  taskId,
  sourceFingerprint,
  actions,
}: {
  readonly taskId: MissionTaskId;
  readonly sourceFingerprint: string;
  readonly actions: AnalyticsWorkspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<ExplicitHumanDisposition>("accepted");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setPending(true);
      const succeeded = await actions.recordHumanDisposition({
        taskId,
        disposition,
        actor: "user",
        markedAt: new Date().toISOString(),
        reason: reason.trim() === "" ? null : requireTrimmed(reason, "Reason", 2_000),
        sourceFingerprint: requireTrimmed(sourceFingerprint, "Source fingerprint", 512),
      });
      setPending(false);
      if (succeeded) setOpen(false);
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "The human disposition is invalid.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Record disposition
      </DialogTrigger>
      <DialogPopup>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Record human disposition</DialogTitle>
            <DialogDescription>
              Record an explicit review outcome against this task and its current source
              fingerprint.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field label="Disposition">
              <select
                className={SELECT_CLASSNAME}
                value={disposition}
                onChange={(event) => setDisposition(event.target.value as ExplicitHumanDisposition)}
              >
                <option value="accepted">accepted</option>
                <option value="accepted_with_edits">accepted with edits</option>
                <option value="rejected">rejected</option>
                <option value="abandoned">abandoned</option>
              </select>
            </Field>
            <Field label="Reason" hint="Optional review context.">
              <Textarea
                maxLength={2_000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <FormError message={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Recording..." : "Record disposition"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function AnalyticsOperationControls({
  actions,
  filter,
}: {
  readonly actions: AnalyticsWorkspaceActions;
  readonly filter: AnalyticsFilter;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [detailBefore, setDetailBefore] = useState("");
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [scopeType, setScopeType] = useState<AnalyticsScopeType | "all">("all");
  const [scopeId, setScopeId] = useState("");
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const createExport = async (format: "csv" | "json") => {
    setPending(format);
    await actions.createExport({ format, filter, requestedAt: new Date().toISOString() });
    setPending(null);
  };

  const startRetention = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRetentionError(null);
    try {
      const before = toRequiredIsoDateTime(detailBefore, "Retention cutoff");
      if (before >= new Date().toISOString())
        throw new Error("Retention cutoff must be in the past.");
      setPending("retention");
      const succeeded = await actions.startRetention({
        projectId: filter.projectId,
        detailBefore: before,
        requestedAt: new Date().toISOString(),
      });
      setPending(null);
      if (succeeded) setRetentionOpen(false);
    } catch (cause) {
      setPending(null);
      setRetentionError(
        cause instanceof Error ? cause.message : "The retention request is invalid.",
      );
    }
  };

  const rebuild = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRebuildError(null);
    try {
      const normalizedScopeId =
        scopeType === "all" ? null : requireTrimmed(scopeId, "Scope ID", 512);
      setPending("rebuild");
      const succeeded = await actions.rebuildAggregates({
        scopeType: scopeType === "all" ? null : scopeType,
        scopeId: normalizedScopeId,
        requestedAt: new Date().toISOString(),
      });
      setPending(null);
      if (succeeded) setRebuildOpen(false);
    } catch (cause) {
      setPending(null);
      setRebuildError(cause instanceof Error ? cause.message : "The rebuild request is invalid.");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending !== null}
        onClick={() => void createExport("csv")}
      >
        {pending === "csv" ? "Starting CSV..." : "Export CSV"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending !== null}
        onClick={() => void createExport("json")}
      >
        {pending === "json" ? "Starting JSON..." : "Export JSON"}
      </Button>
      <Dialog open={retentionOpen} onOpenChange={setRetentionOpen}>
        <DialogTrigger
          render={<Button size="sm" variant="destructive-outline" disabled={pending !== null} />}
        >
          Run retention
        </DialogTrigger>
        <DialogPopup>
          <form onSubmit={startRetention}>
            <DialogHeader>
              <DialogTitle>Delete retained analytics detail</DialogTitle>
              <DialogDescription>
                This permanently deletes detail before the cutoff{" "}
                {filter.projectId === null ? "across all projects" : "for the selected project"}.
                Aggregates remain available.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="grid gap-4">
              <Field label="Delete detail before">
                <Input
                  nativeInput
                  type="datetime-local"
                  required
                  value={detailBefore}
                  onChange={(event) => setDetailBefore(event.target.value)}
                />
              </Field>
              <FormError message={retentionError} />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending !== null} />}>
                Cancel
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending !== null}>
                {pending === "retention" ? "Starting..." : "Delete retained detail"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
      <Dialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" disabled={pending !== null} />}>
          Rebuild aggregates
        </DialogTrigger>
        <DialogPopup>
          <form onSubmit={rebuild}>
            <DialogHeader>
              <DialogTitle>Rebuild analytics aggregates</DialogTitle>
              <DialogDescription>
                Queue a source-backed recalculation for all scopes or one explicit scope.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="grid gap-4">
              <Field label="Scope">
                <select
                  className={SELECT_CLASSNAME}
                  value={scopeType}
                  onChange={(event) =>
                    setScopeType(event.target.value as AnalyticsScopeType | "all")
                  }
                >
                  <option value="all">all scopes</option>
                  {scopeOptions()}
                </select>
              </Field>
              {scopeType === "all" ? null : (
                <Field label="Scope ID">
                  <Input
                    nativeInput
                    required
                    maxLength={512}
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                  />
                </Field>
              )}
              <FormError message={rebuildError} />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending !== null} />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={pending !== null}>
                {pending === "rebuild" ? "Queuing..." : "Queue rebuild"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
