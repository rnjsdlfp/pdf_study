PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'webpage')),
  title TEXT NOT NULL,
  file_hash TEXT,
  url TEXT,
  original_filename TEXT,
  local_path TEXT,
  page_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  status_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  extraction_confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, page_number)
);

CREATE TABLE IF NOT EXISTS selections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  selection_text TEXT NOT NULL,
  surrounding_text TEXT NOT NULL,
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  selection_id TEXT REFERENCES selections(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'failed_schema')),
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  locked_by TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  cache_key TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_lease
  ON jobs(status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS analysis_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  selection_id TEXT REFERENCES selections(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  publisher TEXT,
  published_date TEXT,
  accessed_date TEXT,
  relevance TEXT
);
