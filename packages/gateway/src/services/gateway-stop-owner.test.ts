import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineAdapter } from "@grokdesk/engine-grok";
import { openDatabase } from "../db.js";
import { Gateway } from "../index.js";
import type { DataPaths } from "../config.js";
import { AuditService } from "./audit.js";
import { RunAttemptService } from "./run-attempts.js";
import { TaskRunner } from "./runner.js";
import { TaskService } from "./tasks.js";

describe("Gateway owner-safe shutdown", () => {
  let dir: string;
  let paths: DataPaths;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-owner-stop-"));
    paths = {
      dataDir: dir,
      logsDir: path.join(dir, "logs"),
      dbPath: path.join(dir, "gateway.sqlite"),
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not cancel a silent task owned by another gateway", async () => {
    const dbA = openDatabase(paths.dbPath);
    const tasksA = new TaskService(dbA);
    const attemptsA = new RunAttemptService(dbA, "gateway-a");
    const workspace = path.join(dir, "owned-workspace");
    fs.mkdirSync(workspace);
    const task = tasksA.create({
      goal: "stay owned by gateway A",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
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
    const runnerA = new TaskRunner(
      tasksA,
      new AuditService(dbA),
      ownerEngine,
      {
        runAttempts: attemptsA,
        runAttemptLeaseMs: 2_000,
        runAttemptHeartbeatMs: 100,
      },
    );
    const running = runnerA.start(task.id);
    await entered;

    const gatewayB = new Gateway(paths, {
      engine: {
        executesOwnTools: true,
        async cancel() {},
        async run() {},
      },
      machineId: "gateway-b-machine",
    });
    await gatewayB.start();
    await gatewayB.stop();

    expect(ownerCancels).toBe(0);
    expect(tasksA.get(task.id)?.status).toBe("running");
    expect(attemptsA.get(attempt.id)).toMatchObject({
      status: "running",
      leaseOwner: "gateway-a",
    });

    releaseEngine?.();
    await running;
    dbA.close();
  });

  it("stops and terminalizes only the runner's own active engine", async () => {
    const db = openDatabase(paths.dbPath);
    const tasks = new TaskService(db);
    const attempts = new RunAttemptService(db, "local-gateway");
    const workspace = path.join(dir, "local-workspace");
    fs.mkdirSync(workspace);
    const task = tasks.create({
      goal: "stop local work",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
    });
    const attempt = attempts.create(task.id);
    let enteredEngine: (() => void) | null = null;
    let releaseEngine: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      enteredEngine = resolve;
    });
    let cancels = 0;
    const runner = new TaskRunner(
      tasks,
      new AuditService(db),
      {
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
      },
      { runAttempts: attempts },
    );
    const running = runner.start(task.id);
    await entered;

    await runner.stopLocalRuns();
    await running;

    expect(cancels).toBeGreaterThanOrEqual(1);
    expect(runner.runningCount).toBe(0);
    expect(tasks.get(task.id)?.status).toBe("cancelled");
    expect(attempts.get(attempt.id)).toMatchObject({
      status: "cancelled",
      terminalReason: "gateway_stopped",
      leaseOwner: null,
    });
    db.close();
  });

  it("preserves queued work on stop and leaves it pumpable after restart", async () => {
    const seedDb = openDatabase(paths.dbPath);
    const seedTasks = new TaskService(seedDb);
    const workspace = path.join(dir, "queued-workspace");
    fs.mkdirSync(workspace);
    const missingSource = path.join(dir, "not-yet-available.png");
    const missingStaged = path.join(workspace, "attachments", "queued.png");
    const task = seedTasks.create({
      goal: "survive shutdown",
      workspaceRoots: [workspace],
      approvalMode: "autopilot",
      attachments: [
        {
          id: "queued-image",
          kind: "image",
          name: "queued.png",
          sourcePath: missingSource,
          stagedPath: missingStaged,
          sizeBytes: 10,
        },
      ],
    });
    const attempt = new RunAttemptService(seedDb, "seed").create(task.id);
    seedDb.close();

    const gateway = new Gateway(paths, {
      engine: {
        executesOwnTools: true,
        async cancel() {},
        async run() {},
      },
      machineId: "idle-gateway",
    });
    await gateway.start();
    await gateway.stop();

    const restartDb = openDatabase(paths.dbPath);
    const restartTasks = new TaskService(restartDb);
    const restartAttempts = new RunAttemptService(restartDb, "restart");
    expect(restartTasks.get(task.id)?.status).toBe("queued");
    expect(restartAttempts.get(attempt.id)).toMatchObject({
      status: "queued",
      leaseOwner: null,
    });
    let engineRuns = 0;
    const restartRunner = new TaskRunner(
      restartTasks,
      new AuditService(restartDb),
      {
        executesOwnTools: true,
        async cancel() {},
        async run() {
          engineRuns += 1;
        },
      },
      { runAttempts: restartAttempts },
    );

    await restartRunner.start(task.id);

    expect(engineRuns).toBe(1);
    expect(restartTasks.get(task.id)?.status).toBe("done");
    restartDb.close();
  });
});
