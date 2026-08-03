# Project memory operations

This runbook covers persistent project memory migration, indexing recovery, privacy controls, and derived-index repair. Memory uses the existing local SQLite store and orchestration recovery path.

## Startup and migration

Migration 040 creates the durable memory projection, lifecycle and audit tables, indexed-source tables, and FTS5 indexes. It migrates an existing Phase 4 database in place and preserves all project, mission, task, verification, worktree, and GitHub records.

Before upgrading a real installation, take a consistent SQLite snapshot. Never start a development server against the live user-data directory. Copy a snapshot into an isolated T3 home and validate the migration there first.

On startup, verify that:

- migration 040 completed without a foreign-key failure;
- FTS5 tables and triggers exist;
- running or queued indexing operations were marked interrupted;
- retrieval remains lexical when no embedding provider is configured;
- projects with memory disabled do not perform retrieval.

An interrupted migration is not repaired by deleting memory tables. Restore the pre-upgrade snapshot, preserve the failure diagnostics, and fix or retry the migration in an isolated copy.

## Indexing safely

Indexing must receive a validated project or mission-worktree root. The resolved Git top level must remain inside that root. Do not widen the root to compensate for a path error.

The default classifier excludes `.git`, dependencies, build output, caches, generated bundles, minified files, binaries, media, large lockfiles, credential stores, private keys, environment-value files, and configured project exclusions. Secret detection runs before content persistence and embedding.

Use changed-file refresh for normal operation. It consumes Git status and diff information, fingerprints affected files, marks deleted sources removed, and reuses unchanged chunks. Use full safe reindex only when exclusions, chunking rules, or source fingerprints changed globally.

A branch or worktree refresh creates branch-qualified source identities. Identical fingerprints may reuse chunks, but source metadata remains branch-specific. Never merge branch indexes merely because paths match.

## Recovery

At startup, indexing operations left queued or running are marked interrupted. Recovery may then rerun them from source. Replacing an indexed source's chunks is transactional and idempotent, so a restart cannot append duplicate chunks.

If an index is stale or partially failed:

1. Inspect failed paths and skip reasons.
2. Confirm the repository root, branch, commit, exclusions, and file-size limit.
3. Correct the source or configuration problem.
4. Refresh changed files.
5. Request a full safe reindex only if incremental repair cannot restore consistency.

Clearing the derived index removes repository maps, indexed sources, chunks, and embeddings. It does not remove accepted memory entries, sources, lifecycle history, proposals, or retrieval audits.

## Secret or privacy incident

If secret-like content appears in an index, proposal, log, citation, retrieval package, or embedding request:

1. Disable memory retrieval and pause indexing for the project.
2. Disable the embedding provider, especially a remote provider.
3. Rotate the exposed credential using its owning system.
4. Preserve only redacted diagnostics needed for investigation.
5. Clear and rebuild the derived index after fixing the exclusion or detector.
6. Mark affected memories stale or supersede them; do not erase lifecycle history as incident cleanup.

Remote embeddings require explicit configuration, provider identity, a description of transmitted content, and recorded user acceptance. A provider or model change invalidates incompatible vectors and schedules incremental re-embedding. A model or dimension mismatch fails closed to lexical retrieval.

## Diagnostics

The most useful records are:

- index-operation status and per-source failure summaries;
- indexed source path, branch, commit, fingerprint, skip reason, and last index time;
- memory sources and source freshness;
- lifecycle records for stale, disputed, superseded, rejected, and archived entries;
- retrieval audits with scope, mode, selected identifiers, token estimate, exclusions, and error summary;
- reference-sized orchestration events for correlation with mission and run history.

Do not add raw chunks, full excerpts, secret values, vectors, or provider prompts to orchestration events or logs.

When retrieval is unavailable, verify settings and FTS health before investigating semantic configuration. Lexical mode is the supported fallback and should remain usable with no network access or embedding provider.

## Backup, export, and restore

The SQLite snapshot is the authoritative backup for local memory history. Memory export is useful for review and controlled transfer, but imports apply an explicit conflict policy: skip, create proposals, or import inactive. They do not silently replace trusted entries.

After restore, verify a representative active entry, its sources and lifecycle, one accepted and one rejected proposal, index status, and a retrieval audit. Then run a changed-file refresh so source fingerprints reflect the restored worktree.
