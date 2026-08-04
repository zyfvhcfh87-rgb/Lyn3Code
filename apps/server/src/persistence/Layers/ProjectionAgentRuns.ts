import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { AgentPermissions, AgentRunModelSelection } from "@t3tools/contracts";

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
  error_summary AS "errorSummary",
  mission_agent_id AS "missionAgentId",
  worktree_id AS "worktreeId",
  attempt_number AS "attemptNumber",
  permissions_json AS "permissions",
  write_capable AS "writeCapable",
  purpose,
  repair_attempt_id AS "repairAttemptId",
  routing_decision_id AS "routingDecisionId",
  model_selection_json AS "modelSelection",
  routing_reasoning_level AS "reasoningLevel"
`;

const ProjectionAgentRunDbRow = ProjectionAgentRun.mapFields(
  Struct.assign({
    permissions: Schema.fromJsonString(AgentPermissions),
    writeCapable: Schema.Number,
    modelSelection: Schema.NullOr(Schema.fromJsonString(AgentRunModelSelection)),
  }),
);

const toProjectionAgentRun = (row: typeof ProjectionAgentRunDbRow.Type): ProjectionAgentRun => {
  const { routingDecisionId, modelSelection, reasoningLevel, ...legacyRow } = row;
  return {
    ...legacyRow,
    writeCapable: row.writeCapable === 1,
    ...(routingDecisionId === null ? {} : { routingDecisionId }),
    ...(modelSelection === null ? {} : { modelSelection }),
    ...(reasoningLevel === null ? {} : { reasoningLevel }),
  };
};

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
          error_summary,
          mission_agent_id,
          worktree_id,
          attempt_number,
          permissions_json,
          write_capable,
          purpose,
          repair_attempt_id,
          routing_decision_id,
          model_selection_json,
          routing_reasoning_level
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
          ${row.errorSummary},
          ${row.missionAgentId},
          ${row.worktreeId},
          ${row.attemptNumber},
          ${JSON.stringify(row.permissions)},
          ${row.writeCapable ? 1 : 0},
          ${row.purpose ?? "implementation"},
          ${row.repairAttemptId ?? null},
          ${row.routingDecisionId ?? null},
          ${row.modelSelection === undefined || row.modelSelection === null ? null : JSON.stringify(row.modelSelection)},
          ${row.reasoningLevel ?? null}
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
          error_summary = excluded.error_summary,
          mission_agent_id = excluded.mission_agent_id,
          worktree_id = excluded.worktree_id,
          attempt_number = excluded.attempt_number,
          permissions_json = excluded.permissions_json,
          write_capable = excluded.write_capable,
          purpose = excluded.purpose,
          repair_attempt_id = excluded.repair_attempt_id,
          routing_decision_id = excluded.routing_decision_id,
          model_selection_json = excluded.model_selection_json,
          routing_reasoning_level = excluded.routing_reasoning_level
      `,
  });

  const getProjectionAgentRunRow = SqlSchema.findOneOption({
    Request: GetProjectionAgentRunInput,
    Result: ProjectionAgentRunDbRow,
    execute: ({ agentRunId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE agent_run_id = ${agentRunId}
      `,
  });

  const getActiveProjectionAgentRunRow = SqlSchema.findOneOption({
    Request: ListProjectionAgentRunsInput,
    Result: ProjectionAgentRunDbRow,
    execute: ({ missionId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE mission_id = ${missionId}
          AND status IN ('starting', 'running', 'cancelling')
        ORDER BY created_at ASC, agent_run_id ASC
        LIMIT 1
      `,
  });

  const listActiveProjectionAgentRunRowsByMission = SqlSchema.findAll({
    Request: ListProjectionAgentRunsInput,
    Result: ProjectionAgentRunDbRow,
    execute: ({ missionId }) =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE mission_id = ${missionId}
          AND status IN ('starting', 'running', 'cancelling')
        ORDER BY created_at ASC, agent_run_id ASC
      `,
  });

  const getProjectionAgentRunRowByThread = SqlSchema.findOneOption({
    Request: GetProjectionAgentRunByThreadInput,
    Result: ProjectionAgentRunDbRow,
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
    Result: ProjectionAgentRunDbRow,
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
    Result: ProjectionAgentRunDbRow,
    execute: () =>
      sql`
        SELECT ${sql.unsafe(selectAgentRunColumns)}
        FROM projection_agent_runs
        WHERE status IN ('starting', 'running', 'cancelling')
        ORDER BY created_at ASC, agent_run_id ASC
      `,
  });

  const upsert: ProjectionAgentRunRepositoryShape["upsert"] = (row) =>
    Effect.gen(function* () {
      yield* upsertProjectionAgentRunRow(row);
      if (row.routingDecisionId !== undefined && row.routingDecisionId !== null) {
        yield* sql`
          UPDATE projection_routing_decisions
          SET
            status = 'applied',
            agent_run_id = ${row.id},
            applied_at = ${row.createdAt}
          WHERE routing_decision_id = ${row.routingDecisionId}
            AND status = 'planned'
        `;
      }
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.upsert:query")));

  const getById: ProjectionAgentRunRepositoryShape["getById"] = (input) =>
    getProjectionAgentRunRow(input).pipe(
      Effect.map(Option.map(toProjectionAgentRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.getById:query")),
    );

  const getActiveByMissionId: ProjectionAgentRunRepositoryShape["getActiveByMissionId"] = (input) =>
    getActiveProjectionAgentRunRow(input).pipe(
      Effect.map(Option.map(toProjectionAgentRun)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionAgentRunRepository.getActiveByMissionId:query"),
      ),
    );

  const listActiveByMissionId: ProjectionAgentRunRepositoryShape["listActiveByMissionId"] = (
    input,
  ) =>
    listActiveProjectionAgentRunRowsByMission(input).pipe(
      Effect.map((rows) => rows.map(toProjectionAgentRun)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionAgentRunRepository.listActiveByMissionId:query"),
      ),
    );

  const getByThreadId: ProjectionAgentRunRepositoryShape["getByThreadId"] = (input) =>
    getProjectionAgentRunRowByThread(input).pipe(
      Effect.map(Option.map(toProjectionAgentRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.getByThreadId:query")),
    );

  const listByMissionId: ProjectionAgentRunRepositoryShape["listByMissionId"] = (input) =>
    listProjectionAgentRunRows(input).pipe(
      Effect.map((rows) => rows.map(toProjectionAgentRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.listByMissionId:query")),
    );

  const listActive: ProjectionAgentRunRepositoryShape["listActive"] = () =>
    listActiveProjectionAgentRunRows().pipe(
      Effect.map((rows) => rows.map(toProjectionAgentRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionAgentRunRepository.listActive:query")),
    );

  return {
    upsert,
    getById,
    getActiveByMissionId,
    listActiveByMissionId,
    getByThreadId,
    listByMissionId,
    listActive,
  } satisfies ProjectionAgentRunRepositoryShape;
});

export const ProjectionAgentRunRepositoryLive = Layer.effect(
  ProjectionAgentRunRepository,
  makeProjectionAgentRunRepository,
);
