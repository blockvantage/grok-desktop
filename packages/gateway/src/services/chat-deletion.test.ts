import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeRoot } from "@grokdesk/shared";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { deleteChatThread } from "./chat-deletion.js";
import { NullHostBridge } from "../host-bridge.js";

describe("deleteChatThread", () => {
  let dir: string;
  let dataDir: string;
  let db: Db;
  let tasks: TaskService;
  let cancelled: string[];
  let removed: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-del-"));
    dataDir = path.join(dir, "data");
    fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    cancelled = [];
    removed = [];
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes managed workspace but not user project roots", async () => {
    const managed = fs.mkdtempSync(
      path.join(dataDir, "workspaces", "chat-"),
    );
    const userProj = path.join(dir, "user-project");
    fs.mkdirSync(userProj);
    fs.writeFileSync(path.join(userProj, "keep.txt"), "safe");

    const t = tasks.create({
      goal: "hi",
      workspaceRoots: [managed, userProj],
      mode: "interactive",
      model: "m",
      effort: "fast",
    });
    // Primary root is managed; secondary is user project.
    // create() stores roots via normalizeRoot (forward slashes on Windows).
    expect(t.policySnapshot.workspaceRoots[0]).toBe(
      normalizeRoot(path.resolve(managed)),
    );

    const result = await deleteChatThread(t.id, {
      tasks,
      runner: {
        cancel: async (id) => {
          cancelled.push(id);
        },
      },
      hostBridge: new NullHostBridge(),
      dataDir,
      rmSync: (p) => {
        removed.push(String(p));
        fs.rmSync(p, { recursive: true, force: true });
      },
    });

    expect(result.deletedIds).toContain(t.id);
    expect(tasks.get(t.id)).toBeNull();
    expect(removed).toEqual([path.resolve(managed)]);
    expect(fs.existsSync(path.join(userProj, "keep.txt"))).toBe(true);
  });

  it("cancels running members before delete", async () => {
    const managed = fs.mkdtempSync(
      path.join(dataDir, "workspaces", "chat-"),
    );
    const t = tasks.create({
      goal: "run",
      workspaceRoots: [managed],
    });
    tasks.setStatus(t.id, "running");
    await deleteChatThread(t.id, {
      tasks,
      runner: {
        cancel: async (id) => {
          cancelled.push(id);
        },
      },
      hostBridge: new NullHostBridge(),
      dataDir,
      rmSync: () => {},
    });
    expect(cancelled).toEqual([t.id]);
  });
});
