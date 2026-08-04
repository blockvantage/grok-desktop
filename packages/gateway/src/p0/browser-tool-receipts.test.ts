/**
 * AUDIT-01: browser tool path writes operation receipts (not only audit log).
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
import type { EngineAdapter, EngineRunOptions } from "../engine-types.js";
import { NullHostBridge } from "../host-bridge.js";

class FakeBrowserHost extends NullHostBridge {
  constructor(
    private result: { ok: boolean; output: string; url?: string },
  ) {
    super();
  }
  override async browserExec() {
    return {
      ok: this.result.ok,
      output: this.result.output,
      url: this.result.url,
    };
  }
}

describe("browser tool operation receipts", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-btr-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("host browser_open success records effect executed", async () => {
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async run(opts: EngineRunOptions) {
        await opts.onEvent({
          type: "tool_request",
          id: "b1",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
      async cancel() {},
    };
    const host = new FakeBrowserHost({
      ok: true,
      output: "opened",
      url: "https://example.com",
    });

    const db = openDatabase(path.join(dir, "t.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
      hostBridge: host,
    });
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "open page",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);

    const ops = receipts.listForTask(t.id);
    expect(
      ops.some(
        (o) =>
          o.action === "tool:browser_open" &&
          o.decision === "allow" &&
          o.effect === "executed" &&
          o.detail?.executedBy === "host" &&
          o.detail?.browserProvider === "desk-browser",
      ),
    ).toBe(true);
    db.close();
  });

  it("host browser failure records deny/host_failed receipt", async () => {
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async run(opts: EngineRunOptions) {
        await opts.onEvent({
          type: "tool_request",
          id: "b2",
          tool: "browser_open",
          meta: { url: "https://blocked.example" },
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
      async cancel() {},
    };
    const host = new FakeBrowserHost({
      ok: false,
      output: "navigation denied",
      url: "https://blocked.example",
    });

    const db = openDatabase(path.join(dir, "t2.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
      hostBridge: host,
    });
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "blocked",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    const ops = receipts.listForTask(t.id);
    expect(
      ops.some(
        (o) =>
          o.action === "tool:browser_open" &&
          o.decision === "deny" &&
          o.effect === "host_failed",
      ),
    ).toBe(true);
    db.close();
  });

  it("records provider success only after the correlated engine tool_result", async () => {
    const db = openDatabase(path.join(dir, "provider-success.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    let taskId = "";
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts) {
        await opts.onEvent({
          type: "tool_request",
          id: "mcp-open",
          tool: "browser_open",
          meta: { url: "https://example.com" },
        });
        expect(receipts.listForTask(taskId)).toHaveLength(0);
        await opts.onEvent({
          type: "tool_result",
          id: "mcp-open",
          ok: true,
          output: "loaded",
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
    };
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
      hostBridge: new NullHostBridge(),
    });
    const ws = path.join(dir, "provider-success-ws");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "open page",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    taskId = task.id;

    await runner.start(task.id);

    expect(receipts.listForTask(task.id)).toEqual([
      expect.objectContaining({
        action: "tool:browser_open",
        decision: "allow",
        effect: "provider_executed",
        correlationId: "mcp-open",
        detail: expect.objectContaining({
          executedBy: "engine_mcp",
          browserProvider: "desk-browser",
          ok: true,
        }),
      }),
    ]);
    db.close();
  });

  it("records a correlated provider failure without a success/provider receipt", async () => {
    const db = openDatabase(path.join(dir, "provider-failure.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts) {
        await opts.onEvent({
          type: "tool_request",
          id: "mcp-failed",
          tool: "browser_open",
          meta: { url: "https://blocked.example" },
        });
        await opts.onEvent({
          type: "tool_result",
          id: "mcp-failed",
          ok: false,
          output: "MCP unavailable",
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
    };
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
      hostBridge: new NullHostBridge(),
    });
    const ws = path.join(dir, "provider-failure-ws");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "open blocked page",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    const ops = receipts.listForTask(task.id);
    expect(ops).toEqual([
      expect.objectContaining({
        action: "tool:browser_open",
        decision: "deny",
        effect: "provider_failed",
        correlationId: "mcp-failed",
      }),
    ]);
    expect(ops[0]?.detail.browserProvider).toBeUndefined();
    expect(
      ops.some(
        (op) =>
          op.decision === "allow" || op.effect === "provider_executed",
      ),
    ).toBe(false);
    db.close();
  });

  it("does not fabricate a receipt for an unresolved provider request", async () => {
    const db = openDatabase(path.join(dir, "provider-unresolved.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const engine: EngineAdapter = {
      executesOwnTools: true,
      async cancel() {},
      async run(opts) {
        await opts.onEvent({
          type: "tool_request",
          id: "mcp-unresolved",
          tool: "browser_open",
          meta: { url: "https://missing.example" },
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
    };
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
      hostBridge: new NullHostBridge(),
    });
    const ws = path.join(dir, "provider-unresolved-ws");
    fs.mkdirSync(ws);
    const task = tasks.create({
      goal: "try page",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });

    await runner.start(task.id);

    expect(receipts.listForTask(task.id)).toHaveLength(0);
    db.close();
  });
});
