# Analytics operations

> Operational runbook for Phase 7 analytics. Product behavior is described in
> [Analytics](../user/analytics.md); contracts and metric definitions are in
> [Analytics architecture](../internals/analytics.md).

## Safety rules

- Never run a development server against the live T3 home or open its database read-write for
  diagnosis. Snapshot the database consistently and reproduce in an isolated T3 home.
- Treat analytics exports as sensitive operational records even though prompt content is excluded.
- Never repair missing data by editing aggregate rows. Restore source ingestion, pricing, or outcome
  projection and rebuild through the supported operation.
- Preserve cost provenance and original currency. Do not “fix” a dashboard by folding provider,
  calculated, subscription, or local estimates into one amount.

## Healthy-state checks

For a representative completed mission, confirm:

1. the mission, task, agent-run, routing, verification, and GitHub outcome links resolve;
2. each usage record has a source, confidence, state, and source-event identity;
3. each cost record has one currency, one cost type, one calculation method, component evidence,
   and any missing pricing dimensions;
4. aggregate metric version, period, watermark, sample, missing, and estimated counts are present;
5. the workspace's data-quality counts reconcile with known unknown/unpriced/stale records;
6. budgets, alerts, recommendations, exports, and retention operations show durable lifecycle state.

A green-looking rate without sample and missing-data evidence is not a healthy result.

## Provider coverage baseline

The confirmed shared-ledger baseline is Codex and Claude token snapshots, with Claude provider total
cost only when Claude supplies `total_cost_usd`. Codex has no normalized provider monetary total.
Cursor and Grok remain unknown. OpenCode has native cost metadata available to its parser, but it is
not yet normalized into the shared analytics ledger.

When a provider appears empty:

1. confirm the adapter emitted a supported usage/cost shape for that exact CLI version;
2. inspect the usage source and confidence rather than assuming provider-reported coverage;
3. verify the source event was projected once and linked to the expected run;
4. check for provisional, reconciled, unknown, and duplicate-source records;
5. rebuild only after source ingestion is correct.

Keep unsupported coverage as unknown. Do not derive provider-reported cost from a context-window
counter or label a tokenizer estimate as provider reported.

## Unknown or partial data

Use the quality counters to narrow the failure:

- **unknown usage**: adapter evidence was absent or rejected;
- **estimated usage**: evidence exists but is adapter/tokenizer/context-derived;
- **unpriced usage**: usage exists but no applicable price dimension was found;
- **stale pricing**: a price snapshot was outside its trusted effective period;
- **incomplete outcome**: task/mission lifecycle has not finalized or projection is behind;
- **pending human disposition**: acceptance metrics correctly exclude the task for now;
- **source detail deleted**: only retained aggregates remain auditable.

Do not coerce these counters to zero to make comparisons available. Correct the source, then request
a fresh versioned aggregate. Earlier aggregates remain historical evidence.

## Pricing and currency

Pricing source precedence is explicit in analytics settings. For every calculated amount, verify the
pricing snapshot's provider/model identity, source, effective interval, billing unit, decimal rate,
confidence, and component breakdown. Missing cache, reasoning, request, tool, or time dimensions
must stay missing when no trusted rate exists.

Exchange-rate snapshots are immutable, user-configured records. A direct rate effective at the
reporting cutoff creates a separately labelled conversion row; original currency rows remain the
source of truth. Phase 7 never fetches rates, infers inverse pairs, applies future rates
retroactively, or produces a cross-currency grand total.

Subscription allocations and local-compute estimates are internal analytical models, not provider
invoices. Subscription money requires a period-bound rule and matching global mode; a pricing
snapshot alone never enables it. Flat-plan allocations wait for period close and complete
denominators. Keep these values in their own cost columns and disclose the configured attribution or
hourly rate.

## Aggregate rebuild

Rebuild derived aggregates when metric implementation, pricing, late reconciliation, restored
outcomes, or a damaged derived projection requires it. Record the requested scope and time before
starting. Queue the supported operation from **Settings → Analytics → Exports and retention**;
do not edit aggregate rows directly. During and after the rebuild, confirm:

- the operation advances from queued to running to completed, failed, or interrupted;
- the source watermark does not move backward;
- repeated source events do not create duplicate usage or cost;
- the output uses the requested metric version;
- missing and estimated counts reconcile with detail;
- aggregates whose source detail expired remain marked `sourceDetailDeleted`.

Do not reuse a v1 aggregate under a future metric version or silently update v1 meanings.

## Export

Create CSV or JSON from **Settings → Analytics → Exports and retention**. The request captures the
page's current filter and metric version. Before handing off a file, verify completed status,
row/byte counts, managed relative path, expected time range and scope, and that each monetary row
includes currency and cost provenance.

Export paths must remain beneath the managed analytics export root. Reject absolute paths, traversal,
symbolic links, junctions, and any target outside that root. Export retention removes eligible
managed artifacts; it is not a general filesystem cleanup mechanism.

If export fails or is interrupted, preserve the operation record and error category. Remove a known
partial artifact only through the validated managed-export cleanup path, then create a new export.

## Retention

Retention operates independently for detail, aggregates, and export artifacts. Before a destructive
retention run, confirm the configured periods, optional project scope, `detailBefore` boundary, and
that a consistent backup exists when the data matters. The Settings control shows whether the
operation applies to the selected project or all projects and requires an explicit cutoff and
destructive confirmation.

After completion, verify deleted usage/tool/export counts, surviving aggregate marks, foreign-key
integrity, and that no path outside the managed export root changed. A failed delete is not retried
with a broader path or stronger primitive; stop and investigate the exact locked or invalid target.

## Restart recovery

On startup, inspect export and retention operations left queued or running. If their workers cannot
be proven alive and owned, they must become interrupted or failed. Preserve partial counts, failure
category, timestamps, and any safe diagnostics. Do not infer completion from a file's existence.

An explicit retry creates new operation history. Usage ingestion remains idempotent by source
identity, and aggregate rebuilds resume from durable detail/watermarks rather than appending guessed
results.

## Backup and restore

Take a consistent SQLite snapshot; do not copy only the main database file while it has a live WAL.
Back up managed export files separately when they are required. Restore into an isolated T3 home
first and verify one provider-reported record, one estimate, one unknown/unpriced record, one outcome,
one v1 aggregate, one budget event, and one completed export.

Then confirm interrupted-operation recovery and rebuild only invalid or missing derived aggregates.
If retained detail is unavailable, preserve the aggregate with its deleted-source-detail warning.

## Privacy incident

Analytics v1 fixes prompt-content storage to false. If prompt text, file content, command output,
tool payloads, credentials, secrets, or unrestricted provider responses appear in an analytics row,
event, export, or log:

1. disable analytics collection and pause exports/retention that could spread the content;
2. contain and rotate exposed credentials using their owning systems;
3. preserve only redacted identifiers and diagnostics needed for investigation;
4. correct the ingestion or export boundary;
5. use validated scoped retention to remove the affected detail and managed exports;
6. rebuild affected aggregates and verify data-quality/source-detail-deleted markers;
7. document the incident without copying the sensitive payload into another log.
