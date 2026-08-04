import { useEffect } from "react";

import { Badge } from "../ui/badge";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../ui/sheet";
import { RoutingCandidateComparison } from "./RoutingCandidateComparison";
import {
  routingDecisionTypeLabel,
  type RoutingDecisionDetailView,
  type RoutingDecisionSummaryView,
} from "./routingView";

function DetailList({
  title,
  values,
  emptyLabel = "None",
}: {
  readonly title: string;
  readonly values: ReadonlyArray<string>;
  readonly emptyLabel?: string;
}) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {values.length > 0 ? (
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {values.map((value) => (
            <li key={value}>• {value}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

export function RoutingDecisionSheet({
  open,
  summary,
  detail,
  isLoading,
  error,
  onOpenChange,
  onRequestDetail,
}: {
  readonly open: boolean;
  readonly summary: RoutingDecisionSummaryView | null;
  readonly detail: RoutingDecisionDetailView | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRequestDetail: (decisionId: string) => void;
}) {
  useEffect(() => {
    if (open && summary && detail?.id !== summary.id && !isLoading) {
      onRequestDetail(summary.id);
    }
  }, [detail?.id, isLoading, onRequestDetail, open, summary]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup className="max-w-2xl" side="right">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <SheetTitle>Routing decision</SheetTitle>
            {summary ? (
              <Badge variant="info">{routingDecisionTypeLabel(summary.decisionType)}</Badge>
            ) : null}
          </div>
          <SheetDescription>
            Immutable routing evidence for this run. Candidate details load only while this view is
            open.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel className="grid gap-6">
          {summary ? (
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Provider</dt>
                <dd>{summary.providerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Model</dt>
                <dd>{summary.modelName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reasoning</dt>
                <dd>{summary.reasoningLevel ?? "Model default"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Decision ID</dt>
                <dd className="truncate font-mono text-xs" title={summary.id}>
                  {summary.id}
                </dd>
              </div>
            </dl>
          ) : null}

          {isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading candidate evidence…
            </p>
          ) : null}
          {error ? (
            <p
              className="rounded-lg bg-destructive/8 p-3 text-sm text-destructive-foreground"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {detail ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Role</dt>
                  <dd>{detail.role}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Task type</dt>
                  <dd>{detail.taskType}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Complexity</dt>
                  <dd>{detail.complexity}</dd>
                </div>
              </dl>
              <DetailList title="Selection reasons" values={detail.selectionReasons} />
              <DetailList title="Required capabilities" values={detail.requiredCapabilities} />
              <DetailList title="Policy sources" values={detail.policySources} />
              <DetailList title="Manual overrides" values={detail.manualOverrides} />
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Candidate comparison</h3>
                <RoutingCandidateComparison candidates={detail.candidates} />
              </section>
              <DetailList
                title="Fallback plan"
                values={detail.fallbackPlan}
                emptyLabel="Fallback disabled"
              />
              <DetailList title="Capability snapshot" values={detail.capabilitySnapshot} />
              <DetailList title="Provider health snapshot" values={detail.providerHealthSnapshot} />
              <DetailList
                title="Rerouting history"
                values={detail.reroutingHistory}
                emptyLabel="No reroutes"
              />
            </>
          ) : null}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
