# Mission architecture

> For maintainers. Using missions? See [the user guide](../user/missions.md).

Phase 1 adds a mission aggregate to the existing event-sourced orchestration engine. It reuses the
same commands, append-only event store, projection transaction, provider sessions, Effect RPC
WebSocket, and client connection runtime as threads. There is no second API or conversation-backed
mission database.

## Domain model

The ownership hierarchy is:

```text
Project
`-- Mission
    |-- MissionTask
    |-- AgentRun
    `-- OrchestrationEvent
```

A mission references the existing `OrchestrationProject`. A run references one mission, an optional
task, one T3 thread, and one configured provider instance. The thread is the provider conversation;
it is linked execution history, not the mission source of truth.

The provider-neutral schemas and transition helpers live in
[`packages/contracts/src/mission.ts`](../../packages/contracts/src/mission.ts). Mission command,
event, stream, and detail snapshot schemas live beside the existing orchestration contracts in
[`packages/contracts/src/orchestration.ts`](../../packages/contracts/src/orchestration.ts).

### Statuses

Mission statuses are `backlog`, `planning`, `ready`, `running`, `verification`, `review`, `blocked`,
`completed`, `cancelled`, and `failed`.

Task statuses are `backlog`, `ready`, `running`, `blocked`, `completed`, `cancelled`, and `failed`.
Agent-run statuses are `starting`, `running`, `cancelling`, `completed`, `cancelled`, `failed`, and
`interrupted`.

Terminal run transitions are one-way. Repeating a terminal transition, completing a cancelled run,
or cancelling a completed run is rejected before events are appended.

## Commands and events

Client-dispatchable mission commands are:

- `mission.create` and `mission.update`;
- `mission.task.create` and `mission.task.update`;
- `mission.start`, `mission.retry`, and `mission.cancel`.

Provider lifecycle integration uses server-only commands:

- `mission.agent-run.mark-running`;
- `mission.agent-run.complete`;
- `mission.agent-run.fail`;
- `mission.agent-run.cancel`;
- `mission.agent-run.interrupt`.

The decider emits provider-neutral events. Important families are `mission.*`, `task.*`, and
`agent_run.*`; payloads contain mission identifiers and normalized lifecycle data rather than raw
provider protocol responses. See [`decider.ts`](../../apps/server/src/orchestration/decider.ts) and
[`projector.ts`](../../apps/server/src/orchestration/projector.ts).

As with thread commands, the orchestration engine serializes commands, checks durable command
receipts, appends all planned events and projection mutations in one SQL transaction, and publishes
events only after commit. A lifecycle command that emits several events therefore cannot expose a
half-updated mission.

## Persistence

Migration 036 adds three read-model tables:

- `projection_missions`;
- `projection_mission_tasks`;
- `projection_agent_runs`.

The authoritative history remains the append-only `orchestration_events` table. Projection rows
store current state for efficient board, recovery, and detail queries. The projection repositories
are under [`apps/server/src/persistence/Services`](../../apps/server/src/persistence/Services) with
their SQLite layers under [`apps/server/src/persistence/Layers`](../../apps/server/src/persistence/Layers).

Database constraints reinforce the domain model:

- mission, task, and run statuses have `CHECK` constraints;
- project, mission, and task relationships use foreign keys;
- a composite foreign key prevents a run from referencing a task owned by another mission;
- a partial unique index permits at most one `starting`, `running`, or `cancelling` run per mission;
- project/status/time, mission/position, run/status, thread, and event-stream lookups are indexed.

Event sequence is the stable ordering key. Timestamps describe when work happened but do not replace
sequence ordering.

## Provider execution and cancellation

Starting or retrying creates one `AgentRun` and one linked thread, then uses the existing provider
instance, model selection, session directory, and command reactor to start the turn. The provider
adapter remains selected at the existing provider boundary; mission code does not branch on Codex,
Claude, Cursor, Grok, or OpenCode response shapes.

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

## Restart recovery

Startup recovery queries active agent runs in deterministic creation order. A provider-native
session identifier alone is not a safe cross-process resume capability, so Phase 1 does not attempt
automatic resume. The server dispatches `mission.agent-run.interrupt` exactly once for each active
run.

The interruption transition:

1. marks the run `interrupted` with a reason;
2. moves a running task to `blocked`;
3. moves the mission to `blocked`;
4. appends `agent_run.interrupted` and `mission.recovery-blocked` history;
5. leaves `mission.retry` available to create a new run and thread.

Recovery never synthesizes a successful completion. Terminal-state guards and command receipts
make repeated recovery or late provider results harmless.

## Live reads

Mission clients use two streams on the existing authenticated RPC socket:

- `orchestration.subscribeMissions` sends a project-filtered board snapshot and mission summary
  updates;
- `orchestration.subscribeMission` sends a detail snapshot followed by ordered mission events.

Both support an `afterSequence` cursor and an optional synchronization marker. On reconnect, the
shared client runtime refreshes from a server snapshot and then resumes the stream. React consumes
that environment-scoped state; it does not maintain a second authoritative mission store.

## Focused verification

Run the Phase 1 domain and persistence coverage with:

```powershell
.\node_modules\.bin\vp.cmd test run apps/server/src/orchestration/missionLifecycle.integration.test.ts apps/server/src/persistence/Migrations/036_MissionFoundation.test.ts apps/server/src/persistence/Layers/MissionProjectionRepositories.test.ts
```

These tests cover lifecycle ordering, duplicate and late terminal rejection, cancellation, provider
failure and retry, deterministic interruption recovery, clean and incremental migrations, active-run
race protection, and file-backed restart persistence.

Phase 1 deliberately excludes parallel agents, worktree management, GitHub automation, semantic
memory, automatic model routing, analytics dashboards, and automatic verification or merge flows.
