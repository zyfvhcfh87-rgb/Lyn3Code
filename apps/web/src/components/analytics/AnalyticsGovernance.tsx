import type {
  AnalyticsAlert,
  AnalyticsExport,
  AnalyticsFilter,
  AnalyticsRecommendation,
  AnalyticsRetentionOperation,
  BudgetEvent,
  BudgetPolicy,
} from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { AnalyticsWorkspaceActions } from "./analyticsActions";
import {
  AnalyticsOperationControls,
  BudgetEventControls,
  BudgetPolicyDialog,
} from "./AnalyticsControls";
import {
  ANALYTICS_TABLE_CELL_CLASSNAME,
  ANALYTICS_TABLE_CLASSNAME,
  ANALYTICS_TABLE_HEADER_CLASSNAME,
  AnalyticsCard,
  AnalyticsNotice,
  AnalyticsStateBadge,
  AnalyticsTableFrame,
} from "./AnalyticsPrimitives";
import {
  formatAnalyticsDecimal,
  formatAnalyticsMoney,
  formatDateTime,
  humanizeAnalyticsKey,
} from "./analyticsPresentation";

function BudgetPolicyCard({
  policy,
  actions,
}: {
  policy: BudgetPolicy;
  actions?: AnalyticsWorkspaceActions | undefined;
}) {
  const monetaryLimits = [
    policy.softLimit === null
      ? null
      : `Soft ${formatAnalyticsMoney(policy.softLimit, policy.currency)}`,
    policy.hardLimit === null
      ? null
      : `Hard ${formatAnalyticsMoney(policy.hardLimit, policy.currency)}`,
  ].filter((value): value is string => value !== null);
  const volumeLimits = [
    policy.tokenLimit === null ? null : `${policy.tokenLimit.toLocaleString()} tokens`,
    policy.requestLimit === null ? null : `${policy.requestLimit.toLocaleString()} requests`,
  ].filter((value): value is string => value !== null);

  return (
    <AnalyticsCard
      title={policy.name}
      action={
        <div className="flex items-center gap-2">
          <AnalyticsStateBadge state={policy.enabled ? "complete" : "disabled"} />
          {actions ? <BudgetPolicyDialog policy={policy} actions={actions} /> : null}
        </div>
      }
    >
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Scope</dt>
          <dd className="mt-1 font-medium">
            {humanizeAnalyticsKey(policy.scopeType)} · {policy.scopeId}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Period</dt>
          <dd className="mt-1 font-medium">{humanizeAnalyticsKey(policy.periodType)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Period window</dt>
          <dd className="mt-1 font-medium">
            {policy.periodStart === null || policy.periodEnd === null ? (
              "Resolved from the policy period when evaluated"
            ) : (
              <>
                <time dateTime={policy.periodStart}>{formatDateTime(policy.periodStart)}</time> –{" "}
                <time dateTime={policy.periodEnd}>{formatDateTime(policy.periodEnd)}</time>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Money limits</dt>
          <dd className="mt-1 font-medium">
            {monetaryLimits.length > 0 ? monetaryLimits.join(" · ") : "Not configured"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Volume limits</dt>
          <dd className="mt-1 font-medium">
            {volumeLimits.length > 0 ? volumeLimits.join(" · ") : "Not configured"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Soft-limit action</dt>
          <dd className="mt-1 font-medium">{humanizeAnalyticsKey(policy.actionOnSoftLimit)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Hard-limit action</dt>
          <dd className="mt-1 font-medium">{humanizeAnalyticsKey(policy.actionOnHardLimit)}</dd>
        </div>
      </dl>
      {policy.conservativeWhenIncomplete ? (
        <div className="mt-4">
          <AnalyticsNotice title="Conservative with incomplete data" tone="warning">
            Unknown or incomplete usage is treated cautiously when this policy is evaluated.
          </AnalyticsNotice>
        </div>
      ) : null}
    </AnalyticsCard>
  );
}

function budgetEventValue(event: BudgetEvent, value: string): string {
  return event.currency === null
    ? `${formatAnalyticsDecimal(value)} (non-currency unit)`
    : formatAnalyticsMoney(value, event.currency);
}

export function AnalyticsBudgets({
  policies,
  events,
  actions,
}: {
  policies: ReadonlyArray<BudgetPolicy>;
  events: ReadonlyArray<BudgetEvent>;
  actions?: AnalyticsWorkspaceActions | undefined;
}) {
  return (
    <div className="space-y-4">
      {actions ? (
        <div className="flex justify-end">
          <BudgetPolicyDialog policy={null} actions={actions} />
        </div>
      ) : null}
      {policies.length === 0 ? (
        <AnalyticsNotice title="No budget policies" tone="neutral" role="status">
          Analytics is not currently applying a monetary, token, or request budget in this scope.
        </AnalyticsNotice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {policies.map((policy) => (
            <BudgetPolicyCard key={policy.id} policy={policy} actions={actions} />
          ))}
        </div>
      )}

      {events.length > 0 ? (
        <AnalyticsCard title="Budget events">
          <AnalyticsTableFrame>
            <table className={`${ANALYTICS_TABLE_CLASSNAME} min-w-[920px]`}>
              <caption className="sr-only">Budget threshold and forecast events</caption>
              <thead>
                <tr>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Event
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Current
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Threshold
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Recorded
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Status
                  </th>
                  {actions ? (
                    <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <th scope="row" className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {humanizeAnalyticsKey(event.eventType)}
                    </th>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono`}>
                      {budgetEventValue(event, event.currentValue)}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} font-mono`}>
                      {budgetEventValue(event, event.thresholdValue)}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <Badge variant={event.acknowledgedAt === null ? "warning" : "outline"}>
                        {event.acknowledgedAt === null ? "Needs acknowledgement" : "Acknowledged"}
                      </Badge>
                    </td>
                    {actions ? (
                      <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                        <BudgetEventControls event={event} actions={actions} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </AnalyticsTableFrame>
        </AnalyticsCard>
      ) : null}
    </div>
  );
}

const ALERT_VARIANTS = {
  info: "info",
  warning: "warning",
  critical: "error",
} as const;

export function AnalyticsAlerts({
  alerts,
  actions,
}: {
  alerts: ReadonlyArray<AnalyticsAlert>;
  actions?: AnalyticsWorkspaceActions | undefined;
}) {
  if (alerts.length === 0) {
    return (
      <AnalyticsNotice title="No active analytics alerts" tone="success" role="status">
        No unresolved analytics warning or critical condition is present in this snapshot.
      </AnalyticsNotice>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <div key={alert.id} className="rounded-xl border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ALERT_VARIANTS[alert.severity]}>{alert.severity}</Badge>
            <Badge variant="outline">{humanizeAnalyticsKey(alert.status)}</Badge>
            <h3 className="font-medium">{alert.title}</h3>
            {actions && alert.status === "active" ? (
              <Button
                className="ms-auto"
                size="xs"
                variant="outline"
                onClick={() =>
                  void actions.acknowledgeAlert({
                    alertId: alert.id,
                    acknowledgedAt: new Date().toISOString(),
                  })
                }
              >
                Acknowledge
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{alert.detail}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {humanizeAnalyticsKey(alert.category)} ·{" "}
            <time dateTime={alert.createdAt}>{formatDateTime(alert.createdAt)}</time>
          </p>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsRecommendations({
  recommendations,
  minimumSampleSize,
}: {
  recommendations: ReadonlyArray<AnalyticsRecommendation>;
  minimumSampleSize: number;
}) {
  return (
    <div className="space-y-4">
      <AnalyticsNotice title="Recommendations are non-binding" tone="neutral">
        They explain observed correlations. They do not change routing, permissions, providers,
        budgets, verification, source code, or Git state automatically.
      </AnalyticsNotice>

      {recommendations.length === 0 ? (
        <AnalyticsNotice title="No recommendation" tone="neutral" role="status">
          No observation currently meets the configured sample and evidence requirements.
        </AnalyticsNotice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {recommendations.map((recommendation) => {
            const insufficientSample = recommendation.sampleSize < minimumSampleSize;
            return (
              <AnalyticsCard
                key={recommendation.id}
                title={recommendation.title}
                action={
                  insufficientSample ? (
                    <AnalyticsStateBadge state="insufficient_sample" />
                  ) : (
                    <Badge variant="info">Advisory</Badge>
                  )
                }
              >
                <div className="space-y-3 text-sm">
                  {insufficientSample ? (
                    <AnalyticsNotice title="Below the comparison threshold" tone="warning">
                      Sample {recommendation.sampleSize.toLocaleString()} is smaller than the
                      configured minimum of {minimumSampleSize.toLocaleString()}.
                    </AnalyticsNotice>
                  ) : null}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Evidence</p>
                    <p className="mt-1 leading-relaxed">{recommendation.evidence}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Uncertainty</p>
                    <p className="mt-1 leading-relaxed">{recommendation.uncertainty}</p>
                  </div>
                  <dl className="grid gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Task segment</dt>
                      <dd className="mt-1 font-medium">{recommendation.taskSegment}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Sample</dt>
                      <dd className="mt-1 font-medium">
                        {recommendation.sampleSize.toLocaleString()}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Observation period</dt>
                      <dd className="mt-1 font-medium">
                        <time dateTime={recommendation.periodStart}>
                          {formatDateTime(recommendation.periodStart)}
                        </time>{" "}
                        –{" "}
                        <time dateTime={recommendation.periodEnd}>
                          {formatDateTime(recommendation.periodEnd)}
                        </time>
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Metrics</dt>
                      <dd className="mt-1 font-medium">
                        {recommendation.metricKeys.map(humanizeAnalyticsKey).join(", ")}
                      </dd>
                    </div>
                  </dl>
                  {recommendation.estimatedCostPresent ? (
                    <Badge variant="warning">Includes estimated cost</Badge>
                  ) : null}
                  {recommendation.conflictsWithPolicy ? (
                    <Badge variant="error">Conflicts with current policy</Badge>
                  ) : null}
                </div>
              </AnalyticsCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

const OPERATION_VARIANTS = {
  queued: "outline",
  running: "info",
  completed: "success",
  failed: "error",
  interrupted: "warning",
} as const;

function OperationBadge({ status }: { status: AnalyticsExport["status"] }) {
  return <Badge variant={OPERATION_VARIANTS[status]}>{humanizeAnalyticsKey(status)}</Badge>;
}

export function AnalyticsOperations({
  exports: exportsList,
  retentionOperations,
  actions,
  filter,
}: {
  exports: ReadonlyArray<AnalyticsExport>;
  retentionOperations: ReadonlyArray<AnalyticsRetentionOperation>;
  actions?: AnalyticsWorkspaceActions | undefined;
  filter?: AnalyticsFilter | undefined;
}) {
  return (
    <div className="space-y-4">
      {actions && filter ? <AnalyticsOperationControls actions={actions} filter={filter} /> : null}
      {exportsList.length === 0 && retentionOperations.length === 0 ? (
        <AnalyticsNotice title="No export or retention operations" tone="neutral" role="status">
          No analytics maintenance operation is recorded in this snapshot.
        </AnalyticsNotice>
      ) : null}
      {exportsList.length > 0 ? (
        <AnalyticsCard title="Exports">
          <AnalyticsTableFrame>
            <table className={`${ANALYTICS_TABLE_CLASSNAME} min-w-[900px]`}>
              <caption className="sr-only">Analytics CSV and JSON export operations</caption>
              <thead>
                <tr>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Format
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Status
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Metric version
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Rows
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Requested
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {exportsList.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {item.format.toUpperCase()}
                    </th>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <OperationBadge status={item.status} />
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      v{item.metricVersion}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      {item.rowCount === null ? "Unknown" : item.rowCount.toLocaleString()}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <time dateTime={item.requestedAt}>{formatDateTime(item.requestedAt)}</time>
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      {item.relativeFilePath ?? item.errorCategory ?? "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AnalyticsTableFrame>
        </AnalyticsCard>
      ) : null}

      {retentionOperations.length > 0 ? (
        <AnalyticsCard title="Retention operations">
          <AnalyticsTableFrame>
            <table className={`${ANALYTICS_TABLE_CLASSNAME} min-w-[940px]`}>
              <caption className="sr-only">
                Analytics detail and export retention operations
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Delete detail before
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Status
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Usage rows
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Tool rows
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Exports
                  </th>
                  <th scope="col" className={ANALYTICS_TABLE_HEADER_CLASSNAME}>
                    Requested
                  </th>
                </tr>
              </thead>
              <tbody>
                {retentionOperations.map((operation) => (
                  <tr key={operation.id}>
                    <th scope="row" className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <time dateTime={operation.detailBefore}>
                        {formatDateTime(operation.detailBefore)}
                      </time>
                    </th>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <OperationBadge status={operation.status} />
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      {operation.deletedUsageCount.toLocaleString()}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      {operation.deletedToolMetricCount.toLocaleString()}
                    </td>
                    <td className={`${ANALYTICS_TABLE_CELL_CLASSNAME} tabular-nums`}>
                      {operation.deletedExportCount.toLocaleString()}
                    </td>
                    <td className={ANALYTICS_TABLE_CELL_CLASSNAME}>
                      <time dateTime={operation.requestedAt}>
                        {formatDateTime(operation.requestedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AnalyticsTableFrame>
        </AnalyticsCard>
      ) : null}
    </div>
  );
}
