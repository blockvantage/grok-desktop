import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db.js";
import { TaskService } from "./tasks.js";
import { RunAttemptService } from "./run-attempts.js";

describe("RunAttemptService provider session id", () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;
  let taskId: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attempt-"));
    db = openDatabase(path.join(dir, "t.db"));
    const tasks = new TaskService(db);
    const t = tasks.create({
      goal: "g",
      mode: "interactive",
      model: "m",
      effort: "normal",
      workspaceRoots: [dir],
      approvalMode: "balanced",
      skills: [],
      mcpServerIds: [],
    });
    taskId = t.id;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stores and retrieves provider session id for resume", () => {
    const svc = new RunAttemptService(db);
    const a1 = svc.create(taskId);
    svc.setProviderSessionId(a1.id, "sess-abc");
    expect(svc.get(a1.id)?.providerSessionId).toBe("sess-abc");
    expect(svc.latestProviderSessionId(taskId)).toBe("sess-abc");
    const a2 = svc.create(taskId);
    expect(svc.latestProviderSessionId(taskId)).toBe("sess-abc");
    svc.setProviderSessionId(a2.id, "sess-new");
    expect(svc.latestProviderSessionId(taskId)).toBe("sess-new");
  });
});
