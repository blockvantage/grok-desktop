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

  it("treats non-finite limits as default 100", () => {
    expect(clampAuditListLimit(Number.NaN)).toBe(100);
    expect(clampAuditListLimit(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampAuditListLimit(Number.NEGATIVE_INFINITY)).toBe(100);
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
    expect(page.entries[0]?.createdAt).toBe("2026-08-01T12:00:00.000Z");
    expect(page.entries[1]?.action).toBe("first.action");
    expect(page.entries[1]?.createdAt).toBe("2026-08-01T10:00:00.000Z");
    expect(page.entries.every((r) => r.taskId === taskId)).toBe(true);
    expect(page.entries.every((r) => typeof r.createdAt === "string" && r.createdAt)).toBe(
      true,
    );
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(2);
    expect(page.limit).toBe(10);
  });

  it("breaks same-timestamp ties with id DESC for stable newest-first", () => {
    const ts = "2026-08-01T10:00:00.000Z";
    // Lexicographically ordered ids so id DESC is unambiguous.
    const a = audit.append({
      taskId: "tie",
      action: "a",
      detail: {},
      decision: "info",
      createdAt: ts,
    });
    const b = audit.append({
      taskId: "tie",
      action: "b",
      detail: {},
      decision: "info",
      createdAt: ts,
    });
    const c = audit.append({
      taskId: "tie",
      action: "c",
      detail: {},
      decision: "info",
      createdAt: ts,
    });
    // Force same created_at (append may use wall clock if omitted; we set equal).
    db.prepare(`UPDATE audit_entries SET created_at = ? WHERE task_id = ?`).run(
      ts,
      "tie",
    );

    const page = listAuditEntries(db, { taskId: "tie", limit: 10 });
    expect(page.entries).toHaveLength(3);
    const ids = page.entries.map((e) => e.id);
    const sortedDesc = [a.id, b.id, c.id].sort().reverse();
    expect(ids).toEqual(sortedDesc);
    // Second page slice still stable under limit.
    const top2 = listAuditEntries(db, { taskId: "tie", limit: 2 });
    expect(top2.entries.map((e) => e.id)).toEqual(sortedDesc.slice(0, 2));
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
    expect(page.entries[0]?.createdAt).toBe("2026-08-01T10:00:00.000Z");
    expect(page.entries[0]?.detail._unknownDecision).toBe("bogus-decision");
    expect(page.entries[0]?.detail.ok).toBe(true);
  });

  it("decision:info filter includes remapped unknown/corrupt decisions", () => {
    const taskId = "t-info-filter";
    const literalInfo = audit.append({
      taskId,
      action: "literal.info",
      detail: {},
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    const allow = audit.append({
      taskId,
      action: "allow.row",
      detail: {},
      decision: "allow",
      createdAt: "2026-08-01T11:00:00.000Z",
    });
    const corrupt = audit.append({
      taskId,
      action: "corrupt.row",
      detail: { x: 1 },
      decision: "info",
      createdAt: "2026-08-01T12:00:00.000Z",
    });
    db.prepare(`UPDATE audit_entries SET decision = ? WHERE id = ?`).run(
      "legacy-maybe",
      corrupt.id,
    );

    const asInfo = listAuditEntries(db, { taskId, decision: "info" });
    expect(asInfo.entries.map((e) => e.id).sort()).toEqual(
      [literalInfo.id, corrupt.id].sort(),
    );
    expect(asInfo.entries.every((e) => e.decision === "info")).toBe(true);
    expect(asInfo.total).toBe(2);
    // Corrupt row presents as info with provenance.
    const corruptMapped = asInfo.entries.find((e) => e.id === corrupt.id);
    expect(corruptMapped?.detail._unknownDecision).toBe("legacy-maybe");

    // Known non-info filters stay exact-column and exclude remapped rows.
    const asAllow = listAuditEntries(db, { taskId, decision: "allow" });
    expect(asAllow.entries).toHaveLength(1);
    expect(asAllow.entries[0]?.id).toBe(allow.id);
    expect(
      listAuditEntries(db, { taskId, decision: "deny" }).entries,
    ).toHaveLength(0);
  });

  it("null taskId/decision omit filters (not IS NULL / not throw)", () => {
    audit.append({
      taskId: null,
      action: "system.row",
      detail: {},
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    audit.append({
      taskId: "t-null-filter",
      action: "task.row",
      detail: {},
      decision: "allow",
      createdAt: "2026-08-01T11:00:00.000Z",
    });

    // null filters = unfiltered list (includes system null-taskId rows).
    const nullFilters = listAuditEntries(db, {
      taskId: null,
      decision: null,
      limit: 10,
    });
    expect(nullFilters.entries).toHaveLength(2);
    expect(nullFilters.entries.map((e) => e.action).sort()).toEqual([
      "system.row",
      "task.row",
    ]);

    // Explicit empty-string taskId also omits (truthiness guard).
    expect(
      listAuditEntries(db, { taskId: "", limit: 10 }).entries,
    ).toHaveLength(2);
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

  it("caps limit at 500 and retains the newest 500 rows", () => {
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
    // Newest retained: action.509 … action.10 (not the oldest slice).
    expect(capped.entries[0]?.action).toBe("action.509");
    expect(capped.entries[0]?.createdAt).toBe(
      new Date(Date.UTC(2026, 7, 1, 0, 0, 509)).toISOString(),
    );
    expect(capped.entries[499]?.action).toBe("action.10");
    expect(capped.entries.map((e) => e.action)).toEqual(
      Array.from({ length: 500 }, (_, i) => `action.${509 - i}`),
    );
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
    expect(viaService.entries[0]?.createdAt).toBe("2026-08-01T10:00:00.000Z");
    expect(viaService.hasMore).toBe(false);
    expect(viaService.total).toBe(1);
  });

  it("defaults limit to 100, clamps below 1, and retains newest N", () => {
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
    // Newest 100: a104 … a5 (not oldest a0…a99).
    expect(def.entries[0]?.action).toBe("a104");
    expect(def.entries[0]?.createdAt).toBe(
      new Date(Date.UTC(2026, 7, 1, 0, 0, 104)).toISOString(),
    );
    expect(def.entries[99]?.action).toBe("a5");
    expect(def.entries.map((e) => e.action)).toEqual(
      Array.from({ length: 100 }, (_, i) => `a${104 - i}`),
    );

    expect(
      listAuditEntries(db, { taskId: "lim", limit: undefined }).entries,
    ).toHaveLength(100);
    const one = listAuditEntries(db, { taskId: "lim", limit: 0 });
    expect(one.entries).toHaveLength(1);
    expect(one.entries[0]?.action).toBe("a104");
    expect(
      listAuditEntries(db, { taskId: "lim", limit: -3 }).entries[0]?.action,
    ).toBe("a104");
    const floor = listAuditEntries(db, { taskId: "lim", limit: 2.9 });
    expect(floor.entries).toHaveLength(2);
    expect(floor.entries.map((e) => e.action)).toEqual(["a104", "a103"]);

    // Non-finite limits fall back to default 100 newest.
    const nanPage = listAuditEntries(db, { taskId: "lim", limit: Number.NaN });
    expect(nanPage.limit).toBe(100);
    expect(nanPage.entries).toHaveLength(100);
    expect(nanPage.entries[0]?.action).toBe("a104");
    expect(
      listAuditEntries(db, {
        taskId: "lim",
        limit: Number.POSITIVE_INFINITY,
      }).limit,
    ).toBe(100);
  });
});
