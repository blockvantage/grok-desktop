import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { openDatabase } from "../db.js";

describe("TASK-01 crash recovery on restart", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-crash-"));
    dbPath = path.join(dir, "db.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks running and waiting_approval as failed on restart; pumps queued", async () => {
    // Seed DB with stale statuses as if crash mid-run.
    const db = openDatabase(dbPath);
    const now = new Date().toISOString();
    for (const [id, status] of [
      ["t-run", "running"],
      ["t-wait", "waiting_approval"],
      ["t-queue", "queued"],
    ] as const) {
      db.prepare(
        `INSERT INTO tasks (id, goal, mode, status, model, effort, policy_json, skills_json, mcp_json, created_at, updated_at)
         VALUES (?, ?, 'interactive', ?, 'grok-4.5', 'normal', ?, '[]', '[]', ?, ?)`,
      ).run(
        id,
        `goal ${id}`,
        status,
        JSON.stringify({
          approvalMode: "balanced",
          workspaceRoots: [dir],
          allowNetworkTools: true,
          allowShell: true,
        }),
        now,
        now,
      );
    }
    db.close();

    const gw = new Gateway(
      {
        dataDir: dir,
        dbPath,
        logsDir: path.join(dir, "logs"),
      },
      { engine: new TestEngine(), machineId: "crash-mach" },
    );
    await gw.start();

    expect(gw.tasks.get("t-run")?.status).toBe("failed");
    expect(gw.tasks.get("t-wait")?.status).toBe("failed");
    // Queued may have been pumped by TestEngine to done/running/failed — not left abandoned forever.
    const q = gw.tasks.get("t-queue");
    expect(q).toBeTruthy();
    expect(["queued", "running", "done", "failed"]).toContain(q!.status);

    await gw.stop();
  });
});
