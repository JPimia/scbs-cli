CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT,
  remote_url TEXT,
  default_branch TEXT,
  provider TEXT,
  project_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE file_records (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  kind TEXT,
  hash TEXT NOT NULL,
  size_bytes BIGINT,
  exists BOOLEAN NOT NULL,
  version_stamp TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (repo_id, path)
);

CREATE TABLE symbol_records (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  export_name TEXT,
  signature TEXT,
  anchor JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE dependency_edges (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE fact_records (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  value JSONB NOT NULL,
  anchors JSONB NOT NULL,
  version_stamp TEXT NOT NULL,
  freshness TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE claim_records (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  trust_tier TEXT NOT NULL,
  fact_ids JSONB NOT NULL,
  anchors JSONB NOT NULL,
  freshness TEXT NOT NULL,
  invalidation_keys JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE view_records (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  claim_ids JSONB NOT NULL,
  file_scope JSONB,
  symbol_scope JSONB,
  freshness TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (repo_id, type, key)
);

CREATE TABLE task_bundles (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  repo_ids JSONB NOT NULL,
  summary TEXT NOT NULL,
  selected_view_ids JSONB NOT NULL,
  selected_claim_ids JSONB NOT NULL,
  file_scope JSONB NOT NULL,
  symbol_scope JSONB NOT NULL,
  commands JSONB NOT NULL,
  proof_handles JSONB NOT NULL,
  freshness TEXT NOT NULL,
  cache_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE TABLE bundle_cache_entries (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  bundle_id TEXT NOT NULL REFERENCES task_bundles(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE TABLE agent_receipts (
  id TEXT PRIMARY KEY,
  external_ref JSONB,
  repo_ids JSONB NOT NULL,
  bundle_id TEXT,
  from_role TEXT,
  from_run_id TEXT,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE freshness_events (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  changed_files JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE recompute_jobs (
  id TEXT PRIMARY KEY,
  job_kind TEXT NOT NULL,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES freshness_events(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  changed_files JSONB NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE receipt_reviews (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  bundle_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  repo_id TEXT,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deliveries JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_delivery_at TIMESTAMPTZ
);

CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE audit_records (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_file_records_repo_id ON file_records (repo_id);
CREATE INDEX idx_symbol_records_repo_id ON symbol_records (repo_id);
CREATE INDEX idx_dependency_edges_repo_id ON dependency_edges (repo_id);
CREATE INDEX idx_fact_records_repo_id ON fact_records (repo_id);
CREATE INDEX idx_claim_records_repo_id ON claim_records (repo_id);
CREATE INDEX idx_view_records_repo_id ON view_records (repo_id);
CREATE INDEX idx_task_bundles_cache_key ON task_bundles (cache_key);
CREATE INDEX idx_agent_receipts_status ON agent_receipts (status);
CREATE INDEX idx_freshness_events_repo_id ON freshness_events (repo_id);
CREATE INDEX idx_recompute_jobs_status ON recompute_jobs (status);
CREATE INDEX idx_receipt_reviews_receipt_id ON receipt_reviews (receipt_id);
CREATE INDEX idx_outbox_events_topic ON outbox_events (topic);
CREATE INDEX idx_audit_records_scope ON audit_records (scope);
