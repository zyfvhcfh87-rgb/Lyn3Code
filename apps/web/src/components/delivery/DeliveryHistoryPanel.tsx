import type { DeliveryWorkspaceSnapshot } from "@t3tools/contracts";

import { DeliveryCard, DeliveryEmpty, DeliveryStatusBadge } from "./DeliveryPrimitives";
import { formatDeliveryTime, humanizeDeliveryKey, shortIdentifier } from "./deliveryPresentation";

export function DeliveryHistoryPanel({ snapshot }: { snapshot: DeliveryWorkspaceSnapshot }) {
  const entries = [...snapshot.auditEntries].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );

  return (
    <DeliveryCard
      title="Delivery history"
      description="Append-only intent, state changes, and public adapter evidence."
    >
      {entries.length === 0 ? (
        <DeliveryEmpty>No delivery audit entries have been recorded.</DeliveryEmpty>
      ) : (
        <ol className="space-y-2">
          {entries.slice(0, 20).map((entry) => (
            <li
              className="grid gap-2 rounded-lg border px-3 py-2.5 text-xs sm:grid-cols-[1fr_auto]"
              key={entry.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{humanizeDeliveryKey(entry.action)}</p>
                  <DeliveryStatusBadge status={entry.actorType} tone="neutral" />
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {humanizeDeliveryKey(entry.aggregateType)} {shortIdentifier(entry.aggregateId)}
                  {entry.sourceCommit ? ` · ${shortIdentifier(entry.sourceCommit)}` : ""}
                </p>
              </div>
              <div className="text-left text-[11px] text-muted-foreground sm:text-right">
                <p>{formatDeliveryTime(entry.occurredAt)}</p>
                <p>{entry.actorId ?? "System"}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </DeliveryCard>
  );
}
