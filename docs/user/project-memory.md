# Project memory

Project memory helps new agent sessions pick up durable project knowledge without replaying entire conversations. It keeps concise claims such as architecture decisions, conventions, known issues, failed approaches, test procedures, and user preferences together with the evidence behind them.

Memory is context, not authority to take actions. It cannot grant permissions, change verification rules, execute commands, or override your current request.

## Memory scopes

Choose the narrowest scope that describes where a memory is true:

- **User** applies as a general preference across projects.
- **Project** applies throughout one project.
- **Branch** applies only on a named branch or worktree.
- **Mission** applies to one mission.
- **Task** applies to one task.

Closer scopes are preferred during retrieval. A branch exception can outrank a project convention on that branch without changing the project-wide rule.

## Trust and status

Every memory shows both trust and status. Trust tells you how strongly the claim is supported: authoritative, verified, supported, inferred, unverified, or disputed. Status tells you where it is in its lifecycle: proposed, active, stale, superseded, disputed, rejected, or archived.

An inferred interpretation is never presented as an authoritative repository fact. Source-backed entries show their path or linked record, line range when available, branch or commit, and last verification state.

Stale does not mean deleted. It means the supporting file or record changed, disappeared, expired, or was invalidated. Superseded memories also remain visible so older missions can be understood accurately.

## The memory workspace

Open a project's Memory area to browse active memories, proposals, architecture decisions, conventions, known issues, failed approaches, repository index status, conflicts, stale items, retrieval history, and settings.

Use filters for scope, type, status, trust, source, branch, mission, task, date, and staleness. Open an entry to inspect all supporting sources, lifecycle changes, related entries, conflicts, retrieval use, and the reason it became stale.

Available actions depend on the entry's state. You can edit, pin, change scope, mark stale, supersede, restore, archive, add a source, or export. Historical knowledge does not have a casual permanent-delete action.

## Saving and reviewing memory

Use quick actions such as **Save as project memory**, **Save as branch decision**, **Save as failed approach**, or **Save as known issue**. The chosen scope is always shown before saving.

Agents can propose reusable knowledge after a handoff or completed mission. A proposal stays outside normal agent retrieval until it is reviewed. The review queue shows the claim, suggested scope, type, trust, confidence, evidence, likely duplicates, and possible contradictions.

You can accept, edit and accept, merge with an existing memory, reject, mark duplicate, or defer. Bulk review does not bypass low-confidence or contradiction warnings.

When two active memories appear incompatible, the conflict view keeps both claims and their sources visible. Resolve the conflict by narrowing a scope, superseding one claim, rejecting an unsupported proposal, or retaining both when their scopes differ.

## Repository index

The repository index supplies bounded source excerpts for retrieval. Its status view shows the current branch and commit, indexed and skipped files, failures, last refresh, embedding state, index size, and exclusions.

You can refresh changed files, request a safe full reindex, pause indexing, inspect failures, manage exclusions, or clear the derived index. Clearing the derived index does not delete manually saved or reviewed memory.

Sensitive files, credentials, generated output, dependencies, binaries, media, and configured exclusions are skipped. Source files outside the validated repository root are never indexed.

## Why an agent received a rule

Each agent run has a Memory view showing its query, selected memories and source excerpts, trust labels, citations, token estimate, and concise selection reasons. This answers why a rule applied and whether it came from lexical matching, semantic matching, explicit pinning, or close scope.

The package is limited by the project's context budget. Relevant, trusted, close-scope items are prioritized; unrelated and duplicate material is left out.

## Privacy and settings

Lexical search works locally without an embedding provider. Semantic retrieval is optional and never turns on silently. A remote embedding provider requires an explicit choice and a visible disclosure of what content is sent. Turning semantic retrieval off immediately returns the project to lexical-only search.

Project settings control whether memory is enabled, automatic proposal generation, deterministic repository-fact indexing, exclusions, maximum file size, context budget, stale-memory behavior, proposal retention, and semantic retrieval. Disabling project memory stops context retrieval without deleting the project's history.

Memory can be exported for review or backup and imported with an explicit conflict policy. Import does not silently overwrite an existing trusted claim.
