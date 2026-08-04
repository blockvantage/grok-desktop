import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Db = Database.Database;

interface Migration {
  version: number;
  sql: string;
  /** Optional post-SQL step (idempotent column adds, etc.). */
  afterSql?: (db: Db) => void;
}

/** Ordered versioned migrations. Append new versions; never edit applied ones. */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
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
  completed_at TEXT
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
`,
  },
  {
    // Short, editable, Grok-generated chat title (distinct from the raw goal).
    version: 2,
    sql: `ALTER TABLE tasks ADD COLUMN title TEXT;`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS remote_devices (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  public_key TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  pair_secret_b64 TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_pair_challenges (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  secret_b64 TEXT NOT NULL,
  machine_pub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    // Durable remote/local mutation receipts for clientMutationId idempotency.
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS mutation_receipts (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  method TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(principal_id, method, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_mutation_receipts_lookup
  ON mutation_receipts(principal_id, method, client_mutation_id);
`,
  },
  {
    // Phase 2 durable task kernel: run attempts, schedule occurrences, operation receipts.
    version: 5,
    sql: `
CREATE TABLE IF NOT EXISTS task_run_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  terminal_reason TEXT,
  provider_session_id TEXT,
  capability_snapshot_json TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_run_attempts_task
  ON task_run_attempts(task_id);
CREATE INDEX IF NOT EXISTS idx_run_attempts_lease
  ON task_run_attempts(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS schedule_occurrences (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL,
  task_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(schedule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_schedule_occurrences_schedule
  ON schedule_occurrences(schedule_id, scheduled_for);

CREATE TABLE IF NOT EXISTS operation_receipts (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  run_attempt_id TEXT,
  principal_id TEXT,
  action TEXT NOT NULL,
  decision TEXT NOT NULL,
  effect TEXT,
  detail_json TEXT NOT NULL,
  redaction_class TEXT NOT NULL DEFAULT 'standard',
  correlation_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_receipts_task
  ON operation_receipts(task_id, created_at);
`,
  },
  {
    // Conversations / turns + provider session binding for follow-ups (TASK-02).
    version: 6,
    sql: `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider_id TEXT NOT NULL DEFAULT 'grok',
  model_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  parent_turn_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider_session_id TEXT,
  context_strategy TEXT,
  model_id TEXT,
  provider_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation
  ON turns(conversation_id, created_at);

ALTER TABLE tasks ADD COLUMN conversation_id TEXT;
ALTER TABLE tasks ADD COLUMN provider_id TEXT;
ALTER TABLE tasks ADD COLUMN provider_session_id TEXT;
`,
  },
  {
    // Revision lineage for edit-and-resubmit task chains.
    version: 7,
    sql: `ALTER TABLE tasks ADD COLUMN revision_of_task_id TEXT;`,
  },
  {
    // Nullable distinguishes legacy unknown inputs from an accepted empty list.
    version: 8,
    sql: `ALTER TABLE tasks ADD COLUMN attachments_json TEXT;`,
  },
  {
    // Post-acceptance reconciliation may run after a retry or restart. These
    // partial unique indexes make the two per-task ledger writes idempotent.
    version: 9,
    sql: `
DELETE FROM turns
WHERE role = 'user'
  AND task_id IS NOT NULL
  AND rowid NOT IN (
    SELECT COALESCE(
      MIN(CASE
        WHEN candidate.conversation_id = task.conversation_id
        THEN candidate.rowid
      END),
      MIN(candidate.rowid)
    )
    FROM turns AS candidate
    LEFT JOIN tasks AS task ON task.id = candidate.task_id
    WHERE candidate.role = 'user' AND candidate.task_id IS NOT NULL
    GROUP BY candidate.task_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_one_user_per_task
  ON turns(task_id)
  WHERE role = 'user' AND task_id IS NOT NULL;

DELETE FROM operation_receipts
WHERE action = 'task.submit'
  AND task_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM operation_receipts
    WHERE action = 'task.submit' AND task_id IS NOT NULL
    GROUP BY task_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_receipts_one_task_submit
  ON operation_receipts(task_id)
  WHERE action = 'task.submit' AND task_id IS NOT NULL;
`,
  },
  {
    // CLI port wave: context usage meter + plan-first task flag.
    // last_usage lives in a side table so incomplete legacy fixtures (v7-only
    // task tables without task_run_attempts) still migrate cleanly.
    // plan_first is added via PRAGMA-guarded JS in applyMigrations (idempotent).
    version: 10,
    sql: `
CREATE TABLE IF NOT EXISTS task_run_attempt_usage (
  attempt_id TEXT PRIMARY KEY,
  last_usage_json TEXT NOT NULL
);
`,
    afterSql: (db: Db) => {
      const cols = db
        .prepare(`PRAGMA table_info(tasks)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "plan_first")) {
        db.exec(
          `ALTER TABLE tasks ADD COLUMN plan_first INTEGER NOT NULL DEFAULT 0`,
        );
      }
    },
  },
  {
    // Bounded retry of failed schedule occurrences after transient submit errors.
    // Guarded for incomplete legacy fixtures that lack schedule_occurrences.
    version: 11,
    sql: ``,
    afterSql: (db: Db) => {
      const table = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_occurrences'`,
        )
        .get() as { name: string } | undefined;
      if (!table) return;
      const cols = db
        .prepare(`PRAGMA table_info(schedule_occurrences)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "attempt_count")) {
        db.exec(
          `ALTER TABLE schedule_occurrences ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0`,
        );
      }
    },
  },
  {
    // Gateway-owned durable follow-up outbox. id === clientMutationId.
    version: 12,
    sql: `
CREATE TABLE IF NOT EXISTS conversation_outbox (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_task_id TEXT NOT NULL,
  text TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  accepted_task_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  fail_reason TEXT,
  claim_lease_until TEXT,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_outbox_conv_status_created
  ON conversation_outbox(conversation_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_conversation_outbox_claim_lease
  ON conversation_outbox(claim_lease_until)
  WHERE claim_lease_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_outbox_accepted_task
  ON conversation_outbox(accepted_task_id)
  WHERE accepted_task_id IS NOT NULL;
`,
  },
  {
    // Outbox revision lineage for edit-and-resubmit follow-ups.
    version: 13,
    sql: ``,
    afterSql: (db: Db) => {
      const table = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_outbox'`,
        )
        .get() as { name: string } | undefined;
      if (!table) return;
      const cols = db
        .prepare(`PRAGMA table_info(conversation_outbox)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "revision_of_task_id")) {
        db.exec(
          `ALTER TABLE conversation_outbox ADD COLUMN revision_of_task_id TEXT`,
        );
      }
    },
  },
];

/** Latest applied schema version (must match last MIGRATIONS entry). */
export const CURRENT_SCHEMA_VERSION = 13;

function getSchemaVersion(db: Db): number {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
    )
    .get() as { name: string } | undefined;
  if (!table) return 0;

  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!row) return 0;
  const n = Number.parseInt(row.value, 10);
  return Number.isFinite(n) ? n : 0;
}

function setSchemaVersion(db: Db, version: number): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(version));
}

function applyMigrations(db: Db): void {
  let current = getSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const run = db.transaction(() => {
      if (migration.sql.trim()) db.exec(migration.sql);
      migration.afterSql?.(db);
      setSchemaVersion(db, migration.version);
    });
    run();
    current = migration.version;
  }
}

/**
 * Open SQLite with versioned migrations. When the on-disk schema is behind
 * the latest migration, copy a `.pre-migrate.bak` beside the DB first
 * (best-effort; skipped for new files).
 */
export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    try {
      backupBeforeMigrate(dbPath);
    } catch {
      // Best-effort — do not block open if backup fails (read-only fs, etc.)
    }
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

function backupBeforeMigrate(dbPath: string): void {
  // Peek schema without applying migrations.
  const peek = new Database(dbPath, { readonly: true, fileMustExist: true });
  let current = 0;
  try {
    const table = peek
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
      )
      .get() as { name: string } | undefined;
    if (table) {
      const row = peek
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string } | undefined;
      if (row) current = Number.parseInt(row.value, 10) || 0;
    }
  } finally {
    peek.close();
  }
  const latest = CURRENT_SCHEMA_VERSION;
  if (current >= latest) return;
  const bak = `${dbPath}.pre-migrate-v${current}-to-v${latest}.bak`;
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(dbPath, bak);
  }
}
