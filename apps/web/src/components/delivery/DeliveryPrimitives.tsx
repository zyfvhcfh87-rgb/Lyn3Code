import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import { Card, CardHeader, CardPanel, CardTitle } from "../ui/card";
import { deliveryTone, humanizeDeliveryKey, type DeliveryTone } from "./deliveryPresentation";

const BADGE_VARIANTS = {
  neutral: "outline",
  info: "info",
  success: "success",
  warning: "warning",
  critical: "error",
} as const;

export function DeliveryStatusBadge({
  status,
  tone = deliveryTone(status),
}: {
  status: unknown;
  tone?: DeliveryTone;
}) {
  return <Badge variant={BADGE_VARIANTS[tone]}>{humanizeDeliveryKey(status)}</Badge>;
}

export function DeliveryNotice({
  title,
  children,
  tone = "warning",
  role,
}: {
  title: string;
  children: ReactNode;
  tone?: DeliveryTone;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "neutral" && "border-border bg-muted/35",
        tone === "info" && "border-info/35 bg-info/8 text-info-foreground",
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

export function DeliveryCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-4 py-3">
        <div>
          <CardTitle className="text-sm leading-5">{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="col-start-2 row-start-1">{action}</div> : null}
      </CardHeader>
      <CardPanel className="p-4">{children}</CardPanel>
    </Card>
  );
}

export function DeliveryFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("mt-1 truncate text-xs font-medium", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

export function DeliveryEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}
