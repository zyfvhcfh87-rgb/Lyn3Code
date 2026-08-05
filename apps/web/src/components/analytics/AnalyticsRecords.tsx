import type {
  AnalyticsAnnotation,
  ExchangeRateSnapshot,
  PricingSnapshot,
  SubscriptionAttributionRule,
} from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import type { AnalyticsWorkspaceActions } from "./analyticsActions";
import { AnnotationDialog } from "./AnalyticsControls";
import { AnalyticsCard, AnalyticsNotice } from "./AnalyticsPrimitives";
import {
  formatAnalyticsDecimal,
  formatDateTime,
  humanizeAnalyticsKey,
} from "./analyticsPresentation";

function pricingRates(snapshot: PricingSnapshot) {
  return [
    ["Input tokens", snapshot.inputTokenRate],
    ["Output tokens", snapshot.outputTokenRate],
    ["Reasoning tokens", snapshot.reasoningTokenRate],
    ["Cached input", snapshot.cachedInputRate],
    ["Cache write", snapshot.cacheWriteRate],
    ["Cache read", snapshot.cacheReadRate],
    ["Request", snapshot.requestRate],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
}

export function AnalyticsPricingSnapshots({
  snapshots,
}: {
  readonly snapshots: ReadonlyArray<PricingSnapshot>;
}) {
  if (snapshots.length === 0) {
    return (
      <AnalyticsNotice title="No pricing snapshots" tone="warning" role="status">
        Calculated cost remains unknown for usage without an applicable provider, model, currency,
        effective period, and billing unit.
      </AnalyticsNotice>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {snapshots.map((snapshot) => (
        <AnalyticsCard
          key={snapshot.id}
          title={`${snapshot.providerProfileId} · ${snapshot.modelProfileId}`}
          action={<Badge variant="outline">{humanizeAnalyticsKey(snapshot.pricingSource)}</Badge>}
        >
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Currency and unit</dt>
              <dd className="mt-1 font-medium">
                <span className="font-mono">{snapshot.currency}</span> ·{" "}
                {humanizeAnalyticsKey(snapshot.billingUnit)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="mt-1 font-medium">{humanizeAnalyticsKey(snapshot.confidence)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Effective period</dt>
              <dd className="mt-1 font-medium">
                <time dateTime={snapshot.effectiveFrom}>
                  {formatDateTime(snapshot.effectiveFrom)}
                </time>{" "}
                –{" "}
                {snapshot.effectiveTo === null ? (
                  "Open ended"
                ) : (
                  <time dateTime={snapshot.effectiveTo}>
                    {formatDateTime(snapshot.effectiveTo)}
                  </time>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Rates</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {pricingRates(snapshot).map(([label, rate]) => (
                  <span key={label} className="rounded-md border px-2 py-1">
                    {label}: <span className="font-mono">{formatAnalyticsDecimal(rate)}</span>{" "}
                    {snapshot.currency}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </AnalyticsCard>
      ))}
    </div>
  );
}

export function AnalyticsAccountingSnapshots({
  rules,
  exchangeRates,
}: {
  readonly rules: ReadonlyArray<SubscriptionAttributionRule>;
  readonly exchangeRates: ReadonlyArray<ExchangeRateSnapshot>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AnalyticsCard title="Subscription accounting rules">
        {rules.length === 0 ? (
          <AnalyticsNotice title="No subscription allocation configured" tone="neutral">
            Subscription activity remains non-monetary until an explicit rule and matching global
            attribution mode are configured.
          </AnalyticsNotice>
        ) : (
          <ul className="space-y-3 text-sm">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-lg border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{rule.label}</span>
                  <Badge variant="outline">{humanizeAnalyticsKey(rule.mode)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rule.providerProfileId}
                  {rule.modelProfileId === null
                    ? " · all models"
                    : ` · ${rule.modelProfileId}`} ·{" "}
                  <span className="font-mono">{rule.currency}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <time dateTime={rule.periodStart}>{formatDateTime(rule.periodStart)}</time> –{" "}
                  <time dateTime={rule.periodEnd}>{formatDateTime(rule.periodEnd)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </AnalyticsCard>
      <AnalyticsCard title="Manual exchange-rate snapshots">
        {exchangeRates.length === 0 ? (
          <AnalyticsNotice title="No currency conversion configured" tone="neutral">
            Original currency rows remain separate. Add a direct manual rate to show a labelled
            reporting-currency conversion.
          </AnalyticsNotice>
        ) : (
          <ul className="space-y-3 text-sm">
            {exchangeRates.map((snapshot) => (
              <li key={snapshot.id} className="rounded-lg border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium">
                    1 {snapshot.baseCurrency} = {formatAnalyticsDecimal(snapshot.rate)}{" "}
                    {snapshot.quoteCurrency}
                  </span>
                  <Badge variant="outline">User configured</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Effective{" "}
                  <time dateTime={snapshot.effectiveAt}>
                    {formatDateTime(snapshot.effectiveAt)}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </AnalyticsCard>
    </div>
  );
}

export function AnalyticsAnnotations({
  annotations,
  actions,
}: {
  readonly annotations: ReadonlyArray<AnalyticsAnnotation>;
  readonly actions?: AnalyticsWorkspaceActions | undefined;
}) {
  return (
    <div className="space-y-4">
      {actions ? (
        <div className="flex justify-end">
          <AnnotationDialog actions={actions} />
        </div>
      ) : null}
      {annotations.length === 0 ? (
        <AnalyticsNotice title="No annotations" tone="neutral" role="status">
          No scoped explanatory context is recorded for this workspace.
        </AnalyticsNotice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {annotations.map((annotation) => (
            <AnalyticsCard
              key={annotation.id}
              title={annotation.title}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{humanizeAnalyticsKey(annotation.scopeType)}</Badge>
                  {actions ? <AnnotationDialog annotation={annotation} actions={actions} /> : null}
                </div>
              }
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{annotation.content}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {annotation.scopeId} · {annotation.createdBy} ·{" "}
                <time dateTime={annotation.timestamp ?? annotation.createdAt}>
                  {formatDateTime(annotation.timestamp ?? annotation.createdAt)}
                </time>
              </p>
            </AnalyticsCard>
          ))}
        </div>
      )}
    </div>
  );
}
