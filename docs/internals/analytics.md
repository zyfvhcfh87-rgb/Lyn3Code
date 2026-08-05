# Analytics architecture

> For maintainers. For the product view, see [Analytics](../user/analytics.md). For operational
> recovery, see [Analytics operations](../operations/analytics.md).

Phase 7 derives explainable operational analytics from the existing mission, agent-run, routing,
verification, GitHub, and provider-runtime seams. It does not create a second scheduler, billing
system, provider runner, or source of truth for task state. Analytics detail and aggregates are
projection data linked back to durable source records and orchestration events.

## Contract and provenance model

The shared contract separates:

- usage records, with provider-reported, adapter-calculated, tokenizer-estimated,
  context-estimated, or unknown source plus confidence and lifecycle state;
- tool execution metrics and run performance, including typed completion categories;
- pricing snapshots with source, effective interval, billing unit, decimal rates, and confidence;
- cost records with one currency, cost type, calculation method, pricing snapshot, exact decimal
  amount, component breakdown, missing dimensions, and estimated/subscription flags;
- subscription usage, task and mission outcomes, aggregates, budgets, overrides, alerts,
  recommendations, annotations, exports, retention operations, and exchange-rate snapshots;
- one filter shape shared by overview, comparisons, detail, aggregate rebuild, and export.

Money is stored as bounded decimal strings with up to 18 fractional digits. Currency arithmetic must
use decimal math, never binary floating point. Provider-reported, calculated API estimates,
subscription allocations, and local-compute estimates remain distinct even when they share a
currency. Phase 7 never silently combines currencies. Immutable user-configured exchange-rate
snapshots may produce separately labelled reporting-currency rows, while every original amount
remains intact and visible. There is no automatic rate fetching, reciprocal inference, or
cross-currency grand total. The subscription-attribution mode is persisted and defaults to `none`.
Immutable, period-bound accounting rules supply the explicit plan amount or internal rate;
`subscription_plan` pricing snapshots alone never create money. Flat monthly redistribution waits
for a closed period and complete period-wide denominator. Rebuilds append a deterministic
allocation revision and replace only current pointers, never historical cost or usage records.
When a run has both provider-reported and catalogue-calculated amounts in one currency, a difference
of at least five percent produces a review alert; both immutable amounts remain visible.

Unknown cost is not zero cost. Missing pricing dimensions remain on the cost record and feed data
quality. A finalized calculation is immutable and linked to the pricing snapshot effective at usage
time; provider-reported amounts remain separate records.

## Metric catalogue v1

`ANALYTICS_METRIC_VERSION` is 1. Meanings never change in place; a semantic change requires a new
version and separately queryable/exportable aggregates.

