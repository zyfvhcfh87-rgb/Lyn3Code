# Automated verification architecture

> For maintainers. For the product workflow, see [Missions](../user/missions.md).

Phase 3 adds evidence-backed verification to the existing mission aggregate. It does not create a
second scheduler or trust an agent's self-report. The event store remains the audit trail, projection
tables remain the query model, the mission scheduler owns task readiness, and managed task worktrees
remain the only write roots.

## Repository configuration and trust

Verification is a versioned top-level section of the repository's `t3.json`:

```json
{
  "verification": {
    "version": 1,
    "defaultProfile": "fast",
    "preIntegrationProfile": "standard",
    "profiles": {
      "fast": {
        "triggers": ["manual", "on_task_completion"],
        "gates": [
          {
            "id": "types",
            "category": "typecheck",
            "required": true,
            "checks": [
              {
                "id": "web-types",
                "name": "Web typecheck",
                "command": {
                  "executable": "pnpm",
                  "args": ["--filter", "@t3tools/web", "run", "typecheck"]
                },
                "timeoutSeconds": 300,
                "applicability": {
                  "mode": "changed_files",
                  "include": ["apps/web/**", "packages/client-runtime/**"]
                }
              }
            ]
          }
        ]
      },
      "standard": {
        "extends": ["fast"],
        "triggers": ["before_integration"],
        "gates": [
          {
            "id": "tests",
            "category": "unit_test",
            "checks": [
              {
                "id": "server-tests",
                "name": "Server tests",
                "command": {
                  "executable": "pnpm",
                  "args": ["--filter", "t3", "run", "test"]
                },
                "timeoutSeconds": 900,
                "diagnosticParser": "test",
                "artifacts": [
                  {
                    "pattern": "reports/tests/*.xml",
                    "type": "test_result",
                    "required": false,
                    "maxBytes": 10485760
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  }
}
```

Profiles may extend other profiles. Resolution is deterministic, rejects cycles and repeated check
identities, and keeps gate order. Gates declare category, required/enabled state, sequential or
parallel-safe execution, and block/warn/informational failure policy. Checks declare an executable,
literal argument array, repository-relative working directory, environment references, timeout,
accepted exit codes, continuation policy, platforms, changed-file applicability, diagnostics parser,
and bounded artifact rules.

Discovery checks `t3.json` first. When there is no verification section, package scripts may produce
safe suggestions, but suggestions stay marked untrusted and are never executed or persisted as
accepted commands. Repository configuration is normalized and SHA-256 hashed. Project settings must
record that exact digest before planning permits execution; any edit changes the digest and returns
the configuration to `requires_acceptance`.

## Persistent model

Migration 038 adds normalized, indexed projection tables for:

- project verification settings;
- profile, gate, and check-definition snapshots;
- verification runs and check runs;
- diagnostics and artifacts;
- repair attempts and explicit overrides.

Runs retain project, optional mission/task/worktree/agent links, trigger/requester, accepted
configuration revision and digest, branch, commit, dirty fingerprint, changed-file snapshot, safe
environment summary, immutable plan, timestamps, result, and invalidation metadata. Check runs retain
the exact command and argument snapshots, selection reason, status, duration, exit/signal/timeout,
failure classification, and durable log reference.

Diagnostics, artifacts, repair attempts, overrides, and orchestration events are append-only evidence.
Later reruns do not update an earlier result to look successful. Invalidation is recorded explicitly;
an invalidated run cannot authorize integration even if its historical result was `passed`.

## Planning and source identity

Planning resolves the project and assigned managed worktree, verifies the registered canonical root,
captures Git branch/HEAD/status, computes the clean or dirty source fingerprint, calculates changed
files, loads the accepted configuration, resolves one profile, and selects applicable checks. The
planner persists a versioned immutable plan before commands start. Every selected and skipped check
contains an explicit reason and selection source.

Changed-file rules are configuration, not hidden policy. An optional check may be skipped when its
include/exclude patterns make it explicitly inapplicable. A required blocking check remains selected
unless its definition expressly allows a required applicability skip. A required blocking gate with
neither an executable check nor an explicit inapplicability record is an invalid plan, never a pass.

Execution uses only the persisted plan. A configuration edit during a run affects the next run. The
engine captures source state again before execution and rejects a stale plan, then captures it after
execution and reports `invalidated` if a command or external process changed relevant state.

## Process, log, diagnostic, and artifact evidence

The verification engine delegates process lifecycle to one focused runner. Commands spawn without an
interactive shell, use an explicit directory beneath the authorized task worktree, receive an
isolated managed home/temp plus a small allowlisted host environment, and have a mandatory timeout.
Cancellation addresses only execution IDs owned by that verification run and terminates their child
process trees where the platform supports it.

