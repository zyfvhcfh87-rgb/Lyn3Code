# Controlled delivery architecture

Controlled delivery is an event-sourced workflow over existing mission, verification, Git, GitHub, routing, and analytics seams. It does not create a second scheduler, verification authority, repository model, or provider session system. Its job is to project the evidence required for a delivery decision, record human intent, plan consequential operations, and reconcile receipts from adapters.

## Terms and authority

Merge, release, deploy, and rollback are separate domain operations:

| Operation | Result                                                     | Authority                                           |
| --------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Merge     | The approved source is integrated into a target branch     | Git and the configured repository integration       |
| Release   | An immutable source identity and artifact set are recorded | Delivery event log plus artifact metadata           |
| Deploy    | A release is applied to one environment                    | The configured deployment adapter and its receipts  |
| Rollback  | A recorded recovery target is applied to one environment   | The rollback plan, adapter, and validation receipts |

Verification remains the authority for check evidence. Git remains the authority for repository identity and refs. External deployment systems remain the authority for their running state. Delivery projections summarize those facts but must not silently overwrite them.

## Snapshot and presentation boundary

Clients consume a `DeliveryWorkspaceSnapshot` through the existing typed RPC/client-runtime boundary. The snapshot contains policy, readiness assessments, approval requests and decisions, merge executions, release configuration and plans, artifacts, environments, deployment plans and executions, validation runs, rollback plans and executions, audit history, and metrics.

Presentation components are snapshot-driven. They do not poll, query repositories, call providers, or infer authorization. User intent returns through explicit action callbacks; command handling, policy checks, persistence, queueing, and receipts remain server responsibilities.

The UI must render loading, unavailable, empty, and ready states, plus every consequential reverse or degraded state: stale assessments, rejected or expired approvals, source changes, pending or failed checks, freezes, disconnected providers, validation failures, partial reversibility, and unavailable or running rollbacks.

## Source-bound readiness

A readiness assessment is valid only for its recorded project, mission when applicable, target, source ref and commit, policy, and evidence fingerprint. A head or policy change invalidates the old conclusion. Diagnostic evidence can explain a problem but cannot substitute for the configured delivery profile.

Evidence entries are immutable observations. Projections may supersede an assessment with a newer one, but must retain the older assessment and the reason it ceased to authorize execution.

## Approvals

Human approval is required by default for merge, release, deployment, and rollback. Approval requests bind to the exact operation and source, release, plan, target environment, or rollback target they authorize. Decisions record the actor, timestamp, disposition, and reason. Expiry, rejection, supersession, or a bound-input change returns the operation to a non-authorized state.

The request/decision history is append-only. Updating a projection must never rewrite an earlier decision. Confirmation and reason affordances in clients are safeguards for expressing intent; the server still validates policy and current state when it accepts a command.

## Planning and execution

Plans are inspectable values, not side effects. A release plan identifies the immutable source and expected artifacts. A deployment plan identifies the release, environment, adapter, arguments, timeouts, validation profile, reversibility, and rollback posture. A rollback plan identifies its recovery target and the evidence required to consider recovery successful.

The client never submits a composed release or deployment plan through the proposal path. It submits bounded operator choices. The server captures the project source, loads the full verification record behind current summary evidence, requires a passing non-invalidated `full_profile` run for the exact commit and source fingerprint, gathers durable mission/task/pull-request records, snapshots public configuration, and computes the plan digest before persistence. Existing low-level save RPCs remain lifecycle/persistence seams; user-facing first-time authoring uses the server-owned proposal RPCs.

Executions run through queue-backed reactors and emit typed receipts. Commands and adapter calls must carry stable operation and idempotency identities. Duplicate delivery must be prevented at the server/adaptor boundary, not by disabling a button alone.

The **repository-script adapter is the only initial adapter that performs a real deployment**. It executes a repository-controlled script with validated literal configuration. Provider records without a real adapter are descriptive or unavailable; the server must not pretend they are executable.

## Secret boundary

Delivery events and projections store secret references, never secret values. Adapters resolve references at execution time through the environment's secret mechanism. Resolved values must not enter events, receipts, audit entries, exported snapshots, logs, errors, approval reasons, or client payloads. Error normalization must redact adapter output before persistence.

## Restart recovery and reconciliation

Events are the durable record; projections are rebuildable. On startup, interrupted queued or running operations are recovered through the same reactor/reconciliation seams used elsewhere in orchestration. A missing receipt is not success. The operation remains interrupted or reconciliation-required until the adapter's observable state and new receipts establish an outcome.

Retry and resume are distinct when the adapter supports them. An idempotent retry may reuse an operation identity; a new attempt records a new attempt identity while preserving lineage. Recovery must not manufacture an approval, advance a stage from a stale assessment, or infer successful validation from successful deployment.

## Scope and limitations

The initial UI is a compact presentation workspace for the web/desktop client surface. It consumes shared contracts so another client can implement the same states, but it does not by itself add mobile navigation or controls.

External state can drift between assessment and execution. Partial reversibility is a first-class deployment property. Rollback can be unavailable, can fail, and requires its own validation. These states remain visible in projections and audit history rather than collapsing into a single success flag.
