import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION, openDatabase, type Db } from "./db.js";

describe("db schema", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-db-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sets schema_version to the latest migration", () => {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("creates conversation_outbox table (v12 migration)", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_outbox'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("conversation_outbox");
    const cols = db
      .prepare("PRAGMA table_info(conversation_outbox)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    for (const required of [
      "id",
      "conversation_id",
      "parent_task_id",
      "text",
      "attachments_json",
      "status",
      "accepted_task_id",
      "attempt_count",
      "fail_reason",
      "claim_lease_until",
      "request_hash",
      "created_at",
      "updated_at",
    ]) {
      expect(names).toContain(required);
    }
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversation_outbox'",
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_conversation_outbox_conv_status_created");
    expect(indexNames).toContain("idx_conversation_outbox_claim_lease");
    expect(indexNames).toContain("idx_conversation_outbox_accepted_task");
  });

  it("creates mutation_receipts table (v4 migration)", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='mutation_receipts'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("mutation_receipts");
  });

  it("creates task_run_attempts and schedule_occurrences (v5)", () => {
    for (const name of [
      "task_run_attempts",
      "schedule_occurrences",
      "operation_receipts",
    ]) {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get(name) as { name: string } | undefined;
      expect(row?.name).toBe(name);
    }
  });

  it("adds the tasks.title column (v2 migration)", () => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toContain("title");
  });

  it("adds and persists tasks.revision_of_task_id (v7 migration)", () => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toContain("revision_of_task_id");

    db.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        revision_of_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "revised-task",
      "goal",
      "interactive",
      "queued",
      "grok-4.5",
      "normal",
      "{}",
      "source-task",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const row = db
      .prepare("SELECT revision_of_task_id FROM tasks WHERE id = ?")
      .get("revised-task") as { revision_of_task_id: string };
    expect(row.revision_of_task_id).toBe("source-task");
  });

  it("adds reload-safe task attachment metadata (v8 migration)", () => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as {
      name: string;
    }[];
    expect(cols.map((column) => column.name)).toContain("attachments_json");

    const row = db
      .prepare("SELECT attachments_json FROM tasks LIMIT 1")
      .get() as { attachments_json: string } | undefined;
    if (row) expect(JSON.parse(row.attachments_json)).toEqual([]);
  });

  it("adds one durable user turn and submit receipt per accepted task (v9)", () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)",
      )
      .all(
        "idx_turns_one_user_per_task",
        "idx_operation_receipts_one_task_submit",
      ) as Array<{ name: string }>;
    expect(indexes.map((row) => row.name).sort()).toEqual([
      "idx_operation_receipts_one_task_submit",
      "idx_turns_one_user_per_task",
    ]);
  });

  it("adds one durable assistant turn per completed task (v14)", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
      .get("idx_turns_one_assistant_per_task") as { name: string } | undefined;
    expect(row?.name).toBe("idx_turns_one_assistant_per_task");
  });

  it("v14 keeps the assistant turn linked to the task conversation", () => {
    db.exec(`
      DROP INDEX idx_turns_one_assistant_per_task;
      UPDATE meta SET value = '13' WHERE key = 'schema_version';
      INSERT INTO conversations (id, provider_id, created_at, updated_at)
      VALUES
        ('assistant-old-conversation', 'grok', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('assistant-current-conversation', 'grok', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        created_at, updated_at, conversation_id
      ) VALUES (
        'assistant-task', 'goal', 'interactive', 'done', 'grok-4.5',
        'normal', '{}', '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z', 'assistant-current-conversation'
      );
      INSERT INTO turns
        (id, conversation_id, task_id, role, content, created_at)
      VALUES
        ('assistant-old', 'assistant-old-conversation', 'assistant-task', 'assistant', 'stale', '2026-01-01T00:00:00.000Z'),
        ('assistant-current', 'assistant-current-conversation', 'assistant-task', 'assistant', 'current', '2026-01-02T00:00:00.000Z');
    `);
    db.close();
    db = openDatabase(path.join(dir, "test.sqlite"));

    expect(
      db.prepare(
        "SELECT id, content FROM turns WHERE task_id = 'assistant-task' AND role = 'assistant'",
      ).all(),
    ).toEqual([{ id: "assistant-current", content: "current" }]);
  });

  it("v9 keeps the user turn linked by the task when deduplicating legacy binds", () => {
    const legacyPath = path.join(dir, "legacy-duplicate-turns.sqlite");
    const legacy = openDatabase(legacyPath);
    legacy.exec(`
      DROP INDEX idx_turns_one_user_per_task;
      DROP INDEX idx_operation_receipts_one_task_submit;
      UPDATE meta SET value = '8' WHERE key = 'schema_version';
    `);
    const policy = JSON.stringify({
      approvalMode: "balanced",
      workspaceRoots: [dir],
      allowNetworkTools: true,
      allowShell: true,
    });
    legacy.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json, skills_json,
        mcp_json, created_at, updated_at, conversation_id
      ) VALUES ('legacy-task', 'legacy goal', 'interactive', 'queued',
        'grok-4.5', 'normal', ?, '[]', '[]', ?, ?, 'conversation-new')`,
    ).run(policy, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    legacy.exec(`
      INSERT INTO conversations
        (id, provider_id, created_at, updated_at)
      VALUES
        ('conversation-old', 'grok', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('conversation-new', 'grok', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      INSERT INTO turns
        (id, conversation_id, task_id, role, content, created_at)
      VALUES
        ('turn-old', 'conversation-old', 'legacy-task', 'user', 'old duplicate', '2026-01-01T00:00:00.000Z'),
        ('turn-new', 'conversation-new', 'legacy-task', 'user', 'current turn', '2026-01-02T00:00:00.000Z');
    `);
    legacy.close();

    const migrated = openDatabase(legacyPath);
    const turns = migrated
      .prepare(
        "SELECT id, conversation_id AS conversationId FROM turns WHERE task_id = 'legacy-task' AND role = 'user'",
      )
      .all() as Array<{ id: string; conversationId: string }>;
    expect(turns).toEqual([
      { id: "turn-new", conversationId: "conversation-new" },
    ]);
    const ready = migrated
      .prepare(
        `SELECT 1 AS ready
         FROM tasks JOIN turns
           ON turns.task_id = tasks.id
          AND turns.role = 'user'
          AND turns.conversation_id = tasks.conversation_id
         WHERE tasks.id = 'legacy-task'`,
      )
      .get();
    expect(ready).toEqual({ ready: 1 });
    migrated.close();
  });

  it("upgrades a v7 task table with unknown legacy attachment metadata", () => {
    const legacyPath = path.join(dir, "legacy-v7.sqlite");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta (key, value) VALUES ('schema_version', '7');
      CREATE TABLE tasks (id TEXT PRIMARY KEY, conversation_id TEXT);
      INSERT INTO tasks (id) VALUES ('legacy-task');
      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        task_id TEXT,
        role TEXT NOT NULL
      );
      CREATE TABLE operation_receipts (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        action TEXT NOT NULL
      );
    `);
    legacy.close();

    const migrated = openDatabase(legacyPath);
    const row = migrated
      .prepare("SELECT attachments_json FROM tasks WHERE id = ?")
      .get("legacy-task") as { attachments_json: string };
    expect(row.attachments_json).toBeNull();
    migrated.close();
  });

  it("creates all v1 tables", () => {
    const expected = [
      "meta",
      "tasks",
      "task_events",
      "artifacts",
      "schedule_rules",
      "memory_items",
      "inbox_items",
      "audit_entries",
      "settings",
      "projects",
    ];
    for (const name of expected) {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get(name) as { name: string } | undefined;
      expect(row?.name).toBe(name);
    }
  });

  it("creates tasks table", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("tasks");
  });

  it("inserts and reads a task row", () => {
    db.prepare(
      `INSERT INTO tasks (id, goal, mode, status, model, effort, policy_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "t1",
      "goal",
      "interactive",
      "queued",
      "grok-4.5",
      "normal",
      "{}",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const row = db.prepare("SELECT goal FROM tasks WHERE id=?").get("t1") as {
      goal: string;
    };
    expect(row.goal).toBe("goal");
  });

  it("is idempotent on reopen (migrations applied once)", () => {
    const dbPath = path.join(dir, "test.sqlite");
    db.close();
    db = openDatabase(dbPath);
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(row.value).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("creates remote device tables (v3 migration)", () => {
    for (const name of ["remote_devices", "remote_pair_challenges"]) {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get(name) as { name: string } | undefined;
      expect(row?.name).toBe(name);
    }
  });

  it("enables WAL and foreign_keys", () => {
    const journal = db.pragma("journal_mode", { simple: true });
    expect(String(journal).toLowerCase()).toBe("wal");
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(Number(fk)).toBe(1);
  });
});
