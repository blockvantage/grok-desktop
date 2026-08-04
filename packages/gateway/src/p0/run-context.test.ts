import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db.js";
import { TaskService } from "../services/tasks.js";
import { AuditService } from "../services/audit.js";
import { TaskRunner } from "../services/runner.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { createRunContext } from "../services/run-context.js";
import { RunAttemptService } from "../services/run-attempts.js";
import { OperationReceiptService } from "../services/operation-receipts.js";

describe("RunContext (no monkey-patch)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-rctx-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes systemPreamble from setRunContext into engine without patching engine", async () => {
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const tasks = new TaskService(db);
    const audit = new AuditService(db);
    const runs = new RunAttemptService(db);
    const receipts = new OperationReceiptService(db);

    let seenPreamble = "";
    const engine = {
      executesOwnTools: false as const,
      async run(opts: {
        systemPreamble: string;
        onEvent: (e: {
          type: "done";
          summary: string;
        }) => Promise<"continue" | "abort">;
      }) {
        seenPreamble = opts.systemPreamble;
        await opts.onEvent({ type: "done", summary: "ok" });
      },
      async cancel() {},
    };

    const runner = new TaskRunner(tasks, audit, engine, {
      runAttempts: runs,
      operationReceipts: receipts,
    });

    const task = tasks.create({
      goal: "with context",
      workspaceRoots: [dir],
    });
    runs.create(task.id);
    runner.setRunContext(
      createRunContext({
        taskId: task.id,
        systemPreamble: "MEMORY: stand firm",
        provenance: ["memory:1"],
      }),
    );
    await runner.start(task.id);
    expect(seenPreamble).toContain("MEMORY: stand firm");
    expect(tasks.get(task.id)?.status).toBe("done");
    const attempt = runs.latestForTask(task.id);
    expect(attempt?.status).toBe("done");
    db.close();
  });

  it("TestEngine still works with RunAttempt lease completion", async () => {
    const db = openDatabase(path.join(dir, "t2.sqlite"));
    const tasks = new TaskService(db);
    const audit = new AuditService(db);
    const runs = new RunAttemptService(db);
    const runner = new TaskRunner(tasks, audit, new TestEngine(), {
      runAttempts: runs,
    });
    const task = tasks.create({
      goal: "fake",
      workspaceRoots: [dir],
    });
    runs.create(task.id);
    await runner.start(task.id);
    expect(runs.latestForTask(task.id)?.status).toBe("done");
    db.close();
  });
});
