import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { RunAttemptService } from "../services/run-attempts.js";
import { TaskService } from "../services/tasks.js";
import { TaskSubmissionService } from "../services/task-submission.js";
import { ScheduleOccurrenceService } from "../services/schedule-occurrences.js";

describe("Phase 2 run attempts + schedule occurrences", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let runs: RunAttemptService;
  let submit: TaskSubmissionService;
  let occ: ScheduleOccurrenceService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-run-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    runs = new RunAttemptService(db, "instance-a");
    submit = new TaskSubmissionService(tasks, runs);
    occ = new ScheduleOccurrenceService(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("submit creates task + queued run attempt", () => {
    const { task, runAttempt } = submit.submit({
      goal: "hi",
      workspaceRoots: [dir],
    });
    expect(task.status).toBe("queued");
    expect(runAttempt.taskId).toBe(task.id);
    expect(runAttempt.attemptNumber).toBe(1);
    expect(runAttempt.status).toBe("queued");
  });

  it("claim + heartbeat + complete lifecycle", () => {
    const { runAttempt } = submit.submit({
      goal: "work",
      workspaceRoots: [dir],
    });
    const claimed = runs.claimNext(5_000);
    expect(claimed?.id).toBe(runAttempt.id);
    expect(claimed?.leaseOwner).toBe("instance-a");
    expect(runs.heartbeat(runAttempt.id, 5_000)).toBe(true);
    runs.complete(runAttempt.id, "done", "completed successfully");
    const done = runs.get(runAttempt.id)!;
    expect(done.status).toBe("done");
    expect(done.terminalReason).toBe("completed successfully");
    expect(done.leaseOwner).toBeNull();
  });

  it("recoverStaleLeases marks foreign running attempts interrupted", () => {
    const { runAttempt } = submit.submit({
      goal: "x",
      workspaceRoots: [dir],
    });
    // Simulate another instance holding a lease
    const db = openDatabase(path.join(dir, "t.sqlite"));
    db.prepare(
      `UPDATE task_run_attempts SET status = 'running', lease_owner = 'other', lease_expires_at = ? WHERE id = ?`,
    ).run(new Date(Date.now() - 60_000).toISOString(), runAttempt.id);
    db.close();

    const n = runs.recoverStaleLeases();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(runs.get(runAttempt.id)?.status).toBe("interrupted");
  });

  it("preserves an unexpired lease owned by another live instance", () => {
    const { runAttempt } = submit.submit({
      goal: "shared live work",
      workspaceRoots: [dir],
    });
    const db = openDatabase(path.join(dir, "t.sqlite"));
    db.prepare(
      `UPDATE task_run_attempts SET status = 'running', lease_owner = 'other', lease_expires_at = ? WHERE id = ?`,
    ).run(new Date(Date.now() + 60_000).toISOString(), runAttempt.id);
    db.close();

    expect(runs.recoverStaleLeases()).toBe(0);
    expect(runs.get(runAttempt.id)).toMatchObject({
      status: "running",
      leaseOwner: "other",
    });
  });

  it("does not interrupt a lease renewed after an expired snapshot", () => {
    const { runAttempt } = submit.submit({
      goal: "renew during recovery",
      workspaceRoots: [dir],
    });
    expect(runs.claimForTask(runAttempt.taskId, 60_000)?.id).toBe(
      runAttempt.id,
    );
    const db = openDatabase(path.join(dir, "t.sqlite"));
    db.prepare(
      "UPDATE task_run_attempts SET lease_expires_at = ? WHERE id = ?",
    ).run(new Date(Date.now() - 1_000).toISOString(), runAttempt.id);
    const recoveryNow = new Date();
    expect(runs.heartbeat(runAttempt.id, 60_000)).toBe(true);

    expect(runs.interruptIfExpired(runAttempt.id, recoveryNow)).toBe(false);
    expect(runs.get(runAttempt.id)?.status).toBe("running");
    db.close();
  });

  it("prevents a stale former owner from completing the new owner's attempt", () => {
    const { runAttempt } = submit.submit({
      goal: "ownership handoff",
      workspaceRoots: [dir],
    });
    expect(runs.claimForTask(runAttempt.taskId, 60_000)?.id).toBe(
      runAttempt.id,
    );
    const db = openDatabase(path.join(dir, "t.sqlite"));
    db.prepare(
      "UPDATE task_run_attempts SET lease_expires_at = ? WHERE id = ?",
    ).run(new Date(Date.now() - 1_000).toISOString(), runAttempt.id);
    const nextOwner = new RunAttemptService(db, "instance-b");
    expect(nextOwner.claimForTask(runAttempt.taskId, 60_000)).toMatchObject({
      id: runAttempt.id,
      leaseOwner: "instance-b",
    });

    expect(runs.complete(runAttempt.id, "done", "stale completion")).toBe(
      false,
    );
    expect(nextOwner.get(runAttempt.id)).toMatchObject({
      status: "running",
      leaseOwner: "instance-b",
    });
    expect(
      nextOwner.complete(runAttempt.id, "done", "current completion"),
    ).toBe(true);
    db.close();
  });

  it("does not publish attachment failure after another process claims the task", () => {
    const { task, runAttempt } = submit.submit({
      goal: "attachment claim race",
      workspaceRoots: [dir],
    });
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const otherTasks = new TaskService(db);
    const otherRuns = new RunAttemptService(db, "instance-b");
    expect(
      otherRuns.claimForTaskAtomically(task.id, 60_000, () =>
        Boolean(
          otherTasks.transitionStatus(task.id, ["queued"], "running", {
            emitHooks: false,
          }),
        ),
      ),
    ).toMatchObject({ id: runAttempt.id, leaseOwner: "instance-b" });

    let publishedFailure = false;
    expect(
      runs.completeUnclaimedAtomically(
        runAttempt.id,
        "failed",
        "attachment_recovery_failed",
        () => {
          publishedFailure = true;
          tasks.setStatus(task.id, "failed");
        },
      ),
    ).toBe(false);
    expect(publishedFailure).toBe(false);
    expect(tasks.get(task.id)?.status).toBe("running");
    expect(runs.get(runAttempt.id)).toMatchObject({
      status: "running",
      leaseOwner: "instance-b",
    });
    db.close();
  });

  it("schedule occurrence uniqueness across restart", () => {
    const when = "2026-07-14T12:00:00.000Z";
    const first = occ.tryBegin("sched-1", when);
    expect(first).toBeTruthy();
    const second = occ.tryBegin("sched-1", when);
    expect(second).toBeNull();
    occ.markFired(first!.id, "task-1");
    expect(occ.find("sched-1", when)?.status).toBe("fired");
    expect(occ.find("sched-1", when)?.taskId).toBe("task-1");
  });
});
