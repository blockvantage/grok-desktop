import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineAdapter } from "@grokdesk/engine-grok";
import { openDatabase, type Db } from "../db.js";
import { AuditService } from "./audit.js";
import { OperationReceiptService } from "./operation-receipts.js";
import { RunAttemptService } from "./run-attempts.js";
import { TaskRunner } from "./runner.js";
import { TaskService } from "./tasks.js";

describe("TaskRunner shared-database lease gate", () => {
  let dir: string;
  let dbA: Db;
  let dbB: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-runner-shared-db-"));
    const dbPath = path.join(dir, "gateway.sqlite");
    dbA = openDatabase(dbPath);
    dbB = openDatabase(dbPath);
  });

  afterEach(() => {
    dbA.close();
    dbB.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("allows exactly one engine side effect after two instances passed queue eligibility", async () => {
    const workspace = path.join(dir, "workspace");
    const effectPath = path.join(workspace, "engine-effects.txt");
    fs.mkdirSync(workspace);
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "perform exactly once",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
    new RunAttemptService(dbA, "seed").create(task.id);

    let engineRuns = 0;
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(options) {
        engineRuns += 1;
        fs.appendFileSync(effectPath, "effect\n");
        await options.onEvent({ type: "done", summary: "done" });
      },
    };
    const runnerA = new TaskRunner(tasksA, new AuditService(dbA), engine, {
      runAttempts: new RunAttemptService(dbA, "gateway-a"),
    });
    const runnerB = new TaskRunner(tasksB, new AuditService(dbB), engine, {
      runAttempts: new RunAttemptService(dbB, "gateway-b"),
    });
    const runA = runnerA as unknown as {
      runTask(taskId: string): Promise<void>;
    };
    const runB = runnerB as unknown as {
      runTask(taskId: string): Promise<void>;
    };

    await Promise.all([runA.runTask(task.id), runB.runTask(task.id)]);

    expect(engineRuns).toBe(1);
    expect(fs.readFileSync(effectPath, "utf8").trim().split("\n")).toEqual([
      "effect",
    ]);
    expect(tasksA.get(task.id)?.status).toBe("done");
  });

  it("keeps a silent engine lease alive so another instance cannot reclaim it", async () => {
    const workspace = path.join(dir, "silent-workspace");
    fs.mkdirSync(workspace);
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "silent long operation",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
    new RunAttemptService(dbA, "seed").create(task.id);
    let engineRuns = 0;
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(options) {
        engineRuns += 1;
        await new Promise((resolve) => setTimeout(resolve, 220));
        await options.onEvent({ type: "done", summary: "done" });
      },
    };
    const runnerA = new TaskRunner(tasksA, new AuditService(dbA), engine, {
      runAttempts: new RunAttemptService(dbA, "gateway-a"),
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 25,
    });
    const runnerB = new TaskRunner(tasksB, new AuditService(dbB), engine, {
      runAttempts: new RunAttemptService(dbB, "gateway-b"),
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 25,
    });
    const runA = runnerA as unknown as { runTask(id: string): Promise<void> };
    const runB = runnerB as unknown as { runTask(id: string): Promise<void> };

    const first = runA.runTask(task.id);
    await new Promise((resolve) => setTimeout(resolve, 130));
    await runB.runTask(task.id);
    await first;

    expect(engineRuns).toBe(1);
    expect(tasksA.get(task.id)?.status).toBe("done");
  });

  it("keeps the lease alive while provider preflight is still silent", async () => {
    const workspace = path.join(dir, "preflight-workspace");
    fs.mkdirSync(workspace);
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "slow provider preflight",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
    new RunAttemptService(dbA, "seed").create(task.id);
    let engineRuns = 0;
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run() {
        engineRuns += 1;
      },
    };
    const runnerA = new TaskRunner(tasksA, new AuditService(dbA), engine, {
      runAttempts: new RunAttemptService(dbA, "gateway-a"),
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 25,
      providerPreflight: async () => {
        await new Promise((resolve) => setTimeout(resolve, 220));
        return { action: "proceed" };
      },
    });
    const runnerB = new TaskRunner(tasksB, new AuditService(dbB), engine, {
      runAttempts: new RunAttemptService(dbB, "gateway-b"),
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 25,
    });
    const runA = runnerA as unknown as { runTask(id: string): Promise<void> };
    const runB = runnerB as unknown as { runTask(id: string): Promise<void> };

    const first = runA.runTask(task.id);
    await new Promise((resolve) => setTimeout(resolve, 130));
    await runB.runTask(task.id);
    await first;

    expect(engineRuns).toBe(1);
    expect(tasksA.get(task.id)?.status).toBe("done");
  });

  it("cancels without terminalizing when ownership is lost mid-run", async () => {
    const workspace = path.join(dir, "lost-lease-workspace");
    fs.mkdirSync(workspace);
    const tasks = new TaskService(dbA);
    const task = tasks.create({
      goal: "lose ownership",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
    const attemptsA = new RunAttemptService(dbA, "gateway-a");
    const attemptsB = new RunAttemptService(dbB, "gateway-b");
    const attempt = attemptsA.create(task.id);
    let releaseEngine: (() => void) | null = null;
    let enteredEngine: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      enteredEngine = resolve;
    });
    let cancels = 0;
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {
        cancels += 1;
        releaseEngine?.();
      },
      async run() {
        enteredEngine?.();
        await new Promise<void>((resolve) => {
          releaseEngine = resolve;
        });
      },
    };
    const runner = new TaskRunner(tasks, new AuditService(dbA), engine, {
      runAttempts: attemptsA,
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 25,
    });
    const privateRunner = runner as unknown as {
      runTask(id: string): Promise<void>;
    };

    const running = privateRunner.runTask(task.id);
    await entered;
    dbB
      .prepare("UPDATE task_run_attempts SET lease_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), attempt.id);
    expect(attemptsB.claimForTask(task.id, 60_000)).toMatchObject({
      leaseOwner: "gateway-b",
    });
    await running;

    expect(cancels).toBeGreaterThanOrEqual(1);
    expect(tasks.get(task.id)?.status).toBe("running");
    expect(attemptsB.get(attempt.id)).toMatchObject({
      status: "running",
      leaseOwner: "gateway-b",
    });
  });

  it("durably cancels a task from a non-owner process and stops the owner", async () => {
    const workspace = path.join(dir, "remote-cancel-workspace");
    fs.mkdirSync(workspace);
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "cancel from another gateway",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
    const attemptsA = new RunAttemptService(dbA, "gateway-a");
    const attemptsB = new RunAttemptService(dbB, "gateway-b");
    const attempt = attemptsA.create(task.id);
    let enteredEngine: (() => void) | null = null;
    let releaseEngine: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      enteredEngine = resolve;
    });
    let ownerCancels = 0;
    const ownerEngine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {
        ownerCancels += 1;
        releaseEngine?.();
      },
      async run() {
        enteredEngine?.();
        await new Promise<void>((resolve) => {
          releaseEngine = resolve;
        });
      },
    };
    const remoteEngine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run() {
        throw new Error("remote runner must not execute");
      },
    };
    const runnerA = new TaskRunner(tasksA, new AuditService(dbA), ownerEngine, {
      runAttempts: attemptsA,
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 20,
    });
    const runnerB = new TaskRunner(
      tasksB,
      new AuditService(dbB),
      remoteEngine,
      { runAttempts: attemptsB },
    );
    const privateRunnerA = runnerA as unknown as {
      runTask(id: string): Promise<void>;
    };

    const running = privateRunnerA.runTask(task.id);
    await entered;
    await runnerB.cancel(task.id);
    await running;

    expect(ownerCancels).toBeGreaterThanOrEqual(1);
    expect(tasksA.get(task.id)?.status).toBe("cancelled");
    expect(attemptsA.get(attempt.id)).toMatchObject({
      status: "cancelled",
      terminalReason: "cancelled_by_user",
      leaseOwner: null,
    });
  });

  it("rejects a stale approval after another process cancels the task", async () => {
    const workspace = path.join(dir, "cancel-approval-race");
    fs.mkdirSync(workspace);
    const output = path.join(workspace, "must-not-exist.txt");
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "never execute stale approval",
      workspaceRoots: [workspace],
      approvalMode: "strict",
    });
    const attemptsA = new RunAttemptService(dbA, "gateway-a");
    const attemptsB = new RunAttemptService(dbB, "gateway-b");
    const attempt = attemptsA.create(task.id);
    const ownerEngine: EngineAdapter = {
      executesOwnTools: false,
      async cancel() {},
      async run(options) {
        await options.onEvent({
          type: "tool_request",
          id: "stale-write",
          tool: "write_file",
          path: output,
          meta: { content: "should never be written" },
        });
      },
    };
    const remoteEngine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run() {},
    };
    const runnerA = new TaskRunner(
      tasksA,
      new AuditService(dbA),
      ownerEngine,
      {
        runAttempts: attemptsA,
        operationReceipts: new OperationReceiptService(dbA),
        runAttemptLeaseMs: 90,
        runAttemptHeartbeatMs: 20,
      },
    );
    const runnerB = new TaskRunner(
      tasksB,
      new AuditService(dbB),
      remoteEngine,
      { runAttempts: attemptsB },
    );

    const running = runnerA.start(task.id);
    let approvalId: string | undefined;
    for (let i = 0; i < 50; i += 1) {
      approvalId = runnerA.getPendingApprovals(task.id)[0]?.id;
      if (approvalId) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(approvalId).toBeTruthy();

    await runnerB.cancel(task.id);
    await runnerA.approve(approvalId!, "approve");
    await running;

    expect(fs.existsSync(output)).toBe(false);
    expect(tasksA.get(task.id)?.status).toBe("cancelled");
    expect(attemptsA.get(attempt.id)).toMatchObject({
      status: "cancelled",
      terminalReason: "cancelled_by_user",
      leaseOwner: null,
    });
    const executed = dbA
      .prepare(
        `SELECT COUNT(*) AS count FROM operation_receipts
         WHERE task_id = ? AND correlation_id = ? AND effect = 'executed'`,
      )
      .get(task.id, "stale-write") as { count: number };
    expect(executed.count).toBe(0);
    const resolved = tasksA
      .listEvents(task.id)
      .filter(
        (event) =>
          event.kind === "approval_resolved" &&
          event.payload.approvalId === approvalId,
      );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.payload).toMatchObject({
      decision: "reject",
      reason: "cancelled",
    });
  });

  it("settles the owner's pending approval after remote cancellation", async () => {
    const workspace = path.join(dir, "cancel-pending-owner");
    fs.mkdirSync(workspace);
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "settle pending approval",
      workspaceRoots: [workspace],
      approvalMode: "strict",
    });
    const attemptsA = new RunAttemptService(dbA, "gateway-a");
    const attemptsB = new RunAttemptService(dbB, "gateway-b");
    attemptsA.create(task.id);
    const ownerEngine: EngineAdapter = {
      executesOwnTools: false,
      async cancel() {},
      async run(options) {
        await options.onEvent({
          type: "tool_request",
          id: "pending-write",
          tool: "write_file",
          path: path.join(workspace, "never.txt"),
          meta: { content: "never" },
        });
      },
    };
    const runnerA = new TaskRunner(
      tasksA,
      new AuditService(dbA),
      ownerEngine,
      {
        runAttempts: attemptsA,
        runAttemptLeaseMs: 90,
        runAttemptHeartbeatMs: 20,
      },
    );
    const runnerB = new TaskRunner(
      tasksB,
      new AuditService(dbB),
      ownerEngine,
      { runAttempts: attemptsB },
    );

    const running = runnerA.start(task.id);
    let approvalId: string | undefined;
    for (let i = 0; i < 50; i += 1) {
      approvalId = runnerA.getPendingApprovals(task.id)[0]?.id;
      if (approvalId) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(approvalId).toBeTruthy();

    await runnerB.cancel(task.id);
    await running;

    expect(runnerA.getPendingApprovals(task.id)).toHaveLength(0);
    expect(tasksA.get(task.id)?.status).toBe("cancelled");
    const resolved = tasksA
      .listEvents(task.id)
      .filter(
        (event) =>
          event.kind === "approval_resolved" &&
          event.payload.approvalId === approvalId,
      );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.payload).toMatchObject({
      decision: "reject",
      reason: "cancelled",
    });
  });

  it("cannot park a foreign-owned task without local attempt identity", () => {
    const workspace = path.join(dir, "foreign-host-approval");
    fs.mkdirSync(workspace);
    const tasksA = new TaskService(dbA);
    const tasksB = new TaskService(dbB);
    const task = tasksA.create({
      goal: "foreign owner",
      workspaceRoots: [workspace],
      approvalMode: "strict",
    });
    const attemptsA = new RunAttemptService(dbA, "gateway-a");
    const attempt = attemptsA.create(task.id);
    expect(
      attemptsA.claimForTaskAtomically(task.id, 60_000, () =>
        Boolean(
          tasksA.transitionStatus(task.id, ["queued"], "running", {
            emitHooks: false,
          }),
        ),
      ),
    ).toMatchObject({ id: attempt.id, leaseOwner: "gateway-a" });
    const runnerB = new TaskRunner(
      tasksB,
      new AuditService(dbB),
      {
        executesOwnTools: true,
        async cancel() {},
        async run() {},
      },
      { runAttempts: new RunAttemptService(dbB, "gateway-b") },
    );

    runnerB.registerHostBrowserApproval({
      approvalId: "foreign-approval",
      taskId: task.id,
      tool: "browser_open",
      reason: "needs permission",
      url: "https://example.com",
    });

    expect(runnerB.getPendingApprovals(task.id)).toHaveLength(0);
    expect(tasksA.get(task.id)?.status).toBe("running");
    expect(attemptsA.get(attempt.id)).toMatchObject({
      status: "running",
      leaseOwner: "gateway-a",
    });
  });
});
