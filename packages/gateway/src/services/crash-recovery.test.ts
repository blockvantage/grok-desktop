import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { RunAttemptService } from "./run-attempts.js";
import { recoverInterruptedTasks } from "./crash-recovery.js";

describe("crash recovery (TASK-01)", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let runs: RunAttemptService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-crash-"));
    db = openDatabase(path.join(dir, "t.db"));
    tasks = new TaskService(db);
    runs = new RunAttemptService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks running and waiting_approval as failed and completes open leases", () => {
    const running = tasks.create({
      goal: "run",
      mode: "agent",
      model: "m",
      effort: "low",
      workspaceRoots: [dir],
    });
    const waiting = tasks.create({
      goal: "wait",
      mode: "agent",
      model: "m",
      effort: "low",
      workspaceRoots: [dir],
    });
    const queued = tasks.create({
      goal: "queue",
      mode: "agent",
      model: "m",
      effort: "low",
      workspaceRoots: [dir],
    });
    tasks.setStatus(running.id, "running");
    tasks.setStatus(waiting.id, "waiting_approval");
    // queued stays queued

    const runA = runs.create(running.id);
    const claimed = runs.claimForTask(running.id, 60_000);
    expect(claimed?.id).toBe(runA.id);
    expect(claimed?.status).toBe("running");
    db.prepare(
      "UPDATE task_run_attempts SET lease_expires_at = ? WHERE id = ?",
    ).run(new Date(Date.now() - 1_000).toISOString(), runA.id);

    let pumped = 0;
    const result = recoverInterruptedTasks({
      tasks,
      runAttempts: runs,
      pumpQueue: async () => {
        pumped += 1;
      },
    });

    expect(result.interruptedTaskIds.sort()).toEqual(
      [running.id, waiting.id].sort(),
    );
    expect(tasks.get(running.id)?.status).toBe("failed");
    expect(tasks.get(waiting.id)?.status).toBe("failed");
    expect(tasks.get(queued.id)?.status).toBe("queued");
    expect(runs.get(runA.id)?.status).toBe("interrupted");
    expect(pumped).toBe(1);
  });

  it("requeues a running task with a provider session instead of interrupted_on_restart", () => {
    const running = tasks.create({
      goal: "resume me",
      workspaceRoots: [dir],
    });
    tasks.setStatus(running.id, "running");
    db.prepare(`UPDATE tasks SET provider_session_id = ? WHERE id = ?`).run(
      "sess-live",
      running.id,
    );
    const result = recoverInterruptedTasks({
      tasks,
      runAttempts: runs,
      pumpQueue: async () => {},
    });
    expect(result.interruptedTaskIds).toEqual([]);
    expect(tasks.get(running.id)?.status).toBe("queued");
  });

  it("does not interrupt a task held by an unexpired foreign lease", () => {
    const running = tasks.create({
      goal: "live in another gateway",
      workspaceRoots: [dir],
    });
    tasks.setStatus(running.id, "running");
    const attempt = runs.create(running.id);
    expect(runs.claimForTask(running.id, 60_000)?.id).toBe(attempt.id);
    const recoveryRuns = new RunAttemptService(db, "instance-b");

    const result = recoverInterruptedTasks({
      tasks,
      runAttempts: recoveryRuns,
      pumpQueue: async () => {},
    });

    expect(result.interruptedTaskIds).toEqual([]);
    expect(result.recoveredLeases).toBe(0);
    expect(tasks.get(running.id)?.status).toBe("running");
    expect(runs.get(attempt.id)).toMatchObject({
      status: "running",
      leaseOwner: runs.getInstanceId(),
    });
  });

  it("heals a running task whose terminal attempt committed before task status", () => {
    const running = tasks.create({
      goal: "crash between terminal writes",
      workspaceRoots: [dir],
    });
    tasks.setStatus(running.id, "running");
    const attempt = runs.create(running.id);
    expect(runs.claimForTask(running.id, 60_000)?.id).toBe(attempt.id);
    expect(runs.complete(attempt.id, "done", "engine completed")).toBe(true);

    const result = recoverInterruptedTasks({
      tasks,
      runAttempts: new RunAttemptService(db, "instance-b"),
      pumpQueue: async () => {},
    });

    expect(result.interruptedTaskIds).toEqual([]);
    expect(tasks.get(running.id)?.status).toBe("done");
    expect(runs.get(attempt.id)?.status).toBe("done");
  });
});
