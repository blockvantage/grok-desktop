-- Schema version 2 fixture (adds tasks.title).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  project_id TEXT,
  parent_task_id TEXT,
  schedule_rule_id TEXT,
  role_pack TEXT,
  skills_json TEXT NOT NULL DEFAULT '[]',
  mcp_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  title TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, seq)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal_template TEXT NOT NULL,
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  quiet_hours_respect INTEGER NOT NULL DEFAULT 1,
  approval_mode TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  workspace_roots_json TEXT NOT NULL,
  role_pack TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  project_id TEXT,
  provenance TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  task_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES ('schema_version', '2');

INSERT INTO tasks (
  id, goal, mode, status, model, effort, policy_json, created_at, updated_at, title
) VALUES (
  'fixture-task-v2',
  'v2 fixture goal',
  'interactive',
  'running',
  'grok-4.5',
  'normal',
  '{"approvalMode":"strict","workspaceRoots":["/tmp"],"allowNetworkTools":false,"allowShell":false}',
  '2026-01-02T00:00:00.000Z',
  '2026-01-02T00:00:00.000Z',
  'V2 Title'
);
