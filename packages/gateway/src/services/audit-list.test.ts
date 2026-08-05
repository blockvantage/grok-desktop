import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { AuditService } from "./audit.js";
import {
  clampAuditListLimit,
  listAuditEntries,
  parseAuditDecision,
  redactAuditDetail,
} from "./audit-list.js";

describe("clampAuditListLimit", () => {
  it("defaults to 100, floors fractions, clamps to [1, 500]", () => {
    expect(clampAuditListLimit()).toBe(100);
    expect(clampAuditListLimit(undefined)).toBe(100);
    expect(clampAuditListLimit(2.9)).toBe(2);
    expect(clampAuditListLimit(0)).toBe(1);
    expect(clampAuditListLimit(-3)).toBe(1);
    expect(clampAuditListLimit(500)).toBe(500);
    expect(clampAuditListLimit(501)).toBe(500);
    expect(clampAuditListLimit(9999)).toBe(500);
  });
});

describe("parseAuditDecision", () => {
  it("accepts known decisions only", () => {
    expect(parseAuditDecision("allow")).toBe("allow");
    expect(parseAuditDecision("deny")).toBe("deny");
    expect(parseAuditDecision("approve")).toBe("approve");
    expect(parseAuditDecision("reject")).toBe("reject");
    expect(parseAuditDecision("info")).toBe("info");
  });

  it("does not invent mediation outcomes for corrupt values", () => {
    expect(parseAuditDecision("maybe")).toBe("info");
    expect(parseAuditDecision("")).toBe("info");
    expect(parseAuditDecision(null)).toBe("info");
    expect(parseAuditDecision(42)).toBe("info");
  });
});

describe("redactAuditDetail", () => {
  it("redacts secret keys and inline password/token assignments", () => {
    const out = redactAuditDetail({
      apiKey: "sk-live-should-not-appear",
      password: "hunter2",
      command: "curl -H token=abc123 password=hunter2 https://x",
      path: "/tmp/safe",
    });
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.password).toBe("[REDACTED]");
    expect(String(out.command)).toContain("token=[REDACTED]");
    expect(String(out.command)).toContain("password=[REDACTED]");
    expect(JSON.stringify(out)).not.toMatch(/hunter2|abc123|sk-live/);
    expect(out.path).toBe("/tmp/safe");
  });
});

