import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { AuditService } from "./audit.js";
import { listAuditEntries } from "./audit-list.js";

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

    const rows = listAuditEntries(db, { taskId, limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.action).toBe("second.action");
    expect(rows[1]?.action).toBe("first.action");
    expect(rows.every((r) => r.taskId === taskId)).toBe(true);
  });

  it("filters by decision when provided", () => {
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
    expect(denied).toHaveLength(1);
    expect(denied[0]?.decision).toBe("deny");
    expect(denied[0]?.action).toBe("tool.deny");
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
    expect(listAuditEntries(db, { taskId: "task-cap", limit: 9999 })).toHaveLength(
      500,
    );
    expect(listAuditEntries(db, { limit: 9999 }).length).toBeLessThanOrEqual(500);
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
    expect(viaService).toHaveLength(1);
    expect(viaService[0]?.detail).toEqual({ ok: true });
  });

  it("defaults limit to 100 and clamps below 1 to 1", () => {
    for (let i = 0; i < 5; i++) {
      audit.append({
        taskId: "lim",
        action: `a${i}`,
        detail: {},
        decision: "info",
        createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
      });
    }
    expect(listAuditEntries(db, { taskId: "lim" })).toHaveLength(5);
    expect(listAuditEntries(db, { taskId: "lim", limit: 0 })).toHaveLength(1);
    expect(listAuditEntries(db, { taskId: "lim", limit: -3 })).toHaveLength(1);
  });
});
