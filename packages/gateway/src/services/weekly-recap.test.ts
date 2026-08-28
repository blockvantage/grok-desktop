import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { InboxService } from "./inbox.js";
import { SettingsService } from "./settings.js";
import { MemoryService } from "./memory.js";
import {
  emitWeeklyRecapIfDue,
  readWeeklyRecapLastWeek,
  shouldEmitWeeklyRecap,
} from "./weekly-recap.js";

describe("weekly recap gateway", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let inbox: InboxService;
  let settings: SettingsService;
  let memory: MemoryService;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-recap-"));
    ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    inbox = new InboxService(db);
    settings = new SettingsService(db);
    memory = new MemoryService(db);
    settings.set({ quietHours: null });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("shouldEmitWeeklyRecap is once per ISO week", () => {
    expect(
      shouldEmitWeeklyRecap({
        enabled: true,
        lastWeekKey: null,
        weekKey: "2026-W35",
        hasLines: true,
      }),
    ).toBe(true);
    expect(
      shouldEmitWeeklyRecap({
        enabled: true,
        lastWeekKey: "2026-W35",
        weekKey: "2026-W35",
        hasLines: true,
      }),
    ).toBe(false);
    expect(
      shouldEmitWeeklyRecap({
        enabled: false,
        lastWeekKey: null,
        weekKey: "2026-W35",
        hasLines: true,
      }),
    ).toBe(false);
    expect(
      shouldEmitWeeklyRecap({
        enabled: true,
        lastWeekKey: null,
        weekKey: "2026-W35",
        hasLines: false,
      }),
    ).toBe(false);
  });

  it("emits a recap inbox item from completed tasks and remembers the week", () => {
    const t = tasks.create({
      goal: "Draft the launch brief",
      workspaceRoots: [ws],
    });
    tasks.setStatus(t.id, "done");
    const now = new Date("2026-08-27T15:00:00.000Z");
    db.prepare(`UPDATE tasks SET completed_at = ? WHERE id = ?`).run(
      "2026-08-26T10:00:00.000Z",
      t.id,
    );
    const first = emitWeeklyRecapIfDue({
      db,
      inbox,
      memory,
      tasks,
      settings,
      now,
    });
    expect(first.emitted).toBe(true);
    const items = inbox.list();
    expect(items.some((i) => i.kind === "recap")).toBe(true);
    const recap = items.find((i) => i.kind === "recap")!;
    expect(recap.title).toBe("Learn from this week");
    expect(recap.body).toContain("Draft the launch brief");
    expect(recap.body).not.toMatch(/[{[]/);
    expect(recap.taskId).toMatch(/^recap:/);
    expect(readWeeklyRecapLastWeek(db)).toBe(first.weekKey);

    const second = emitWeeklyRecapIfDue({
      db,
      inbox,
      memory,
      tasks,
      settings,
      now,
    });
    expect(second.emitted).toBe(false);
    expect(inbox.list().filter((i) => i.kind === "recap")).toHaveLength(1);
  });

  it("does not emit when weeklyRecapEnabled is false", () => {
    settings.set({ weeklyRecapEnabled: false });
    const t = tasks.create({
      goal: "Something done",
      workspaceRoots: [ws],
    });
    tasks.setStatus(t.id, "done");
    const r = emitWeeklyRecapIfDue({
      db,
      inbox,
      memory,
      tasks,
      settings,
      now: new Date("2026-08-27T15:00:00.000Z"),
    });
    expect(r.emitted).toBe(false);
    expect(inbox.list()).toHaveLength(0);
  });
});
