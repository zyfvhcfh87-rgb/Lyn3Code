import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  completed_at AS "completedAt"
`;

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
      `,
  });

  const getProjectionMissionTaskRow = SqlSchema.findOneOption({
    Request: GetProjectionMissionTaskInput,
    Result: ProjectionMissionTask,
    execute: ({ taskId }) =>
      sql`
        SELECT ${sql.unsafe(selectMissionTaskColumns)}
        FROM projection_mission_tasks
        WHERE task_id = ${taskId}
      `,
  });

  const listProjectionMissionTaskRows = SqlSchema.findAll({
    Request: ListProjectionMissionTasksInput,
    Result: ProjectionMissionTask,
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
      Effect.mapError(toPersistenceSqlError("ProjectionMissionTaskRepository.getById:query")),
    );

  const listByMissionId: ProjectionMissionTaskRepositoryShape["listByMissionId"] = (input) =>
    listProjectionMissionTaskRows(input).pipe(
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
