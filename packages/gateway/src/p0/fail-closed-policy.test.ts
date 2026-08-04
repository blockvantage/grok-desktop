import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db.js";
import { TaskService } from "../services/tasks.js";
import { AuditService } from "../services/audit.js";
import { TaskRunner } from "../services/runner.js";
import { OperationReceiptService } from "../services/operation-receipts.js";
import { RunAttemptService } from "../services/run-attempts.js";
import { createRunContext } from "../services/run-context.js";
import type { EngineAdapter } from "../engine-types.js";

describe("fail-closed when provider cannot enforce deny (SEC-01)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-fc-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects run when executesOwnTools and allowShell is false", async () => {
    let ran = false;
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async run() {
        ran = true;
      },
      async cancel() {},
    };
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const tasks = new TaskService(db);
    const audit = new AuditService(db);
    const runs = new RunAttemptService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, audit, engine, {
      runAttempts: runs,
      operationReceipts: receipts,
    });
    const task = tasks.create({
      goal: "no shell",
      workspaceRoots: [dir],
      approvalMode: "balanced",
      allowShell: false,
      allowNetworkTools: true,
    });
    runs.create(task.id);
    await runner.start(task.id);
    expect(ran).toBe(false);
    expect(tasks.get(task.id)?.status).toBe("failed");
    const ops = receipts.listForTask(task.id);
    expect(ops.some((o) => o.decision === "deny" && o.effect === "rejected")).toBe(
      true,
    );
    db.close();
  });

  it("policy deny receipt carries requestId from RunContext correlation", async () => {
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async run() {
        throw new Error("should not run");
      },
      async cancel() {},
    };
    const db = openDatabase(path.join(dir, "t2.sqlite"));
    const tasks = new TaskService(db);
    const audit = new AuditService(db);
    const runs = new RunAttemptService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, audit, engine, {
      runAttempts: runs,
      operationReceipts: receipts,
    });
    const task = tasks.create({
      goal: "deny shell correlated",
      workspaceRoots: [dir],
      allowShell: false,
      allowNetworkTools: false,
    });
    const attempt = runs.create(task.id);
    runner.setRunContext(
      createRunContext({
        taskId: task.id,
        systemPreamble: "",
        requestId: "req-corr-fc-1",
        runAttemptId: attempt.id,
      }),
    );
    await runner.start(task.id);
    const deny = receipts
      .listForTask(task.id)
      .find((o) => o.action === "policy.provider_gate" && o.decision === "deny");
    expect(deny?.correlationId).toBe("req-corr-fc-1");
    db.close();
  });
});
