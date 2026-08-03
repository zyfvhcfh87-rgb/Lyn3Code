# GitHub integration architecture

> For maintainers. For the product workflow, see
> [GitHub workspace](../user/github-workspace.md).

Phase 4 is an external integration over the existing project, mission, managed-worktree,
verification, event-store, projection, and WebSocket systems. It is not a second scheduler and does
not make cached GitHub data authoritative for local orchestration.

## Authority boundaries

| State                                                 | Authority             | Local representation                                                |
| ----------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| Projects, missions, tasks, agent runs, handoffs       | Lyn Code              | Existing mission aggregate and projections                          |
| Local branches, commits, worktrees, dirty state       | Local Git             | Existing managed-worktree services plus bounded branch observations |
| Verification profiles, fingerprints, runs, artifacts  | Lyn Code verification | Existing Phase 3 projections                                        |
| Repository metadata, issues, pull requests, reviews   | GitHub                | Restart-safe bounded cache                                          |
| Remote branches, Actions, check runs, commit statuses | GitHub                | Head-SHA-scoped observations                                        |

A local link joins the two authorities; it does not transfer ownership. Remote refreshes never delete
mission history, and local mission transitions never silently edit GitHub resources.

## Layers and transport

The implementation has four focused boundaries:

1. Contracts define credential-free entities, link types, cache freshness, rate limits, branch
   observations, normalized checks, bounded queries, mutation inputs, and append-only event payloads.
2. The GitHub API client normalizes GitHub REST and GraphQL responses behind typed operations. It
   delegates authentication to GitHub CLI, paginates explicitly, supports conditional requests,
   classifies retryable failures, and redacts remote error bodies.
3. The workspace service owns account and repository connection, cached synchronization, cursors,
   rate-limit observations, and workspace subscriptions. The workflow service composes those records
   with the existing mission, worktree, Git, and verification services for local links and remote
   mutations.
4. Typed WebSocket RPC methods expose queries, mutations, and a project-scoped workspace stream to
   the web client. UI components never invoke `gh`, Git, or GitHub APIs directly.

GitHub is the only Phase 4 hosting implementation. Future hosting providers should add sibling
adapters and provider-specific caches behind equivalent contracts rather than putting provider calls
in mission orchestration or UI components.

## Authentication and credential boundary

The supported account path validates an existing GitHub CLI login for `github.com` or a configured
GitHub Enterprise Server host. The CLI owns credential acquisition and OS-backed storage where the
platform supports it. Lyn Code never asks `gh auth token` for the secret and never persists an
authorization header.

API request bodies are passed to `gh api` on stdin. Credential-bearing headers are rejected before a
process starts. Server URLs must be credential-free HTTPS origins, and repository URLs are normalized
without userinfo, query strings, or fragments. Logged errors contain bounded classifications and
operation context, not access tokens or raw remote response bodies.

The application database stores only account identity, scopes, authentication type, status, and
validation timestamps. A Lyn Code disconnect is a local state transition; credential revocation
remains a GitHub or GitHub CLI operation.

Repository permissions are normalized into read, push, triage, maintain, and administration
capabilities. Read operations remain available when push permission is absent. Every mutation checks
the current connection capability again at the workflow boundary.

## Persistence and migration

Migration 039 extends an existing Phase 3 database with normalized tables for:

- GitHub accounts and one repository connection per project;
- issues and issue-to-mission links;
- pull requests and mission-to-pull-request links;
- reviews, review threads, comments, and review-comment-to-task links;
- normalized check runs and commit statuses;
- pull request commits and bounded changed-file records;
- synchronization cursors, rate-limit observations, and branch observations.

Remote IDs are unique within their repository or pull request scope. Link creation is transactional,
and foreign keys preserve project and mission ownership. Page writes validate that every record
belongs to the target repository before committing; a mixed page rolls back as a unit. No account
table has token, secret, or credential columns.

Cached remote rows are replaceable observations. Local link rows and orchestration events are durable
history. Closing or deleting a remote pull request does not cascade into deletion of a local mission.

## Synchronization and freshness

