# GitHub integration runbook

> For maintainers. User setup lives in
> [GitHub workspace](../user/github-workspace.md); architecture lives in
> [GitHub integration architecture](../internals/github-integration.md).

This runbook covers authentication diagnosis and safe Phase 4 verification. Never exercise mutation
flows against the real upstream repository, a maintainer's active branch, or live T3 home state.

## Authentication setup

Authentication belongs to GitHub CLI on the machine running the Lyn Code server:

```sh
gh auth login
gh auth status
```

For GitHub Enterprise Server:

```sh
gh auth login --hostname github.example.com
gh auth status --hostname github.example.com
```

Use the narrowest practical scopes for the scenario. A read-only account is a valid test subject and
must retain issue, pull request, review, and check browsing while push, PR mutation, ready-for-review,
and thread-resolution actions remain unavailable.

GitHub CLI stores the credential in its configured platform credential store or its own protected
configuration. Lyn Code consumes the authenticated CLI context and must never call `gh auth token`,
persist an authorization header, or copy credentials into `.t3`, a project, a worktree, logs, events,
or browser state.

The in-app disconnect only changes Lyn Code's account state. To revoke the CLI session in a dedicated
test environment:

```sh
gh auth logout --hostname github.com
```

Do not run that command on a shared or production server without explicit operator approval.

## Safe test environment

Prefer mocked API execution and in-memory SQLite for automated tests. For a live smoke test, create a
dedicated disposable GitHub repository and account with no production secrets, protected release
branches, required reviewers, deployments, or external automation. Keep its remote separate from the
repository under test.

For Git-only push and divergence testing, a local temporary bare repository is sufficient. It proves
normal push, ahead/behind classification, and no-force behavior without contacting GitHub. Use a
fresh disposable working directory, capture every path explicitly, and remove it only after verifying
that it is outside the checkout and live T3 home.

Mutation smoke tests must use:

- a dedicated project copy and gitignored `.t3` home;
- a dedicated remote and non-default test branch;
- synthetic issue, review, and verification records;
- explicit confirmation for every push, draft PR, ready-for-review, or thread-resolution action;
- a final remote inspection proving the expected head and absence of unexpected branches or edits.

Never use a personal access token in test fixtures. Stub the command executor and assert redacted
errors instead.

## Focused automated proof

Run the Phase 4 slices directly; do not replace them with a repo-wide check:

```sh
vp test run \
  apps/server/src/github/GitHubApiClient.test.ts \
  apps/server/src/github/GitHubRemote.test.ts \
  apps/server/src/github/GitHubGitSafety.test.ts \
  apps/server/src/sourceControl/GitHubCli.test.ts \
  packages/contracts/src/github.test.ts \
  apps/server/src/persistence/Migrations/039_GitHubWorkspace.test.ts \
  apps/server/src/persistence/Layers/ProjectionGitHubWorkspace.test.ts \
  apps/web/src/components/github/workspaceModel.test.ts
```

Also run targeted lint, typecheck, and build commands for packages changed by the patch. Preserve
pre-existing failures separately; do not relabel an unrelated failure as Phase 4 success.

No automated test may invoke a real `gh` credential, GitHub repository mutation, or external webhook.

## Manual-safe smoke sequence

Use a dedicated test repository when live GitHub confirmation is required:

1. Authenticate and connect the expected account and server origin.
2. Connect by an explicit repository URL, compare it with the detected remote, and confirm no remote
   URL changed.
3. Refresh metadata and one page of issues and pull requests; restart with the disposable `.t3` home
   and confirm the cache and links reopen.
4. Connect read-only credentials and confirm remote mutations are absent while browsing remains useful.
5. Create a mission from a synthetic issue, then attempt the same action again and confirm the
   duplicate guard.
6. Complete a synthetic mission branch and current verification in a managed worktree. Confirm the
   push summary, perform the normal push, and compare the remote head.
7. Create a draft pull request and inspect its body for bounded real evidence, separate local and
   remote check sections, explicit issue-closing intent, and absence of transcripts or secrets.
8. Push a new commit and confirm older checks are stale for readiness.
9. Create a task from an inline review comment. Complete, verify, and push it; confirm the remote
   thread remains unresolved until the separate explicit resolution action.
10. Produce a remote divergence and verify the next push stops without force-pushing.
11. Simulate primary and secondary rate limits, revoked authentication, offline access, and one failed
    resource page through the fake API executor. Confirm cached data survives and retries remain bounded.

