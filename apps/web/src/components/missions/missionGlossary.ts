/**
 * One short definition per mission term, so the vocabulary can be read in place.
 *
 * Wording is condensed from `docs/user/missions.md` and `docs/internals/glossary.md`; keep those and
 * this file saying the same thing. The client has no outbound documentation links, so these
 * definitions are the only explanation a user gets without leaving the app.
 */
export const MISSION_GLOSSARY = {
  mission:
    "A larger engineering outcome, split into dependent tasks performed by a team of agents.",
  task: "One unit of mission work. It becomes ready when its dependencies succeeded, its agent is available, and its worktree exists.",
  run: "One attempt at a task by one agent. Every attempt is retained, so a retry adds a run rather than replacing one.",
  handoff:
    "The structured result an agent leaves when a run ends: outcome, unresolved problems, recommended next action, and changed files.",
  worktree:
    "A separate Git branch and working directory owned by one task, so write-capable agents never edit the same files at once.",
  integration:
    "Merging a finished task's branch into the mission's integration branch. Task branches integrate in dependency order.",
  verification:
    "Running a project's configured gates — typecheck, lint, tests, build — against a task's exact source state, and recording the evidence.",
  delivery:
    "Carrying verified mission work outward through merge, release, deployment, and rollback as separate approved steps.",
  routing: "How a provider, model, and reasoning level get chosen for each task.",
  scheduler:
    "The mission's own loop that starts ready tasks within the configured concurrency limits.",

  // Board columns whose difference is not self-evident.
  columnVerification: "Task work has finished and its evidence is being produced or reviewed.",
  columnReview: "Verified work is waiting on a person before it can integrate or ship.",
  columnBlocked: "Something must be resolved before this mission can continue.",
} as const;

export type MissionGlossaryTerm = keyof typeof MISSION_GLOSSARY;
