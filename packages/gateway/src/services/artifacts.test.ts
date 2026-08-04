import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TestEngine } from "@grokdesk/engine-testkit";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { ArtifactService } from "./artifacts.js";
import { TaskRunner } from "./runner.js";

describe("ArtifactService", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let artifacts: ArtifactService;
  let runner: TaskRunner;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-art-"));
    ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    artifacts = new ArtifactService(db);
    // Mirror gateway wireArtifactPersistence
    const original = tasks.appendEvent.bind(tasks);
    tasks.appendEvent = (taskId, kind, payload) => {
      const ev = original(taskId, kind, payload);
      if (kind === "artifact_created") {
        artifacts.create({
          taskId,
          title: String(payload.title ?? "Artifact"),
          kind: (payload.kind as "file" | "report" | "media" | "card") ?? "file",
          path: (payload.path as string | null) ?? null,
        });
      }
      return ev;
    };
    runner = new TaskRunner(tasks, new AuditService(db), new TestEngine());
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists artifacts persisted after a TestEngine run", async () => {
    const t = tasks.create({
      goal: "Write report",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("done");

    const list = artifacts.list(t.id);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]!.taskId).toBe(t.id);
    expect(list[0]!.path).toContain("grokdesk-output.md");
    expect(fs.existsSync(list[0]!.path!)).toBe(true);
  });
});
