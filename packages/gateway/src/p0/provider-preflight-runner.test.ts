/**
 * Registry-backed preflight is on the real TaskRunner path (not dead composition).
 */
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
import { createDefaultProviderRegistry } from "../provider-composition.js";
import { createProviderPreflight } from "../services/provider-preflight.js";
import type { EngineAdapter } from "../engine-types.js";

describe("TaskRunner + provider preflight (shipped path)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-pp-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("registry preflight rejects denied shell before engine.run", async () => {
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
    const reg = createDefaultProviderRegistry();
    const runner = new TaskRunner(tasks, audit, engine, {
      runAttempts: runs,
      operationReceipts: receipts,
      providerPreflight: createProviderPreflight(reg),
    });
    const task = tasks.create({
      goal: "no shell via registry",
      workspaceRoots: [dir],
      allowShell: false,
      allowNetworkTools: true,
    });
    runs.create(task.id);
    await runner.start(task.id);
    expect(ran).toBe(false);
    expect(tasks.get(task.id)?.status).toBe("failed");
    const ops = receipts.listForTask(task.id);
    expect(
      ops.some(
        (o) =>
          o.action === "policy.provider_gate" &&
          o.decision === "deny" &&
          o.detail?.source === "provider_registry",
      ),
    ).toBe(true);
    db.close();
  });

  it("registry preflight allows balanced shell run to reach engine", async () => {
    let ran = false;
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async run(opts) {
        ran = true;
        await opts.onEvent({ type: "done", summary: "ok" });
      },
      async cancel() {},
    };
    const db = openDatabase(path.join(dir, "t2.sqlite"));
    const tasks = new TaskService(db);
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      providerPreflight: createProviderPreflight(createDefaultProviderRegistry()),
    });
    const task = tasks.create({
      goal: "ok",
      workspaceRoots: [dir],
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "balanced",
    });
    await runner.start(task.id);
    expect(ran).toBe(true);
    expect(tasks.get(task.id)?.status).toBe("done");
    db.close();
  });
});
