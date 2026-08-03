import { BotIcon, CheckCircle2Icon, CircleAlertIcon, CircleIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";

export interface MissionTimelineItem {
  readonly sequence: number;
  readonly type: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly tone: "neutral" | "agent" | "success" | "error";
}

function TimelineIcon({ tone }: { readonly tone: MissionTimelineItem["tone"] }) {
  const className = cn(
    "size-3.5",
    tone === "success" && "text-success-foreground",
    tone === "error" && "text-destructive-foreground",
    (tone === "neutral" || tone === "agent") && "text-muted-foreground",
  );

  if (tone === "agent") return <BotIcon aria-hidden className={className} />;
  if (tone === "success") return <CheckCircle2Icon aria-hidden className={className} />;
  if (tone === "error") return <CircleAlertIcon aria-hidden className={className} />;
  return <CircleIcon aria-hidden className={className} />;
}

export function MissionTimeline({ items }: { readonly items: ReadonlyArray<MissionTimelineItem> }) {
  const orderedItems = items.toSorted(
    (left, right) =>
      left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt),
  );

  if (orderedItems.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="grid gap-0" aria-label="Mission activity">
      {orderedItems.map((item) => (
        <li
          key={item.sequence}
          className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 [content-visibility:auto] [contain-intrinsic-size:auto_4rem]"
        >
          <div className="flex flex-col items-center">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-card">
              <TimelineIcon tone={item.tone} />
            </span>
            <span className="min-h-4 w-px flex-1 bg-border last:hidden" aria-hidden />
          </div>
          <div className="min-w-0 pb-4">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium">{item.type}</p>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={item.createdAt}>
                {formatRelativeTimeLabel(item.createdAt)}
              </time>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{item.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
