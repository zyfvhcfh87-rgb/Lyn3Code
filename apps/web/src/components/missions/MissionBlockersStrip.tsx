import { CircleAlertIcon, InfoIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import type { MissionBlocker } from "./MissionBlockers.logic";

/**
 * What stands between this mission and progress, directly under the header.
 *
 * Each row links to the section that resolves it, so the summary is a route into the page rather
 * than a second place to read the same state. Renders nothing when there is nothing to report.
 */
export function MissionBlockersStrip({
  blockers,
}: {
  readonly blockers: ReadonlyArray<MissionBlocker>;
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
            <a
              href={`#${blocker.anchor}`}
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-sm outline-none transition-colors",
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
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