This is process-level constraint, not a kernel or operating-system sandbox. Commands are shell-free,
use a constrained working directory and environment, and require explicit configuration acceptance,
but an accepted executable still runs with the ambient capabilities of the Lyn Code OS user. A
validated working directory does not constrain a hostile executable by itself.

Stdout and stderr stream through a bounded redacting writer. Full logs live in managed log files, not
event payloads or ordinary query rows. Database records and `verification.check_output` events carry
references/cursors rather than megabytes of text. Partial logs survive exit failure, timeout, and
cancellation. Known sensitive environment values are redacted before live delivery and durable
storage.

Parsers recognize TypeScript-style, ESLint JSON, test/build, and generic `file:line:column` output.
Diagnostics supplement rather than replace the raw log; parser failure creates a warning and leaves
the original evidence available.

Artifact collection expands only configured, bounded patterns beneath the authorized worktree.
Canonical-path checks reject traversal and symlink/junction escape. Broad whole-repository patterns,
oversized files, duplicates, and aggregate over-collection fail closed. Text evidence is redacted,
and collected records include size, media type when known, checksum, and availability metadata.

## Task lifecycle and integration authorization

An implementation agent completion records a structured handoff and moves a verification-required
task into its distinct verification state. When automatic task verification is enabled, the existing
orchestration reactor requests the configured default profile. Manual requests use the same command,
planner, repository, and engine path.

A run passes only when every required blocking gate passes. Optional failures become warnings;
timeouts, cancellation, interruption, missing required checks, missing runtimes, invalid
configuration, and absent required artifacts never become success. Failure categories distinguish
source, test, type, lint, build, dependency, environment, timeout, process, configuration, permission,
cancellation, and unknown failures.

Before integration, `MissionWorktreeReactor` re-captures the task source and authorizes the merge only
when the required profile has a current passing or passing-with-warnings run for that exact
fingerprint. It invalidates stale authorizing runs and blocks the normal integration command. An
override is a separate append-only record with requester and reason; it does not rewrite a failed run
or masquerade as a pass, and it stops authorizing when revoked or when source changes.

## Repair, cancellation, and recovery

Automatic repair is disabled by default. When enabled, only configured source/test/type/lint/build
failures are eligible. The reactor builds a bounded evidence package from failed check summaries,
diagnostics, log references/excerpts, changed files, diff, task scope, and earlier handoffs. A new
`verification_repair` agent run uses the same task worktree and existing role/permission controls. It
cannot integrate branches, and its prompt forbids unrelated scope changes or weakening verification.

Each repair attempt and handoff is persisted before a new verification run. Attempt budgeting follows
the complete repair ancestry and defaults to two, so a failure on a repair-triggered rerun cannot reset
the counter or start an infinite chain. Environment/configuration/permission/timeouts are not silently
sent to a source-repair agent.

Verification cancellation records intent, asks the engine to stop only that run's active executions,
marks unscheduled checks honestly, and preserves partial evidence. Mission/task cancellation reuses
the existing cascade and filters active verification runs by mission/task ownership.

At server startup, the reactor loads queued/preparing/running/cancelling runs. Since their recorded OS
processes cannot be proven alive and owned after restart, it marks them `interrupted`, persists the
failure explanation, and appends the matching orchestration event. It does not fabricate completion
or automatically restart a write-capable repair agent. Rerun commands create new history.

## Query and client model

Dedicated RPC queries expose project discovery/settings, task authorization summaries, run evidence,
bounded history/comparison, and paged logs. The shared client runtime reduces live verification events
and reconnect state. The desktop/web mission surfaces show configuration trust, profiles/gates/checks,
task verification state, integration authorization, current execution/log output, diagnostics,
artifacts, repair history, cancellation/retry actions, and earlier-run comparison without replacing
chat or mission state.

## Deliberate boundaries

Phase 3 does not publish GitHub checks, push branches, create pull requests, merge a protected/default
branch, deploy builds, add production monitoring, upload artifacts, learn model routing, store semantic
project memory, or provide unrestricted shell access. Those are separate product and trust decisions.

## Focused proof

The verification suites use only temporary repositories, temporary databases, and disposable
worktrees. They cover configuration trust/cycles, immutable planning and changed-file selection,
process timeout/cancellation/environment failure, redaction, diagnostics, artifact containment,
source fingerprint invalidation, migrations and repository history, integration authorization,
bounded repair, and restart-safe interruption. Existing Phase 1/2 scheduler, worktree, mission, and
chat tests remain the regression boundary.
