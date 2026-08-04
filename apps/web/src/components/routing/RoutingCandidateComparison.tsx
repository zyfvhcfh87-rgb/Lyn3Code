import { CircleCheckIcon, CircleXIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import type { RoutingCandidateView } from "./routingView";

export function RoutingCandidateComparison({
  candidates,
}: {
  readonly candidates: ReadonlyArray<RoutingCandidateView>;
}) {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">No candidate details were retained.</p>;
  }

  return (
    <div className="grid gap-2">
      {candidates.map((candidate) => (
        <article
          key={candidate.id}
          className="grid gap-2 rounded-lg border border-border p-3 [content-visibility:auto] [contain-intrinsic-size:auto_8rem]"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {candidate.eligible ? (
              <CircleCheckIcon className="size-4 text-success-foreground" />
            ) : (
              <CircleXIcon className="size-4 text-destructive-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-medium">{candidate.modelName}</h4>
              <p className="truncate text-xs text-muted-foreground">{candidate.providerName}</p>
            </div>
            <Badge variant={candidate.eligible ? "success" : "error"}>
              {candidate.eligible ? "Eligible" : "Rejected"}
            </Badge>
            {candidate.score !== null ? (
              <Badge variant="outline">Score {candidate.score.toFixed(2)}</Badge>
            ) : null}
          </div>
          {candidate.reasons.length > 0 ? (
            <ul className="grid gap-1 pl-6 text-xs text-muted-foreground">
              {candidate.reasons.map((reason) => (
                <li key={reason}>• {reason}</li>
              ))}
            </ul>
          ) : (
            <p className="pl-6 text-xs text-muted-foreground">No explanation retained.</p>
          )}
        </article>
      ))}
    </div>
  );
}
