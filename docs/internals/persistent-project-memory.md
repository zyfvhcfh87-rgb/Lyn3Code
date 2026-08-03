# Persistent project memory

Persistent project memory gives an agent a small, evidence-bearing context package without treating a raw conversation transcript as durable truth. It extends the existing project, mission, task, run, Git/worktree, verification, GitHub, event, and projection systems. It does not introduce a second orchestration model.

## Architecture

The memory path is deliberately layered:

1. The SQLite projection stores durable entries, sources, relations, proposals, index metadata, lifecycle records, settings, and retrieval audits.
2. The repository indexer scans a validated Git root, classifies safe text files, fingerprints content, and stores bounded structural chunks.
3. Retrieval combines SQLite full-text matches with scope, trust, freshness, and recency signals. A configured embedding provider may add semantic candidates, but lexical retrieval remains complete on its own.
4. The context assembler resolves the current project, worktree branch, mission, task, and run, then renders a bounded package as quoted, untrusted evidence.
5. The orchestration event stream records reference-sized lifecycle facts. Entries, chunks, source excerpts, and embeddings remain in their dedicated tables.

Migration `040_PersistentProjectMemory` adds the normalized tables and FTS5 indexes. Foreign keys bind project, mission, task, run, and verification references to existing Phase 1–4 projections. Historical entries are retained when a source disappears, a proposal is rejected, or an entry is superseded.

## Scope, trust, and lifecycle

Supported scopes are user, project, branch, mission, and task. Retrieval proximity is task, mission, branch, project, then user. A matching branch rule therefore ranks ahead of a project convention, while a project convention ranks ahead of a generic user preference. Other branches, missions, tasks, and projects are filtered before ranking.

Every entry carries a trust level: authoritative, verified, supported, inferred, unverified, or disputed. Trust describes the strength of the claim, not permission to act. Automatic authoritative entries are restricted to deterministic repository facts and still retain fingerprints.

Entries move through proposed, active, stale, superseded, disputed, rejected, and archived states. Transitions are validated and recorded in an append-only lifecycle table. Supersession rejects cycles. Contradictory relations place both eligible entries in a shared dispute group; a branch-specific exception is not automatically a contradiction with a project-wide default.

Normal retrieval selects active entries. Stale entries follow the project's exclude, demote, or include-and-label policy. Rejected, superseded, disputed, and archived entries remain queryable in the workspace but are excluded from normal agent context.

## Provenance and citations

An active entry must have at least one resolvable source record. Sources may point to repository files, commits and diffs, project instructions, documentation, user instructions, mission events, handoffs, verification results, synchronized GitHub records, or an explicit manual entry.

Repository citations retain the relative path, real line range, commit and branch when known, and the fingerprint observed when the claim was verified. Other sources retain their durable Phase 1–4 identifier. Retrieval packages expose only the citation fields an agent needs; database bookkeeping is omitted.

Source fingerprints power staleness checks. A changed fingerprint, missing indexed path, expired entry, invalidated verification, or changed synchronized record marks a memory stale instead of deleting it. Unresolvable sources are labeled unresolved and are never presented as source-backed facts.

## Repository indexing

The indexer validates the Git top level and refuses paths outside it. It respects Git-tracked and untracked state, `.gitignore`, project exclusions, file-size limits, and symlink or junction boundaries. Secret-bearing paths, dependency trees, generated output, caches, binaries, media, and minified or oversized content are skipped before content is stored.

Full indexing fingerprints safe files and writes chunks transactionally. Changed-file refresh uses Git status and diffs to process additions, modifications, renames, and removals without rereading unchanged content. Identical fingerprints can reuse chunks across worktrees. Branch and commit remain part of indexed-source identity so temporary branch decisions do not leak into another branch.

Chunking preserves stable citations: Markdown headings, code symbols or logical blocks, structured configuration sections, and test groupings are preferred. Arbitrary overlapping windows are avoided. A generated repository map is itself indexed with provenance and inferred trust.

Interrupted operations are marked interrupted during recovery and may be retried safely. Chunk replacement is idempotent, so restart recovery does not duplicate content. Clearing the derived index removes indexed sources, chunks, vectors, and repository maps; it does not delete trusted memory history.

## Retrieval and context assembly

SQLite FTS5 searches memory titles and content plus indexed chunk content, symbols, and paths. User input is converted to an operator-free query so it cannot inject FTS syntax. Phrase, prefix, symbol, and path lookup continue to work when semantic retrieval is unavailable.

Hybrid ranking considers query relevance, scope proximity, trust, source authority, branch applicability, recency, source freshness, and explicit pinning. Duplicate claims and chunks are collapsed by normalized claim or content fingerprints. The configured token budget is a hard upper bound; the assembler prefers a few close-scope, high-trust, source-backed items and records how many candidates were excluded.

Each retrieval writes an audit containing the effective query, scope, mode, selected entry and chunk identifiers, token estimate, concise ranking metadata, status, and failure summary. The audit links to the run, thread, and message when available. It intentionally stores identifiers rather than copied source excerpts.

The rendered provider section is visibly delimited as untrusted memory context. It cannot replace the current task, system instructions, role permissions, verification requirements, Git policy, or GitHub mutation policy. Text found in memory is evidence, never an executable command.

## Semantic retrieval and privacy

Semantic retrieval is off by default. The embedding boundary records provider identity, local or remote kind, model, version-relevant identifier, vector dimensions, and whether content leaves the machine. Dimension and model mismatches fail closed and lexical search continues.

A remote provider requires explicit enablement and recorded acceptance of the disclosure describing what will be sent. No provider configuration means no upload. Secret detection and redaction happen before storage, logging, proposal extraction, retrieval, or embedding. Environment-variable names may be indexed when useful, but values, tokens, passwords, private keys, authorization headers, and credential databases may not.

## Proposals and correction

Agents produce proposals, not trusted entries. A proposal contains a concise reusable claim, suggested scope/type/trust, confidence, extraction origin, and supporting source references. Mission extraction uses structured handoffs, diffs, verification results, and user decisions rather than coordinator prose alone.

Reviewers may accept, edit and accept, merge, reject, mark duplicate, or defer. Only accepted entries participate in normal retrieval. Agents may flag stale or incorrect context and propose a correction, but cannot silently rewrite a trusted entry. The replacement is linked through supersession so historical missions continue to explain what they knew at the time.
