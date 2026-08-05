/**
 * MigrationsLive - Migration runner with inline loader
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * Migrations run automatically when the MigrationLayer is provided,
 * ensuring the database schema is always up-to-date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Import all migrations statically
import Migration0001 from "./Migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./Migrations/002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./Migrations/003_CheckpointDiffBlobs.ts";
import Migration0004 from "./Migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./Migrations/005_Projections.ts";
import Migration0006 from "./Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./Migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./Migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./Migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./Migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./Migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./Migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./Migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./Migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./Migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./Migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./Migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./Migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./Migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./Migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./Migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./Migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./Migrations/025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./Migrations/026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./Migrations/027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./Migrations/028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./Migrations/029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./Migrations/030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./Migrations/031_AuthAuthorizationScopes.ts";
import Migration0032 from "./Migrations/032_AuthPairingProofKeyThumbprint.ts";
import Migration0033 from "./Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./Migrations/035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./Migrations/036_MissionFoundation.ts";
import Migration0037 from "./Migrations/037_MissionTeamsAndWorktrees.ts";
import Migration0038 from "./Migrations/038_AutomatedVerification.ts";
import Migration0039 from "./Migrations/039_GitHubWorkspace.ts";
import Migration0040 from "./Migrations/040_PersistentProjectMemory.ts";
import Migration0041 from "./Migrations/041_IntelligentRouting.ts";
import Migration0042 from "./Migrations/042_UsageAnalytics.ts";
import Migration0043 from "./Migrations/043_ControlledDelivery.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 */
export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
  [33, "ProjectionThreadsSettled", Migration0033],
  [34, "ProjectionThreadsSnoozed", Migration0034],
  [35, "ProjectionThreadTitleRegeneration", Migration0035],
  [36, "MissionFoundation", Migration0036],
  [37, "MissionTeamsAndWorktrees", Migration0037],
  [38, "AutomatedVerification", Migration0038],
  [39, "GitHubWorkspace", Migration0039],
  [40, "PersistentProjectMemory", Migration0040],
  [41, "IntelligentRouting", Migration0041],
  [42, "UsageAnalytics", Migration0042],
  [43, "ControlledDelivery", Migration0043],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});
const AUTOMATED_VERIFICATION_MIGRATION_ID = 38;

/**
 * SQLite cannot disable foreign keys while Effect Migrator's transaction is
 * active. Phase 3 extends the mission-task status CHECK and the task table is
 * part of a circular task/worktree relationship, so the supported table-copy
 * rebuild has to run between migration transactions with foreign keys disabled.
 *
 * The preparation is idempotent: if the rebuilt schema is already present it
 * does nothing, allowing a failed 038 body to be retried safely.
 */
