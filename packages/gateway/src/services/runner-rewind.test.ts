import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { TaskRunner } from "./runner.js";
import type { EngineAdapter } from "@grokdesk/engine-grok";

describe("TaskRunner.rewindTo supersedes turns", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let audit: AuditService;
  let runner: TaskRunner;
  let lastRewind: { taskId: string; pointId: string } | null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-rewind-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    audit = new AuditService(db);
    lastRewind = null;
    const eng: EngineAdapter = {
      executesOwnTools: true,
      async run() {},
      async cancel() {},
      async rewindTo(taskId, pointId) {
        lastRewind = { taskId, pointId };
        return true;
      },
      async rewindPoints() {
        return [
          { id: "0", label: "a" },
          { id: "1", label: "b" },
        ];
      },
    };
    runner = new TaskRunner(tasks, audit, eng);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("calls provider then marks target turn and later turns rewound", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const root = tasks.create({
      goal: "root",
      workspaceRoots: [ws],
      approvalMode: "balanced",
    });
    // Stagger created_at so thread order is deterministic.
    const t1 = tasks.create({
      goal: "turn 1",
      workspaceRoots: [ws],
      approvalMode: "balanced",
      parentTaskId: root.id,
    });
    await new Promise((r) => setTimeout(r, 5));
    const t2 = tasks.create({
      goal: "turn 2",
      workspaceRoots: [ws],
      approvalMode: "balanced",
      parentTaskId: root.id,
    });
    await new Promise((r) => setTimeout(r, 5));
    const t3 = tasks.create({
      goal: "turn 3",
      workspaceRoots: [ws],
      approvalMode: "balanced",
      parentTaskId: root.id,
    });

    // Force statuses so markRewound is visible.
    for (const t of [root, t1, t2, t3]) {
      tasks.setStatus(t.id, "done");
    }

    const ok = await runner.rewindTo(t2.id, "1", t2.id);
    expect(ok).toBe(true);
    expect(lastRewind).toEqual({ taskId: t2.id, pointId: "1" });

    expect(tasks.get(t1.id)?.status).toBe("done");
    expect(tasks.get(t2.id)?.status).toBe("cancelled");
    expect(tasks.get(t3.id)?.status).toBe("cancelled");

    const t2Events = tasks.listEvents(t2.id);
    const rewound = t2Events.find(
      (e) =>
        e.kind === "status_change" &&
        (e.payload as { reason?: string }).reason === "rewound",
    );
    expect(rewound).toBeTruthy();
    expect(rewound?.payload).toMatchObject({
      reason: "rewound",
      pointId: "1",
      message: "Rewound to before this message",
    });

    const t3Events = tasks.listEvents(t3.id);
    expect(
      t3Events.some(
        (e) =>
          e.kind === "status_change" &&
          (e.payload as { reason?: string }).reason === "rewound",
      ),
    ).toBe(true);
  });
});
