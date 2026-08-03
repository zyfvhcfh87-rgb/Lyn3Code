import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionAgentRunInput,
  GetProjectionAgentRunByThreadInput,
  ListProjectionAgentRunsInput,
  ProjectionAgentRun,
  ProjectionAgentRunRepository,
  type ProjectionAgentRunRepositoryShape,
} from "../Services/ProjectionAgentRuns.ts";

const selectAgentRunColumns = `
  agent_run_id AS "id",
  mission_id AS "missionId",
  task_id AS "taskId",
  thread_id AS "threadId",
  provider,
  provider_instance_id AS "providerInstanceId",
  provider_session_id AS "providerSessionId",
  status,
  created_at AS "createdAt",
  started_at AS "startedAt",
  updated_at AS "updatedAt",
  completed_at AS "completedAt",
  error_summary AS "errorSummary"
`;

const makeProjectionAgentRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionAgentRunRow = SqlSchema.void({
    Request: ProjectionAgentRun,
    execute: (row) =>
      sql`
        INSERT INTO projection_agent_runs (
          agent_run_id,
          mission_id,
          task_id,
          thread_id,
          provider,
          provider_instance_id,
          provider_session_id,
          status,
          created_at,
          started_at,
          updated_at,
          completed_at,
          error_summary
        ) VALUES (
          ${row.id},
          ${row.missionId},
          ${row.taskId},
          ${row.threadId},
          ${row.provider},
          ${row.providerInstanceId},
          ${row.providerSessionId},
          ${row.status},
          ${row.createdAt},
          ${row.startedAt},
          ${row.updatedAt},
          ${row.completedAt},
          ${row.errorSummary}
        )
        ON CONFLICT (agent_run_id)
        DO UPDATE SET
          mission_id = excluded.mission_id,
          task_id = excluded.task_id,
          thread_id = excluded.thread_id,
          provider = excluded.provider,
          provider_instance_id = excluded.provider_instance_id,
          provider_session_id = excluded.provider_session_id,
          status = excluded.status,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at,
          error_summary = excluded.error_summary
      `,
  });

  const getProjectionAgentRunRow = SqlSchema.findOneOption({
    Request: GetProjectionAgentRunInput,
    Result: ProjectionAgentRun,
    execute: ({ agentRunId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE agent_run_id = ${agentRunId}
      `,
  });

  const getActiveProjectionAgentRunRow = SqlSchema.findOneOption({
    Request: ListProjectionAgentRunsInput,
    Result: ProjectionAgentRun,
    execute: ({ missionId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE mission_id = ${missionId}
          AND status IN ('starting', 'running', 'cancelling')
      `,
  });

  const getProjectionAgentRunRowByThread = SqlSchema.findOneOption({
    Request: GetProjectionAgentRunByThreadInput,
    Result: ProjectionAgentRun,
    execute: ({ threadId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC, agent_run_id DESC
        LIMIT 1
      `,
  });

  const listProjectionAgentRunRows = SqlSchema.findAll({
    Request: ListProjectionAgentRunsInput,
    Result: ProjectionAgentRun,
    execute: ({ missionId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE mission_id = ${missionId}
        ORDER BY created_at ASC, agent_run_id ASC
      `,
  });

  const listActiveProjectionAgentRunRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionAgentRun,
    execute: () =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE status IN ('starting', 'running', 'cancelling')
        ORDER BY created_at ASC, agent_run_id ASC
      `,
  });

  const upsert: ProjectionAgentRunRepositoryShape["upsert"] = (row) =>
    upsertProjectionAgentRunRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.upsert:query")),
    );

  const getById: ProjectionAgentRunRepositoryShape["getById"] = (input) =>
    getProjectionAgentRunRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.getById:query")),
    );

  const getActiveByMissionId: ProjectionAgentRunRepositoryShape["getActiveByMissionId"] = (input) =>
    getActiveProjectionAgentRunRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAgentRunRepository.getActiveByMissionId:query"),
      ),
    );

  const getByThreadId: ProjectionAgentRunRepositoryShape["getByThreadId"] = (input) =>
    getProjectionAgentRunRowByThread(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.getByThreadId:query")),
    );

  const listByMissionId: ProjectionAgentRunRepositoryShape["listByMissionId"] = (input) =>
    listProjectionAgentRunRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.listByMissionId:query")),
    );

  const listActive: ProjectionAgentRunRepositoryShape["listActive"] = () =>
    listActiveProjectionAgentRunRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.listActive:query")),
    );

  return {
    upsert,
    getById,
    getActiveByMissionId,
    getByThreadId,
    listByMissionId,
    listActive,
  } satisfies ProjectionAgentRunRepositoryShape;
});

export const ProjectionAgentRunRepositoryLive = Layer.effect(
  ProjectionAgentRunRepository,
  makeProjectionAgentRunRepository,
);
