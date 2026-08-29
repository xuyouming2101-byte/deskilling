import "server-only";

export const CURRENT_LOCAL_SCHEMA_VERSION = 1;

export const LOCAL_SCHEMA_V1_SQL = `
CREATE TABLE local_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE local_study_packages (
  checksum_sha256 TEXT PRIMARY KEY CHECK (length(checksum_sha256) = 64),
  package_version INTEGER NOT NULL,
  minimum_schema_version INTEGER NOT NULL,
  study_mode TEXT NOT NULL CHECK (study_mode IN ('dev', 'formal')),
  generated_at TEXT NOT NULL,
  allowed_participant_ids_json TEXT NOT NULL,
  canonical_manifest_json TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE TABLE local_assessment_attempts (
  attempt_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  session_number INTEGER NOT NULL CHECK (session_number BETWEEN 1 AND 3),
  runtime_channel TEXT NOT NULL DEFAULT 'local' CHECK (runtime_channel = 'local'),
  study_mode TEXT NOT NULL CHECK (study_mode IN ('dev', 'formal')),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned', 'invalid')),
  valid_for_analysis INTEGER NOT NULL DEFAULT 0 CHECK (valid_for_analysis IN (0, 1)),
  replaces_attempt_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'never_synced'
    CHECK (sync_state IN ('never_synced', 'syncing', 'synced', 'sync_failed', 'conflict')),
  sync_payload_sha256 TEXT,
  study_package_checksum TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (attempt_id, participant_id, session_number),
  CHECK (replaces_attempt_id IS NULL OR replaces_attempt_id <> attempt_id),
  CHECK (valid_for_analysis = 0 OR status = 'completed'),
  FOREIGN KEY (replaces_attempt_id) REFERENCES local_assessment_attempts(attempt_id),
  FOREIGN KEY (study_package_checksum) REFERENCES local_study_packages(checksum_sha256)
);

CREATE TABLE local_video_metadata_snapshot (
  attempt_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  has_lesion INTEGER NOT NULL CHECK (has_lesion IN (0, 1)),
  lesion_onset_ms INTEGER,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  session_pool INTEGER CHECK (session_pool IS NULL OR session_pool BETWEEN 1 AND 3),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64),
  PRIMARY KEY (attempt_id, video_id),
  UNIQUE (attempt_id, file_path),
  UNIQUE (attempt_id, participant_id, session_number, video_id),
  FOREIGN KEY (attempt_id, participant_id, session_number)
    REFERENCES local_assessment_attempts(attempt_id, participant_id, session_number)
    ON DELETE RESTRICT
);

CREATE TABLE local_assessment_queue (
  attempt_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  video_order INTEGER NOT NULL CHECK (video_order >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, video_order),
  UNIQUE (attempt_id, video_id),
  UNIQUE (attempt_id, participant_id, session_number, video_id, video_order),
  FOREIGN KEY (attempt_id, participant_id, session_number)
    REFERENCES local_assessment_attempts(attempt_id, participant_id, session_number)
    ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, participant_id, session_number, video_id)
    REFERENCES local_video_metadata_snapshot(attempt_id, participant_id, session_number, video_id)
    ON DELETE RESTRICT
);

CREATE TABLE local_responses (
  attempt_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  video_order INTEGER NOT NULL,
  answer INTEGER NOT NULL CHECK (answer IN (0, 1)),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  created_at TEXT NOT NULL,
  video_time_at_click_ms INTEGER,
  detection_latency_ms INTEGER,
  response_type TEXT NOT NULL CHECK (response_type IN ('lesion_detected', 'no_lesion_detected')),
  video_completed INTEGER NOT NULL CHECK (video_completed = 1),
  no_response_latency_ms INTEGER CHECK (no_response_latency_ms IS NULL OR no_response_latency_ms >= 0),
  PRIMARY KEY (attempt_id, video_order),
  UNIQUE (attempt_id, participant_id, session_number, video_id, video_order),
  CHECK (
    (answer = 1 AND video_time_at_click_ms IS NOT NULL AND no_response_latency_ms IS NULL)
    OR
    (answer = 0 AND video_time_at_click_ms IS NULL AND detection_latency_ms IS NULL)
  ),
  FOREIGN KEY (attempt_id, participant_id, session_number, video_id, video_order)
    REFERENCES local_assessment_queue(attempt_id, participant_id, session_number, video_id, video_order)
    ON DELETE RESTRICT
);

CREATE TABLE local_lesion_detection_events (
  attempt_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  video_order INTEGER NOT NULL,
  click_index INTEGER NOT NULL CHECK (click_index >= 1),
  video_time_at_click_ms INTEGER NOT NULL CHECK (video_time_at_click_ms >= 0),
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  lesion_onset_ms INTEGER,
  detection_latency_ms INTEGER,
  overridden INTEGER NOT NULL CHECK (overridden IN (0, 1)),
  final_valid INTEGER NOT NULL CHECK (final_valid IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, video_order, click_index),
  CHECK (final_valid <> overridden),
  FOREIGN KEY (attempt_id, participant_id, session_number, video_id, video_order)
    REFERENCES local_responses(attempt_id, participant_id, session_number, video_id, video_order)
    ON DELETE RESTRICT
);

CREATE TABLE local_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  sync_state TEXT NOT NULL,
  payload_sha256 TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES local_assessment_attempts(attempt_id)
    ON DELETE RESTRICT
);

CREATE INDEX local_attempt_lookup
  ON local_assessment_attempts(participant_id, session_number, status);
CREATE INDEX local_response_attempt_lookup
  ON local_responses(attempt_id, video_order);
CREATE INDEX local_event_attempt_lookup
  ON local_lesion_detection_events(attempt_id, video_order);
`;
