import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionMissionInput,
  ListProjectionMissionsByProjectInput,
  ProjectionMission,
  ProjectionMissionRepository,
  type ProjectionMissionRepositoryShape,
} from "../Services/ProjectionMissions.ts";
import { DEFAULT_MISSION_TEAM_SETTINGS, MissionTeamSettings } from "@t3tools/contracts";

const selectMissionColumns = `
  mission_id AS "id",
  project_id AS "projectId",
  title,
  description,
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  started_at AS "startedAt",
  completed_at AS "completedAt",
  cancelled_at AS "cancelledAt",
  json_object(
    'maximumConcurrentAgents', maximum_concurrent_agents,
    'maximumConcurrentWriteAgents', maximum_concurrent_write_agents,
    'defaultMaximumTaskAttempts', default_maximum_task_attempts,
    'autoStartReadyTasks', json(CASE WHEN auto_start_ready_tasks = 1 THEN 'true' ELSE 'false' END),
    'integrationMode', integration_mode
  ) AS "teamSettings",
  scheduler_status AS "schedulerStatus"
`;

const ProjectionMissionDbRow = ProjectionMission.mapFields(
  Struct.assign({ teamSettings: Schema.fromJsonString(MissionTeamSettings) }),
);

const makeProjectionMissionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionMissionRow = SqlSchema.void({
    Request: ProjectionMission,
    execute: (row) => {
      const teamSettings = row.teamSettings ?? DEFAULT_MISSION_TEAM_SETTINGS;
      const schedulerStatus = row.schedulerStatus ?? "idle";
      return sql`
        INSERT INTO projection_missions (
          mission_id,
          project_id,
          title,
          description,
          status,
          created_at,
          updated_at,
          started_at,
          completed_at,
          cancelled_at,
          maximum_concurrent_agents,
          maximum_concurrent_write_agents,
          default_maximum_task_attempts,
          auto_start_ready_tasks,
          integration_mode,
          scheduler_status
        ) VALUES (
          ${row.id},
          ${row.projectId},
          ${row.title},
          ${row.description},
          ${row.status},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.cancelledAt},
          ${teamSettings.maximumConcurrentAgents},
          ${teamSettings.maximumConcurrentWriteAgents},
          ${teamSettings.defaultMaximumTaskAttempts},
          ${teamSettings.autoStartReadyTasks ? 1 : 0},
          ${teamSettings.integrationMode},
          ${schedulerStatus}
        )
        ON CONFLICT (mission_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          cancelled_at = excluded.cancelled_at,
          maximum_concurrent_agents = excluded.maximum_concurrent_agents,
          maximum_concurrent_write_agents = excluded.maximum_concurrent_write_agents,
          default_maximum_task_attempts = excluded.default_maximum_task_attempts,
          auto_start_ready_tasks = excluded.auto_start_ready_tasks,
          integration_mode = excluded.integration_mode,
          scheduler_status = excluded.scheduler_status
      `;
    },
  });

  const getProjectionMissionRow = SqlSchema.findOneOption({
    Request: GetProjectionMissionInput,
    Result: ProjectionMissionDbRow,
    execute: ({ missionId }) =>
      sql`
        SELECT ${sql.unsafe(selectMissionColumns)}
        FROM projection_missions
        WHERE mission_id = ${missionId}
      `,
  });

  const listProjectionMissionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionMissionDbRow,
    execute: () =>
      sql`
        SELECT ${sql.unsafe(selectMissionColumns)}
        FROM projection_missions
        ORDER BY updated_at DESC, mission_id ASC
      `,
  });

  const listProjectionMissionRowsByProject = SqlSchema.findAll({
    Request: ListProjectionMissionsByProjectInput,
    Result: ProjectionMissionDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT ${sql.unsafe(selectMissionColumns)}
        FROM projection_missions
        WHERE project_id = ${projectId}
        ORDER BY updated_at DESC, mission_id ASC
      `,
  });

  const upsert: ProjectionMissionRepositoryShape["upsert"] = (row) =>
    upsertProjectionMissionRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionMissionRepository.upsert:query")),
    );

  const getById: ProjectionMissionRepositoryShape["getById"] = (input) =>
    getProjectionMissionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionMissionRepository.getById:query")),
    );

  const listAll: ProjectionMissionRepositoryShape["listAll"] = () =>
    listProjectionMissionRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionMissionRepository.listAll:query")),
    );

  const listByProjectId: ProjectionMissionRepositoryShape["listByProjectId"] = (input) =>
    listProjectionMissionRowsByProject(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionMissionRepository.listByProjectId:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    listByProjectId,
  } satisfies ProjectionMissionRepositoryShape;
});

export const ProjectionMissionRepositoryLive = Layer.effect(
  ProjectionMissionRepository,
  makeProjectionMissionRepository,
);
