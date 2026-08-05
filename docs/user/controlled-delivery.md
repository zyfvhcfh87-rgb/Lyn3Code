# Controlled delivery

Controlled delivery turns verified mission work into an explicit, reviewable path from source code to a running environment. It does not treat every successful check as permission to ship. The delivery workspace shows the current source, blockers, warnings, evidence, approval state, release plan, deployment progress, validation results, rollback options, and history together.

## The four delivery actions

These actions are related, but they are not interchangeable:

- **Merge** integrates an approved source revision into its configured target branch.
- **Release** records an immutable, named source revision and its build artifacts. A release is evidence of what may be deployed; it does not mean an environment changed.
- **Deploy** applies one release to one configured environment through a deployment adapter.
- **Rollback** is a separate, explicitly approved operation that attempts to restore an environment to a previous release or other recorded recovery target.

Completing one action never silently authorizes the next.

Release and deployment plans are proposed from the mission Delivery workspace. You choose the configured policy, release or environment options, and any optional release note context. Lyn Code then derives the plan from the current clean commit, a passing full-profile verification, recorded mission tasks and pull requests, and the selected configuration. The server rejects a proposal when that evidence is missing or stale.

## Readiness and evidence

The workspace evaluates the exact source revision selected for delivery. A head change makes an older assessment stale, even when its checks were previously green. Reassess the new source before approving or executing delivery.

Blocking conditions must be resolved before the affected action can run. Examples include required checks that are pending or failed, an active delivery freeze, a disconnected provider, an expired or rejected approval, and failed post-deployment validation. Warnings remain visible but do not automatically block execution. Each assessment links its conclusion to the evidence used to reach it.

## Human approval is the default

Merge, release, deployment, and rollback require a human approval by default. Approval requests identify the action and exact source or release they cover. Decisions may require a reason, can expire, and do not transfer to a changed head, plan, target environment, or rollback target.

Execution controls use a separate confirmation step and reason field for consequential actions. Rejecting a request is a recorded decision, not a temporary UI state.

## Deployment adapters and secrets

The only initial adapter that performs a real deployment is the **repository-script adapter**. It runs the delivery script accepted into the repository's controlled configuration with the recorded arguments, timeout, target environment, and source or release identity. Other provider records may describe environments or future integrations, but they do not imply that Lyn Code can deploy through those providers today.

Delivery configuration stores **secret references only**. Secret values must remain in the environment's secret store. They are not persisted in delivery events, shown in the workspace, included in exports, or passed through approval reasons.

## Recovery after restart

Delivery history is durable. After a server restart, Lyn Code reconstructs plans, approvals, executions, receipts, and validation results from persisted state. An operation that was running when the process stopped is not reported as completed without new evidence. It is shown as interrupted or awaiting reconciliation so a maintainer can inspect the target and explicitly retry, resume, validate, or roll back as supported.

## Important limitations

- Repository scripts are the only initial real deployment mechanism.
- A green readiness assessment applies only to the recorded source fingerprint and evidence. It is not a permanent approval.
- External infrastructure can change outside Lyn Code. Provider connectivity and post-deployment validation must be checked again at execution time.
- Some deployments are only partially reversible. The workspace calls this out before execution.
- Rollback may be unavailable when no safe prior target or rollback procedure exists. Rollback is not an automatic undo button.
- A failed validation does not prove that a rollback succeeded or that the previous release is healthy; those are separate operations with separate evidence.