describe("listAuditEntries", () => {
  let dir: string;
  let db: Db;
  let audit: AuditService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-audit-list-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    audit = new AuditService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns newest first for a taskId", () => {
    const taskId = "task-order";
    audit.append({
      taskId,
      action: "first.action",
      detail: { n: 1 },
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    audit.append({
      taskId,
      action: "second.action",
      detail: { n: 2 },
      decision: "info",
      createdAt: "2026-08-01T12:00:00.000Z",
    });
    audit.append({
      taskId: "other-task",
      action: "other.action",
      detail: {},
      decision: "allow",
      createdAt: "2026-08-01T13:00:00.000Z",
    });

    const page = listAuditEntries(db, { taskId, limit: 10 });
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]?.action).toBe("second.action");
    expect(page.entries[1]?.action).toBe("first.action");
    expect(page.entries.every((r) => r.taskId === taskId)).toBe(true);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(2);
    expect(page.limit).toBe(10);
  });

  it("filters by decision when provided with taskId", () => {
    const taskId = "task-decision";
    audit.append({
      taskId,
      action: "tool.allow",
      detail: {},
      decision: "allow",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    audit.append({
      taskId,
      action: "tool.deny",
      detail: { reason: "policy" },
      decision: "deny",
      createdAt: "2026-08-01T11:00:00.000Z",
    });

    const denied = listAuditEntries(db, { taskId, decision: "deny" });
    expect(denied.entries).toHaveLength(1);
    expect(denied.entries[0]?.decision).toBe("deny");
    expect(denied.entries[0]?.action).toBe("tool.deny");
    expect(denied.total).toBe(1);
    expect(denied.hasMore).toBe(false);
  });

  it("filters by decision alone (no taskId) across tasks", () => {
    audit.append({
      taskId: "t-a",
      action: "a.deny",
      detail: {},
      decision: "deny",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    audit.append({
      taskId: "t-b",
      action: "b.allow",
      detail: {},
      decision: "allow",
      createdAt: "2026-08-01T11:00:00.000Z",
    });
    audit.append({
      taskId: "t-c",
      action: "c.deny",
      detail: {},
      decision: "deny",
      createdAt: "2026-08-01T12:00:00.000Z",
    });

    const denied = listAuditEntries(db, { decision: "deny" });
    expect(denied.entries).toHaveLength(2);
    expect(denied.entries.every((r) => r.decision === "deny")).toBe(true);
    expect(denied.entries.map((r) => r.action)).toEqual(["c.deny", "a.deny"]);
    expect(denied.total).toBe(2);
  });

  it("maps null taskId system rows and detail JSON correctly", () => {
    audit.append({
      taskId: null,
      action: "queue.watchdog.error",
      detail: { code: "TIMEOUT", retries: 2 },
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    audit.append({
      taskId: "task-with-id",
      action: "tool.allow",
      detail: { path: "/tmp/x" },
      decision: "allow",
      createdAt: "2026-08-01T11:00:00.000Z",
    });

    const page = listAuditEntries(db, { limit: 10 });
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]?.taskId).toBe("task-with-id");
    expect(page.entries[0]?.detail).toEqual({ path: "/tmp/x" });
    expect(page.entries[1]?.taskId).toBeNull();
    expect(page.entries[1]?.action).toBe("queue.watchdog.error");
    expect(page.entries[1]?.detail).toEqual({ code: "TIMEOUT", retries: 2 });
  });

  it("isolates corrupt detail_json instead of failing the whole list", () => {
    const good = audit.append({
      taskId: "t1",
      action: "good.action",
      detail: { ok: true },
      decision: "allow",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    const bad = audit.append({
      taskId: "t1",
      action: "bad.action",
      detail: { will: "corrupt" },
      decision: "deny",
      createdAt: "2026-08-01T11:00:00.000Z",
    });
    db.prepare(`UPDATE audit_entries SET detail_json = ? WHERE id = ?`).run(
      "NOT_JSON{",
      bad.id,
    );
    // Non-object JSON is also corrupt.
    const arrayDetail = audit.append({
      taskId: "t1",
      action: "array.detail",
      detail: { x: 1 },
      decision: "info",
      createdAt: "2026-08-01T12:00:00.000Z",
    });
    db.prepare(`UPDATE audit_entries SET detail_json = ? WHERE id = ?`).run(
      "[1,2]",
      arrayDetail.id,
    );

    const page = listAuditEntries(db, { taskId: "t1", limit: 10 });
    expect(page.entries).toHaveLength(3);
    expect(page.entries.find((r) => r.id === good.id)?.detail).toEqual({
      ok: true,
    });
    expect(page.entries.find((r) => r.id === bad.id)?.detail).toEqual({
      _corruptDetail: true,
    });
    expect(page.entries.find((r) => r.id === arrayDetail.id)?.detail).toEqual({
      _corruptDetail: true,
    });
  });

  it("maps unknown decision strings without inventing allow/deny truth", () => {
    const row = audit.append({
      taskId: "t-unk",
      action: "weird",
      detail: { ok: true },
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    db.prepare(`UPDATE audit_entries SET decision = ? WHERE id = ?`).run(
      "bogus-decision",
      row.id,
    );

    const page = listAuditEntries(db, { taskId: "t-unk" });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.decision).toBe("info");
    expect(page.entries[0]?.detail._unknownDecision).toBe("bogus-decision");
    expect(page.entries[0]?.detail.ok).toBe(true);
  });

  it("redacts secret-like fields in listed detail", () => {
    audit.append({
      taskId: "t-sec",
      action: "tool.shell",
      detail: {
        apiKey: "sk-live-xyz",
        command: "export token=abc123 password=hunter2",
        path: "/workspace/a",
      },
      decision: "deny",
      createdAt: "2026-08-01T10:00:00.000Z",
    });

    const page = listAuditEntries(db, { taskId: "t-sec" });
    const d = page.entries[0]?.detail ?? {};
    expect(d.apiKey).toBe("[REDACTED]");
    expect(String(d.command)).toContain("token=[REDACTED]");
    expect(String(d.command)).toContain("password=[REDACTED]");
    expect(JSON.stringify(d)).not.toMatch(/hunter2|abc123|sk-live/);
    expect(d.path).toBe("/workspace/a");
  });

  it("reports hasMore and total when truncated", () => {
    for (let i = 0; i < 5; i++) {
      audit.append({
        taskId: "task-page",
        action: `action.${i}`,
        detail: { i },
        decision: "info",
        createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
      });
    }
    const page = listAuditEntries(db, { taskId: "task-page", limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(true);
    expect(page.limit).toBe(2);
    // Newest first
    expect(page.entries[0]?.action).toBe("action.4");
    expect(page.entries[1]?.action).toBe("action.3");

    const full = listAuditEntries(db, { taskId: "task-page", limit: 10 });
    expect(full.entries).toHaveLength(5);
    expect(full.hasMore).toBe(false);
    expect(full.total).toBe(5);
  });

  it("caps limit at 500", () => {
    for (let i = 0; i < 510; i++) {
      audit.append({
        taskId: "task-cap",
        action: `action.${i}`,
        detail: { i },
        decision: "info",
        createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
      });
    }
    const capped = listAuditEntries(db, { taskId: "task-cap", limit: 9999 });
    expect(capped.entries).toHaveLength(500);
    expect(capped.limit).toBe(500);
    expect(capped.total).toBe(510);
    expect(capped.hasMore).toBe(true);
    expect(
      listAuditEntries(db, { limit: 9999 }).entries.length,
    ).toBeLessThanOrEqual(500);
    expect(
      listAuditEntries(db, { taskId: "task-cap", limit: 500 }).entries,
    ).toHaveLength(500);
  });

  it("AuditService.list delegates to listAuditEntries", () => {
    audit.append({
      taskId: "svc",
      action: "a",
      detail: { ok: true },
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    const viaService = audit.list({ taskId: "svc", limit: 5 });
    const viaHelper = listAuditEntries(db, { taskId: "svc", limit: 5 });
    expect(viaService).toEqual(viaHelper);
    expect(viaService.entries).toHaveLength(1);
    expect(viaService.entries[0]?.detail).toEqual({ ok: true });
    expect(viaService.hasMore).toBe(false);
    expect(viaService.total).toBe(1);
  });

  it("defaults limit to 100 and clamps below 1 to 1", () => {
    // Seed >100 rows so a wrong default (e.g. 10) would fail.
    for (let i = 0; i < 105; i++) {
      audit.append({
        taskId: "lim",
        action: `a${i}`,
        detail: {},
        decision: "info",
        createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
      });
    }
    const def = listAuditEntries(db, { taskId: "lim" });
    expect(def.entries).toHaveLength(100);
    expect(def.limit).toBe(100);
    expect(def.total).toBe(105);
    expect(def.hasMore).toBe(true);

    expect(
      listAuditEntries(db, { taskId: "lim", limit: undefined }).entries,
    ).toHaveLength(100);
    expect(
      listAuditEntries(db, { taskId: "lim", limit: 0 }).entries,
    ).toHaveLength(1);
    expect(
      listAuditEntries(db, { taskId: "lim", limit: -3 }).entries,
    ).toHaveLength(1);
    expect(
      listAuditEntries(db, { taskId: "lim", limit: 2.9 }).entries,
    ).toHaveLength(2);
  });
});
