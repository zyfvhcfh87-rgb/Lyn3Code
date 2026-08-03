# Phase 4: GitHub engineering workspace

## Architectural decisions

- Extend the existing source-control boundary. GitHub-specific API and synchronization code stays
  behind a provider-facing engineering-workspace service; React and mission reactors never invoke
  `gh`, GitHub APIs, or remote Git directly.
- Use the authenticated GitHub CLI session as the first secure account flow. The CLI owns its
  credential and OS-keyring integration. Lyn Code stores account identity, scopes, status, and host,
  but never copies the access token into SQLite, events, prompts, worktrees, or client payloads.
- Local projects, missions, tasks, agent runs, managed worktrees, and verification records remain
  authoritative for harness activity. GitHub remains authoritative for repository metadata,
  issues, pull requests, reviews, threads, branches, and remote checks.
- Add migration 039 for GitHub cache records, local links, sync cursors, rate-limit state, and
  remote-branch observations. Cached remote rows are replaceable observations; local links are
  transactional durable state.
- Keep orchestration events reference-sized. A single validated internal recording command may
  produce the required `github.*` event types, carrying record identifiers and bounded summaries,
  never bodies, diffs, logs, or credentials.
- Build mission-aware push and PR workflows over Phase 2 managed worktrees and Phase 3 source
  fingerprints. Pushes are explicit, non-force, default-branch-blocked, divergence-checked, and
  confirmed against the remote before success is recorded.
- Keep local verification and GitHub checks separate. A local pass is current only for its exact
  fingerprint; a remote check is current only for the pull request's current head SHA.
- Web is the complete workspace UI and therefore also covers the desktop renderer. Shared
  contracts/client runtime remain remote-capable. Mobile receives the transport/runtime contract
  but not a new mission workspace in this phase because the current app has no Phase 1-3 mission UI.

## Implementation slices

1. Contracts and persistence
   - GitHub account, repository connection, issue, PR, review, thread/comment, check, link, cursor,
     rate-limit, branch observation, workspace snapshot, paging, mutation, and error schemas.
   - Migration 039, repository services, uniqueness/foreign-key constraints, Phase-3 upgrade and
     restart-safe cursor tests.
2. Authentication, API, and synchronization
   - Canonical GitHub/GHES remote parser.
   - Credential-free `gh api` client with schema decoding, pagination, conditional requests,
     bounded output, typed auth/permission/rate-limit/offline errors, and redaction.
   - Account discovery/validation, repository connection validation, partial resource sync, cached
     reads, stale markers, bounded retry, and coarse background refresh.
3. Mission and review workflows
   - Issue-to-mission and existing-mission link flows through orchestration commands.
   - Review-comment-to-task links through the mission aggregate.
   - Managed-branch push preflight/confirmation, draft PR creation/update/ready flow, verification
     evidence body generation, and merge-readiness interpretation without merge automation.
4. Transport and UI
   - Typed RPC/query/mutation/subscription surface with read/write authorization split.
   - Shared client-runtime atoms and one project-scoped GitHub workspace for overview, issues, PRs,
     branches, checks, reviews, and synchronization.
   - Mission linkage panels, connection settings, permission-aware actions, cached/offline/stale and
     rate-limit states, paged/lazy detail loading, and existing diff primitives.
5. Resilience, regression proof, and documentation
   - Focused migration, parser, client, pagination, cache, rate-limit, redaction, sync, workflow,
     push-safety, divergence, PR-body, evidence, restart, client-state, and UI tests.
   - Reconcile user/internals/glossary documentation and retain the Phase 5 exclusions.

## Validation gates

- Focused tests after every slice; no real repository mutations.
- Final typecheck, lint, requested repository tests, and production build.
- Browser/computer-use validation only after explicit permission, as required by the repository.
- Diff audit for credentials, force-push/merge automation, Phase 5 scope, and accidental inclusion
  of the pre-existing uncommitted Phase 3 work in any commit.
