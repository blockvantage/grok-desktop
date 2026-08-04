/**
 * AUDIT-01: gateway-mediated tool decisions yield redacted operation receipts.
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

describe("tool operation receipts (AUDIT-01)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-tor-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deny shell produces operation receipt with redacted command secrets", async () => {
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async run(opts: EngineRunOptions) {
        await opts.onEvent({
          type: "tool_request",
          id: "shell-1",
          tool: "shell",
          command: "echo password=supersecret token=abc",
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
      async cancel() {},
    };

    const db = openDatabase(path.join(dir, "t.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
    });
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "no shell",
      workspaceRoots: [ws],
      allowShell: false,
      allowNetworkTools: true,
      approvalMode: "balanced",
    });
    await runner.start(t.id);

    const ops = receipts.listForTask(t.id);
    const shell = ops.find((o) => o.action === "tool:shell");
    expect(shell?.decision).toBe("deny");
    const cmd = String(shell?.detail?.command ?? "");
    expect(cmd).toContain("password=[REDACTED]");
    expect(cmd).toContain("token=[REDACTED]");
    expect(cmd).not.toMatch(/supersecret|\btoken=abc\b/);
    // Policy deny path must not create host files.
    expect(fs.existsSync(path.join(ws, "grokdesk-output.md"))).toBe(false);
    db.close();
  });

  it("user reject after approval writes deny receipt with effect user_rejected", async () => {
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async run(opts: EngineRunOptions) {
        await opts.onEvent({
          type: "tool_request",
          id: "w1",
          tool: "write_file",
          path: path.join(dir, "ws", "out.md"),
          meta: { content: "x" },
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
      async cancel() {},
    };
    const db = openDatabase(path.join(dir, "t2.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
    });
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "needs approval",
      workspaceRoots: [ws],
      approvalMode: "strict",
    });
    const start = runner.start(t.id);
    let approvalId: string | undefined;
    for (let i = 0; i < 80; i++) {
      const pending = runner.getPendingApprovals(t.id);
      if (pending.length) {
        approvalId = pending[0]!.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(approvalId).toBeTruthy();
    await runner.approve(approvalId!, "reject");
    await start;

    const ops = receipts.listForTask(t.id);
    expect(
      ops.some(
        (o) =>
          o.action === "tool:write_file" &&
          o.decision === "deny" &&
          o.effect === "user_rejected",
      ),
    ).toBe(true);
    db.close();
  });

  it("host write_file execution records effect executed", async () => {
    const engine: EngineAdapter = {
      executesOwnTools: false,
      async run(opts: EngineRunOptions) {
        const p = path.join(dir, "ws", "note.md");
        await opts.onEvent({
          type: "tool_request",
          id: "w2",
          tool: "write_file",
          path: p,
          meta: { content: "hello" },
        });
        await opts.onEvent({ type: "done", summary: "done" });
      },
      async cancel() {},
    };
    const db = openDatabase(path.join(dir, "t3.sqlite"));
    const tasks = new TaskService(db);
    const receipts = new OperationReceiptService(db);
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: new RunAttemptService(db),
      operationReceipts: receipts,
    });
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "write",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(fs.existsSync(path.join(ws, "note.md"))).toBe(true);
    const ops = receipts.listForTask(t.id);
    expect(
      ops.some(
        (o) =>
          o.action === "tool:write_file" &&
          o.decision === "allow" &&
          o.effect === "executed",
      ),
    ).toBe(true);
    db.close();
  });
});
