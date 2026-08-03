# Phase 5: Persistent, source-backed project memory

## Architecture decisions

- Add one provider-neutral memory contract shared by server and clients. Trusted entry and proposal
  lifecycle changes are durable and auditable; repository indexes, chunks, embeddings, and ranking
  material are rebuildable derived data with reference-sized events.
- Model user memory as environment-local scope rather than attaching it to an arbitrary project.
  Project, branch, mission, and task scopes retain explicit project ownership and are revalidated
  transactionally against existing mission/task projections.
- Keep raw chat separate. Retrieval augments provider turn input at the central provider-command
  boundary without rewriting the persisted user message. Memory is labelled untrusted context and
  cannot change permissions, verification, Git/GitHub authority, or current instructions.
- Make retrieval auditing cover both missions and ordinary chat: `agentRunId` is nullable and every
  record carries `threadId` plus the turn/message reference.
- Use controlled repository enumeration and bounded canonical reads, not the ephemeral FFF content
  index, for persistent indexing. Apply exclusions and secret detection before content is stored,
  proposed, cited, logged, or embedded.
- Use SQLite FTS when supported by the shipped runtimes, with a deterministic lexical fallback.
  Semantic retrieval is an optional adapter, disabled by default, and remote code upload requires
  explicit provider/model configuration and visible disclosure.
- Preserve historical entries and provenance through source deletion, supersession, rejection,
  contradiction, branch deletion, and index rebuilds. Only derived index records may be cleared.

## Worker ownership and implementation slices

1. **Shared contracts and composition (lead)**
   - Memory entities, settings, queries, mutations, retrieval package, citations, events, RPC,
     authorization, runtime wiring, and cross-worker integration.
2. **Worker 1: domain, persistence, lifecycle**
   - Migration 040, repositories, scope/provenance validation, transitions, duplicate detection,
     supersession cycle prevention, contradictions, import/export, and restart-safe persistence.
3. **Worker 2: repository indexing and source intelligence**
   - Safe scanner, exclusions, secret redaction, structural chunking, fingerprints, incremental
     add/change/delete/rename/branch behavior, repository map, and interrupted-index recovery.
4. **Worker 3: lexical/semantic retrieval and ranking**
   - FTS/fallback lexical search, optional embedding adapter and privacy gate, structured filters,
     hybrid ranking, deduplication, citations, token budgeting, selection reasons, and audits.
5. **Worker 4: extraction and agent-context lifecycle**
   - Proposal orchestration, deterministic authoritative facts, staleness/contradiction checks,
     mission summaries, context assembly, provider-turn integration, and memory feedback.
6. **Worker 5: memory interface**
   - Project memory workspace, entry/proposal/conflict/index/retrieval views, settings, quick-save
     entry points, lifecycle actions, accessibility, and all specified unavailable/stale states.
7. **Worker 6: evaluation, resilience, and documentation**
   - Cross-layer scenario coverage, migration/restart/privacy/regression tests, user/internals/
     operations docs, and integration fixes outside active worker ownership.

## Gates

- Coordinate contracts before parallel implementation; workers own non-overlapping files.
- Run focused tests at every slice boundary, then relevant typechecks, lint, production builds, and
  Phase 1-4 regression suites. Preserve the five known Windows-only `packages/shared` baseline
  failures separately.
- Use only temporary repositories/databases for indexing, secret, branch, and restart tests.
- Browser validation is the lead's single final integrated pass; subagents do not start servers.
- Finish with a diff audit for secrets, source leakage, oversized event payloads, permission bypass,
  autonomous Git/GitHub actions, and Phase 6 scope creep.
