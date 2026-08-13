import { CircleAlertIcon, InfoIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import type { MissionBlocker } from "./MissionBlockers.logic";

/**
 * What stands between this mission and progress, directly under the header.
 *
 * Each row selects the section that resolves it. These are buttons rather than anchors because the
 * target usually lives in a tab panel that is not mounted yet, so the workspace has to switch tabs
 * before it can scroll. Renders nothing when there is nothing to report.
 */
export function MissionBlockersStrip({
  blockers,
  onSelect,
}: {
  readonly blockers: ReadonlyArray<MissionBlocker>;
  readonly onSelect: (blocker: MissionBlocker) => void;
}) {
  if (blockers.length === 0) return null;

  const blockingCount = blockers.filter((blocker) => blocker.severity === "blocker").length;

  return (
    <section
      aria-labelledby="mission-blockers-heading"
      className="grid gap-2 rounded-xl border border-border bg-muted/24 p-3"
    >
      <h2
        id="mission-blockers-heading"
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {blockingCount > 0 ? "Needs attention" : "In progress"}
      </h2>
      <ul className="grid gap-1.5">
        {blockers.map((blocker) => (
          <li key={blocker.id}>
            <button
              type="button"
              onClick={() => onSelect(blocker)}
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none transition-colors",
                "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
                blocker.severity === "blocker"
                  ? "text-warning-foreground"
                  : "text-muted-foreground",
              )}
            >
              {blocker.severity === "blocker" ? (
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              ) : (
                <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              )}
              <span className="min-w-0">{blocker.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
