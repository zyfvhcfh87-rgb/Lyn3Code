import {
  AgentHandoffArtifact,
  AgentHandoffChangedFile,
  AgentHandoffCommand,
  AgentHandoffDecision,
  AgentPermissions,
  wouldCreateTaskDependencyCycle,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { MissionProjectionValidationError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteMissionAgentInput,
  DeleteTaskDependencyInput,
  GetAgentHandoffInput,
  GetManagedWorktreeInput,
  GetMissionAgentInput,
  MissionTeamListInput,
  ProjectionAgentHandoff,
  ProjectionAgentRole,
  ProjectionManagedWorktree,
  ProjectionMissionAgent,
  ProjectionMissionTeamRepository,
  type ProjectionMissionTeamRepositoryShape,
  ProjectionTaskDependency,
} from "../Services/ProjectionMissionTeams.ts";

const isMissionProjectionValidationError = Schema.is(MissionProjectionValidationError);

const ProjectionAgentRoleDbRow = ProjectionAgentRole.mapFields(
  Struct.assign({
    defaultPermissions: Schema.fromJsonString(AgentPermissions),
  }),
);

const ProjectionMissionAgentDbRow = ProjectionMissionAgent.mapFields(
  Struct.assign({
    permissions: Schema.fromJsonString(AgentPermissions),
  }),
);

const ProjectionManagedWorktreeDbRow = ProjectionManagedWorktree.mapFields(
  Struct.assign({
    hasUncommittedChanges: Schema.Number,
    conflictingFiles: Schema.fromJsonString(Schema.Array(Schema.String)),
  }),
);

const ProjectionAgentHandoffDbRow = ProjectionAgentHandoff.mapFields(
  Struct.assign({
    decisions: Schema.fromJsonString(Schema.Array(AgentHandoffDecision)),
    changedFiles: Schema.fromJsonString(Schema.Array(AgentHandoffChangedFile)),
    commandsRun: Schema.fromJsonString(Schema.Array(AgentHandoffCommand)),
    unresolvedProblems: Schema.fromJsonString(Schema.Array(Schema.String)),
    artifacts: Schema.fromJsonString(Schema.Array(AgentHandoffArtifact)),
  }),
);

const toManagedWorktree = (
  row: typeof ProjectionManagedWorktreeDbRow.Type,
): ProjectionManagedWorktree => ({
  ...row,
  hasUncommittedChanges: row.hasUncommittedChanges === 1,
});

const agentRoleColumns = `
  agent_role_id AS "id",
  name,
  kind,
  default_permissions_json AS "defaultPermissions",
  description,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const missionAgentColumns = `
  mission_agent_id AS "id",
  mission_id AS "missionId",
  role_id AS "roleId",
  role_kind AS "roleKind",
  display_name AS "displayName",
  provider_instance_id AS "providerInstanceId",
  model,
  reasoning_level AS "reasoningLevel",
  permissions_json AS "permissions",
  maximum_concurrent_runs AS "maximumConcurrentRuns",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const taskDependencyColumns = `
  task_dependency_id AS "id",
  mission_id AS "missionId",
  task_id AS "taskId",
  depends_on_task_id AS "dependsOnTaskId",
  created_at AS "createdAt"
`;

const managedWorktreeColumns = `
  managed_worktree_id AS "id",
  project_id AS "projectId",
  mission_id AS "missionId",
  task_id AS "taskId",
  purpose,
  repository_path AS "repositoryPath",
  worktree_path AS "worktreePath",
  branch_name AS "branchName",
  base_branch AS "baseBranch",
  base_commit AS "baseCommit",
  head_commit AS "headCommit",
  status,
  changed_file_count AS "changedFileCount",
  has_uncommitted_changes AS "hasUncommittedChanges",
  conflicting_files_json AS "conflictingFiles",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  removed_at AS "removedAt",
  error_summary AS "errorSummary"
`;

const agentHandoffColumns = `
  agent_handoff_id AS "id",
  mission_id AS "missionId",
  task_id AS "taskId",
  agent_run_id AS "agentRunId",
  from_mission_agent_id AS "fromMissionAgentId",
  to_mission_agent_id AS "toMissionAgentId",
  summary,
  decisions_json AS "decisions",
  changed_files_json AS "changedFiles",
  commands_run_json AS "commandsRun",
  unresolved_problems_json AS "unresolvedProblems",
  recommended_next_action AS "recommendedNextAction",
  artifacts_json AS "artifacts",
  reconciliation_status AS "reconciliationStatus",
  reconciled_at AS "reconciledAt",
  created_at AS "createdAt"
`;

const makeProjectionMissionTeamRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertAgentRoleRow = SqlSchema.void({
    Request: ProjectionAgentRole,
    execute: (row) => sql`
      INSERT INTO projection_agent_roles (
        agent_role_id, name, kind, default_permissions_json, description, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.name}, ${row.kind}, ${JSON.stringify(row.defaultPermissions)},
        ${row.description}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (agent_role_id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        default_permissions_json = excluded.default_permissions_json,
        description = excluded.description,
        updated_at = excluded.updated_at
    `,
  });

  const listAgentRoleRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionAgentRoleDbRow,
    execute: () => sql`
      SELECT ${sql.unsafe(agentRoleColumns)}
      FROM projection_agent_roles
      ORDER BY kind ASC, name ASC, agent_role_id ASC
    `,
  });

  const upsertMissionAgentRow = SqlSchema.void({
    Request: ProjectionMissionAgent,
    execute: (row) => sql`
      INSERT INTO projection_mission_agents (
        mission_agent_id, mission_id, role_id, role_kind, display_name,
        provider_instance_id, model, reasoning_level, permissions_json,
        maximum_concurrent_runs, status, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.missionId}, ${row.roleId}, ${row.roleKind}, ${row.displayName},
        ${row.providerInstanceId}, ${row.model}, ${row.reasoningLevel},
        ${JSON.stringify(row.permissions)}, ${row.maximumConcurrentRuns}, ${row.status},
        ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (mission_agent_id) DO UPDATE SET
        mission_id = excluded.mission_id,
        role_id = excluded.role_id,
        role_kind = excluded.role_kind,
        display_name = excluded.display_name,
        provider_instance_id = excluded.provider_instance_id,
        model = excluded.model,
        reasoning_level = excluded.reasoning_level,
        permissions_json = excluded.permissions_json,
        maximum_concurrent_runs = excluded.maximum_concurrent_runs,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
  });

  const getMissionAgentRow = SqlSchema.findOneOption({
    Request: GetMissionAgentInput,
    Result: ProjectionMissionAgentDbRow,
    execute: ({ missionAgentId }) => sql`
      SELECT ${sql.unsafe(missionAgentColumns)}
      FROM projection_mission_agents
      WHERE mission_agent_id = ${missionAgentId}
    `,
  });

  const listMissionAgentRows = SqlSchema.findAll({
    Request: MissionTeamListInput,
    Result: ProjectionMissionAgentDbRow,
    execute: ({ missionId }) => sql`
      SELECT ${sql.unsafe(missionAgentColumns)}
      FROM projection_mission_agents
      WHERE mission_id = ${missionId}
      ORDER BY created_at ASC, mission_agent_id ASC
    `,
  });

  const deleteMissionAgentRow = SqlSchema.void({
    Request: DeleteMissionAgentInput,
    execute: ({ missionAgentId }) => sql`
      DELETE FROM projection_mission_agents WHERE mission_agent_id = ${missionAgentId}
    `,
  });

  const upsertTaskDependencyRow = SqlSchema.void({
    Request: ProjectionTaskDependency,
    execute: (row) => sql`
      INSERT INTO projection_task_dependencies (
        task_dependency_id, mission_id, task_id, depends_on_task_id, created_at
      ) VALUES (${row.id}, ${row.missionId}, ${row.taskId}, ${row.dependsOnTaskId}, ${row.createdAt})
      ON CONFLICT (task_dependency_id) DO UPDATE SET
        mission_id = excluded.mission_id,
        task_id = excluded.task_id,
        depends_on_task_id = excluded.depends_on_task_id,
        created_at = excluded.created_at
    `,
  });

  const listTaskDependencyRows = SqlSchema.findAll({
    Request: MissionTeamListInput,
    Result: ProjectionTaskDependency,
    execute: ({ missionId }) => sql`
      SELECT ${sql.unsafe(taskDependencyColumns)}
      FROM projection_task_dependencies
      WHERE mission_id = ${missionId}
      ORDER BY created_at ASC, task_dependency_id ASC
    `,
  });

  const deleteTaskDependencyRow = SqlSchema.void({
    Request: DeleteTaskDependencyInput,
    execute: ({ dependencyId }) => sql`
      DELETE FROM projection_task_dependencies WHERE task_dependency_id = ${dependencyId}
    `,
  });

  const upsertManagedWorktreeRow = SqlSchema.void({
    Request: ProjectionManagedWorktree,
    execute: (row) => sql`
      INSERT INTO projection_managed_worktrees (
        managed_worktree_id, project_id, mission_id, task_id, purpose, repository_path,
        worktree_path, branch_name, base_branch, base_commit, head_commit, status,
        changed_file_count, has_uncommitted_changes, conflicting_files_json,
        created_at, updated_at, removed_at, error_summary
      ) VALUES (
        ${row.id}, ${row.projectId}, ${row.missionId}, ${row.taskId}, ${row.purpose},
        ${row.repositoryPath}, ${row.worktreePath}, ${row.branchName}, ${row.baseBranch},
        ${row.baseCommit}, ${row.headCommit}, ${row.status}, ${row.changedFileCount},
        ${row.hasUncommittedChanges ? 1 : 0}, ${JSON.stringify(row.conflictingFiles)},
        ${row.createdAt}, ${row.updatedAt}, ${row.removedAt}, ${row.errorSummary}
      )
      ON CONFLICT (managed_worktree_id) DO UPDATE SET
        project_id = excluded.project_id,
        mission_id = excluded.mission_id,
        task_id = excluded.task_id,
        purpose = excluded.purpose,
        repository_path = excluded.repository_path,
        worktree_path = excluded.worktree_path,
        branch_name = excluded.branch_name,
        base_branch = excluded.base_branch,
        base_commit = excluded.base_commit,
        head_commit = excluded.head_commit,
        status = excluded.status,
        changed_file_count = excluded.changed_file_count,
        has_uncommitted_changes = excluded.has_uncommitted_changes,
        conflicting_files_json = excluded.conflicting_files_json,
        updated_at = excluded.updated_at,
        removed_at = excluded.removed_at,
        error_summary = excluded.error_summary
    `,
  });

  const getManagedWorktreeRow = SqlSchema.findOneOption({
    Request: GetManagedWorktreeInput,
    Result: ProjectionManagedWorktreeDbRow,
    execute: ({ worktreeId }) => sql`
      SELECT ${sql.unsafe(managedWorktreeColumns)}
      FROM projection_managed_worktrees
      WHERE managed_worktree_id = ${worktreeId}
    `,
  });

  const listManagedWorktreeRows = SqlSchema.findAll({
    Request: MissionTeamListInput,
    Result: ProjectionManagedWorktreeDbRow,
    execute: ({ missionId }) => sql`
      SELECT ${sql.unsafe(managedWorktreeColumns)}
      FROM projection_managed_worktrees
      WHERE mission_id = ${missionId}
      ORDER BY created_at ASC, managed_worktree_id ASC
    `,
  });

  const upsertAgentHandoffRow = SqlSchema.void({
    Request: ProjectionAgentHandoff,
    execute: (row) => sql`
      INSERT INTO projection_agent_handoffs (
        agent_handoff_id, mission_id, task_id, agent_run_id, from_mission_agent_id,
        to_mission_agent_id, summary, decisions_json, changed_files_json, commands_run_json,
        unresolved_problems_json, recommended_next_action, artifacts_json,
        reconciliation_status, reconciled_at, created_at
      ) VALUES (
        ${row.id}, ${row.missionId}, ${row.taskId}, ${row.agentRunId},
        ${row.fromMissionAgentId}, ${row.toMissionAgentId}, ${row.summary},
        ${JSON.stringify(row.decisions)}, ${JSON.stringify(row.changedFiles)},
        ${JSON.stringify(row.commandsRun)}, ${JSON.stringify(row.unresolvedProblems)},
        ${row.recommendedNextAction}, ${JSON.stringify(row.artifacts)},
        ${row.reconciliationStatus}, ${row.reconciledAt}, ${row.createdAt}
      )
      ON CONFLICT (agent_handoff_id) DO UPDATE SET
        mission_id = excluded.mission_id,
        task_id = excluded.task_id,
        agent_run_id = excluded.agent_run_id,
        from_mission_agent_id = excluded.from_mission_agent_id,
        to_mission_agent_id = excluded.to_mission_agent_id,
        summary = excluded.summary,
        decisions_json = excluded.decisions_json,
        changed_files_json = excluded.changed_files_json,
        commands_run_json = excluded.commands_run_json,
        unresolved_problems_json = excluded.unresolved_problems_json,
        recommended_next_action = excluded.recommended_next_action,
        artifacts_json = excluded.artifacts_json,
        reconciliation_status = excluded.reconciliation_status,
        reconciled_at = excluded.reconciled_at
    `,
  });

  const getAgentHandoffRow = SqlSchema.findOneOption({
    Request: GetAgentHandoffInput,
    Result: ProjectionAgentHandoffDbRow,
    execute: ({ handoffId }) => sql`
      SELECT ${sql.unsafe(agentHandoffColumns)}
      FROM projection_agent_handoffs
      WHERE agent_handoff_id = ${handoffId}
    `,
  });

  const listAgentHandoffRows = SqlSchema.findAll({
    Request: MissionTeamListInput,
    Result: ProjectionAgentHandoffDbRow,
    execute: ({ missionId }) => sql`
      SELECT ${sql.unsafe(agentHandoffColumns)}
      FROM projection_agent_handoffs
      WHERE mission_id = ${missionId}
      ORDER BY created_at ASC, agent_handoff_id ASC
    `,
  });

  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));

  const addTaskDependency: ProjectionMissionTeamRepositoryShape["addTaskDependency"] = (row) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* listTaskDependencyRows({ missionId: row.missionId }).pipe(
            sqlError("ProjectionMissionTeamRepository.addTaskDependency:list"),
          );
          const withoutCurrent = existing.filter((dependency) => dependency.id !== row.id);
          if (wouldCreateTaskDependencyCycle(withoutCurrent, row)) {
            return yield* new MissionProjectionValidationError({
              operation: "ProjectionMissionTeamRepository.addTaskDependency",
              issue: "dependency cycle",
            });
          }
          yield* upsertTaskDependencyRow(row).pipe(
            sqlError("ProjectionMissionTeamRepository.addTaskDependency:upsert"),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isMissionProjectionValidationError(error)
            ? error
            : toPersistenceSqlError(
                "ProjectionMissionTeamRepository.addTaskDependency:transaction",
              )(error),
        ),
      );

  return {
    upsertAgentRole: (row) =>
      upsertAgentRoleRow(row).pipe(
        sqlError("ProjectionMissionTeamRepository.upsertAgentRole:query"),
      ),
    listAgentRoles: () =>
      listAgentRoleRows().pipe(sqlError("ProjectionMissionTeamRepository.listAgentRoles:query")),
    upsertMissionAgent: (row) =>
      upsertMissionAgentRow(row).pipe(
        sqlError("ProjectionMissionTeamRepository.upsertMissionAgent:query"),
      ),
    getMissionAgentById: (input) =>
      getMissionAgentRow(input).pipe(
        sqlError("ProjectionMissionTeamRepository.getMissionAgentById:query"),
      ),
    listMissionAgentsByMissionId: (input) =>
      listMissionAgentRows(input).pipe(
        sqlError("ProjectionMissionTeamRepository.listMissionAgentsByMissionId:query"),
      ),
    deleteMissionAgent: (input) =>
      deleteMissionAgentRow(input).pipe(
        sqlError("ProjectionMissionTeamRepository.deleteMissionAgent:query"),
      ),
    addTaskDependency,
    listTaskDependenciesByMissionId: (input) =>
      listTaskDependencyRows(input).pipe(
        sqlError("ProjectionMissionTeamRepository.listTaskDependenciesByMissionId:query"),
      ),
    deleteTaskDependency: (input) =>
      deleteTaskDependencyRow(input).pipe(
        sqlError("ProjectionMissionTeamRepository.deleteTaskDependency:query"),
      ),
    upsertManagedWorktree: (row) =>
      upsertManagedWorktreeRow(row).pipe(
        sqlError("ProjectionMissionTeamRepository.upsertManagedWorktree:query"),
      ),
    getManagedWorktreeById: (input) =>
      getManagedWorktreeRow(input).pipe(
        Effect.map(Option.map(toManagedWorktree)),
        sqlError("ProjectionMissionTeamRepository.getManagedWorktreeById:query"),
      ),
    listManagedWorktreesByMissionId: (input) =>
      listManagedWorktreeRows(input).pipe(
        Effect.map((rows) => rows.map(toManagedWorktree)),
        sqlError("ProjectionMissionTeamRepository.listManagedWorktreesByMissionId:query"),
      ),
    upsertAgentHandoff: (row) =>
      upsertAgentHandoffRow(row).pipe(
        sqlError("ProjectionMissionTeamRepository.upsertAgentHandoff:query"),
      ),
    getAgentHandoffById: (input) =>
      getAgentHandoffRow(input).pipe(
        sqlError("ProjectionMissionTeamRepository.getAgentHandoffById:query"),
      ),
    listAgentHandoffsByMissionId: (input) =>
      listAgentHandoffRows(input).pipe(
        sqlError("ProjectionMissionTeamRepository.listAgentHandoffsByMissionId:query"),
      ),
  } satisfies ProjectionMissionTeamRepositoryShape;
});

export const ProjectionMissionTeamRepositoryLive = Layer.effect(
  ProjectionMissionTeamRepository,
  makeProjectionMissionTeamRepository,
);
