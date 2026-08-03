# Missions

Missions organize a larger engineering outcome around a project, a list of tasks, and the agent
runs that perform the work. They live alongside normal Lyn Code conversations; creating a mission
does not change or remove existing threads.

## Open the mission board

Open **Missions** from the sidebar or command palette. The board shows missions for the connected
environment and can be filtered by project.

The main columns are:

| Status       | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| Backlog      | The mission has been captured but is not being prepared yet. |
| Planning     | The outcome or task list is being refined.                   |
| Ready        | The mission can start or continue.                           |
| Running      | One agent run is active.                                     |
| Verification | The result is being checked.                                 |
| Review       | The result is ready for human review.                        |
| Blocked      | The mission needs attention before it can continue.          |
| Completed    | All mission work is complete.                                |

Failed and cancelled missions are kept in a separate section instead of disappearing. Their task,
run, and activity history remains available.

## Create a mission

Every mission belongs to a project. If the environment has no projects yet, select **Add project**
first. Then:

1. Select **New mission**.
2. Choose the project that owns the workspace.
3. Enter the outcome as the title and add any useful context in the description.
4. Open the mission and add one or more concrete tasks.

**Start mission** selects the first actionable task in display order. You can also select **Run
task** to run a specific actionable task. Phase 1 starts one task and one agent run at a time.

## Run and follow a mission

Select **Start mission** from the mission workspace. Lyn Code creates a normal provider-backed
conversation for the run and supplies the mission and selected task as its context. The linked
conversation remains available through the existing chat interface.

The mission workspace shows three separate views of progress:

- the current mission and task status;
- provider run state, including the linked conversation;
- the chronological event timeline.

Updates arrive live. After a reload, the client requests a fresh server snapshot. After a reconnect,
it resumes from the last received event sequence when possible and otherwise requests a fresh
snapshot. Both paths reconstruct the board and mission workspace from persisted server state.

When a task finishes successfully, the next unfinished task leaves the mission ready to continue.
Completing the last task completes the mission. A provider failure marks the run, selected task, and
mission as failed without removing earlier events. Use **Retry** to create a new run while keeping
the failed run in history.

## Cancel safely

Cancellation is a request before it is a result. After you select **Cancel**, the active run first
shows that cancellation is in progress. The mission becomes cancelled only after Lyn Code confirms
that the provider session stopped. Cancellation is never reported as successful completion.

A completed or already-cancelled run cannot be cancelled again. A late provider completion cannot
replace a newer terminal state.

## Server restarts

Projects, missions, tasks, runs, and their activity history are stored by the environment's Lyn Code
server and survive an application or server restart.

If the server stops while a mission run is active, Lyn Code does not assume that the work completed.
When the provider session cannot be resumed safely, the run is marked **Interrupted**, the mission
and active task become **Blocked**, and a recovery event explains what happened. You can inspect the
linked conversation and retry with a new run.

## Phase 1 limits

Mission execution is intentionally small in this release:

- one agent run is active for a mission at a time;
- tasks are not executed in parallel;
- missions do not create Git worktrees or pull requests;
- verification, review, and blocked states are supported, but no automatic verification pipeline
  runs behind them;
- provider routing uses the same configured providers and models as normal Lyn Code conversations.

Normal conversations continue to work independently of missions.
