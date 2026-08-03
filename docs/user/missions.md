# Missions

Missions organize a larger engineering outcome into dependent tasks performed by a controlled team
of agents. They live alongside normal Lyn Code conversations; mission work does not change or remove
your ordinary threads.

## Open the mission board

Open **Missions** from the sidebar or command palette. The board shows missions for the connected
environment and can be filtered by project. Open a mission to see its task graph, team, active runs,
worktrees, handoffs, integration queue, and event history.

## Configure the team

A mission can use coordinator, implementer, researcher, reviewer, verifier, or custom agent slots.
Each slot selects a configured provider and model, has its own concurrency limit, and lists the
capabilities that a run receives.

The default roles are conservative:

- coordinators plan and manage tasks without writing code by default;
- implementers may edit their assigned worktree;
- researchers and reviewers are read-only by default;
- verifiers may inspect files and run tests without editing them by default.

You can change the mission-wide limits for total agents, write-capable agents, attempts per task,
and automatic starts. New missions default to at most three concurrent agents and two concurrent
writers. A configured model is required before a task can run.

## Build the task graph

Create tasks, assign each task to an agent slot, and draw dependencies in the task graph. Lyn Code
rejects dependency cycles before saving them.

A task becomes ready only when its dependencies succeeded, required predecessor handoffs exist,
its assigned agent is available, and its managed worktree is ready. A failed dependency blocks its
dependents instead of allowing them to run early. Independent ready tasks can run together within
the configured concurrency limits.

## Worktrees and branches

Write-capable tasks receive separate managed Git branches and worktrees. Their agent conversations
run with the assigned worktree as the execution root; two writers are never assigned to the same
worktree at the same time. Read-only agents can inspect an assigned worktree concurrently.

The worktree panel shows the recorded path and branch, current Git state, changed-file count,
uncommitted changes, conflicts, active agent, and whether safe removal is currently allowed. Copy or
open a path from that panel when you need to inspect it outside Lyn Code.

Lyn Code never automatically stashes or discards changes in your main working tree. Cancelling a
task or mission preserves its branches, worktrees, commits, and uncommitted files. Dirty or
unintegrated worktrees cannot be removed through the normal safe-removal action.

## Runs, retries, and handoffs

Every task attempt is retained as a separate agent run with its provider, linked conversation,
worktree, status, and event timeline. A failed or interrupted task can be retried until its configured
attempt limit is reached. Retrying keeps earlier runs and uses the same worktree when it is still
safe.

Completed, failed, cancelled, and interrupted runs produce a structured handoff. It records
the outcome, unresolved problems, recommended next action, and changed files. Changed-file claims
are checked against the assigned worktree's actual Git state before downstream tasks consume them.

Mission-run conversations are durable mission history. They can be archived, but Lyn Code prevents
deleting them from the normal thread controls.

## Verify an implementation

Projects can define reusable verification profiles in `t3.json`. A profile contains ordered gates
such as typechecking, linting, tests, or builds. Every check uses an explicit executable plus literal
arguments, working directory, timeout, accepted exit codes, applicability rules, and optional
artifact rules. Lyn Code shows the discovered configuration before it can be accepted. If that
configuration changes later, it must be reviewed and accepted again before its commands can run.

Project verification settings choose the default and pre-integration profiles, whether completed
implementation tasks start verification automatically, and whether bounded repair attempts are
allowed. Inferred package-script suggestions are always shown as untrusted suggestions; Lyn Code
does not silently turn them into accepted commands.

Each run records the assigned worktree, branch, exact commit or dirty-state fingerprint, changed
files, environment summary, immutable execution plan, timestamps, and final result. Open a run to
see why every check ran or was skipped, live stdout and stderr, parsed diagnostics, durable logs,
collected artifacts, and earlier attempts. Required blocking gates must pass. A required check cannot
quietly disappear because a heuristic thought it was irrelevant.

When a command times out, is cancelled, cannot start, or loses its server process, the run says so
instead of reporting a source-code failure or success. Cancelling stops the active verification
process and prevents later checks from starting while preserving partial evidence. After a server
restart, formerly active runs become interrupted and can be rerun; Lyn Code never fabricates a
completion.

Verification remains tied to the recorded source fingerprint. A later commit, dirty-file change, or
relevant untracked file invalidates the old authorization. A fresh passing run restores readiness.
Manual overrides require an explicit reason and remain visibly separate from passed verification.

Automatic repair is off by default and is limited to two attempts unless project settings choose a
different bound. A repair agent works in the same task worktree from a focused failure package. Each
failed run, repair handoff, and rerun stays in history, and no additional repair starts after the
configured limit.

## Integrate completed work

Each mission uses a separate integration branch and worktree. Implementation tasks that require
verification enter a distinct verification state before they can become integration ready. Task
branches enter the integration queue in dependency order, and integration requires explicit approval
by default.

The integration queue distinguishes missing, queued, running, failed, interrupted, invalidated,
passed-with-warnings, passed, and explicitly overridden verification. Normal integration is blocked
unless the required profile passed for the task's current source fingerprint or a current explicit
override exists.

If a clean merge succeeds, the task and worktree become integrated. If Git reports conflicts, Lyn
Code records the conflicting files, blocks dependent integration, and leaves the merge recoverable.
You can abort the in-progress integration and resolve or retry deliberately. Lyn Code does not guess
conflict resolutions, force-push, or merge the mission integration branch into your default branch.

## Cancel safely

Cancelling one task requests cancellation only for its active run. Unrelated tasks continue according
to the scheduler and dependency policy.

Cancelling the mission immediately stops new scheduling, requests cancellation for every active run,
and marks queued work cancelled. Provider shutdown may continue briefly while those runs show as
cancelling. All Git work remains preserved.

## Server restarts and external changes

Mission, team, dependency, run, worktree, handoff, integration, and verification state is stored by
the environment's Lyn Code server. After a restart, Lyn Code re-inspects registered worktrees, marks
formerly active agent and verification runs interrupted, and recomputes task readiness. It does not
automatically relaunch write agents.

If a worktree was removed or changed outside Lyn Code, its panel reports the actual orphaned, dirty,
conflicted, or integrated state instead of trusting stale database state. Inspect the preserved branch
and choose an explicit recovery action.

## Current boundaries

- The Phase 2 mission cockpit is supported in the Lyn Code desktop app. Its web components are the
  Electron renderer implementation, not a separate hosted-product commitment.
- Worktree creation is automatic. If creation fails, the affected task is blocked with the failure
  reason. Use **Retry task** to run safe worktree reconciliation and provisioning again.
- Role capabilities shape runtime access where providers support it and are reinforced by isolated
  execution roots. They are not an operating-system sandbox against a malicious local process.
- Lyn Code does not push branches, publish pull-request checks, or merge the mission integration
  branch into your default branch. Repository-host integration belongs to a later phase.
