# Controlled delivery operations

This runbook covers preparing, executing, recovering, and auditing controlled delivery. Treat merge, release, deploy, and rollback as four separate operations with separate approvals and evidence.

## Before any operation

Confirm all of the following against the current delivery snapshot:

1. The project, mission when present, target branch, source ref, and commit are the intended values.
2. The readiness assessment is current for that exact source and policy.
3. Required checks completed successfully. Pending checks are not success.
4. No delivery freeze blocks the operation.
5. The required approval exists, is accepted, is unexpired, and binds to the current operation inputs.
6. The provider or repository-script adapter is connected and available.
7. The release artifacts, target environment, validation profile, reversibility, and rollback posture are understood.
8. Secret references resolve in the target environment. Do not paste secret values into configuration, reasons, logs, or chat.

A warning can be accepted with an explicit reason when policy permits. A blocker cannot be bypassed through the client.

## Merge

Review the exact source and target, request approval, and execute the recorded merge plan. After execution, verify the resulting target ref rather than treating an accepted command as proof. A source-head change invalidates the earlier assessment and approval; assess and approve again.

## Release

Create a release plan from the merged, immutable source identity. Review expected artifacts and provenance before approval. After execution, verify artifact identities and checksums recorded by receipts. Releasing does not deploy or change an environment.

## Deploy

The repository-script adapter is the only initial real deployment adapter. Before approval, inspect its repository-controlled script, literal arguments, timeout, target environment, validation profile, and secret references. Confirm whether the plan is fully reversible, partially reversible, or irreversible.

Approve and confirm the exact deployment plan with a reason. Follow receipts through completion, then run the recorded validation. A successful script exit without successful validation is not a healthy deployment.

If the provider disconnects, the process restarts, or receipts stop, do not immediately rerun the script. Reconcile the external environment and recorded operation identity first to avoid a duplicate deployment.

## Validation failure

When post-deployment validation fails:

1. Preserve the deployment and validation receipts and their timestamps.
2. Stop further promotion of that release.
3. Determine whether the failure is in the release, environment, validation probe, or provider connection.
4. Review the recorded rollback posture and a safe recovery target.
5. Request and record a separate rollback approval when rollback is appropriate.

Do not mark the deployment successful solely because the adapter completed. Do not claim recovery until the rollback execution and its validation both produce evidence.

## Rollback

Rollback is an explicit delivery operation, not a UI undo. Review the target release, affected environment, reversibility limits, migration or data-loss risk, adapter availability, and required validation. Approval binds to that exact rollback plan.

If rollback is unavailable, freeze further changes and use the environment's documented manual recovery procedure. Record resulting evidence back in the delivery history when supported. If rollback is already running, reconcile that operation rather than starting another.

For partially reversible changes, call out the parts that require manual repair or cannot be restored. A successful rollback script does not by itself establish that data and service health are restored.

## Restart recovery

After a Lyn Code or host restart:

1. Open the delivery workspace and identify interrupted, running, or reconciliation-required operations.
2. Compare the last durable receipt with the adapter's observable state.
3. Confirm the operation identity, source or release, environment, and attempt number.
4. Resume only when the adapter supports resume. Retry only when idempotency and current external state make it safe.
5. Re-run validation when execution state is known.
6. Record the recovery decision and reason.

Never convert a missing receipt into success. Never create a replacement approval on behalf of a human.

## Secret exposure

Delivery state must contain references only. If a secret value appears in logs, errors, receipts, audit history, exported state, or the client:

1. Stop the affected operation and restrict access to the artifact.
2. Rotate or revoke the exposed secret in its owning secret store.
3. Preserve redacted diagnostic evidence.
4. Remove exposed values through the repository's incident and retention procedures; do not rewrite event history casually.
5. Fix adapter redaction before another execution.

## Audit and known limits

Record the source fingerprint, assessment, evidence, approval decision and reason, plan, execution and adapter receipts, validation, and any rollback as one traceable history. Provider-side observations can drift, so capture the verification time and source of each fact.

Repository scripts are currently the only real deployment adapter. Some providers and environments can be represented but not executed. Some operations are only partially reversible, and rollback may be unavailable. Keep those limits visible in plans, approvals, and incident notes.
