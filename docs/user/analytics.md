# Analytics

Analytics explains how missions, tasks, agent runs, verification outcomes, usage, and cost relate to
one another. Open **Settings → Analytics** to review the current environment's overview, data
quality, cost sources, comparisons, forecasts, budgets, alerts, recommendations, exports, and
retention history.

Analytics is evidence for decisions, not a billing statement. Unknown, estimated, stale, disabled,
and insufficient-sample states stay visible. Lyn Code does not replace missing values with zero.

## Managing analytics

Use **Edit settings** to change retention, reporting currency, outcome observation, comparison sample,
forecast, and collection-detail settings. Disabling collection requires confirmation. Existing
retained records remain visible after collection is disabled, and you can enable collection again
from the same page.

The page also lets you:

- create and edit budget policies, acknowledge budget events, and create reasoned temporary
  overrides with an expiry and an explicit fallback choice;
- add effective-dated, user-configured pricing snapshots for a configured provider and model;
- add immutable subscription accounting rules with an explicit plan amount or internal rate;
- add effective-dated manual exchange rates for labelled reporting-currency conversions;
- acknowledge active analytics alerts without erasing their history;
- add or edit scoped annotations that explain external context without changing measurements;
- create CSV or JSON exports for the current analytics filter;
- rebuild aggregates for all data or one explicit scope;
- run a confirmed retention operation for detail older than a chosen cutoff.

Retention permanently removes eligible detail, so check the displayed project scope and cutoff
before confirming. Export and retention requests show durable running, completed, failed, or
interrupted state in operation history.

## Reading cost

Cost is always shown by currency and provenance:

- **Provider reported** is an amount returned by the provider.
- **Calculated estimate** applies a recorded price snapshot or configured rate to usage.
- **Subscription allocation** is an accounting estimate produced only from an explicit period-bound
  rule; it is not an additional provider invoice. The default is no monetary attribution. Flat
  monthly modes wait until the period is closed and the complete allocation basis is available.
  Changing the global attribution mode recalculates saved rules. **Rebuild aggregates** also
  re-evaluates closed periods; it changes only the current accounting view and keeps prior allocation
  revisions for audit.
- **Local compute estimate** applies the configured local hourly rate; it is not a measured utility
  bill.
- **Unknown cost records** have insufficient evidence for a monetary amount.

These categories are not added together. Different currencies are never added. When a direct,
effective manual rate exists, Lyn Code shows a separate labelled reporting-currency row tied to that
snapshot. It never fetches rates automatically, infers an inverse rate, or rewrites the original
amount.

## Metric catalogue v1

Metric meanings are versioned. Version 1 uses these exact definitions:

| Metric                                | Definition                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation cost per verified task | Implementation-agent cost attributed to tasks that passed required verification, divided by the number of those verified tasks.                                                                                                                  |
| Inclusive cost per verified task      | Implementation, repair-agent, reviewer, and fallback-agent cost attributed to tasks that passed required verification, divided by the number of those verified tasks. Verification command runtime is reported separately and is not model cost. |
| Cost per merged mission               | Attributable agent cost for missions recorded as pull-request merged, divided by the number of those merged missions.                                                                                                                            |
| First-pass verification rate          | Tasks that passed required verification after the first implementation attempt, divided by tasks that reached required verification.                                                                                                             |
| Repair rate                           | Tasks that required at least one repair-agent run, divided by tasks that reached required verification.                                                                                                                                          |
| Human acceptance rate                 | Tasks marked `accepted` or `accepted_with_edits`, divided by tasks with an explicit human disposition. `unknown` and `not_reviewed` are excluded from both numerator and denominator.                                                            |
| Provider failure rate                 | Finalized runs whose completion category is `failed_provider`, divided by all finalized runs.                                                                                                                                                    |
| Fallback rate per started run         | Started runs with at least one fallback, divided by all started runs.                                                                                                                                                                            |

When a denominator is zero or the necessary outcome is missing, the result is **Unknown**, not 0%.
Rows below the configured minimum comparison sample are labelled **Insufficient sample**.

## Forecasts and recommendations

Every forecast shows its method, observation window, completeness, confidence, uncertainty, and
whether estimated cost is included. A forecast without enough evidence is withheld with a reason.
Forecasts do not promise a provider bill or future outcome.

Recommendations are non-binding observations. Each one includes its evidence, task segment, sample
size, period, uncertainty, affected metrics, estimated-cost status, and policy-conflict status. A
recommendation never changes routing, providers, reasoning, permissions, budgets, verification,
source code, branches, or GitHub state automatically.

## Budgets and alerts

A budget may watch money, tokens, requests, or a combination. Soft and hard thresholds have separate
actions such as notify, require approval, pause new runs, or block new runs. A disabled policy is
shown as disabled; it is not treated as an unlimited or zero budget. Policies can be configured to
act conservatively when usage is incomplete.

Budget events and alerts are durable records. Acknowledgement does not erase the event or change the
underlying measurement. Overrides are explicit, reasoned, scoped, and expiring; they do not rewrite
historical usage or cost.

## Data quality

The data-quality view reports provider-reported, estimated, unknown, priced, unpriced, stale-pricing,
incomplete-outcome, pending-human-review, and source-detail-deleted counts. Use these counts before
comparing providers, models, or reasoning levels. A high missing-data or estimated-cost ratio can explain
an apparently strong result.

Current provider coverage is deliberately conservative:

| Provider | Normalized usage                             | Provider-reported total cost                              |
| -------- | -------------------------------------------- | --------------------------------------------------------- |
| Codex    | Token snapshots when the provider emits them | Not currently normalized                                  |
| Claude   | Token snapshots when the provider emits them | Available when Claude supplies `total_cost_usd`           |
| Cursor   | Streamed output may be context-estimated     | Unknown                                                   |
| Grok     | Streamed output may be context-estimated     | Unknown                                                   |
| OpenCode | Streamed output may be context-estimated     | Unknown; native metadata exists but is not yet normalized |

Provider and CLI versions can change what is reported. The live data-quality counts, source labels,
and confidence are the authority for a particular record.

## Privacy, retention, and export

Analytics v1 never stores prompt content. It records bounded identifiers, counts, token dimensions,
durations, tool categories and names, statuses, outcome links, pricing provenance, and operational
metadata. It does not use analytics as permission to store prompts, file contents, command output,
provider credentials, or secrets.

Detail, aggregate, and export retention are separate settings. When detail expires, retained
aggregates are marked as having deleted source detail. That mark matters: an aggregate may remain
useful for a trend while no longer supporting a record-by-record audit.

CSV and JSON exports capture schema and metric versions, canonical metric definitions, provenance,
confidence, attribution, currency, and pricing references. Export files live in the managed analytics
area and expire according to export retention. Treat exports as sensitive operational data and move
them only to an approved location.

## Restart and recovery

Recorded usage, outcomes, cost provenance, budgets, alerts, and completed aggregates survive a
restart. An export or retention operation that was still running cannot be proven complete after
restart, so it is marked interrupted honestly. Finalized usage missing its derived cost is retried
idempotently; Lyn Code does not fabricate completion or silently rewrite an old attempt.
