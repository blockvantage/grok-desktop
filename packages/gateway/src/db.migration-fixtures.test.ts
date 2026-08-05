import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION, openDatabase, type Db } from "./db.js";
// Database used for raw fixture load before openDatabase migrates.

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/migrations",
);

function loadSqlFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

function openRawFromSql(sql: string): { dir: string; dbPath: string; db: Db } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-mig-fix"));
  const dbPath = path.join(dir, "fixture.sqlite");
  const db = new Database(dbPath);
  db.exec(sql);
  db.close();
  return { dir, dbPath, db: openDatabase(dbPath) };
}

describe("migration fixtures (all supported schema versions)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("upgrades v1 fixture to current schema and preserves task row", () => {
    const { dir, db } = openRawFromSql(loadSqlFixture("v1-base.sql"));
    dirs.push(dir);
    const ver = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(ver.value)).toBe(CURRENT_SCHEMA_VERSION);
    const task = db
      .prepare("SELECT id, goal FROM tasks WHERE id = ?")
      .get("fixture-task-v1") as { id: string; goal: string };
    expect(task.goal).toBe("v1 fixture goal");
    const cols = (
      db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("title");
    expect(cols).toContain("revision_of_task_id");
    expect(cols).toContain("attachments_json");
    const remote = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='remote_devices'",
      )
      .get() as { name: string } | undefined;
    expect(remote?.name).toBe("remote_devices");
  });

  it("upgrades v2 fixture and keeps title", () => {
    const { dir, db } = openRawFromSql(loadSqlFixture("v2-title.sql"));
    dirs.push(dir);
    const ver = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(ver.value)).toBe(CURRENT_SCHEMA_VERSION);
    const task = db
      .prepare("SELECT id, title FROM tasks WHERE id = ?")
      .get("fixture-task-v2") as { id: string; title: string };
    expect(task.title).toBe("V2 Title");
  });

  it("upgrades v3 fixture and keeps remote device + waiting_approval task", () => {
    const { dir, db } = openRawFromSql(loadSqlFixture("v3-remote.sql"));
    dirs.push(dir);
    const ver = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(ver.value)).toBe(CURRENT_SCHEMA_VERSION);
    const device = db
      .prepare("SELECT id, label FROM remote_devices WHERE id = ?")
      .get("fixture-device-a") as { id: string; label: string };
    expect(device.label).toBe("Phone A");
    const task = db
      .prepare("SELECT status FROM tasks WHERE id = ?")
      .get("fixture-task-v3") as { status: string };
    expect(task.status).toBe("waiting_approval");
  });

  it("empty path (v0) migrates to current on first open", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-mig-v0-"));
    dirs.push(dir);
    const db = openDatabase(path.join(dir, "fresh.sqlite"));
    const ver = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(ver.value)).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it("creates a pre-migrate backup when upgrading an existing DB", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-mig-bak-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "old.sqlite");
    // Write v1-only fixture as a real file
    const raw = new Database(dbPath);
    raw.exec(loadSqlFixture("v1-base.sql"));
    raw.close();
    const db = openDatabase(dbPath);
    db.close();
    const bak = fs
      .readdirSync(dir)
      .find((f) => f.includes("pre-migrate") && f.endsWith(".bak"));
    expect(bak).toBeTruthy();
  });
});
