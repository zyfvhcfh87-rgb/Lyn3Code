# Mission architecture

> For maintainers. Using missions? See [the user guide](../user/missions.md).

Phases 2 and 3 extend the Phase 1 mission aggregate inside the existing event-sourced orchestration
engine. Commands, the append-only event store, transactional projections, provider sessions, Effect
RPC WebSocket transport, and the shared client runtime remain the source of truth. Git lifecycle,
scheduling, and verification are reactors around that aggregate, not separate mission systems.

## Domain model

```text
Project
|-- Verification settings -> accepted repository configuration digest
|-- Verification profiles -> ordered gates and executable checks
`-- Mission
    |-- Team settings
    |-- Mission agents -> provider instance + model + role permissions
    |-- Tasks
    |   |-- Dependencies
    |   |-- Managed task worktree
    |   |-- Agent runs -> linked threads
    |   |-- Structured handoffs
    |   `-- Verification runs -> checks, logs, diagnostics, artifacts, repair attempts
    |-- Managed integration worktree
    `-- Orchestration events
```

The provider-neutral schemas and transition helpers live in
[`packages/contracts/src/mission.ts`](../../packages/contracts/src/mission.ts). Commands, events,
and snapshots live in
[`packages/contracts/src/orchestration.ts`](../../packages/contracts/src/orchestration.ts).

A mission run links exactly one provider-backed thread. Phase 1 runs keep their original nullable
agent/worktree fields and single-run behavior. Phase 2 write runs require an assigned mission agent,
task, and ready managed worktree. The run records the effective permissions and whether it is write
capable, so concurrency decisions are durable and auditable.

## Persistence and migration

Migration 036 owns the Phase 1 mission, task, and run projections. Migration 037 adds:

- five provider-neutral built-in roles;
- `projection_agent_roles` and `projection_mission_agents`;
- `projection_task_dependencies` with cycle-safe transactional insertion;
- `projection_managed_worktrees`;
- `projection_agent_handoffs`;
- mission team/scheduler settings and task/run Phase 2 columns.

Migration 038 adds Phase 3 verification settings, accepted profile/gate/check snapshots, runs,
individual check runs, diagnostics, artifacts, repair attempts, and explicit overrides. It also adds
the verification task state and agent-run purpose needed to distinguish implementation from bounded
verification repair. The migration upgrades Phase 2 databases in place and preserves historical
rows; clean-database and 037-to-038 paths share the same result.

The Phase 1 one-active-run-per-mission index is replaced. Partial indexes allow parallel runs while
enforcing one active write run per worktree. Paths and active worktree ownership are unique, foreign
keys retain mission/task relationships, and no provider secrets or Git credentials are persisted.

Projection repositories are under
[`apps/server/src/persistence`](../../apps/server/src/persistence). Mission detail snapshots load the
mission, tasks, all active and historical runs, roles, agents, dependencies, worktrees, and handoffs
in one read transaction so clients never assemble a mixed-version graph.

## Scheduler and concurrency

[`MissionScheduler.ts`](../../apps/server/src/orchestration/MissionScheduler.ts) is a pure,
provider-neutral planner. It sorts tasks deterministically and evaluates dependency completion,
required handoffs, agent/model availability, worktree state, mission/write/agent/provider capacity,
and one-writer ownership. It returns explicit selected, ready, blocked, and capacity-limited reasons.

[`MissionSchedulerReactor.ts`](../../apps/server/src/orchestration/Layers/MissionSchedulerReactor.ts)
persists ready/blocked and concurrency-limited decisions through orchestration commands. Automatic
starts happen only after explicit scheduler/event triggers when `autoStartReadyTasks` is enabled.
Startup recovery recomputes readiness but deliberately passes `allowStarts: false`, so a restart
cannot silently relaunch write agents.

Read-only roles receive `approval-required`; write-capable roles receive `auto-accept-edits` and must
have their own managed worktree. The decider enforces mission-wide, writer, per-agent, task, and
worktree limits again at command time, preventing stale scheduler/UI decisions from racing.

## Managed Git lifecycle

[`MissionGitService.ts`](../../apps/server/src/mission-git/MissionGitService.ts) is the safety boundary
for repository inspection, branch/worktree creation, status reconciliation, conflict preflight,
integration, abort, and removal. All Git tests use temporary repositories.

The preferred graph is:

```text
project base branch
`-- mission integration branch + worktree
    |-- task branch + worktree
    `-- task branch + worktree
