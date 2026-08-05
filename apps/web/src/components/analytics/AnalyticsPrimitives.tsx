import type { AnalyticsConfidence } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Card, CardHeader, CardPanel, CardTitle } from "../ui/card";
import {
  ANALYTICS_STATE_LABELS,
  confidenceLabel,
  type AnalyticsPresentationState,
} from "./analyticsPresentation";

const STATE_VARIANTS = {
  complete: "success",
  partial: "warning",
  unknown: "error",
  disabled: "outline",
  insufficient_sample: "warning",
} as const;

const CONFIDENCE_VARIANTS = {
  confirmed: "success",
  high: "success",
  medium: "info",
  low: "warning",
  unknown: "error",
} as const;

export function AnalyticsStateBadge({ state }: { state: AnalyticsPresentationState }) {
  return <Badge variant={STATE_VARIANTS[state]}>{ANALYTICS_STATE_LABELS[state]}</Badge>;
}

export function AnalyticsConfidenceBadge({ confidence }: { confidence: AnalyticsConfidence }) {
  return <Badge variant={CONFIDENCE_VARIANTS[confidence]}>{confidenceLabel(confidence)}</Badge>;
}

export function AnalyticsNotice({
  title,
  children,
  tone = "warning",
  role,
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "warning" | "critical" | "success";
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "neutral" && "border-border bg-muted/35",
        tone === "warning" && "border-warning/35 bg-warning/8 text-warning-foreground",
        tone === "critical" && "border-destructive/35 bg-destructive/8 text-destructive-foreground",
        tone === "success" && "border-success/35 bg-success/8 text-success-foreground",
      )}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-[13px] leading-relaxed opacity-85">{children}</div>
    </div>
  );
}

export function AnalyticsCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-4 py-3">
        <CardTitle className="text-sm leading-5">{title}</CardTitle>
        {action ? <div className="col-start-2 row-start-1">{action}</div> : null}
      </CardHeader>
      <CardPanel className="p-4">{children}</CardPanel>
    </Card>
  );
}

export function AnalyticsMetricCard({
  label,
  value,
  detail,
  state,
}: {
  label: string;
  value: string;
  detail?: string;
  state?: AnalyticsPresentationState | undefined;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-xs/5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {state ? <AnalyticsStateBadge state={state} /> : null}
      </div>
      <p className="mt-2 font-mono text-xl font-semibold tracking-tight text-foreground">{value}</p>
      {detail ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

export function StaticRatioBar({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  const formattedPercent = `${percent.toFixed(1).replace(/\.0$/, "")}%`;

  return (
    <svg
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${formattedPercent}`}
      className="h-2 w-full overflow-visible rounded-full"
    >
      <rect width="100" height="8" rx="4" className="fill-muted" />
      <rect width={percent} height="8" rx="4" className="fill-primary" />
    </svg>
  );
}

export function AnalyticsTableFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border">{children}</div>;
}

export const ANALYTICS_TABLE_CLASSNAME =
  "w-full min-w-[760px] border-collapse text-left text-xs text-foreground";
export const ANALYTICS_TABLE_HEADER_CLASSNAME =
  "border-b bg-muted/45 px-3 py-2.5 font-semibold text-muted-foreground";
export const ANALYTICS_TABLE_CELL_CLASSNAME = "border-b px-3 py-2.5 align-top last:border-b-0";
