import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { SettingsService } from "./settings.js";
import { SchedulerService } from "./scheduler.js";
import { reconcileScheduledTaskEvent } from "./scheduled-task-reconcile.js";
import { engineScheduleDeskId } from "@grokdesk/shared";

describe("reconcileScheduledTaskEvent", () => {
  let dir: string;
  let db: Db;
  let scheduler: SchedulerService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-sched-rec-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    const tasks = new TaskService(db);
    const settings = new SettingsService(db);
    scheduler = new SchedulerService(
      db,
      tasks,
      settings,
      path.join(dir, "ws"),
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates and deletes a Desk rule from engine scheduled-task events", () => {
    const created = reconcileScheduledTaskEvent(scheduler, {
      sessionUpdate: "ScheduledTaskCreated",
      id: "st-9",
      prompt: "Check deploy",
      interval: "30m",
    });
    expect(created?.action).toBe("created");
    const id = engineScheduleDeskId("st-9");
    expect(scheduler.get(id)?.goalTemplate).toBe("Check deploy");
    expect(scheduler.get(id)?.cron).toBe("*/30 * * * *");

    const deleted = reconcileScheduledTaskEvent(scheduler, {
      sessionUpdate: "ScheduledTaskDeleted",
      id: "st-9",
    });
    expect(deleted?.action).toBe("deleted");
    expect(scheduler.get(id)).toBeNull();
  });
});
