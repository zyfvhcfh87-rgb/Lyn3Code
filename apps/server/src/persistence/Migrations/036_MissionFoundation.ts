import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_missions (
      mission_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'backlog',
          'planning',
          'ready',
          'running',
          'verification',
          'review',
          'blocked',
          'completed',
          'cancelled',
          'failed'
        )
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE TABLE projection_mission_tasks (
      task_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('backlog', 'ready', 'running', 'blocked', 'completed', 'cancelled', 'failed')
      ),
      position INTEGER NOT NULL CHECK (position >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE (mission_id, task_id),
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_agent_runs (
      agent_run_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      task_id TEXT,
      thread_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      provider_session_id TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('starting', 'running', 'cancelling', 'completed', 'cancelled', 'failed', 'interrupted')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_summary TEXT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE INDEX idx_projection_missions_project_status_updated
    ON projection_missions(project_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_missions_status_updated
    ON projection_missions(status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_mission_tasks_mission_position
    ON projection_mission_tasks(mission_id, position, task_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_mission_tasks_mission_status
    ON projection_mission_tasks(mission_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_agent_runs_mission_status_started
    ON projection_agent_runs(mission_id, status, started_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_agent_runs_task_status
    ON projection_agent_runs(task_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_agent_runs_thread_status
    ON projection_agent_runs(thread_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_agent_runs_one_active_per_mission
    ON projection_agent_runs(mission_id)
    WHERE status IN ('starting', 'running', 'cancelling')
  `;
  yield* sql`
    CREATE INDEX idx_orchestration_events_stream_occurred_sequence
    ON orchestration_events(aggregate_kind, stream_id, occurred_at, sequence)
  `;
});
