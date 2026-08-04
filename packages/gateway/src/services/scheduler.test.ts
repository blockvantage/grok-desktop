import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TestEngine } from "@grokdesk/engine-testkit";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { SettingsService } from "./settings.js";
import { SchedulerService } from "./scheduler.js";
import { TaskRunner } from "./runner.js";
import { RunAttemptService } from "./run-attempts.js";
import { TaskSubmissionService } from "./task-submission.js";
import {
  MAX_SCHEDULE_OCCURRENCE_ATTEMPTS,
  ScheduleOccurrenceService,
} from "./schedule-occurrences.js";

describe("SchedulerService", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let settings: SettingsService;
  let scheduler: SchedulerService;
  let runner: TaskRunner;
  let runs: RunAttemptService;
  let submit: TaskSubmissionService;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-sched-"));
    ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    settings = new SettingsService(db);
    // Disable quiet hours so tests always fire
    settings.set({ quietHours: null });
    runs = new RunAttemptService(db);
    submit = new TaskSubmissionService(tasks, runs);
    scheduler = new SchedulerService(db, tasks, settings);
    scheduler.setTaskSubmission(submit);
    runner = new TaskRunner(tasks, new AuditService(db), new TestEngine(), {
      runAttempts: runs,
    });
  });

  afterEach(async () => {
    scheduler.stop();
    // Drain any in-flight runs before closing sqlite
    await new Promise((r) => setTimeout(r, 20));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tick creates a task and onTasksCreated pumps runner to done", async () => {
    let pumpPromise: Promise<void> = Promise.resolve();
    scheduler.setOnTasksCreated(() => {
      pumpPromise = runner.pumpQueue();
      return pumpPromise;
    });

    scheduler.create({
      name: "every minute",
      goalTemplate: "Scheduled hello",
      cron: "* * * * *",
      timezone: "UTC",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
      quietHoursRespect: false,
    });
    scheduler.resetFireState();

    expect(() =>
      scheduler.create({
        name: "bad",
        goalTemplate: "x",
        cron: "not a cron",
        timezone: "UTC",
        workspaceRoots: [ws],
      }),
    ).toThrow(/Invalid schedule cron/);

    expect(() =>
      scheduler.create({
        name: "rel",
        goalTemplate: "x",
        cron: "* * * * *",
        timezone: "UTC",
        workspaceRoots: ["relative/path"],
      }),
    ).toThrow(/must be absolute/);

    const now = new Date();
    const created = scheduler.tick(now);
    expect(created.length).toBe(1);

    const task = tasks.get(created[0]!);
    expect(task?.mode).toBe("scheduled");
    expect(task?.goal).toBe("Scheduled hello");
    // One submission path: durable run attempt allocated at create time.
    // (Callback may already have claimed the lease if pump is sync-started.)
    const attempt = runs.latestForTask(created[0]!);
    expect(attempt).not.toBeNull();

    // Callback must start work (this is the production wire)
    await pumpPromise;
    expect(tasks.get(created[0]!)?.status).toBe("done");
    expect(runs.latestForTask(created[0]!)?.status).toBe("done");
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(true);
  });

  it("does not double-fire within debounce window", () => {
    scheduler.create({
      name: "once",
      goalTemplate: "x",
      cron: "* * * * *",
      timezone: "UTC",
      workspaceRoots: [ws],
      quietHoursRespect: false,
      approvalMode: "autopilot",
    });
    scheduler.resetFireState();
    const now = new Date();
    expect(scheduler.tick(now).length).toBe(1);
    expect(scheduler.tick(now).length).toBe(0);
  });

  it("occurrence: transient submit failure is retried on a later tick", () => {
    const rule = scheduler.create({
      name: "retry-transient",
      goalTemplate: "should eventually run",
      cron: "* * * * *",
      timezone: "UTC",
      workspaceRoots: [ws],
      quietHoursRespect: false,
      approvalMode: "autopilot",
    });
    scheduler.resetFireState();

    let calls = 0;
    const realSubmit = submit.submit.bind(submit);
    vi.spyOn(submit, "submit").mockImplementation((input, ctx) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("transient db lock");
      }
      return realSubmit(input, ctx);
    });

    const now = new Date();
    expect(scheduler.tick(now)).toEqual([]);

    const occ = new ScheduleOccurrenceService(db);
    const rows = occ.listForSchedule(rule.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error).toContain("transient db lock");
    expect(rows[0]!.attemptCount).toBe(1);

    // Same due occurrence; lastFired was not advanced on failure.
    const created = scheduler.tick(now);
    expect(created).toHaveLength(1);
    expect(tasks.get(created[0]!)?.goal).toBe("should eventually run");

    const after = occ.find(rule.id, rows[0]!.scheduledFor);
    expect(after?.status).toBe("fired");
    expect(after?.taskId).toBe(created[0]);
    expect(after?.attemptCount).toBe(2);

    // Happy path: no double-fire of the succeeded occurrence.
    expect(scheduler.tick(now)).toEqual([]);
  });

  it("occurrence: permanently-failing run stops after retry cap", () => {
    const rule = scheduler.create({
      name: "retry-cap",
      goalTemplate: "always fails",
      cron: "* * * * *",
      timezone: "UTC",
      workspaceRoots: [ws],
      quietHoursRespect: false,
      approvalMode: "autopilot",
    });
    scheduler.resetFireState();

    vi.spyOn(submit, "submit").mockImplementation(() => {
      throw new Error("disk full");
    });

    const now = new Date();
    const allCreated: string[] = [];
    // More ticks than the cap to prove we do not infinite-loop.
    for (let i = 0; i < MAX_SCHEDULE_OCCURRENCE_ATTEMPTS + 3; i++) {
      allCreated.push(...scheduler.tick(now));
    }
    expect(allCreated).toEqual([]);

    const occ = new ScheduleOccurrenceService(db);
    const rows = occ.listForSchedule(rule.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error).toContain("disk full");
    expect(rows[0]!.attemptCount).toBe(MAX_SCHEDULE_OCCURRENCE_ATTEMPTS);
    expect(rows[0]!.taskId).toBeNull();
  });

  it("occurrence: happy path fires exactly once", () => {
    const rule = scheduler.create({
      name: "once-happy",
      goalTemplate: "once",
      cron: "* * * * *",
      timezone: "UTC",
      workspaceRoots: [ws],
      quietHoursRespect: false,
      approvalMode: "autopilot",
    });
    scheduler.resetFireState();
    const now = new Date();
    const first = scheduler.tick(now);
    expect(first).toHaveLength(1);
    // Same tick / debounce window: no second task for the same occurrence.
    expect(scheduler.tick(now)).toEqual([]);

    const occ = new ScheduleOccurrenceService(db);
    const fired = occ.listForSchedule(rule.id).filter((r) => r.status === "fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]!.taskId).toBe(first[0]);
    expect(fired[0]!.attemptCount).toBe(1);

    // Clear debounce and re-tick at the same wall time: still no double-fire
    // of the already-succeeded (scheduleId, scheduledFor) key.
    scheduler.resetFireState();
    expect(scheduler.tick(now)).toEqual([]);
    expect(
      occ.listForSchedule(rule.id).filter((r) => r.status === "fired"),
    ).toHaveLength(1);
  });

  it("deletes a schedule rule", () => {
    const rule = scheduler.create({
      name: "doomed",
      goalTemplate: "delete me",
      cron: "* * * * *",
      timezone: "UTC",
      workspaceRoots: [ws],
      quietHoursRespect: false,
      approvalMode: "autopilot",
    });
    expect(scheduler.list().find((r) => r.id === rule.id)).toBeDefined();

    scheduler.delete(rule.id);

    expect(scheduler.list().find((r) => r.id === rule.id)).toBeUndefined();
  });

  it("delete of a missing id is a no-op", () => {
    const before = scheduler.list().length;

    // The renderer deletes fire-and-forget (no .catch): a throw here would
    // surface as an unhandled rejection, so a no-match DELETE must stay quiet.
    expect(() => scheduler.delete("nope")).not.toThrow();

    expect(scheduler.list()).toHaveLength(before);
  });
});
