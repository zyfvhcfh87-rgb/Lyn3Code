# Glossary

> For maintainers. Using Lyn Code? See [docs/user](../user/).

This is a living glossary for Lyn Code. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Missions](#missions)
- [Verification](#verification)
- [Analytics](#analytics)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Checkpointing](#checkpointing)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

### Missions

#### Mission

A durable engineering outcome owned by a project. A mission has current status plus related tasks,
agent runs, and an append-only event history. A linked provider conversation performs the work but
does not replace mission state. See [missions.md][25].

#### Mission task

An ordered unit of work inside a mission. A task may depend on other tasks, be assigned to a mission
agent and managed worktree, and retain several run attempts. See [missions.md][25].

#### Mission agent

A mission-scoped provider/model slot with one role, an effective capability set, status, and
concurrency limit. It is configuration, not a running process; each attempt is an agent run.

#### Agent role

A provider-neutral role template such as coordinator, implementer, researcher, reviewer, or
verifier. Roles supply conservative default capabilities that a mission agent may customize.

#### Task dependency

A directed edge from one mission task to a prerequisite task. The dependency graph must remain
acyclic. Readiness can additionally require the prerequisite's structured handoff.

#### Managed worktree

A Git worktree and branch recorded as mission-owned state. A managed worktree is either the mission
integration target or the isolated execution root for one write task. Safe removal validates the
recorded identity and refuses active, dirty, conflicted, or unintegrated work.

#### Agent run

One attempt by one configured provider instance to execute a mission or task. It links the mission
to a T3 thread and provider session while keeping lifecycle state provider-neutral. Team runs record
the assigned mission agent, worktree, attempt number, purpose, and effective capabilities.
Retrying creates a new run instead of rewriting the earlier attempt. See [missions.md][25].

#### Agent handoff

A persisted, structured outcome from one task run. It carries a summary, decisions, changed files,
commands, unresolved problems, artifacts, and next action. Git reconciliation corrects changed-file
claims before dependent tasks consume it.

#### Mission integration branch

The controlled branch and worktree that receives approved task branches in dependency order. It is
separate from the project's default branch; Phase 2 never pushes or merges it into the default branch.

### Verification

#### Verification configuration

The versioned repository-local `t3.json` section that declares profiles, gates, checks, changed-file
applicability, timeouts, diagnostics, and artifacts. Its normalized digest must be explicitly accepted
before execution, and a changed digest requires fresh acceptance. See [verification.md][26].

#### Verification profile

A reusable ordered collection of verification gates, selected for manual, task-completion,
pre-integration, or post-integration use. Profiles can reuse parent profiles but cannot form cycles.

#### Verification gate

One logical category inside a profile, such as typecheck, lint, test, build, or security. A gate records
whether it is required, how its checks may run, and whether failure blocks, warns, or is informational.

#### Verification check definition

The accepted configuration for one executable check. It includes an argument-based command, validated
working directory, environment references, timeout, allowed exit codes, continuation policy,
applicability patterns, diagnostics parser, and artifact rules. It is not itself evidence that a
command ran.

#### Verification plan

The immutable execution snapshot persisted before a run starts. It records the accepted configuration
revision, source identity, changed files, safe environment summary, selected gates/checks, and explicit
reasons for every selection or skip. Execution never silently reloads or alters this plan.

#### Source fingerprint

The identity of the exact Git state verified in one managed worktree: branch, commit, and when dirty, a
deterministic fingerprint of tracked and relevant untracked changes. A later state cannot reuse the old
authorization merely because its branch name is unchanged.

#### Verification run

One durable attempt to execute one profile against one source fingerprint. It owns check-run records and
references to logs, diagnostics, artifacts, repair attempts, timestamps, failure classification, and
final result. A rerun creates new history rather than mutating the earlier run.

#### Verification check run

The evidence for one planned command: exact command and arguments, working directory, selection reason,
status, duration, exit code or signal, timeout flag, failure category, durable log reference, diagnostics,
and artifacts.

#### Verification override

An explicit, reasoned user authorization for integrating one task source fingerprint despite missing or
failed required verification. It is append-only audit evidence, remains separate from a pass, and becomes
stale when the source fingerprint changes.

#### Verification repair attempt

A bounded agent run that receives focused failing evidence and writes only in the same task worktree. It
retains the original task scope and cannot integrate branches or erase the failed run it is trying to
repair.

### Analytics

#### Analytics metric version

The immutable catalogue version that defines a metric's numerator, denominator, inclusions, and
exclusions. Aggregates and exports retain this version so a future semantic change cannot silently
rewrite historical comparisons. See [analytics.md][27].

#### Cost provenance

The evidence category behind a monetary amount: provider reported, pricing-calculated,
subscription-allocated, local-compute estimate, or unknown. Provenance and currency remain separate;
unlike categories and currencies are not implicitly summed. See [analytics.md][27].

#### Analytics data quality

The explicit coverage record accompanying analytics: provider-reported, estimated, unknown, priced,
unpriced, stale-pricing, incomplete-outcome, pending-human-disposition, and deleted-source-detail
counts. Missing evidence is not represented as zero. See [analytics.md][27].

#### Analytics recommendation

A non-binding, evidence-labelled observation with a task segment, sample, period, metric keys,
uncertainty, estimated-cost state, and policy-conflict state. It cannot change routing, permissions,
verification, source, Git, or GitHub state. See [analytics.md][27].

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when the session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project`,
`thread`, or `mission`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects,
threads, missions, tasks, agent runs, messages, activities, checkpoints, and session state. See
[ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

#### Receipt

A typed signal emitted when an async milestone completes, such as `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, or `turn.processing.quiesced`. Receipts are a test-only mechanism: the production `RuntimeReceiptBusLive` publish is a no-op and only the test layer is PubSub-backed. Do not build production behavior on them. See [RuntimeReceiptBus.ts][13] and [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable: follow-up work such as [CheckpointReactor.ts][6] has settled. It appears in [the receipt schema][13], so in practice it is something tests wait on rather than a production signal.

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [providers.md][16].

#### Provider

The backend agent runtime that actually performs work. Five drivers ship built in: Codex, Claude, Cursor, Grok, and OpenCode. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access mode for a thread or session. [The contracts][1] define four values: `approval-required`, `auto-accept-edits`, `auto`, and `full-access`. See [permission modes][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the values are `default` and `plan`.

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal, for tests".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [Architecture overview][24]
- [Provider architecture][16]
- [Permission modes][18]
- [Workspace layout][2]
- [Mission architecture][25]
- [Automated verification architecture][26]

[1]: ../../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../../apps/server/src/vcs/GitVcsDriverCore.ts
[4]: ../../apps/server/src/orchestration/projector.ts
[5]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../../apps/server/src/orchestration/decider.ts
[9]: ../../apps/server/src/orchestration/commandInvariants.ts
[10]: ../../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./providers.md
[17]: ../../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ../user/permission-modes.md
[19]: ../../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../../apps/server/src/checkpointing/Utils.ts
[23]: ../../apps/server/src/checkpointing/Diffs.ts
[24]: ./overview.md
[25]: ./missions.md
[26]: ./verification.md
[27]: ./analytics.md
