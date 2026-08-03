import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionMissionTaskInput,
  ListProjectionMissionTasksInput,
  ProjectionMissionTask,
  ProjectionMissionTaskRepository,
  type ProjectionMissionTaskRepositoryShape,
} from "../Services/ProjectionMissionTasks.ts";

const selectMissionTaskColumns = `
  task_id AS "id",
  mission_id AS "missionId",
  title,
  description,
  status,
  position,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  started_at AS "startedAt",
  completed_at AS "completedAt",
  assigned_mission_agent_id AS "assignedMissionAgentId",
  worktree_id AS "worktreeId",
  attempt_count AS "attemptCount",
  maximum_attempts AS "maximumAttempts",
  ready_at AS "readyAt",
  blocked_reason AS "blockedReason",
  integration_status AS "integrationStatus",
  requires_dependency_handoffs AS "requiresDependencyHandoffs"
`;

const ProjectionMissionTaskDbRow = ProjectionMissionTask.mapFields(
  Struct.assign({ requiresDependencyHandoffs: Schema.Number }),
);

const toProjectionMissionTask = (
  row: typeof ProjectionMissionTaskDbRow.Type,
): ProjectionMissionTask => ({
  ...row,
  requiresDependencyHandoffs: row.requiresDependencyHandoffs === 1,
});

const makeProjectionMissionTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionMissionTaskRow = SqlSchema.void({
    Request: ProjectionMissionTask,
    execute: (row) =>
      sql`
        INSERT INTO projection_mission_tasks (
          task_id,
          mission_id,
          title,
          description,
          status,
          position,
          created_at,
          updated_at,
          started_at,
          completed_at
          , assigned_mission_agent_id
          , worktree_id
          , attempt_count
          , maximum_attempts
          , ready_at
          , blocked_reason
          , integration_status
          , requires_dependency_handoffs
        ) VALUES (
          ${row.id},
          ${row.missionId},
          ${row.title},
          ${row.description},
          ${row.status},
          ${row.position},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.startedAt},
          ${row.completedAt}
          , ${row.assignedMissionAgentId}
          , ${row.worktreeId}
          , ${row.attemptCount}
          , ${row.maximumAttempts}
          , ${row.readyAt}
          , ${row.blockedReason}
          , ${row.integrationStatus}
          , ${row.requiresDependencyHandoffs ? 1 : 0}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          mission_id = excluded.mission_id,
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          position = excluded.position,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at
          , assigned_mission_agent_id = excluded.assigned_mission_agent_id
          , worktree_id = excluded.worktree_id
          , attempt_count = excluded.attempt_count
          , maximum_attempts = excluded.maximum_attempts
          , ready_at = excluded.ready_at
          , blocked_reason = excluded.blocked_reason
          , integration_status = excluded.integration_status
          , requires_dependency_handoffs = excluded.requires_dependency_handoffs
      `,
  });

  const getProjectionMissionTaskRow = SqlSchema.findOneOption({
    Request: GetProjectionMissionTaskInput,
    Result: ProjectionMissionTaskDbRow,
    execute: ({ taskId }) =>
      sql`
        SELECT ${sql.unsafe(selectMissionTaskColumns)}
        FROM projection_mission_tasks
        WHERE task_id = ${taskId}
      `,
  });

  const listProjectionMissionTaskRows = SqlSchema.findAll({
    Request: ListProjectionMissionTasksInput,
    Result: ProjectionMissionTaskDbRow,
    execute: ({ missionId }) =>
      sql`
        SELECT ${sql.unsafe(selectMissionTaskColumns)}
        FROM projection_mission_tasks
        WHERE mission_id = ${missionId}
        ORDER BY position ASC, created_at ASC, task_id ASC
      `,
  });

  const upsert: ProjectionMissionTaskRepositoryShape["upsert"] = (row) =>
    upsertProjectionMissionTaskRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionMissionTaskRepository.upsert:query")),
    );

  const getById: ProjectionMissionTaskRepositoryShape["getById"] = (input) =>
    getProjectionMissionTaskRow(input).pipe(
      Effect.map(Option.map(toProjectionMissionTask)),
      Effect.mapError(toPersistenceSqlError("ProjectionMissionTaskRepository.getById:query")),
    );

  const listByMissionId: ProjectionMissionTaskRepositoryShape["listByMissionId"] = (input) =>
    listProjectionMissionTaskRows(input).pipe(
      Effect.map((rows) => rows.map(toProjectionMissionTask)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionMissionTaskRepository.listByMissionId:query"),
      ),
    );

  return {
    upsert,
    getById,
    listByMissionId,
  } satisfies ProjectionMissionTaskRepositoryShape;
});

export const ProjectionMissionTaskRepositoryLive = Layer.effect(
  ProjectionMissionTaskRepository,
  makeProjectionMissionTaskRepository,
);
