import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeRoot } from "@grokdesk/shared";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";

describe("TaskService", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-tasks-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates a queued task with policy snapshot", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const t = tasks.create({
      goal: "Clean folder",
      workspaceRoots: [root],
    });
    expect(t.status).toBe("queued");
    // TaskService stores roots via normalizeRoot (forward slashes on Windows).
    expect(t.policySnapshot.workspaceRoots[0]).toBe(
      normalizeRoot(path.resolve(root)),
    );
    expect(tasks.list()).toHaveLength(1);
  });

  it("rejects relative workspace roots", () => {
    expect(() =>
      tasks.create({
        goal: "nope",
        workspaceRoots: ["relative/ws"],
      }),
    ).toThrow(/must be absolute/);
  });

  it("preserves revision lineage through create, get, and list", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const source = tasks.create({ goal: "Original", workspaceRoots: [root] });
    tasks.setStatus(source.id, "done");
    const revised = tasks.create({
      goal: "Revision",
      workspaceRoots: [root],
      parentTaskId: source.id,
      revisionOfTaskId: source.id,
    });

    expect(revised.revisionOfTaskId).toBe(source.id);
    expect(tasks.get(revised.id)?.revisionOfTaskId).toBe(source.id);
    expect(
      tasks.list().find((task) => task.id === revised.id)?.revisionOfTaskId,
    ).toBe(source.id);
  });

  it("uses null revision lineage when omitted across create, get, and list", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const task = tasks.create({ goal: "Original", workspaceRoots: [root] });

    expect(task.revisionOfTaskId).toBeNull();
    expect(tasks.get(task.id)?.revisionOfTaskId).toBeNull();
    expect(
      tasks.list().find((listed) => listed.id === task.id)?.revisionOfTaskId,
    ).toBeNull();
  });

  it("preserves path-based attachment metadata through create, get, and list", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const attachments = [
      {
        id: "attachment-1",
        kind: "image" as const,
        name: "brief.png",
        sourcePath: path.join(dir, "brief.png"),
        stagedPath: path.join(root, "attachments", "brief.png"),
        mime: "image/png",
        sizeBytes: 123,
      },
    ];

    const created = tasks.create({
      goal: "Use the brief",
      workspaceRoots: [root],
      attachments,
    });

    expect(created.attachments).toEqual(attachments);
    expect(tasks.get(created.id)?.attachments).toEqual(attachments);
    expect(tasks.list()[0]?.attachments).toEqual(attachments);
    const persisted = db
      .prepare("SELECT attachments_json FROM tasks WHERE id = ?")
      .get(created.id) as { attachments_json: string };
    expect(persisted.attachments_json).not.toContain("base64");
    expect(persisted.attachments_json).not.toContain("data:");
    expect(JSON.parse(persisted.attachments_json)).toEqual(attachments);
  });

  it("rejects cross-chat, stale, active, and duplicate revision sources", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const source = tasks.create({ goal: "source", workspaceRoots: [root] });
    expect(() =>
      tasks.create({
        goal: "active edit",
        workspaceRoots: [root],
        parentTaskId: source.id,
        revisionOfTaskId: source.id,
      }),
    ).toThrow(/terminal/i);

    tasks.setStatus(source.id, "done");
    const newer = tasks.create({
      goal: "newer follow-up",
      workspaceRoots: [root],
      parentTaskId: source.id,
    });
    tasks.setStatus(newer.id, "done");
    // This scenario is about a genuinely newer accepted turn, not the
    // canonical id tie-break exercised below. Make that ordering explicit so
    // a fast isolated run cannot collapse both creates into one millisecond.
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(
      "2026-01-01T00:00:00.000Z",
      source.id,
    );
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(
      "2026-01-01T00:00:01.000Z",
      newer.id,
    );
    const other = tasks.create({ goal: "other chat", workspaceRoots: [root] });
    tasks.setStatus(other.id, "done");
    expect(() =>
      tasks.create({
        goal: "stale edit",
        workspaceRoots: [root],
        parentTaskId: source.id,
        revisionOfTaskId: source.id,
      }),
    ).toThrow(/latest/i);
    expect(() =>
      tasks.create({
        goal: "cross-chat",
        workspaceRoots: [root],
        parentTaskId: other.id,
        revisionOfTaskId: newer.id,
      }),
    ).toThrow(/parent/i);

    const revision = tasks.create({
      goal: "valid edit",
      workspaceRoots: [root],
      parentTaskId: other.id,
      revisionOfTaskId: other.id,
    });
    expect(revision.revisionOfTaskId).toBe(other.id);
    expect(() =>
      tasks.create({
        goal: "duplicate edit",
        workspaceRoots: [root],
        parentTaskId: other.id,
        revisionOfTaskId: other.id,
      }),
    ).toThrow(/already revised|latest/i);
  });

  it("accepts exactly one of two competing revisions", async () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const source = tasks.create({ goal: "source", workspaceRoots: [root] });
    tasks.setStatus(source.id, "done");

    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        tasks.create({
          goal: "revision one",
          workspaceRoots: [root],
          parentTaskId: source.id,
          revisionOfTaskId: source.id,
        }),
      ),
      Promise.resolve().then(() =>
        tasks.create({
          goal: "revision two",
          workspaceRoots: [root],
          parentTaskId: source.id,
          revisionOfTaskId: source.id,
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("uses stable task id, not insertion order, when timestamps tie", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const insertedFirst = tasks.create({ goal: "first", workspaceRoots: [root] });
    tasks.setStatus(insertedFirst.id, "done");
    const insertedLast = tasks.create({
      goal: "last",
      workspaceRoots: [root],
      parentTaskId: insertedFirst.id,
    });
    tasks.setStatus(insertedLast.id, "done");

    db.prepare("UPDATE task_events SET task_id = ? WHERE task_id = ?").run(
      "task-z",
      insertedFirst.id,
    );
    db.prepare("UPDATE tasks SET id = ? WHERE id = ?").run(
      "task-z",
      insertedFirst.id,
    );
    db.prepare(
      "UPDATE task_events SET task_id = ? WHERE task_id = ?",
    ).run("task-a", insertedLast.id);
    db.prepare(
      "UPDATE tasks SET id = ?, parent_task_id = ? WHERE id = ?",
    ).run("task-a", "task-z", insertedLast.id);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id IN (?, ?)").run(
      "2026-01-01T00:00:00.000Z",
      "task-a",
      "task-z",
    );

    expect(() =>
      tasks.create({
        goal: "edit lower id",
        workspaceRoots: [root],
        parentTaskId: "task-a",
        revisionOfTaskId: "task-a",
      }),
    ).toThrow(/latest/i);
    expect(
      tasks.create({
        goal: "edit canonical latest",
        workspaceRoots: [root],
        parentTaskId: "task-z",
        revisionOfTaskId: "task-z",
      }).revisionOfTaskId,
    ).toBe("task-z");
  });

  it("appends events with monotonic seq", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const t = tasks.create({ goal: "x", workspaceRoots: [root] });
    const e1 = tasks.appendEvent(t.id, "status_change", { status: "running" });
    const e2 = tasks.appendEvent(t.id, "message", {
      role: "assistant",
      text: "hi",
    });
    expect(e1.seq).toBe(2); // create already wrote seq 1
    expect(e2.seq).toBe(3);
    expect(tasks.listEvents(t.id, 0)).toHaveLength(3);
  });

  it("setStatus updates task and emits event", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const t = tasks.create({ goal: "x", workspaceRoots: [root] });
    tasks.setStatus(t.id, "running");
    expect(tasks.get(t.id)?.status).toBe("running");
    const events = tasks.listEvents(t.id, 0);
    expect(events.some((e) => e.kind === "status_change")).toBe(true);
  });

  it("pauseAll / resumeAll toggles isPaused", () => {
    expect(tasks.isPaused()).toBe(false);
    tasks.pauseAll();
    expect(tasks.isPaused()).toBe(true);
    tasks.resumeAll();
    expect(tasks.isPaused()).toBe(false);
  });
});

describe("AuditService", () => {
  let dir: string;
  let db: Db;
  let audit: AuditService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-audit-"));
    db = openDatabase(path.join(dir, "a.sqlite"));
    audit = new AuditService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("appends audit entries", () => {
    const entry = audit.append({
      taskId: null,
      action: "policy.evaluate",
      detail: { tool: "shell" },
      decision: "allow",
    });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    const row = db
      .prepare("SELECT action, decision FROM audit_entries WHERE id = ?")
      .get(entry.id) as { action: string; decision: string };
    expect(row.action).toBe("policy.evaluate");
    expect(row.decision).toBe("allow");
  });
});
