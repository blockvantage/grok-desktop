import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { AuditService } from "./audit.js";
import {
  AUDIT_DETAIL_STRING_MAX,
  clampAuditListLimit,
  clampAuditListOffset,
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

  it("fails closed for non-finite limits (NaN / Infinity)", () => {
    expect(clampAuditListLimit(Number.NaN)).toBe(100);
    expect(clampAuditListLimit(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampAuditListLimit(Number.NEGATIVE_INFINITY)).toBe(100);
  });
});

describe("clampAuditListOffset", () => {
  it("defaults to 0, floors, clamps below 0 to 0", () => {
    expect(clampAuditListOffset()).toBe(0);
    expect(clampAuditListOffset(undefined)).toBe(0);
    expect(clampAuditListOffset(3.9)).toBe(3);
    expect(clampAuditListOffset(0)).toBe(0);
    expect(clampAuditListOffset(-5)).toBe(0);
    expect(clampAuditListOffset(10)).toBe(10);
  });

  it("fails closed for non-finite offsets", () => {
    expect(clampAuditListOffset(Number.NaN)).toBe(0);
    expect(clampAuditListOffset(Number.POSITIVE_INFINITY)).toBe(0);
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

  it("deep-walks nested objects/arrays (approval detail.tool shape)", () => {
    const out = redactAuditDetail({
      approvalId: "a1",
      decision: "approve",
      tool: {
        type: "tool_request",
        command: "export token=abc123 password=hunter2; curl https://x",
        meta: {
          env: { API_TOKEN: "sk-live-nested-secret-xx", PATH: "/usr/bin" },
          headers: [{ authorization: "Bearer secret-jwt" }],
        },
      },
    });
    const tool = out.tool as Record<string, unknown>;
    expect(String(tool.command)).toContain("token=[REDACTED]");
    expect(String(tool.command)).toContain("password=[REDACTED]");
    expect(JSON.stringify(out)).not.toMatch(
      /hunter2|abc123|sk-live-nested|secret-jwt/,
    );
    const meta = tool.meta as Record<string, unknown>;
    const env = meta.env as Record<string, unknown>;
    // Secret-like keys fully redacted even when nested.
    expect(env.API_TOKEN).toBe("[REDACTED]");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("applies shared secret-value patterns (bare sk-/Bearer without assignment)", () => {
    const out = redactAuditDetail({
      output: "got sk-liveabcdefghij from provider",
      message: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
      command: "echo hello",
    });
    expect(JSON.stringify(out)).not.toMatch(/sk-liveabcdefghij/);
    expect(String(out.output)).toContain("[REDACTED]");
    expect(String(out.message)).toContain("[REDACTED]");
    expect(out.command).toBe("echo hello");
  });

  it("truncates long strings with …[truncated] marker", () => {
    const long = "x".repeat(AUDIT_DETAIL_STRING_MAX + 50);
    const out = redactAuditDetail({ blob: long });
    const s = String(out.blob);
    expect(s.endsWith("…[truncated]")).toBe(true);
    expect(s.length).toBe(AUDIT_DETAIL_STRING_MAX + "…[truncated]".length);
    expect(s.startsWith("x".repeat(100))).toBe(true);
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
    expect(page.offset).toBe(0);
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

  it("decision:info includes rows remapped from unknown DB decisions", () => {
    audit.append({
      taskId: "t-info",
      action: "stored.info",
      detail: { kind: "stored" },
      decision: "info",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    const remapped = audit.append({
      taskId: "t-info",
      action: "stored.bogus",
      detail: { kind: "bogus" },
      decision: "info",
      createdAt: "2026-08-01T11:00:00.000Z",
    });
    db.prepare(`UPDATE audit_entries SET decision = ? WHERE id = ?`).run(
      "bogus-decision",
      remapped.id,
    );
    audit.append({
      taskId: "t-info",
      action: "stored.allow",
      detail: {},
      decision: "allow",
      createdAt: "2026-08-01T12:00:00.000Z",
    });

    const page = listAuditEntries(db, {
      taskId: "t-info",
      decision: "info",
      limit: 10,
    });
    // Must include both stored "info" and remapped unknown rows that display as info.
    expect(page.entries).toHaveLength(2);
    expect(page.entries.every((r) => r.decision === "info")).toBe(true);
    expect(page.entries.map((r) => r.action).sort()).toEqual([
      "stored.bogus",
      "stored.info",
    ]);
    const bog = page.entries.find((r) => r.action === "stored.bogus");
    expect(bog?.detail._unknownDecision).toBe("bogus-decision");
    expect(page.total).toBe(2);
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

  it("redacts secret-like fields in listed detail including nested tool", () => {
    audit.append({
      taskId: "t-sec",
      action: "tool.shell",
      detail: {
        apiKey: "sk-live-xyz",
        command: "export token=abc123 password=hunter2",
        path: "/workspace/a",
        tool: {
          type: "tool_request",
          command: "curl -H token=nested-secret password=nested-pw https://x",
          meta: { note: "safe" },
        },
      },
      decision: "deny",
      createdAt: "2026-08-01T10:00:00.000Z",
    });

    const page = listAuditEntries(db, { taskId: "t-sec" });
    const d = page.entries[0]?.detail ?? {};
    expect(d.apiKey).toBe("[REDACTED]");
    expect(String(d.command)).toContain("token=[REDACTED]");
    expect(String(d.command)).toContain("password=[REDACTED]");
    expect(JSON.stringify(d)).not.toMatch(
      /hunter2|abc123|sk-live|nested-secret|nested-pw/,
    );
    expect(d.path).toBe("/workspace/a");
    const tool = d.tool as Record<string, unknown>;
    expect(String(tool.command)).toContain("token=[REDACTED]");
    expect(tool.meta).toEqual({ note: "safe" });
  });

  it("reports hasMore and total when truncated; offset pages further", () => {
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
    expect(page.offset).toBe(0);
    // Newest first
    expect(page.entries[0]?.action).toBe("action.4");
    expect(page.entries[1]?.action).toBe("action.3");

    const page2 = listAuditEntries(db, {
      taskId: "task-page",
      limit: 2,
      offset: 2,
    });
    expect(page2.entries).toHaveLength(2);
    expect(page2.offset).toBe(2);
    expect(page2.total).toBe(5);
    expect(page2.hasMore).toBe(true);
    expect(page2.entries[0]?.action).toBe("action.2");
    expect(page2.entries[1]?.action).toBe("action.1");

    const page3 = listAuditEntries(db, {
      taskId: "task-page",
      limit: 2,
      offset: 4,
    });
    expect(page3.entries).toHaveLength(1);
    expect(page3.entries[0]?.action).toBe("action.0");
    expect(page3.hasMore).toBe(false);
    expect(page3.total).toBe(5);
    expect(page3.offset).toBe(4);

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

    // Older rows past the first page via offset.
    const next = listAuditEntries(db, {
      taskId: "task-cap",
      limit: 500,
      offset: 500,
    });
    expect(next.entries).toHaveLength(10);
    expect(next.offset).toBe(500);
    expect(next.hasMore).toBe(false);
    expect(next.total).toBe(510);
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
    // NaN must not produce broken LIMIT — fail closed to default 100.
    expect(
      listAuditEntries(db, { taskId: "lim", limit: Number.NaN }).entries,
    ).toHaveLength(100);
  });
});