const prepareAutomatedVerificationMigration = Effect.fn("prepareAutomatedVerificationMigration")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const taskTable = yield* sql<{ readonly sql: string | null }>`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'projection_mission_tasks'
  `;
    const createSql = taskTable[0]?.sql ?? null;
    if (createSql === null || createSql.includes("'verification'")) {
      return;
    }

    yield* sql`PRAGMA foreign_keys = OFF`;
    const foreignKeys = yield* sql<{ readonly foreign_keys: number }>`PRAGMA foreign_keys`;
    if (foreignKeys[0]?.foreign_keys !== 0) {
      return yield* Effect.die("Could not disable SQLite foreign keys for Phase 3 task migration");
    }

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
          CREATE TABLE projection_mission_tasks_v38 (
            task_id TEXT PRIMARY KEY,
            mission_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL CHECK (
              status IN (
                'backlog', 'ready', 'running', 'verification', 'blocked',
                'completed', 'cancelled', 'failed'
              )
            ),
            position INTEGER NOT NULL CHECK (position >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            assigned_mission_agent_id TEXT REFERENCES projection_mission_agents(mission_agent_id)
              ON UPDATE CASCADE ON DELETE SET NULL,
            worktree_id TEXT REFERENCES projection_managed_worktrees(managed_worktree_id)
              ON UPDATE CASCADE ON DELETE SET NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            maximum_attempts INTEGER NOT NULL DEFAULT 3 CHECK (maximum_attempts > 0),
            ready_at TEXT,
            blocked_reason TEXT,
            integration_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (
              integration_status IN (
                'not_requested', 'pending', 'ready', 'integrating', 'integrated',
                'conflicted', 'failed'
              )
            ),
            requires_dependency_handoffs INTEGER NOT NULL DEFAULT 1 CHECK (
              requires_dependency_handoffs IN (0, 1)
            ),
            implementation_completed_at TEXT,
            verification_status TEXT NOT NULL DEFAULT 'not_required' CHECK (
              verification_status IN (
                'not_required', 'pending', 'queued', 'running', 'failed', 'passed',
                'passed_with_warnings', 'cancelled', 'interrupted', 'invalidated', 'overridden'
              )
            ),
            verification_required INTEGER NOT NULL DEFAULT 0 CHECK (
              verification_required IN (0, 1)
            ),
            latest_verification_run_id TEXT,
            verification_profile_id TEXT,
            verification_override_id TEXT,
            UNIQUE (mission_id, task_id),
            FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
              ON UPDATE CASCADE ON DELETE CASCADE
          )
        `;
          yield* sql`
          INSERT INTO projection_mission_tasks_v38 (
            task_id, mission_id, title, description, status, position, created_at, updated_at,
            started_at, completed_at, assigned_mission_agent_id, worktree_id, attempt_count,
            maximum_attempts, ready_at, blocked_reason, integration_status,
            requires_dependency_handoffs, implementation_completed_at, verification_status,
            verification_required, latest_verification_run_id, verification_profile_id,
            verification_override_id
          )
          SELECT
            task_id, mission_id, title, description, status, position, created_at, updated_at,
            started_at, completed_at, assigned_mission_agent_id, worktree_id, attempt_count,
            maximum_attempts, ready_at, blocked_reason, integration_status,
            requires_dependency_handoffs, NULL, 'not_required', 0, NULL, NULL, NULL
          FROM projection_mission_tasks
        `;
          yield* sql`DROP TABLE projection_mission_tasks`;
          yield* sql`ALTER TABLE projection_mission_tasks_v38 RENAME TO projection_mission_tasks`;
          yield* sql`
          CREATE INDEX idx_projection_mission_tasks_mission_position
          ON projection_mission_tasks(mission_id, position, task_id)
        `;
          yield* sql`
          CREATE INDEX idx_projection_mission_tasks_mission_status
          ON projection_mission_tasks(mission_id, status, updated_at DESC)
        `;
          yield* sql`
          CREATE INDEX idx_projection_mission_tasks_verification_status
          ON projection_mission_tasks(mission_id, verification_status, updated_at DESC)
        `;
          yield* sql`
          CREATE INDEX idx_projection_mission_tasks_latest_verification
          ON projection_mission_tasks(latest_verification_run_id)
          WHERE latest_verification_run_id IS NOT NULL
        `;
        }),
      )
      .pipe(Effect.ensuring(sql`PRAGMA foreign_keys = ON`.pipe(Effect.orDie)));

    const foreignKeyErrors = yield* sql<{
      readonly table: string;
      readonly rowid: number;
      readonly parent: string;
      readonly fkid: number;
    }>`PRAGMA foreign_key_check`;
    if (foreignKeyErrors.length > 0) {
      return yield* Effect.die(
        `Phase 3 task migration left ${foreignKeyErrors.length} foreign key violation(s)`,
      );
    }
  },
);

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const includesAutomatedVerification =
    toMigrationInclusive === undefined ||
    toMigrationInclusive >= AUTOMATED_VERIFICATION_MIGRATION_ID;
  const beforeAutomatedVerification = includesAutomatedVerification
    ? yield* run({ loader: makeMigrationLoader(AUTOMATED_VERIFICATION_MIGRATION_ID - 1) })
    : [];
  if (includesAutomatedVerification) {
    yield* prepareAutomatedVerificationMigration();
  }
  const afterAutomatedVerification = yield* run({
    loader: makeMigrationLoader(toMigrationInclusive),
  });
  const executedMigrations = [
    ...beforeAutomatedVerification,
    ...afterAutomatedVerification,
  ] as ReadonlyArray<readonly [number, string]>;
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});

/**
 * Layer that runs migrations when the layer is built.
 *
 * Use this to ensure migrations run before your application starts.
 * Migrations are run automatically - no separate script is needed.
 *
 * @example
 * ```typescript
 * import { MigrationsLive } from "@acme/db/Migrations"
 * import * as SqliteClient from "@acme/db/SqliteClient"
 *
 * // Migrations run automatically when SqliteClient is provided
 * const AppLayer = MigrationsLive.pipe(
 *   Layer.provideMerge(SqliteClient.layer({ filename: "database.sqlite" }))
 * )
 * ```
 */
export const MigrationsLive = Layer.effectDiscard(runMigrations());