Initial and manual refreshes synchronize repository metadata, issues, pull request summaries, and
remote branches. Pull request detail is loaded on demand and includes commits, files, reviews, review
threads and comments, check runs, commit statuses, required-check names, and review decision.

Collection follows every page. Sync cursors record the last attempted and successful state, optional
ETag and last-modified validators, page cursor, and bounded error summary. `304 Not Modified` is a
successful observation and does not decode an empty response. One resource failure does not delete
another resource's cache.

The server starts background refresh after a short initial delay and refreshes active account
connections periodically while it remains alive. A restart reopens the persisted cache and cursors;
an interrupted page set is safe to restart because remote-identity uniqueness and transactional page
writes prevent duplicate links.

Freshness is explicit: never synchronized, current, stale, offline, partial, or failed. Last attempt
and last success are separate. Cached records remain queryable during network, authentication,
permission, or rate-limit failures and must be labelled whenever they are not a current authoritative
observation.

The API client performs bounded retry only for transient responses. Authentication, permission, and
secondary-rate-limit errors do not enter aggressive retry loops. Primary and secondary rate-limit
metadata includes remaining allowance, reset time, and the delayed operation.

Webhooks are not required. The local product remains functional with polling, refresh-on-demand, and
workspace subscriptions; no unauthenticated public webhook endpoint is introduced.

## Workflow invariants

### Issue to mission

Issue context is bounded and explicitly marked as untrusted before entering a mission description.
The workflow refuses a duplicate mission when the issue already has a clear link. Linking is local
and never changes the remote issue.

### Safe push

Push composes the Phase 2 managed worktree and Phase 3 verification services with a narrow Git safety
service. It requires the expected branch and head, an active mission-owned worktree, current required
verification, a clean worktree, a bounded credential scan, a non-default destination, and a remote
ancestry state that is neither behind nor diverged. It uses a normal upstream push and then confirms
the remote head. There is no force flag or remote rewrite path.

### Pull request creation

Creation requires a confirmed remote head equal to the reviewed local head. The body is derived from
bounded mission, task, handoff, changed-area, and Phase 3 evidence. Secret-category scanning runs over
the generated or overridden body. Closing syntax is opt-in. GitHub must return a pull request with the
expected head SHA before the cache and mission link are committed.

### Review tasks and resolution

Review comments remain structured records grouped into threads. A linked task uses the existing
mission task command path. Thread resolution requires explicit confirmation, at least one completed
linked task, current verification for every linked task, a fresh current PR head, an active managed
worktree for that head, and a confirmed equal remote branch. The remote mutation must succeed before
the local thread and links transition to resolved.

## Local verification and remote checks

Local verification authorization is based on the exact Phase 3 source fingerprint and accepted
profile. GitHub checks are normalized observations keyed by repository and head SHA. They never
authorize one another.

Merge-readiness calculation considers required GitHub checks only when their head SHA equals the
current pull request head. A new head makes older check results stale. Required-check names observed
from branch protection remain pending until a matching current-head record arrives. Reviews,
unresolved threads, mergeability, and branch-behind state are reported as separate blockers.

Phase 4 reports readiness only. It does not merge, approve, dismiss reviews, override checks, enable
auto-merge, delete branches, or select a squash/rebase strategy.

## Events and recovery

GitHub workflow events use the existing append-only orchestration engine. Payloads contain validated
IDs, issue or pull request numbers, head SHAs, and bounded summaries. Issue bodies, diffs, review
histories, tokens, and logs remain referenced from projection records instead of being copied into
events.

Remote failures do not roll back completed local mission work or remove managed worktrees. Restart
recovery reconstructs the GitHub workspace from projection rows, then refreshes remote authority when
available. Local-only projects do not instantiate a repository connection and retain their existing
Phase 1-3 behavior.

## Scope boundaries

This architecture intentionally excludes autonomous merging, automatic issue closing or editing,
automatic branch deletion, deployment automation, repository administration, webhook exposure,
semantic memory, learned routing, and non-GitHub hosting providers.

The current resilience and workflow coverage map is maintained in the
[GitHub integration runbook](../operations/github-integration.md#scenario-coverage-matrix).
