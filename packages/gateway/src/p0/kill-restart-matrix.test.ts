/**
 * TASK-01 kill/restart matrix: durable attempt + task status at boundaries.
 * Crash is simulated by writing SQLite mid-flight (no graceful cancel), then
 * opening a new Gateway instance — mirrors unclean exit.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import type { EngineAdapter, NormalizedEngineEvent } from "@grokdesk/engine-grok";
import { openDatabase } from "../db.js";
import { RunAttemptService } from "../services/run-attempts.js";
import { TaskService } from "../services/tasks.js";

function seedTask(
  dbPath: string,
  opts: {
    id: string;
    status: string;
    goal?: string;
    workspace: string;
  },
): void {
  const db = openDatabase(dbPath);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (id, goal, mode, status, model, effort, policy_json, skills_json, mcp_json, created_at, updated_at)
     VALUES (?, ?, 'interactive', ?, 'grok-4.5', 'normal', ?, '[]', '[]', ?, ?)`,
  ).run(
    opts.id,
    opts.goal ?? `goal ${opts.id}`,
    opts.status,
    JSON.stringify({
      approvalMode: "balanced",
      workspaceRoots: [opts.workspace],
      allowNetworkTools: true,
      allowShell: true,
    }),
    now,
    now,
  );
  db.close();
}

describe("Phase 2 kill/restart matrix", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-kill-"));
    dbPath = path.join(dir, "db.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("queued task survives crash restart and is still pumpable", async () => {
    seedTask(dbPath, { id: "t-q", status: "queued", workspace: dir });
    const db = openDatabase(dbPath);
    const runs = new RunAttemptService(db, "prior");
    runs.create("t-q");
    db.close();

    const gw = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "k1" },
    );
    await gw.start();
    // Recovery must not mark queued as failed/cancelled. Startup may pump it.
    const st = gw.tasks.get("t-q")?.status;
    expect(["queued", "running", "done"]).toContain(st);
    expect(st).not.toBe("failed");
    expect(st).not.toBe("cancelled");
    await gw.runner.pumpQueue();
    await new Promise((r) => setTimeout(r, 80));
    const after = gw.tasks.get("t-q");
    expect(["done", "running", "queued"]).toContain(after?.status);
    const attempt = gw.runAttempts.latestForTask("t-q");
    if (after?.status === "done") {
      expect(attempt?.status).toBe("done");
    }
    await gw.stop();
  });

  it("running task becomes failed/interrupted after unclean restart", async () => {
    seedTask(dbPath, { id: "t-r", status: "running", workspace: dir });
    const db = openDatabase(dbPath);
    const runs = new RunAttemptService(db, "dead-instance");
    const a = runs.create("t-r");
    db.prepare(
      `UPDATE task_run_attempts SET status = 'running', lease_owner = 'dead',
       lease_expires_at = ? WHERE id = ?`,
    ).run(new Date(Date.now() - 120_000).toISOString(), a.id);
    db.close();

    const gw = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "k2" },
    );
    await gw.start();
    expect(gw.tasks.get("t-r")?.status).toBe("failed");
    const attempt = gw.runAttempts.latestForTask("t-r");
    expect(attempt).toBeTruthy();
    expect(["interrupted", "failed", "cancelled"]).toContain(attempt!.status);
    await gw.stop();
  });

  it("waiting_approval is interrupted on restart", async () => {
    seedTask(dbPath, { id: "t-w", status: "waiting_approval", workspace: dir });
    const db = openDatabase(dbPath);
    const runs = new RunAttemptService(db, "dead");
    const a = runs.create("t-w");
    db.prepare(
      `UPDATE task_run_attempts SET status = 'waiting_approval', lease_owner = 'x',
       lease_expires_at = ? WHERE id = ?`,
    ).run(new Date(Date.now() - 1).toISOString(), a.id);
    db.close();

    const gw = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new TestEngine(), machineId: "k3" },
    );
    await gw.start();
    expect(gw.tasks.get("t-w")?.status).toBe("failed");
    await gw.stop();
  });

  it("operation receipts recorded for mediated deny", async () => {
    class DenyShellEngine implements EngineAdapter {
      readonly executesOwnTools = false;
      async run(opts: {
        onEvent: (e: NormalizedEngineEvent) => Promise<"continue" | "abort">;
      }): Promise<void> {
        await opts.onEvent({
          type: "tool_request",
          id: "s1",
          tool: "shell",
          command: "rm -rf /",
        });
        await opts.onEvent({ type: "done", summary: "ok" });
      }
      async cancel(): Promise<void> {}
    }
    const gw = new Gateway(
      { dataDir: dir, dbPath, logsDir: path.join(dir, "logs") },
      { engine: new DenyShellEngine(), machineId: "k4" },
    );
    await gw.start();
    const created = (await gw.handle({
      id: "c4",
      method: "tasks.create",
      params: {
        goal: "deny shell",
        workspaceRoots: [dir],
        approvalMode: "strict",
        allowShell: false,
      },
    })) as { id: string };
    await gw.runner.pumpQueue();
    await new Promise((r) => setTimeout(r, 80));
    const receipts = gw.operationReceipts.listForTask(created.id);
    expect(receipts.some((r) => r.decision === "deny")).toBe(true);
    await gw.stop();
  });

  it("transactional event seq is monotonic under burst appends", () => {
    const db = openDatabase(dbPath);
    const tasks = new TaskService(db);
    const t = tasks.create({ goal: "seq", workspaceRoots: [dir] });
    for (let i = 0; i < 20; i++) {
      tasks.appendEvent(t.id, "step", { title: `s${i}`, status: "start" });
    }
    const events = tasks.listEvents(t.id);
    const seqs = events.filter((e) => e.kind === "step").map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
    db.close();
  });
});
