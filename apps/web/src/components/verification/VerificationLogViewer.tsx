import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, VerificationCheckRunId, VerificationRunId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo, useState } from "react";

import { verificationEnvironment } from "../../state/verification";
import { Button } from "../ui/button";

const PAGE_LIMIT = 500;

export function VerificationLogViewer({
  environmentId,
  verificationRunId,
  checkRunId,
}: {
  readonly environmentId: EnvironmentId;
  readonly verificationRunId: VerificationRunId;
  readonly checkRunId: VerificationCheckRunId;
}) {
  const [stream, setStream] = useState<"all" | "stdout" | "stderr">("all");
  const [search, setSearch] = useState("");
  const result = useAtomValue(
    verificationEnvironment.logPageAtom({
      environmentId,
      input: { verificationRunId, checkRunId, cursor: 0, limit: PAGE_LIMIT },
    }),
  );
  const page = Option.getOrNull(AsyncResult.value(result));
  const records = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (page?.records ?? []).filter(
      (record) =>
        (stream === "all" || record.stream === stream) &&
        (needle.length === 0 || record.text.toLocaleLowerCase().includes(needle)),
    );
  }, [page?.records, search, stream]);

  if (result.waiting && page === null) {
    return <p className="text-xs text-muted-foreground">Connecting to the durable log...</p>;
  }
  if (result._tag === "Failure") {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Log connection lost. Evidence already stored on the host is preserved; reconnect to resume
        reading it.
      </p>
    );
  }
  if (page === null || !page.logAvailable) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {page?.unavailableReason ?? "The durable log is currently unavailable."}
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {result.waiting ? (
        <p className="text-xs text-muted-foreground" role="status">
          Reconnecting to the log. Showing the last durable page.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Log stream">
          {(["all", "stdout", "stderr"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={stream === value ? "secondary" : "ghost"}
              onClick={() => setStream(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <input
          aria-label="Search log"
          className="h-8 min-w-40 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          placeholder="Search this page"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      <pre className="max-h-72 overflow-auto rounded-lg bg-black/90 p-3 font-mono text-xs leading-5 text-white">
        {records
          .map((record) => `[${record.observedAt}] [${record.stream}] ${record.text}`)
          .join("") || "No matching log records."}
      </pre>
      <p className="text-[11px] text-muted-foreground">
        Showing a bounded page of {page.records.length} records. Full logs remain durable on the
        host.
      </p>
    </div>
  );
}