| Key                                     | Exact v1 definition                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cost_per_verified_task_implementation` | Sum implementation-agent cost attributed to tasks that passed required verification, divided by the count of those verified tasks, grouped by currency and cost provenance.                                                                                                                      |
| `cost_per_verified_task_inclusive`      | Sum implementation, repair-agent, reviewer, and fallback-agent cost attributed to tasks that passed required verification, divided by the count of those verified tasks, grouped by currency and cost provenance. Verification command runtime is separate performance evidence, not model cost. |
| `cost_per_merged_mission`               | Sum attributable agent cost for missions with `pullRequestMerged = true`, divided by the count of those merged missions, grouped by currency and cost provenance.                                                                                                                                |
| `first_pass_verification_rate`          | Tasks that passed required verification after the first implementation attempt / tasks that reached required verification.                                                                                                                                                                       |
| `repair_rate`                           | Tasks with one or more repair-agent runs / tasks that reached required verification.                                                                                                                                                                                                             |
| `human_acceptance_rate`                 | Tasks with `accepted` or `accepted_with_edits` / tasks with explicit human disposition. `unknown` and `not_reviewed` are excluded from numerator and denominator.                                                                                                                                |
| `provider_failure_rate`                 | Finalized runs with completion category `failed_provider` / all finalized runs.                                                                                                                                                                                                                  |
| `fallback_rate_per_started_run`         | Started runs whose fallback count is at least one / all started runs.                                                                                                                                                                                                                            |

Required-verification pass follows the verification outcome that authorizes the task: `passed` or
`passed_with_warnings` for the required profile. Failed, invalidated, overridden, not-required,
not-run, unknown, and absent results are not counted as verification passes. An override remains
separate evidence and never becomes a pass.

Every aggregate metric carries unit, confidence, sample size, missing count, and estimated count. A
zero denominator produces a null value with visible missing/sample evidence. Aggregates also retain
their metric version, time bounds, source watermark, calculation time, and whether source detail has
since been deleted.

## Ingestion and provider coverage

Normalized ingestion is idempotent by source identity. Provider request/response identifiers,
routing decision, capability snapshot, project/mission/task/run links, and reconciliation state make
late or repeated usage safe to process without double counting. Provisional usage can become final
or reconciled; history must not be rewritten to pretend the provisional observation never existed.

Confirmed v1 coverage is:

| Adapter  | Shared token usage                       | Provider monetary amount                                                                                     |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Codex    | Normalized token snapshots when emitted  | No normalized provider total                                                                                 |
| Claude   | Normalized token snapshots when emitted  | `total_cost_usd` when supplied by Claude                                                                     |
| Cursor   | Streamed output may be context-estimated | Unknown                                                                                                      |
| Grok     | Streamed output may be context-estimated | Unknown                                                                                                      |
| OpenCode | Streamed output may be context-estimated | Unknown; native cost metadata is available to its parser but not normalized into the shared analytics ledger |

Do not turn absent adapter evidence into calculated usage unless the record is explicitly labelled
with the actual adapter/tokenizer/context source. Provider behavior is version-dependent, so the
record source, confidence, and live quality counts take precedence over this baseline matrix.
When no authoritative usage frame exists, model-output and reasoning deltas may produce a
`context_estimated`, low-confidence token record using an in-memory character heuristic. Raw deltas
are never stored by analytics, command/file output is excluded, and unobserved input remains null.
Run-performance audit references include only memory token estimates, selected-memory counts,
source-chunk counts, and retrieval-failure counts from the existing memory projection. Retrieved
memory and source content is never copied into analytics. Provider compaction or a routing decision
that reserves the full context window marks context reduction on the run record.

## Outcomes, comparisons, and recommendations

Task outcomes retain verification, integration, human disposition, revert state, repair attempts,
run count, and active/wall-clock durations. Mission outcomes retain task summaries and pull-request
creation/merge facts. Pending and unknown outcomes remain visible and are excluded only where a v1
denominator says so.

Comparison rows are grouped by provider, model, normalized reasoning level, or the real mission
agent role projection and carry task/run sample counts, missing-data ratio, estimated-cost ratio,
and an explicit insufficient-sample flag. They are not a global model leaderboard. Task segment and
policy context matter.

Recommendations are derived observations with evidence text, period, segment, metric keys, sample
size, uncertainty, estimated-cost presence, and policy-conflict state. They are non-binding. The
analytics reactor must not apply routing, provider, reasoning, permission, budget, verification,
source, Git, or GitHub mutations from a recommendation.

## Forecasts, budgets, and alerts

Forecasts support current-period run rate, trailing average, and scheduled-mission estimate. Each
result includes observation bounds, completeness, confidence, uncertainty, estimated-cost presence,
and an optional withheld reason. A forecast is withheld rather than emitted as zero when evidence is
insufficient.

Budget policy is scoped and period-bound. Money, token, and request thresholds are independent.
Budget decisions list every applicable policy, the blocking policy, optional override, incomplete-
usage state, estimated proposed amount, currency, action, and reason. Overrides are explicit,
reasoned, expiring audit records; they do not mutate usage, cost, or the triggering event.

Alerts and budget events use deduplication keys. Acknowledgement and resolution are lifecycle facts,
not deletion. Conservative incomplete-data policies may pause or block new runs according to their
configured action, but must explain the missing evidence that caused the decision.

## Privacy and bounded storage

`storePromptContent` is a schema literal `false`. Analytics may persist bounded IDs, counts,
durations, categories, statuses, rate metadata, outcome links, and short error classifications. It
must not persist prompt text, assistant content, file contents, command stdout/stderr, tool payloads,
credentials, authorization headers, secret environment values, unrestricted provider responses, or
verification logs.

Large evidence remains in its owning subsystem and is referenced by stable identifiers. Analytics
orchestration events are reference-sized. Metadata keys and strings are bounded by the contract.

## Retention, export, and recovery

Detail, aggregates, and generated exports have separate retention settings. Detail deletion removes
eligible usage/tool detail transactionally, updates deleted counts, and marks surviving aggregates
`sourceDetailDeleted`. Aggregate retention may be disabled with a null period. Export retention
removes managed export artifacts and their eligible operation detail without widening deletion to
arbitrary paths.

CSV and JSON exports persist their exact filter, schema and metric versions, canonical metric
definitions, status, managed relative path, row and byte counts, and failure category. Paths are
resolved beneath the analytics-managed export root;
never accept absolute paths, traversal, or links out of that root.

At startup, running export and retention operations that cannot be proven complete are marked
interrupted with preserved diagnostics. Finalized usage without a cost is retried idempotently, and
terminal agent runs missing usage or performance finalization are backfilled without rerunning an
agent. A recovered failed run remains `unknown` when its original runtime error class is unavailable.
Recovery never infers success from a partial file or watermark, and aggregate rebuild remains an
explicit deterministic operation.

The local SQLite database is authoritative for analytics history. A consistent database snapshot
plus managed export files is the backup boundary. After restore, rebuild invalid or missing derived
aggregates from retained detail; when detail has expired, keep the aggregate marked as source-detail
deleted instead of claiming full auditability.

## Presentation boundary

`AnalyticsWorkspace` consumes `AnalyticsWorkspaceSnapshot` through typed props. The settings route
adapts the active environment's query and live subscription into loading, failure, or ready props;
the presentation components do not perform data access. They do not calculate authoritative metrics,
do not sum cost categories or currencies, and render
unavailable/disabled/unknown/partial/insufficient states explicitly. Tables use captions and scoped
headers. Ratio graphics are small static SVGs with text alternatives; there is no chart dependency,
polling loop, or continuous animation.
