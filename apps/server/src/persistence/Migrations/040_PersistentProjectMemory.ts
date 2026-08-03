import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_memory_entries (
      memory_entry_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'project', 'branch', 'mission', 'task')),
      scope_id TEXT,
      project_id TEXT,
      branch_name TEXT,
      mission_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL CHECK (
        type IN (
          'architecture_decision', 'constraint', 'coding_convention', 'product_requirement',
          'known_issue', 'failed_approach', 'successful_pattern', 'dependency_fact',
          'environment_fact', 'command', 'test_procedure', 'release_procedure',
          'security_rule', 'user_preference', 'repository_fact', 'mission_summary',
          'task_result', 'review_feedback', 'custom'
        )
      ),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
      content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 64000),
      structured_data_json TEXT CHECK (
        structured_data_json IS NULL OR json_valid(structured_data_json)
      ),
      trust_level TEXT NOT NULL CHECK (
        trust_level IN ('authoritative', 'verified', 'supported', 'inferred', 'unverified', 'disputed')
      ),
      status TEXT NOT NULL CHECK (
        status IN ('proposed', 'active', 'stale', 'superseded', 'disputed', 'rejected', 'archived')
      ),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      created_by_type TEXT NOT NULL CHECK (created_by_type IN ('user', 'agent', 'system', 'import')),
      created_by_id TEXT,
      creation_mode TEXT NOT NULL CHECK (
        creation_mode IN ('explicit', 'proposed', 'automatic_authoritative')
      ),
      pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
      claim_fingerprint TEXT NOT NULL CHECK (length(claim_fingerprint) > 0),
      duplicate_key TEXT NOT NULL CHECK (length(duplicate_key) > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_verified_at TEXT,
      expires_at TEXT,
      superseded_by_id TEXT,
      contradiction_group_id TEXT,
      stale_reason TEXT CHECK (stale_reason IS NULL OR length(stale_reason) <= 4000),
      CHECK (
        (scope_type = 'user' AND project_id IS NULL AND branch_name IS NULL AND mission_id IS NULL AND task_id IS NULL)
        OR
        (scope_type = 'project' AND project_id IS NOT NULL AND branch_name IS NULL AND mission_id IS NULL AND task_id IS NULL)
        OR
        (scope_type = 'branch' AND project_id IS NOT NULL AND branch_name IS NOT NULL AND mission_id IS NULL AND task_id IS NULL)
        OR
        (scope_type = 'mission' AND project_id IS NOT NULL AND branch_name IS NULL AND mission_id IS NOT NULL AND task_id IS NULL)
        OR
        (scope_type = 'task' AND project_id IS NOT NULL AND branch_name IS NULL AND mission_id IS NOT NULL AND task_id IS NOT NULL)
      ),
      CHECK (
        scope_id IS NULL
        OR (scope_type = 'project' AND scope_id = project_id)
        OR (scope_type = 'branch' AND scope_id = branch_name)
        OR (scope_type = 'mission' AND scope_id = mission_id)
        OR (scope_type = 'task' AND scope_id = task_id)
        OR scope_type = 'user'
      ),
      CHECK (
        (status = 'superseded' AND superseded_by_id IS NOT NULL)
        OR (status <> 'superseded' AND superseded_by_id IS NULL)
      ),
      CHECK (status <> 'disputed' OR contradiction_group_id IS NOT NULL),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (superseded_by_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_projection_memory_entries_duplicate_active
    ON projection_memory_entries(duplicate_key)
    WHERE status IN ('proposed', 'active', 'stale', 'disputed')
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_entries_project_scope_status
    ON projection_memory_entries(project_id, scope_type, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_entries_task_status
    ON projection_memory_entries(task_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_entries_mission_status
    ON projection_memory_entries(mission_id, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_entries_branch_status
    ON projection_memory_entries(project_id, branch_name, status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_entries_contradiction
    ON projection_memory_entries(contradiction_group_id)
    WHERE contradiction_group_id IS NOT NULL
  `;

  yield* sql`
    CREATE TRIGGER projection_memory_entries_validate_mission_insert
    BEFORE INSERT ON projection_memory_entries
    WHEN NEW.mission_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM projection_missions
      WHERE mission_id = NEW.mission_id AND project_id = NEW.project_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'memory mission must belong to the selected project');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_validate_mission_update
    BEFORE UPDATE OF project_id, mission_id, task_id ON projection_memory_entries
    WHEN NEW.mission_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM projection_missions
      WHERE mission_id = NEW.mission_id AND project_id = NEW.project_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'memory mission must belong to the selected project');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_insert_as_candidate
    BEFORE INSERT ON projection_memory_entries
    WHEN NEW.status NOT IN ('proposed', 'rejected')
    BEGIN
      SELECT RAISE(ABORT, 'memory entries must be inserted as candidates before activation');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_status_transition
    BEFORE UPDATE OF status ON projection_memory_entries
    WHEN OLD.status <> NEW.status AND NOT (
      (OLD.status = 'proposed' AND NEW.status IN ('active', 'stale', 'disputed', 'superseded', 'rejected', 'archived'))
      OR (OLD.status = 'active' AND NEW.status IN ('stale', 'disputed', 'superseded', 'rejected', 'archived'))
      OR (OLD.status = 'stale' AND NEW.status IN ('active', 'disputed', 'superseded', 'archived'))
      OR (OLD.status = 'disputed' AND NEW.status IN ('active', 'stale', 'superseded', 'rejected', 'archived'))
      OR (OLD.status = 'rejected' AND NEW.status IN ('proposed', 'archived'))
      OR (OLD.status = 'archived' AND NEW.status IN ('active', 'stale', 'disputed'))
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid memory status transition');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_supersession_cycle
    BEFORE UPDATE OF superseded_by_id ON projection_memory_entries
    WHEN NEW.superseded_by_id IS NOT NULL AND (
      NEW.superseded_by_id = NEW.memory_entry_id OR EXISTS (
        WITH RECURSIVE supersession_chain(memory_entry_id, superseded_by_id) AS (
          SELECT memory_entry_id, superseded_by_id
          FROM projection_memory_entries
          WHERE memory_entry_id = NEW.superseded_by_id
          UNION
          SELECT entry.memory_entry_id, entry.superseded_by_id
          FROM projection_memory_entries AS entry
          JOIN supersession_chain AS chain
            ON entry.memory_entry_id = chain.superseded_by_id
          WHERE entry.superseded_by_id IS NOT NULL
        )
        SELECT 1 FROM supersession_chain WHERE memory_entry_id = NEW.memory_entry_id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'memory supersession cycle');
    END
  `;

  yield* sql`
    CREATE TABLE projection_memory_sources (
      memory_source_id TEXT PRIMARY KEY,
      memory_entry_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (
        source_type IN (
          'repository_file', 'git_commit', 'git_diff', 'agents_file', 'documentation',
          'user_instruction', 'mission_event', 'agent_handoff', 'verification_result',
          'github_issue', 'github_pull_request', 'github_review', 'manual_entry', 'derived'
        )
      ),
      source_identifier TEXT NOT NULL CHECK (length(trim(source_identifier)) BETWEEN 1 AND 4096),
      project_id TEXT,
      repository_path TEXT,
      file_path TEXT,
      start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
      end_line INTEGER CHECK (end_line IS NULL OR end_line > 0),
      commit_hash TEXT,
      branch_name TEXT,
      mission_id TEXT,
      task_id TEXT,
      agent_run_id TEXT,
      verification_run_id TEXT,
      github_record_type TEXT,
      github_record_id TEXT,
      message_reference TEXT,
      content_fingerprint TEXT,
      source_status TEXT NOT NULL CHECK (source_status IN ('resolved', 'changed', 'missing', 'unresolved')),
      created_at TEXT NOT NULL,
      CHECK (
        (start_line IS NULL AND end_line IS NULL)
        OR (start_line IS NOT NULL AND end_line IS NOT NULL AND end_line >= start_line)
      ),
      FOREIGN KEY (memory_entry_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_memory_sources_identity
    ON projection_memory_sources(
      memory_entry_id, source_type, source_identifier,
      coalesce(file_path, ''), coalesce(start_line, 0), coalesce(end_line, 0),
      coalesce(commit_hash, ''), coalesce(message_reference, '')
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_sources_entry
    ON projection_memory_sources(memory_entry_id, created_at, memory_source_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_sources_fingerprint
    ON projection_memory_sources(content_fingerprint)
    WHERE content_fingerprint IS NOT NULL
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_sources_preserve_last
    BEFORE DELETE ON projection_memory_sources
    WHEN EXISTS (
      SELECT 1 FROM projection_memory_entries WHERE memory_entry_id = OLD.memory_entry_id
    ) AND (
      SELECT count(*) FROM projection_memory_sources WHERE memory_entry_id = OLD.memory_entry_id
    ) <= 1
    BEGIN
      SELECT RAISE(ABORT, 'memory entry must retain at least one source');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_require_source
    BEFORE UPDATE OF status ON projection_memory_entries
    WHEN NEW.status NOT IN ('proposed', 'rejected') AND NOT EXISTS (
      SELECT 1 FROM projection_memory_sources WHERE memory_entry_id = NEW.memory_entry_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'active or historical memory requires provenance');
    END
  `;

  yield* sql`
    CREATE TABLE projection_memory_relations (
      memory_relation_id TEXT PRIMARY KEY,
      from_memory_entry_id TEXT NOT NULL,
      to_memory_entry_id TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (
        relation_type IN (
          'supports', 'contradicts', 'supersedes', 'refines', 'depends_on',
          'applies_to', 'derived_from', 'related_to'
        )
      ),
      created_at TEXT NOT NULL,
      CHECK (from_memory_entry_id <> to_memory_entry_id),
      UNIQUE (from_memory_entry_id, to_memory_entry_id, relation_type),
      FOREIGN KEY (from_memory_entry_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (to_memory_entry_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_relations_to
    ON projection_memory_relations(to_memory_entry_id, relation_type)
  `;

  yield* sql`
    CREATE TABLE projection_memory_proposals (
      memory_proposal_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'project', 'branch', 'mission', 'task')),
      scope_id TEXT,
      project_id TEXT NOT NULL,
      branch_name TEXT,
      mission_id TEXT,
      task_id TEXT,
      proposed_type TEXT NOT NULL CHECK (
        proposed_type IN (
          'architecture_decision', 'constraint', 'coding_convention', 'product_requirement',
          'known_issue', 'failed_approach', 'successful_pattern', 'dependency_fact',
          'environment_fact', 'command', 'test_procedure', 'release_procedure',
          'security_rule', 'user_preference', 'repository_fact', 'mission_summary',
          'task_result', 'review_feedback', 'custom'
        )
      ),
      proposed_title TEXT NOT NULL CHECK (length(trim(proposed_title)) BETWEEN 1 AND 500),
      proposed_content TEXT NOT NULL CHECK (length(trim(proposed_content)) BETWEEN 1 AND 64000),
      proposed_structured_data_json TEXT CHECK (
        proposed_structured_data_json IS NULL OR json_valid(proposed_structured_data_json)
      ),
      proposed_trust_level TEXT NOT NULL CHECK (
        proposed_trust_level IN ('authoritative', 'verified', 'supported', 'inferred', 'unverified', 'disputed')
      ),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      extraction_source TEXT NOT NULL CHECK (length(trim(extraction_source)) BETWEEN 1 AND 255),
      claim_fingerprint TEXT NOT NULL CHECK (length(claim_fingerprint) > 0),
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'accepted', 'edited_and_accepted', 'rejected', 'expired', 'duplicate', 'deferred')
      ),
      reviewed_by TEXT,
      reviewed_at TEXT,
      rejection_reason TEXT,
      duplicate_of_memory_entry_id TEXT,
      accepted_memory_entry_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      CHECK (
        (scope_type = 'user' AND branch_name IS NULL AND mission_id IS NULL AND task_id IS NULL)
        OR (scope_type = 'project' AND branch_name IS NULL AND mission_id IS NULL AND task_id IS NULL)
        OR (scope_type = 'branch' AND branch_name IS NOT NULL AND mission_id IS NULL AND task_id IS NULL)
        OR (scope_type = 'mission' AND branch_name IS NULL AND mission_id IS NOT NULL AND task_id IS NULL)
        OR (scope_type = 'task' AND branch_name IS NULL AND mission_id IS NOT NULL AND task_id IS NOT NULL)
      ),
      CHECK (
        scope_id IS NULL
        OR (scope_type = 'project' AND scope_id = project_id)
        OR (scope_type = 'branch' AND scope_id = branch_name)
        OR (scope_type = 'mission' AND scope_id = mission_id)
        OR (scope_type = 'task' AND scope_id = task_id)
        OR scope_type = 'user'
      ),
      CHECK (
        (status IN ('accepted', 'edited_and_accepted') AND accepted_memory_entry_id IS NOT NULL)
        OR (status NOT IN ('accepted', 'edited_and_accepted') AND accepted_memory_entry_id IS NULL)
      ),
      CHECK (
        (status = 'duplicate' AND duplicate_of_memory_entry_id IS NOT NULL)
        OR (status <> 'duplicate' AND duplicate_of_memory_entry_id IS NULL)
      ),
      CHECK (status NOT IN ('accepted', 'edited_and_accepted', 'rejected', 'duplicate') OR reviewed_at IS NOT NULL),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (duplicate_of_memory_entry_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (accepted_memory_entry_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_proposals_project_status
    ON projection_memory_proposals(project_id, status, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_proposals_fingerprint
    ON projection_memory_proposals(project_id, claim_fingerprint, status)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_proposals_accepted_entry
    ON projection_memory_proposals(accepted_memory_entry_id)
    WHERE accepted_memory_entry_id IS NOT NULL
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_proposals_validate_mission_insert
    BEFORE INSERT ON projection_memory_proposals
    WHEN NEW.mission_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM projection_missions
      WHERE mission_id = NEW.mission_id AND project_id = NEW.project_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'memory proposal mission must belong to the selected project');
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_proposals_status_transition
    BEFORE UPDATE OF status ON projection_memory_proposals
    WHEN OLD.status <> NEW.status AND NOT (
      (OLD.status = 'pending' AND NEW.status IN ('accepted', 'edited_and_accepted', 'rejected', 'expired', 'duplicate', 'deferred'))
      OR (OLD.status = 'deferred' AND NEW.status IN ('pending', 'accepted', 'edited_and_accepted', 'rejected', 'expired', 'duplicate'))
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid memory proposal status transition');
    END
  `;

  yield* sql`
    CREATE TABLE projection_memory_proposal_sources (
      proposal_source_id TEXT PRIMARY KEY,
      memory_proposal_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (
        source_type IN (
          'repository_file', 'git_commit', 'git_diff', 'agents_file', 'documentation',
          'user_instruction', 'mission_event', 'agent_handoff', 'verification_result',
          'github_issue', 'github_pull_request', 'github_review', 'manual_entry', 'derived'
        )
      ),
      source_identifier TEXT NOT NULL CHECK (length(trim(source_identifier)) BETWEEN 1 AND 4096),
      project_id TEXT,
      repository_path TEXT,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      commit_hash TEXT,
      branch_name TEXT,
      mission_id TEXT,
      task_id TEXT,
      agent_run_id TEXT,
      verification_run_id TEXT,
      github_record_type TEXT,
      github_record_id TEXT,
      message_reference TEXT,
      content_fingerprint TEXT,
      created_at TEXT NOT NULL,
      CHECK (
        (start_line IS NULL AND end_line IS NULL)
        OR (start_line > 0 AND end_line >= start_line)
      ),
      UNIQUE (memory_proposal_id, proposal_source_id),
      FOREIGN KEY (memory_proposal_id) REFERENCES projection_memory_proposals(memory_proposal_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (verification_run_id) REFERENCES projection_verification_runs(verification_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_proposal_sources_proposal
    ON projection_memory_proposal_sources(memory_proposal_id, created_at, proposal_source_id)
  `;

  yield* sql`
    CREATE TABLE projection_memory_indexed_sources (
      indexed_source_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (
        source_type IN (
          'repository_file', 'repository_map', 'github_issue', 'github_pull_request',
          'github_review', 'agent_handoff', 'verification_summary'
        )
      ),
      source_identifier TEXT NOT NULL CHECK (length(trim(source_identifier)) BETWEEN 1 AND 4096),
      relative_path TEXT,
      branch_name TEXT,
      commit_hash TEXT,
      content_fingerprint TEXT NOT NULL CHECK (length(content_fingerprint) > 0),
      language TEXT,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      index_status TEXT NOT NULL CHECK (
        index_status IN ('queued', 'indexing', 'indexed', 'skipped', 'stale', 'failed', 'removed')
      ),
      skip_reason TEXT,
      last_indexed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_memory_indexed_sources_identity
    ON projection_memory_indexed_sources(
      project_id, source_type, source_identifier, coalesce(branch_name, ''), coalesce(commit_hash, '')
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_indexed_sources_project_status
    ON projection_memory_indexed_sources(project_id, index_status, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_indexed_sources_fingerprint
    ON projection_memory_indexed_sources(project_id, content_fingerprint)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_indexed_sources_path
    ON projection_memory_indexed_sources(project_id, relative_path, branch_name)
  `;

  yield* sql`
    CREATE TABLE projection_memory_indexed_chunks (
      indexed_chunk_id TEXT PRIMARY KEY,
      indexed_source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
      end_line INTEGER CHECK (end_line IS NULL OR end_line > 0),
      content TEXT NOT NULL CHECK (length(content) <= 64000),
      content_fingerprint TEXT NOT NULL CHECK (length(content_fingerprint) > 0),
      token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
      symbol_metadata_json TEXT CHECK (
        symbol_metadata_json IS NULL OR json_valid(symbol_metadata_json)
      ),
      embedding_status TEXT NOT NULL CHECK (
        embedding_status IN ('disabled', 'queued', 'embedding', 'embedded', 'stale', 'failed')
      ),
      embedding_provider TEXT,
      embedding_model TEXT,
      embedding_dimensions INTEGER CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (start_line IS NULL AND end_line IS NULL)
        OR (start_line IS NOT NULL AND end_line IS NOT NULL AND end_line >= start_line)
      ),
      CHECK (
        (embedding_provider IS NULL AND embedding_model IS NULL AND embedding_dimensions IS NULL)
        OR (embedding_provider IS NOT NULL AND embedding_model IS NOT NULL AND embedding_dimensions IS NOT NULL)
      ),
      UNIQUE (indexed_source_id, chunk_index),
      FOREIGN KEY (indexed_source_id) REFERENCES projection_memory_indexed_sources(indexed_source_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_indexed_chunks_source
    ON projection_memory_indexed_chunks(indexed_source_id, chunk_index)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_indexed_chunks_fingerprint
    ON projection_memory_indexed_chunks(content_fingerprint)
  `;

  yield* sql`
    CREATE TABLE projection_memory_chunk_embeddings (
      indexed_chunk_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK (dimensions > 0),
      vector_blob BLOB NOT NULL,
      content_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (indexed_chunk_id, provider_id, model),
      FOREIGN KEY (indexed_chunk_id) REFERENCES projection_memory_indexed_chunks(indexed_chunk_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE projection_memory_settings (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      automatic_proposal_generation INTEGER NOT NULL CHECK (automatic_proposal_generation IN (0, 1)),
      automatic_authoritative_indexing INTEGER NOT NULL CHECK (automatic_authoritative_indexing IN (0, 1)),
      repository_exclusions_json TEXT NOT NULL CHECK (json_valid(repository_exclusions_json)),
      maximum_indexed_file_size_bytes INTEGER NOT NULL CHECK (maximum_indexed_file_size_bytes > 0),
      context_token_budget INTEGER NOT NULL CHECK (context_token_budget >= 0),
      lexical_only INTEGER NOT NULL CHECK (lexical_only IN (0, 1)),
      semantic_retrieval_enabled INTEGER NOT NULL CHECK (semantic_retrieval_enabled IN (0, 1)),
      embedding_provider_kind TEXT NOT NULL CHECK (embedding_provider_kind IN ('none', 'local', 'remote')),
      embedding_provider_id TEXT,
      embedding_model TEXT,
      embedding_dimensions INTEGER CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
      remote_code_upload_accepted_at TEXT,
      proposal_retention_days INTEGER NOT NULL CHECK (proposal_retention_days > 0),
      stale_memory_behavior TEXT NOT NULL CHECK (stale_memory_behavior IN ('exclude', 'demote', 'include_labeled')),
      indexing_paused INTEGER NOT NULL CHECK (indexing_paused IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (semantic_retrieval_enabled = 0 OR embedding_provider_kind <> 'none'),
      CHECK (embedding_provider_kind <> 'remote' OR remote_code_upload_accepted_at IS NOT NULL),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE projection_memory_index_operations (
      memory_index_operation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK (
        operation_type IN ('refresh_changed', 'full_reindex', 'branch_refresh', 'clear_derived_index', 'recovery')
      ),
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'interrupted', 'failed', 'cancelled')
      ),
      branch_name TEXT,
      commit_hash TEXT,
      processed_sources INTEGER NOT NULL CHECK (processed_sources >= 0),
      changed_sources INTEGER NOT NULL CHECK (changed_sources >= 0),
      skipped_sources INTEGER NOT NULL CHECK (skipped_sources >= 0),
      failed_sources INTEGER NOT NULL CHECK (failed_sources >= 0),
      error_summary TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      CHECK (status <> 'running' OR started_at IS NOT NULL),
      CHECK (status NOT IN ('completed', 'interrupted', 'failed', 'cancelled') OR completed_at IS NOT NULL),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_memory_index_operations_one_active
    ON projection_memory_index_operations(project_id)
    WHERE status IN ('queued', 'running')
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_index_operations_project_requested
    ON projection_memory_index_operations(project_id, requested_at DESC)
  `;

  yield* sql`
    CREATE TABLE projection_memory_lifecycle (
      memory_lifecycle_record_id TEXT PRIMARY KEY,
      memory_entry_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (
        action IN (
          'created', 'updated', 'activated', 'marked_stale', 'verified', 'superseded',
          'disputed', 'rejected', 'archived', 'restored', 'pinned', 'unpinned',
          'scope_changed', 'source_added'
        )
      ),
      previous_status TEXT CHECK (
        previous_status IS NULL OR previous_status IN (
          'proposed', 'active', 'stale', 'superseded', 'disputed', 'rejected', 'archived'
        )
      ),
      next_status TEXT CHECK (
        next_status IS NULL OR next_status IN (
          'proposed', 'active', 'stale', 'superseded', 'disputed', 'rejected', 'archived'
        )
      ),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system', 'import')),
      actor_id TEXT,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_entry_id) REFERENCES projection_memory_entries(memory_entry_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_lifecycle_entry_created
    ON projection_memory_lifecycle(memory_entry_id, created_at, memory_lifecycle_record_id)
  `;

  yield* sql`
    CREATE TABLE projection_memory_retrieval_records (
      memory_retrieval_record_id TEXT PRIMARY KEY,
      agent_run_id TEXT,
      thread_id TEXT,
      message_id TEXT,
      project_id TEXT NOT NULL,
      mission_id TEXT,
      task_id TEXT,
      branch_name TEXT,
      query TEXT NOT NULL CHECK (length(query) <= 16000),
      retrieval_mode TEXT NOT NULL CHECK (
        retrieval_mode IN ('lexical', 'semantic', 'hybrid', 'explicit', 'disabled')
      ),
      selected_memory_ids_json TEXT NOT NULL CHECK (json_valid(selected_memory_ids_json)),
      selected_chunk_ids_json TEXT NOT NULL CHECK (json_valid(selected_chunk_ids_json)),
      excluded_candidate_count INTEGER NOT NULL CHECK (excluded_candidate_count >= 0),
      token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
      ranking_metadata_json TEXT NOT NULL CHECK (json_valid(ranking_metadata_json)),
      status TEXT NOT NULL CHECK (status IN ('completed', 'disabled', 'unavailable', 'failed')),
      error_summary TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_run_id) REFERENCES projection_agent_runs(agent_run_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (thread_id) REFERENCES projection_threads(thread_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (message_id) REFERENCES projection_thread_messages(message_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id) REFERENCES projection_missions(mission_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (mission_id, task_id) REFERENCES projection_mission_tasks(mission_id, task_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_retrieval_records_run_created
    ON projection_memory_retrieval_records(agent_run_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_projection_memory_retrieval_records_project_created
    ON projection_memory_retrieval_records(project_id, created_at DESC)
  `;

  yield* sql`
    CREATE VIRTUAL TABLE projection_memory_entries_fts USING fts5(
      memory_entry_id UNINDEXED,
      title,
      content,
      content = 'projection_memory_entries',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_fts_insert
    AFTER INSERT ON projection_memory_entries
    BEGIN
      INSERT INTO projection_memory_entries_fts(rowid, memory_entry_id, title, content)
      VALUES (NEW.rowid, NEW.memory_entry_id, NEW.title, NEW.content);
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_fts_delete
    AFTER DELETE ON projection_memory_entries
    BEGIN
      INSERT INTO projection_memory_entries_fts(
        projection_memory_entries_fts, rowid, memory_entry_id, title, content
      ) VALUES ('delete', OLD.rowid, OLD.memory_entry_id, OLD.title, OLD.content);
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_entries_fts_update
    AFTER UPDATE OF title, content ON projection_memory_entries
    BEGIN
      INSERT INTO projection_memory_entries_fts(
        projection_memory_entries_fts, rowid, memory_entry_id, title, content
      ) VALUES ('delete', OLD.rowid, OLD.memory_entry_id, OLD.title, OLD.content);
      INSERT INTO projection_memory_entries_fts(rowid, memory_entry_id, title, content)
      VALUES (NEW.rowid, NEW.memory_entry_id, NEW.title, NEW.content);
    END
  `;

  yield* sql`
    CREATE VIRTUAL TABLE projection_memory_indexed_chunks_fts USING fts5(
      indexed_chunk_id UNINDEXED,
      content,
      symbol_metadata_json,
      content = 'projection_memory_indexed_chunks',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_indexed_chunks_fts_insert
    AFTER INSERT ON projection_memory_indexed_chunks
    BEGIN
      INSERT INTO projection_memory_indexed_chunks_fts(
        rowid, indexed_chunk_id, content, symbol_metadata_json
      ) VALUES (
        NEW.rowid, NEW.indexed_chunk_id, NEW.content, coalesce(NEW.symbol_metadata_json, '')
      );
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_indexed_chunks_fts_delete
    AFTER DELETE ON projection_memory_indexed_chunks
    BEGIN
      INSERT INTO projection_memory_indexed_chunks_fts(
        projection_memory_indexed_chunks_fts, rowid, indexed_chunk_id, content, symbol_metadata_json
      ) VALUES (
        'delete', OLD.rowid, OLD.indexed_chunk_id, OLD.content,
        coalesce(OLD.symbol_metadata_json, '')
      );
    END
  `;
  yield* sql`
    CREATE TRIGGER projection_memory_indexed_chunks_fts_update
    AFTER UPDATE OF content, symbol_metadata_json ON projection_memory_indexed_chunks
    BEGIN
      INSERT INTO projection_memory_indexed_chunks_fts(
        projection_memory_indexed_chunks_fts, rowid, indexed_chunk_id, content, symbol_metadata_json
      ) VALUES (
        'delete', OLD.rowid, OLD.indexed_chunk_id, OLD.content,
        coalesce(OLD.symbol_metadata_json, '')
      );
      INSERT INTO projection_memory_indexed_chunks_fts(
        rowid, indexed_chunk_id, content, symbol_metadata_json
      ) VALUES (
        NEW.rowid, NEW.indexed_chunk_id, NEW.content, coalesce(NEW.symbol_metadata_json, '')
      );
    END
  `;
});
