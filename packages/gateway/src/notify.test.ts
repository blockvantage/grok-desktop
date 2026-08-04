import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "./index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import type { GatewayNotifyMessage } from "@grokdesk/shared";

describe("Gateway server-push notify", () => {
  let dir: string;
  let gateway: Gateway;
  let notes: GatewayNotifyMessage[];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-notify-"));
    notes = [];
    gateway = new Gateway(
      {
        dataDir: dir,
        logsDir: path.join(dir, "logs"),
        dbPath: path.join(dir, "db.sqlite"),
      },
      { engine: new TestEngine() },
    );
    gateway.setNotifySink((msg) => {
      notes.push(msg);
    });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("emits notify.tasksChanged when a task is created", async () => {
    gateway.tasks.create({
      goal: "Notify me",
      workspaceRoots: [path.join(dir, "ws")],
      approvalMode: "autopilot",
    });
    await vi.waitFor(() => {
      expect(
        notes.some((n) => n.method === "notify.tasksChanged"),
      ).toBe(true);
    });
  });

  it("emits notify.taskEvents when events are appended", async () => {
    const t = gateway.tasks.create({
      goal: "Events",
      workspaceRoots: [path.join(dir, "ws")],
      approvalMode: "autopilot",
    });
    // Drain debounced create notifies so we only assert the append.
    await new Promise((r) => setTimeout(r, 120));
    notes.length = 0;
    gateway.tasks.appendEvent(t.id, "message", {
      role: "assistant",
      text: "hello",
    });
    await vi.waitFor(() => {
      const hit = notes.find(
        (n) =>
          n.method === "notify.taskEvents" &&
          (n.params as { taskId: string }).taskId === t.id,
      );
      expect(hit).toBeTruthy();
    });
  });

  it("emits notify.inboxChanged on inbox add", async () => {
    notes.length = 0;
    gateway.inbox.add({
      kind: "suggestion",
      title: "Hello",
      body: "World",
    });
    expect(notes.some((n) => n.method === "notify.inboxChanged")).toBe(true);
  });
});