Capture the test repository, account, base/head SHA, timestamps, and exact command results in the
Phase 4 validation report. Do not include credentials or raw authorization errors.

## Scenario coverage matrix

The status below describes automated proof in the initial Phase 4 implementation. **Partial** means
the core primitive is tested but the composed WebSocket-to-service workflow still needs a focused
integration test. **Manual-safe** means a dedicated disposable repository is required for the final
remote confirmation. A unit test passing is not evidence that a live push or PR creation succeeded.

| Scenario                              | Current proof                                                                                                                                                  | Remaining proof                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1. Connect account and repository     | **Partial:** account/API normalization, remote parsing, migration, persisted repository connections, and cache reopen behavior are automated.                  | Composed connect/restart test plus a manual-safe CLI credential validation.                                       |
| 2. Read-only account                  | **Partial:** permission contracts and UI capability gating are implemented.                                                                                    | Service and component test proving all mutation actions are unavailable while queries succeed.                    |
| 3. Issue to mission                   | **Partial:** issue pagination, durable issue links, and duplicate-safe uniqueness are tested at client/persistence layers.                                     | Workflow test for mission context, selected comments, and duplicate-mission rejection.                            |
| 4. Create draft pull request          | **Partial:** draft API transport, branch safety, and secret-free PR body generation with distinct local/remote evidence are automated.                         | Composed workflow test for confirmed push and persisted PR link; manual-safe remote confirmation.                 |
| 5. Failed or stale verification       | **Partial:** Phase 3 source authorization and current-head UI behavior have focused tests.                                                                     | GitHub workflow test proving failed and fingerprint-stale runs block push/PR evidence.                            |
| 6. CI synchronization                 | **Partial:** check normalization and current-head required-check readiness are automated.                                                                      | Paginated service test covering queued/running/failure and invalidation after a newer head.                       |
| 7. Review comment to task             | **Partial:** review-thread persistence and comment-task links survive without resolving the thread.                                                            | Workflow test for task creation, assignment, verification, push, and explicit-only resolution.                    |
| 8. Changes requested                  | **Gap:** normalized review states and UI rendering exist.                                                                                                      | Service/workflow test for mission follow-up, multiple review tasks, new checks, and preserved review history.     |
| 9. Diverged remote branch             | **Partial:** ancestry classification, bounded observations, and secret categories are automated.                                                               | Temporary local-bare-repository test proving a real normal push rejects divergence and never adds force.          |
| 10. Rate limit                        | **Partial:** secondary-rate-limit classification, bounded transient retry, persisted blocked-operation/reset metadata, and cache preservation are implemented. | Composed service test proving no retry loop and recovery after the reset window.                                  |
| 11. Authentication expiration         | **Partial:** credential-bearing headers are rejected, errors are sanitized, and sync/mutation failures persist expired or insufficient-permission state.       | Composed service test preserving local work and succeeding after reauthentication.                                |
| 12. Partial synchronization failure   | **Partial:** per-resource failure cursors preserve the last successful cursor and earlier caches; the workspace becomes partially stale.                       | Composed workspace test where a later resource fails and retry repairs only that resource.                        |
| 13. Restart recovery                  | **Partial:** migration and repository tests reopen cached records/cursors without duplicate links.                                                             | Service interruption test during pagination proving a safe resume or restart from the persisted cursor.           |
| 14. Existing functionality regression | **Partial:** Phase 1-3 focused suites remain independently available and local-only projects have no required GitHub connection.                               | Targeted mission, team/worktree, verification, chat, and local-only smoke results in the final validation report. |

The highest-value next tests are composed `GitHubWorkspaceService` and `GitHubWorkflowService` tests
using in-memory persistence and fake GitHub/Git executors. They close multiple matrix gaps without
requiring a live remote and should precede broad UI automation.

## Incident behavior

- **Authentication failure:** stop mutation attempts, preserve local state, reauthenticate on the
  server, and validate the exact hostname before retrying.
- **Rate limit:** do not loop refresh. Record the reset time and blocked operation, use cached data,
  and retry after the window.
- **Partial sync:** keep successful resource caches, mark the workspace partially stale, and retry the
  failed resource only.
- **Offline:** do not convert network failure into authentication revocation. Keep local missions and
  worktrees available.
- **Divergence:** do not force-push. Inspect local and remote heads, choose an explicit merge/rebase or
  new-branch recovery, re-run required verification, then re-confirm.
- **Unexpected remote mutation:** stop further mutations, record the confirmed remote state and event
  IDs, preserve the managed worktree, and escalate. Do not rewrite history while diagnosing.
