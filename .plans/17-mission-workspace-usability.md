# Plan: Mission Workspace Usability Remediation

## Tracking

Milestone: [Mission workspace usability](https://github.com/zyfvhcfh87-rgb/Lyn3Code/milestone/1).
Each phase below has an issue; update the issue, not this file, as work progresses.

| Phase | Issue | Findings |
| --- | --- | --- |
| 0 — Scope delivery to the mission | [#8](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/8) | 01 |
| 1 — Copy and state honesty | [#9](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/9) | 04, 05, 06, 07 |
| 2 — Name the domain | [#10](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/10) | 11 |
| 3 — Blockers strip | [#11](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/11) | 03 |
| 4 — Lifecycle tabs | [#12](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/12) | 02 |
| 5 — Contextual links | [#13](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/13) | 08 |
| 6 — Board fit | [#14](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/14) | 09 |
| 7 — Agent editor | [#15](https://github.com/zyfvhcfh87-rgb/Lyn3Code/issues/15) | 10 |

## Summary

Make the mission tab understandable and operable on first contact. Eight phases of orchestration
(PR #1–#7) were each built as a complete vertical slice and appended to the bottom of
`MissionWorkspace`. The machinery is sound; the surface is not. This plan fixes one data-scoping
defect and then restructures the surface so the page states what a mission is waiting on before it
states everything else.

Source review: 12 findings. Finding 12 (missions on mobile) is **out of scope** — see
[Out of scope](#out-of-scope).

## Motivation

- Delivery state from other missions renders inside a specific mission (wrong data, and it reaches a
  write path).
- Ten always-open top-level sections in one scroll, with no nav, no summary, and no prioritization.
- Blocked missions show a `Blocked` badge and require a scroll hunt across five panels to learn why.
- Internal migration vocabulary (`legacy`) and raw enum values (`not_requested`,
  `passed_with_warnings`) are user-facing.
- Four shipped, mission-relevant features (GitHub workspace, verification profiles, routing registry,
  analytics) have no link from the mission page.

## Fork context

This fork is a personal, desktop-first application. We are not contributing upstream, so we are free
to restructure `MissionWorkspace` and its children rather than layer around them, and we do not need
to preserve upstream file shapes for merge-ability. The web and desktop clients are the same React
app, so no additional surface work is implied.

The AGENTS.md quality bars that still apply: no performance regressions (keep
`content-visibility`/`contain-intrinsic-size` on long lists, do not widen WebSocket payloads), and
no new machinery where a smaller model works.

---

## Phase 0: Scope delivery to the mission

Finding 01. Correctness. Ship this first and independently — it is the only phase that changes what
data the user is shown.

`DeliveryWorkspaceSnapshot` is project-scoped with flat arrays. Every mission-bearing record carries
`missionId: NullOr(MissionId)`, but the mission route passes the snapshot through unfiltered.

### Changes

1. New `apps/web/src/components/delivery/deliveryScope.ts`:

   ```
   scopeDeliverySnapshotToMission(snapshot, missionId): DeliveryWorkspaceSnapshot
   ```

   - **Filter by `missionId`** (mission-scoped roots): `mergeReadinessAssessments`,
     `approvalRequests`, `mergeExecutions`, `releasePlans`, `deploymentPlans`, `rollbackPlans`,
     `auditEntries`.
   - **Cascade to children by surviving parent id**: `approvalDecisions` → `approvalRequestId`,
     `releaseArtifacts` → `releasePlanId`, `deploymentExecutions` → `deploymentPlanId`,
     `deploymentValidationRuns` and `rollbackExecutions` → their surviving plan/execution ids.
   - **Preserve whole** (project-level configuration, used as option lists by the proposal forms —
     filtering these would break `DeliveryPlanProposalForms`): `policies`, `releaseConfigurations`,
     `deploymentEnvironments`.
   - Keep `projectId` and `capturedAt` unchanged.

2. Apply it in `missions.$environmentId.$missionId.tsx` where the `delivery` prop is built. Leave
   every other `DeliveryWorkspace` call site on the project-wide snapshot.

3. Replace the arbitrary repository-connection lookup in `handlePublishDeliveryRelease`. Today:

   ```
   const connection = deliverySnapshot.mergeReadinessAssessments.at(-1)?.repositoryConnectionId;
   ```

   `ReleasePlan` has no `repositoryConnectionId`, so this reaches for whatever assessment is last in
   the array — from any mission.

   **Implemented differently from the original proposal.** That proposal assumed a project could
   connect several repositories and needed matching against `ReleaseConfiguration.repository`. It
   cannot: `GitHubRepositoryWorkspaceSnapshot.connection` is a single non-nullable
   `RepositoryConnection`, so a project has exactly one connected repository and there is no
   ambiguity to resolve. The fix is therefore smaller and needs no new subscription:

   - Resolve from the **project-wide** snapshot, not the mission-scoped one, using `latestBy`
     `observedAt`. The connection is a project-level fact; scoping it to the mission would newly
     break publication for a mission that has a release plan but no merge assessment of its own.
   - Fail separately, and specifically, for "plan not in this mission" and "no assessment has
     recorded a repository for this project".

### Files

- `apps/web/src/components/delivery/deliveryScope.ts` (new)
- `apps/web/src/components/delivery/deliveryScope.test.ts` (new)
- `apps/web/src/routes/missions.$environmentId.$missionId.tsx`

### Validation

- Unit: records belonging to mission B are excluded; orphaned children whose parent was filtered out
  are dropped; the three configuration collections survive intact; an empty result still returns a
  well-formed snapshot.
- Unit: connection resolution returns the match, and returns a typed failure on zero/ambiguous
  matches.
- Manual: a project with two missions, each with its own readiness assessment, shows only its own.

### Exit criteria

- No delivery record from another mission can render inside a mission workspace.
- No delivery write path selects a repository connection by array position.

---

## Phase 1: Copy and state honesty

Findings 04, 05, 06, 07. Four small changes that remove the most common "is this broken?" moments.
One pass, one commit.

### 04 — Retire `legacy` from user-facing copy

Data and enum names stay; only presentation changes.

- `MissionWorkspace.tsx:212` — `Start legacy run` → **`Run without a team`**, with helper copy on the
  button group pointing at Add agent. This is the only start affordance on a freshly created
  mission, so it must read as a deliberate choice, not a deprecated path.
- `MissionAgentActivity.tsx:286` — `legacy agent` → **`No assigned agent`**.
- `MissionAgentActivity.tsx:328` — `Legacy selection` badge → **`Direct selection`**, with a tooltip
  explaining the run predates or bypassed a routing decision.

### 05 — Explain the read-only terminal state

`canMutate` is `connected && live && !missionTerminal`. The route's `syncMessage` explains the first
two conditions and is silent on the third.

- Extend `syncMessage` in `missions.$environmentId.$missionId.tsx` with the terminal case:
  "This mission is completed. Its history is read-only." / "…cancelled…".
- Order it after the connection cases so a disconnected terminal mission still reports the
  connection problem first.

### 06 — Stop offering verification where it cannot run

- `MissionVerificationPanel` — scope the list to tasks that can hold evidence rather than
  `tasks.map` over everything.
- Disable the run button when `task.worktreeId === null` and state the reason on the card
  ("Needs a worktree — start the implementation task first"), instead of firing an error toast on
  click.
- Add a real empty state so the heading never renders above nothing.
- Keep the guard in `handleRequestVerification` as a backstop; it stops being the primary UX.

### 07 — Let delivery introduce itself

- `MissionDeliverySection` currently returns `null` on an empty snapshot, which makes
  `DeliveryWorkspace`'s own empty-state notice unreachable from a mission and the entire controlled
  delivery phase undiscoverable.
- Render the notice instead, with a link to where a policy and release/deployment target get
  configured.

### Files

`MissionWorkspace.tsx`, `MissionAgentActivity.tsx`, `missions.$environmentId.$missionId.tsx`,
`verification/MissionVerificationPanel.tsx`, `delivery/MissionDeliverySection.tsx`

### Exit criteria

- No user-facing string contains "legacy".
- Every disabled-control state on the mission page has a visible reason.
- Delivery is visible and self-explanatory on a mission that has never used it.

---

## Phase 2: Name the domain in the product

Finding 11. Eleven domain terms, none defined in-app. The pattern to extend already exists —
`MISSION_STATUS_LABELS` in `MissionBoard.logic.ts` maps mission status to written labels. Task,
integration, verification, agent, and run statuses print raw enum values.

### Changes

1. New `apps/web/src/components/missions/missionLabels.ts` — written labels for
   `MissionTask["status"]`, `MissionTask["integrationStatus"]`, verification authorization status,
   `AgentRun["status"]`, and `MissionAgent["status"]`. Move `MISSION_STATUS_LABELS` here so all label
   maps live together; re-export from `MissionBoard.logic.ts` to avoid churn in its tests.
2. Replace every raw enum badge render — `MissionIntegrationQueue.tsx:118`,
   `MissionTaskGraph.tsx` display status, `MissionTeamPanel.tsx:286`, `MissionAgentActivity.tsx:292`,
   `MissionCard.tsx:53` (`activeRunStatus`).
3. New `apps/web/src/components/missions/missionGlossary.ts` — one short definition per term, lifted
   from `docs/user/missions.md` and `docs/internals/glossary.md` so there is a single wording source.
4. New `DefinitionLabel` component wrapping the existing `ui/tooltip`, applied to section headings,
   board column headers, and status badges whose meaning is not self-evident (`Verification` vs
   `Review` columns especially).

Everything stays in-app: the web client has no outbound documentation-link pattern today, and this
plan does not introduce one.

### Files

`missions/missionLabels.ts` (new), `missions/missionGlossary.ts` (new),
`missions/DefinitionLabel.tsx` (new), plus the badge call sites above.

### Exit criteria

- No raw enum value renders as user-facing text anywhere in the mission surfaces.
- Every board column header and section heading can explain itself without leaving the app.

---

## Phase 3: Blockers strip

Finding 03. The reasons a mission is stuck are all computed already — they are just scattered across
five panels. Collect them, do not recompute them.

### Changes

1. New `apps/web/src/components/missions/MissionBlockers.logic.ts` — pure function returning an
   ordered `ReadonlyArray<{ id, severity, message, targetSection }>` from
   `{ mission, tasks, missionAgents, taskDependencies, managedWorktrees, verificationSummaries,
   providerReady }`.
2. Lift the existing in-panel predicates into that module and have the panels consume them, so there
   is one source of truth rather than two implementations that drift:
   - `MissionTaskGraph.tsx:136–143` — `startUnavailable` (unassigned agent, disabled/unavailable
     agent, write agent without a worktree, waiting on dependency).
   - `MissionIntegrationQueue.tsx:95–106` — `dependenciesIntegrated`, `conflicted`,
     `verificationAllowed`.
   - `MissionWorkspace.tsx:240–248` — no ready provider.
3. New `MissionBlockersStrip.tsx` rendered directly under the header. Each row links to the section
   that resolves it (compatible with Phase 4's tab ids). Renders nothing when the list is empty.

Follows the repo's existing `.logic.ts` + `.logic.test.ts` convention, so the derivation is testable
without rendering.

### Validation

- Unit tests per blocker condition and for ordering (hard blockers before advisories).
- Regression: the panels' own inline warnings still appear and now read identically to the strip.

### Exit criteria

- A blocked mission states its reasons in the first screenful.
- No blocker condition is implemented in two places.

---

## Phase 4: Regroup the workspace into lifecycle tabs

Finding 02. The largest change. Do it after Phases 0–3 so the tabs are grouping content that already
reads correctly.

The grouping is not invented — it is the lifecycle the server already models.

| Tab | Contains |
| --- | --- |
| **Plan** | Outcome, agent team, routing, task dependency graph |
| **Work** | Agent activity, worktrees |
| **Verify** | Verification, integration queue |
| **Ship** | Delivery |
| **History** | Mission event timeline, handoffs |

### Changes

1. New `apps/web/src/components/ui/tabs.tsx` wrapping `@base-ui/react/tabs`, styled to match
   `toggle-group.tsx`. **Verify the export exists in `@base-ui/react@^1.4.1` first**; if it does not,
   build the segmented control on the existing `ToggleGroup` primitive rather than adding a
   dependency.
2. Split `MissionWorkspace.tsx` (currently ~390 lines and the entire page) into
   `MissionWorkspaceHeader.tsx` plus `MissionPlanTab` / `MissionWorkTab` / `MissionVerifyTab` /
   `MissionShipTab` / `MissionHistoryTab`. Keep the existing prop contract and pass through, so
   `missions.$environmentId.$missionId.tsx` needs no change beyond imports.
3. Persist the active tab in the URL via TanStack Router `validateSearch`, so reload, deep links, and
   Phase 3's blocker links all work.
4. Retire the 22rem right rail. The timeline moves into History; the page reclaims the width, which
   is what the task graph and delivery panels actually need. Show an unread/recent-event count on the
   History tab so activity is still noticeable without the rail.
5. Replace the `SettingsSection` wrappers inside `DeliveryWorkspace` when rendered in a mission —
   settings-page chrome inside a mission workspace is a visual mismatch. Either parameterize the
   section wrapper or have `MissionShipTab` render the delivery sub-panels directly.

### Risks

- Largest diff in the plan; highest chance of a regression in an untested panel.
- Mitigate by keeping child panel props identical and moving, not rewriting, their JSX.
- Keep `content-visibility` / `contain-intrinsic-size` on every long list that moves.

### Exit criteria

- No tab exceeds roughly two screens on a 1440×900 window with a five-task mission.
- Tab state survives reload and is linkable.
- Existing panel tests pass unmodified.

---

## Phase 5: Connect the mission page to its siblings

Finding 08. The mission workspace has exactly one outbound link today (Memory audit, on a run card),
despite four directly relevant features shipping in PR #3–#6.

### Changes

- Routing panel → `/settings/routing` ("Manage provider and model registry").
- Verification panel → `/settings/verification` ("Manage verification profiles").
- Integration queue and delivery → `/github/$environmentId/$projectId` (branches, PRs, checks).
- Header overflow menu → `/settings/analytics` (cost and outcome for this mission) and
  `/memory/$environmentId/$projectId`.

Small, but it is what turns five separately shipped phases into one workflow.

### Exit criteria

- Every mission-relevant feature is reachable from the mission page in one click.

---

## Phase 6: Fit the board to a laptop

Finding 09. Eight `w-72` columns is roughly 2,400px; on a typical window half the pipeline —
including `Blocked` — is off-screen right, and the failed/cancelled `<details>` sits below a
horizontal scroller where it is easy to never see.

### Changes

1. Collapse empty columns to a narrow rail with a vertical label and count; expand on click. Keeps
   all eight statuses honest while letting the populated ones fit.
2. Surface `Blocked` and `Failed` counts in the board header regardless of scroll position, with a
   click that scrolls the column into view.
3. Move the failed/cancelled group out from under the horizontal scroller — into the header as a
   filter toggle, or above the columns.
4. Extend `MissionBoard.logic.test.ts` for the collapse and count derivations.

### Exit criteria

- Every populated column is reachable without horizontal scrolling on a 1440px window.
- Missions needing attention are visible before any scroll.

---

## Phase 7: Unify the agent editor

Finding 10. Configuring one agent currently means three independent forms with three save buttons —
`Save limits` (mission-wide), `Save agent` (inside a collapsed `<details>`), `Save permissions` —
with nothing indicating they are independent until a change is lost. The panel also mixes the design
system's `Input`/`Select` with raw `<select>`/`<input>` carrying hand-written Tailwind.

### Changes

1. One `MissionAgentEditor` dialog (following `CreateTaskDialog`'s shape) holding display name, role,
   provider, model, concurrency, availability, and permissions. One save.
   - `mission.agent.upsert` accepts a full `MissionAgent` including `permissions`, so a single
     command can carry the whole edit.
   - **Keep the distinct audit event**: when permissions changed, also dispatch
     `mission.agent.permissions.update` so `mission.agent-permissions-updated` still appears in
     history rather than being absorbed into `mission.agent-upserted`.
2. Move mission-wide limits (concurrency, attempts, integration mode, auto-start) into their own
   clearly separated "Team settings" control, not interleaved with per-agent editing.
3. Replace every raw `<select>` / `<input>` in `MissionTeamPanel.tsx` with `Select`, `Input`,
   `Checkbox`, and `Field` from the UI kit, so the panel inherits focus rings, dark-mode surfaces,
   and sizing.

### Exit criteria

- Editing an agent is one form and one save.
- No hand-styled form control remains in the mission surfaces.

---

## Out of scope

**Finding 12 — missions on mobile.** `apps/mobile` has no mission code, which the review flagged
against AGENTS.md's multi-surface principle. Deliberately not doing this: the fork is a desktop-only
personal application, mobile parity is not a goal here, and mobile changes would be inherited
maintenance from upstream for no benefit. The finding stands as accurate for the upstream project and
is recorded here only so it is not re-raised.

## Suggested sequencing

Phase 0 first and alone (it is the only correctness fix). Phases 1, 2, 5, and 6 are independent and
can land in any order. Phase 3 before Phase 4 so the blockers strip exists when the header is
restructured. Phase 7 last — it is the largest interaction change with the smallest comprehension
payoff.

| Order | Phase | Findings | Relative size |
| --- | --- | --- | --- |
| 1 | Scope delivery to the mission | 01 | S |
| 2 | Copy and state honesty | 04, 05, 06, 07 | S |
| 3 | Name the domain | 11 | S |
| 4 | Blockers strip | 03 | M |
| 5 | Contextual links | 08 | M |
| 6 | Board fit | 09 | M |
| 7 | Lifecycle tabs | 02 | L |
| 8 | Agent editor | 10 | M |

## Validation (whole plan)

- `.logic.ts` modules covered by unit tests, per existing convention.
- Existing mission, verification, delivery, and routing suites pass unmodified where panels only
  moved.
- Web typecheck, targeted lint, and production build clean.
- Manual pass on a project with two missions, one blocked and one completed, to exercise Phase 0
  scoping, Phase 1 terminal state, and Phase 3 blockers together.

## Done criteria

- A new mission is startable without reading `docs/user/missions.md`.
- A blocked mission states its reasons in the first screenful.
- No control is disabled without a visible reason.
- No mission page shows another mission's data.
- Every shipped mission-relevant feature is reachable from the mission page.
