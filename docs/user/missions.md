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

Completed, failed, cancelled, and interrupted Phase 2 runs produce a structured handoff. It records
the outcome, unresolved problems, recommended next action, and changed files. Changed-file claims
are checked against the assigned worktree's actual Git state before downstream tasks consume them.

Mission-run conversations are durable mission history. They can be archived, but Lyn Code prevents
deleting them from the normal thread controls.

## Integrate completed work

Each mission uses a separate integration branch and worktree. Completed task branches enter the
integration queue in dependency order. Integration requires explicit approval by default.

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

Mission, team, dependency, run, worktree, handoff, and integration state is stored by the environment's
Lyn Code server. After a restart, Lyn Code re-inspects registered worktrees, marks formerly active runs
interrupted, and recomputes task readiness. It does not automatically relaunch write agents.

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
- Lyn Code does not push branches, create pull requests, run an advanced verification pipeline, or
  merge the mission integration branch into your default branch in this phase.
