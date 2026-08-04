import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "../services/tasks.js";

describe("SEC-01 TaskService policy defaults", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-pol-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not hard-code allowShell/allowNetwork true for strict", () => {
    const t = tasks.create({
      goal: "strict task",
      workspaceRoots: [dir],
      approvalMode: "strict",
    });
    expect(t.policySnapshot.allowShell).toBe(false);
    expect(t.policySnapshot.allowNetworkTools).toBe(false);
  });

  it("honors explicit allowShell false even in balanced", () => {
    const t = tasks.create({
      goal: "no shell",
      workspaceRoots: [dir],
      approvalMode: "balanced",
      allowShell: false,
      allowNetworkTools: false,
    });
    expect(t.policySnapshot.allowShell).toBe(false);
    expect(t.policySnapshot.allowNetworkTools).toBe(false);
  });

  it("balanced defaults still allow shell/network for UX continuity", () => {
    const t = tasks.create({
      goal: "balanced",
      workspaceRoots: [dir],
      approvalMode: "balanced",
    });
    expect(t.policySnapshot.allowShell).toBe(true);
    expect(t.policySnapshot.allowNetworkTools).toBe(true);
  });
});
