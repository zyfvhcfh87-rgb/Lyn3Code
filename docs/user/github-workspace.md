# GitHub workspace

The project GitHub workspace connects Lyn Code's local mission workflow to a GitHub repository. It
keeps the two systems linked without pretending that either one owns the other's data:

- Lyn Code owns local projects, missions, tasks, managed worktrees, agent handoffs, and local
  verification history.
- GitHub owns remote issues, pull requests, reviews, branches, and Actions or status checks.

Cached GitHub records never replace local mission history. Local-only projects continue to work
without a GitHub account or repository connection.

## Connect an account and repository

GitHub authentication runs on the machine hosting the Lyn Code server. Install GitHub CLI and sign
in there before connecting the account in Lyn Code:

```sh
gh auth login
gh auth status
```

For GitHub Enterprise Server, authenticate the exact hostname and enter its HTTPS origin in the
connection form:

```sh
gh auth login --hostname github.example.com
gh auth status --hostname github.example.com
```

The **Connect GitHub** action validates that existing server-side session. Lyn Code records the
account identity, granted scopes, and connection status, but does not copy the access token into a
project, mission, worktree, event, or ordinary application database table.

Connect a project using one of these repository references:

- leave the repository field blank to use the selected Git remote;
- enter `owner/repository`;
- enter an HTTPS or SSH GitHub repository URL.

Connecting records the selected remote and repository identity. It does not add, remove, rename, or
rewrite a Git remote. A project cannot be changed to a conflicting repository until its existing
connection is explicitly disconnected.

Repository permissions are detected from GitHub. A read-only connection can still browse cached
repository metadata, issues, pull requests, reviews, and checks. Actions that mutate GitHub are
hidden or disabled.

## Browse and synchronize

The workspace is split into **Overview**, **Issues**, **Pull requests**, **Branches**, **Checks**,
and **Synchronization**.

Issue and pull request lists load incrementally. Opening a pull request loads its bounded changed-file
patches, commits, reviews, inline threads, and checks. Use **Refresh** when you need a new authoritative
observation before making a decision.

The synchronization view shows when each cached resource last completed, the selected remote,
account permissions, and observed rate-limit data. A stale, partial, offline, or failed refresh does
not delete previously cached records. Treat visibly stale data as a browsing aid, not proof of the
current remote state.

Disconnecting an account or repository preserves local missions, tasks, worktrees, verification
history, and Git branches. Disconnecting in Lyn Code does not revoke the underlying GitHub CLI login;
use `gh auth logout` on the server if the credential itself must be removed.

## Issues and missions

From an issue you can create a mission or link an existing mission. A mission created from an issue
keeps the issue number, URL, title, author, assignees, labels, and a bounded copy of the selected issue
context. GitHub text is treated as untrusted reference material: it cannot grant an agent permission,
run a command, or change verification policy.

If the issue already has a clear mission link, Lyn Code prevents an accidental duplicate. Linking an
issue does not edit, close, label, assign, or otherwise mutate the issue.

## Push a managed branch

The branch view compares known local and remote heads. A push must be explicitly confirmed and is
limited to an active mission or task worktree. Before pushing, Lyn Code checks that:

- the branch belongs to the selected mission or task;
- the selected repository and remote match the project;
- the reviewed local head has not changed;
- required local verification is current for that source;
- the managed worktree has no uncommitted changes;
- the outgoing bounded patch does not match the credential-safety checks;
- the destination is not the repository's default branch;
- the remote branch is not behind or diverged.

The push uses normal Git history. Lyn Code does not force-push, rewrite the remote branch, change the
remote URL, bypass hooks, or push from an unrelated working tree. If the branch diverged, choose and
perform a recovery strategy explicitly before trying again.

## Create a draft pull request

Pull requests are created from a confirmed remote branch backed by a managed mission worktree. The
creation dialog shows the repository, base and head branches, expected head commit, mission, draft
state, and optional linked issue.

The generated description uses structured local evidence: mission objective, completed tasks,
bounded handoff summaries, changed areas, current local verification, known limitations, and reviewer
guidance. It excludes agent transcripts, hidden reasoning, credentials, and raw logs. Closing language
is only used when you explicitly select it; otherwise the issue is marked as related.

Local verification and GitHub checks are always shown separately:

- **Local harness verification** is tied to Lyn Code's accepted verification profile and source
  fingerprint. A source change makes old evidence stale.
- **GitHub Actions and remote checks** belong to a GitHub head commit. Results for an older commit do
  not count toward the current pull request's readiness.

Creating or updating a pull request never merges it. Lyn Code does not enable auto-merge, bypass
branch protection, approve as you, dismiss reviews, or delete branches.

## Reviews and review tasks

The pull request review view keeps submissions and inline threads grouped by file. A review comment
can become a linked local task containing the reviewer, text, file and line, commit, and resolution
requirements.

Completing that task does not resolve the GitHub thread. Resolution remains an explicit action and
requires a completed linked task, current required local verification, a freshly synchronized pull
request head, and a confirmed pushed managed branch. GitHub must confirm the resolution before Lyn
Code records it.

## When the connection is unhealthy

- **Read only or insufficient permissions:** browsing and local workflows remain available; remote
  mutation actions stay unavailable.
- **Expired or revoked login:** reauthenticate with GitHub CLI on the server, then reconnect or
  refresh in Lyn Code.
- **Rate limited:** keep using cached data and wait until GitHub's displayed reset window before
  refreshing again.
- **Offline, stale, or partial synchronization:** local work continues. Retry only the affected
  resource when connectivity returns.
- **Remote resource deleted:** local history and links remain preserved for explicit disposition.

GitHub integration is optional. It does not add deployment automation, issue administration,
autonomous merging, automatic branch deletion, or support for other hosting providers in this
workspace.