```

The service validates Git availability, repository identity, refs, in-progress operations, canonical
path containment, branch/path uniqueness, and worktree overlap. It never stashes or discards the
main worktree, uses force removal, deletes unmerged branches, or integrates into the default branch.

[`MissionWorktreeReactor.ts`](../../apps/server/src/orchestration/Layers/MissionWorktreeReactor.ts)
creates the integration worktree followed by missing write-task worktrees, records every lifecycle
transition through commands, and re-inspects managed paths after restart and relevant events.
External removal, branch mismatch, dirty state, conflicts, and completed integration are projected
honestly. Dirty, active, conflicted, or unintegrated worktrees fail closed during removal.

Manual integration is the default. Approval starts a merge inside the mission integration worktree
in dependency order. Clean, already-integrated, conflicted, failed, and aborted outcomes each append
typed events. A conflict retains Git's merge state and conflicting files until the user explicitly
aborts or resolves it.

## Provider execution and handoffs

[`MissionRunReactor.ts`](../../apps/server/src/orchestration/Layers/MissionRunReactor.ts) resolves the
assigned worktree and branch into `thread.create`, making the worktree the provider execution root.
The prompt contains only the mission objective, selected task, role and effective permissions,
assigned path, predecessor handoff summaries, safety limits, and completion requirements. It does
not copy the entire originating conversation.

Completed, failed, cancelled, and interrupted mission runs emit a structured `AgentHandoff`, then a
reconciliation event. The current provider-neutral completion stream does not expose a trustworthy
machine-readable model handoff, so the server records a conservative outcome summary and treats Git
status as authoritative for changed paths. The schema leaves decisions, commands, artifacts, and
unresolved problems available for richer adapters later without storing secrets.

The durable provider association is the run's `threadId` plus `providerInstanceId`. When an adapter
returns a stable provider-native session identifier, the provider-neutral session contract carries
it into the run's nullable `providerSessionId` for traceability. Adapters leave the field unset
rather than guessing when no safe identifier is available.

Cancellation records intent first. The active run moves to `cancelling`, then queues the existing
thread interrupt and session-stop commands in that order. The provider command worker serializes
those intents behind any in-flight session startup. Only a projected `stopped` or `interrupted`
session produces `agent_run.cancelled`, `task.cancelled`, and `mission.cancelled`; a session error
produces failure events instead. Interruption uses its own terminal events and cannot be projected
as completion.

Mission failure is isolated to the affected task; independent siblings remain running or
eligible. Legacy single-agent failures retain Phase 1 mission-failed behavior. A completed task
that does not require verification becomes integration-ready. When verification is required, agent
completion records implementation completion and the task remains in the verification state until a
current required profile passes or an explicit current-source override is applied. The mission
completes only after all tasks are complete and no sibling run remains active.

## Automated verification

Phase 3 architecture, configuration, evidence, and security details live in
[verification.md](./verification.md). The short lifecycle is:

```text
implementation handoff
        |
        v
task verification state -> immutable plan -> checks in assigned worktree
        |                                      |
        |                                      +-> logs, diagnostics, artifacts
        v
current required pass or explicit override -> integration ready
```

`VerificationOrchestrationReactor` consumes the existing mission events. It handles automatic and
manual requests, persists accepted configuration snapshots and immutable plans, delegates commands
to the focused verification engine, records provider-neutral progress, launches bounded repair runs
through the existing `MissionRunReactor`, cascades cancellation, revalidates source state, and marks
lost active runs interrupted on restart. It never emits normal orchestration events for every log
line; durable log resources are paged through a dedicated query path.

`MissionWorktreeReactor` remains the integration authority. Immediately before a task merge, it
captures the actual managed-worktree fingerprint and requires a passing or passing-with-warnings run
of the configured pre-integration profile for that exact state. Stale passes are invalidated and do
not authorize integration. Overrides remain separately visible, reasoned audit records and do not
alter verification history.

Mission-linked threads are retained as durable run history. `thread.delete` rejects them; archiving
remains available and does not remove managed Git state.

## Cancellation and restart recovery

Startup recovery queries active agent runs in deterministic creation order. A provider-native
session identifier alone is not a safe cross-process resume capability, so Phase 1 does not attempt
automatic resume. The server dispatches `mission.agent-run.interrupt` exactly once for each active
run.

Task cancellation emits a task-scoped request and interrupts only the matching active run. Mission
cancellation atomically appends the mission request, cancellation requests for all active runs,
queued-task cancellation, and terminal mission cancellation. This stops future scheduler selection
immediately while provider shutdown finishes asynchronously. Worktrees and branches are untouched.

At reactor startup, every still-active agent run receives one deterministic interruption command and
a handoff. Tasks become blocked for explicit retry while unrelated work is preserved; legacy
single-agent missions keep the Phase 1 recovery-blocked transition. Active verification runs become
`interrupted` with their partial evidence retained and no fabricated result. Worktree recovery
independently compares persisted records with actual Git registration and status. Neither reactor
resumes write agents or repair agents.

## Client surfaces

Mission and verification commands and live reduction are shared through
[`packages/client-runtime`](../../packages/client-runtime). The web mission route is the Electron
renderer for the desktop team editor, accessible dependency graph, active-agent timeline, structured
handoffs, worktree safety cards, verification evidence/history, and dependency-ordered integration
queue. Mobile and remote verification-specific presentation remains a later multi-surface follow-up;
the provider-neutral server contracts continue to work over the existing remote WebSocket transport.

## Focused verification

Relevant proof lives in:

- migration, repository, restart, dependency-cycle, and one-writer tests under
  `apps/server/src/persistence`;
- temporary-repository Git and worktree reactor tests under `apps/server/src/mission-git` and
  `apps/server/src/orchestration/Layers`;
- pure scheduler and mission lifecycle integration tests under `apps/server/src/orchestration`;
- configuration/planner/process/evidence tests under `apps/server/src/verification`;
- shared runtime and mission component tests under `packages/client-runtime` and `apps/web`.

Phase 3 deliberately excludes GitHub/PR check publishing, pushing branches, default-branch merging,
deployment verification, production monitoring, semantic memory, model-routing intelligence, and
usage dashboards.
