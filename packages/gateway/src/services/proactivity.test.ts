import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { InboxService } from "./inbox.js";
import { SettingsService } from "./settings.js";
import { MemoryService } from "./memory.js";
import { SchedulerService } from "./scheduler.js";
import { ProactivityService } from "./proactivity.js";
import { recordScheduleOutcome } from "./schedule-outcomes.js";

describe("ProactivityService", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let inbox: InboxService;
  let settings: SettingsService;
  let memory: MemoryService;
  let scheduler: SchedulerService;
  let proactivity: ProactivityService;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-pro-"));
    ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    inbox = new InboxService(db);
    settings = new SettingsService(db);
    memory = new MemoryService(db);
    scheduler = new SchedulerService(db, tasks, settings, path.join(dir, "sched-ws"));
    settings.set({ quietHours: null });
    proactivity = new ProactivityService(tasks, inbox, settings);
    proactivity.setIntelligenceSources({ memory, scheduler });
  });

  afterEach(() => {
    proactivity.stop();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tick writes inbox items for waiting_approval and failed tasks", () => {
    const t1 = tasks.create({
      goal: "Needs approval",
      workspaceRoots: [ws],
    });
    tasks.setStatus(t1.id, "waiting_approval");

    const t2 = tasks.create({
      goal: "Failed run",
      workspaceRoots: [ws],
    });
    tasks.setStatus(t2.id, "failed");

    const noon = new Date("2026-07-10T12:00:00");
    const n = proactivity.tick(noon);
    expect(n).toBeGreaterThanOrEqual(2);

    const items = inbox.list();
    expect(items.some((i) => i.kind === "approval" && i.taskId === t1.id)).toBe(
      true,
    );
    expect(
      items.some((i) => i.kind === "unfinished" && i.taskId === t2.id),
    ).toBe(true);

    // Dedupe within 24h
    expect(proactivity.tick(noon)).toBe(0);
  });

  it("quiet hours skip suggestion ticks but schedule outcomes still insert", () => {
    settings.set({
      quietHours: { start: "22:00", end: "08:00" },
    });
    const night = new Date("2026-07-10T23:30:00");
    const t1 = tasks.create({
      goal: "Needs approval",
      workspaceRoots: [ws],
    });
    tasks.setStatus(t1.id, "waiting_approval");
    expect(proactivity.tick(night)).toBe(0);

    const scheduled = tasks.create({
      goal: "Night brief",
      workspaceRoots: [ws],
      scheduleRuleId: "s-night",
    });
    tasks.setStatus(scheduled.id, "done");
    recordScheduleOutcome(inbox, {
      task: tasks.get(scheduled.id)!,
      scheduleName: "Night shift",
    });
    expect(
      inbox.list().some((i) => i.kind === "schedule_done" && i.taskId === scheduled.id),
    ).toBe(true);
  });

  it("emits memory-aware automation suggestions as inbox suggestion items", () => {
    memory.upsert({
      kind: "standing",
      title: "Weekly priorities",
      content: "Protect focus; plan OKRs and weekly priorities.",
    });
    const preview = proactivity.previewAutomationSuggestions();
    expect(preview.length).toBeGreaterThanOrEqual(1);
    expect(preview.some((s) => s.suggestionKey === "weekly-priority-review")).toBe(
      true,
    );

    const n = proactivity.emitAutomationSuggestions();
    expect(n).toBeGreaterThanOrEqual(1);
    const items = inbox.list();
    expect(items.some((i) => i.kind === "suggestion")).toBe(true);
    expect(
      items.some(
        (i) =>
          i.kind === "suggestion" &&
          i.taskId === "suggestion:weekly-priority-review",
      ),
    ).toBe(true);

    // Deduped
    expect(proactivity.emitAutomationSuggestions()).toBe(0);
  });
});
