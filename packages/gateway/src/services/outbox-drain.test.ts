import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { ConversationOutboxRepository } from "./conversation-outbox.js";
import {
  OutboxDrainCoordinator,
  conversationHasActiveTask,
  conversationMayDrain,
  defaultIsTransientError,
  drainOnce,
  parentTaskIsActive,
} from "./outbox-drain.js";
import type { Task } from "@grokdesk/shared";

function fakeTask(id: string): Task {
  return {
    id,
    goal: "g",
    title: null,
    mode: "interactive",
    status: "queued",
    model: "grok-4.5",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [],
      allowNetworkTools: false,
      allowShell: false,
    },
    projectId: null,
    parentTaskId: "parent",
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

describe("outbox-drain", () => {
  let dir: string;
  let db: Db;
  let outbox: ConversationOutboxRepository;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-drain-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
    outbox = new ConversationOutboxRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("conversationMayDrain is false when active or submitting", () => {
    expect(
      conversationMayDrain({ hasActiveTask: true, hasSubmittingClaim: false }),
    ).toBe(false);
    expect(
      conversationMayDrain({ hasActiveTask: false, hasSubmittingClaim: true }),
    ).toBe(false);
    expect(
      conversationMayDrain({ hasActiveTask: false, hasSubmittingClaim: false }),
    ).toBe(true);
  });

  it("carries parent model/strict/skills onto the drained follow-up", async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        skills_json, mcp_json, created_at, updated_at, conversation_id
      ) VALUES (?, 'root', 'interactive', 'done', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "parent-strict",
      "grok-4",
      "heavy",
      JSON.stringify({
        approvalMode: "strict",
        workspaceRoots: ["/abs/ws"],
        allowShell: false,
        allowNetworkTools: true,
      }),
      JSON.stringify(["desk-image"]),
      JSON.stringify(["desk-browser"]),
      now,
      now,
      "conv-strict",
    );
    outbox.enqueue({
      id: "follow-strict",
      conversationId: "conv-strict",
      parentTaskId: "parent-strict",
      text: "next please",
      attachments: [],
    });
    let captured: Record<string, unknown> | undefined;
    await drainOnce({
      outbox,
      db,
      createFollowUp: async (input) => {
        captured = input as unknown as Record<string, unknown>;
        return { task: fakeTask("task-follow"), kind: "continue" };
      },
      countActiveRuns: () => 0,
    });
    expect(captured).toMatchObject({
      goal: "next please",
      model: "grok-4",
      effort: "heavy",
      approvalMode: "strict",
      skills: ["desk-image"],
      mcpServerIds: ["desk-browser"],
      workspaceRoots: ["/abs/ws"],
    });
    expect(captured?.model).not.toBe("grok-4.5");
    expect(captured?.approvalMode).not.toBe("balanced");
  });

  it("drains multiple conversations independently of selected chat", async () => {
    outbox.enqueue({
      id: "c1-m1",
      conversationId: "conv-a",
      parentTaskId: "pa",
      text: "from a",
      attachments: [],
    });
    outbox.enqueue({
      id: "c2-m1",
      conversationId: "conv-b",
      parentTaskId: "pb",
      text: "from b",
      attachments: [],
    });
    const created: string[] = [];
    await drainOnce({
      outbox,
      db,
      createFollowUp: async (input) => {
        created.push(input.clientMutationId);
        return { task: fakeTask(`task-${input.clientMutationId}`), kind: "fresh" };
      },
      countActiveRuns: () => 0,
      maxConcurrentConversations: 5,
    });
    expect(created.sort()).toEqual(["c1-m1", "c2-m1"]);
    expect(outbox.get("c1-m1")?.status).toBe("accepted");
    expect(outbox.get("c2-m1")?.status).toBe("accepted");
    expect(outbox.get("c1-m1")?.acceptedTaskId).toBe("task-c1-m1");
  });

  it("FIFO within a conversation and blocks while parent task active", async () => {
    outbox.enqueue({
      id: "f1",
      conversationId: "c1",
      parentTaskId: "parent-live",
      text: "first",
      attachments: [],
    });
    outbox.enqueue({
      id: "f2",
      conversationId: "c1",
      parentTaskId: "parent-live",
      text: "second",
      attachments: [],
    });
    // Insert active parent task.
    db.prepare(
      `INSERT INTO tasks (
        id, goal, mode, status, model, effort, policy_json,
        created_at, updated_at, conversation_id
      ) VALUES (?, ?, 'interactive', 'running', 'grok-4.5', 'normal', '{}', ?, ?, ?)`,
    ).run("parent-live", "parent", new Date().toISOString(), new Date().toISOString(), "c1");

    expect(conversationHasActiveTask(db, "c1")).toBe(true);
    expect(parentTaskIsActive(db, "parent-live")).toBe(true);

    const create = vi.fn(async () => ({
      task: fakeTask("x"),
      kind: "fresh" as const,
    }));
    await drainOnce({ outbox, db, createFollowUp: create, countActiveRuns: () => 1 });
    expect(create).not.toHaveBeenCalled();

    // Complete parent → drain oldest first.
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = 'parent-live'`).run();
    const order: string[] = [];
    await drainOnce({
      outbox,
      db,
      createFollowUp: async (input) => {
        order.push(input.clientMutationId);
        // First create leaves a running child so second stays queued until next cycle.
        if (input.clientMutationId === "f1") {
          db.prepare(
            `INSERT INTO tasks (
              id, goal, mode, status, model, effort, policy_json,
              created_at, updated_at, conversation_id, parent_task_id
            ) VALUES (?, ?, 'interactive', 'running', 'grok-4.5', 'normal', '{}', ?, ?, ?, ?)`,
          ).run(
            "task-f1",
            "first",
            new Date().toISOString(),
            new Date().toISOString(),
            "c1",
            "parent-live",
          );
        }
        return { task: fakeTask(`task-${input.clientMutationId}`), kind: "fresh" };
      },
      countActiveRuns: () => 0,
    });
    expect(order).toEqual(["f1"]);
    expect(outbox.get("f1")?.status).toBe("accepted");
    expect(outbox.get("f2")?.status).toBe("pending");
  });

  it("same mutation id replay after acceptance completes reconciliation", async () => {
    outbox.enqueue({
      id: "mut-replay",
      conversationId: "c1",
      parentTaskId: "p1",
      text: "once",
      attachments: [],
    });
    let calls = 0;
    const create = async () => {
      calls += 1;
      return { task: fakeTask("task-once"), kind: calls === 1 ? "fresh" as const : "duplicate" as const };
    };
    await drainOnce({ outbox, db, createFollowUp: create });
    expect(outbox.get("mut-replay")?.acceptedTaskId).toBe("task-once");

    // Simulate crash after acceptance but before markAccepted: re-claim path.
    // Item already accepted — re-drain must not create again.
    await drainOnce({ outbox, db, createFollowUp: create });
    expect(calls).toBe(1);
  });

  it("blocks missing attachment without wedging other conversations", async () => {
    outbox.enqueue({
      id: "miss",
      conversationId: "c-miss",
      parentTaskId: "p1",
      text: "needs file",
      attachments: [
        {
          id: "a1",
          name: "gone.txt",
          sourcePath: path.join(dir, "does-not-exist.txt"),
          kind: "file",
        },
      ],
    });
    outbox.enqueue({
      id: "ok",
      conversationId: "c-ok",
      parentTaskId: "p2",
      text: "fine",
      attachments: [],
    });
    await drainOnce({
      outbox,
      db,
      createFollowUp: async (input) => ({
        task: fakeTask(`t-${input.clientMutationId}`),
        kind: "fresh",
      }),
      attachmentExists: (p) => fs.existsSync(p),
    });
    expect(outbox.get("miss")?.status).toBe("blocked_missing_attachment");
    expect(outbox.get("ok")?.status).toBe("accepted");
  });

  it("classifies permanent vs transient errors", () => {
    expect(defaultIsTransientError(new Error("auth required"))).toBe(false);
    expect(defaultIsTransientError(new Error("validation failed"))).toBe(false);
    expect(defaultIsTransientError(new Error("network timeout"))).toBe(true);
    expect(defaultIsTransientError(new Error("SQLITE_BUSY"))).toBe(true);
  });

  it("coalesces concurrent schedule triggers into one pump", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let resolveCreate!: () => void;
    const gate = new Promise<void>((r) => {
      resolveCreate = r;
    });
    outbox.enqueue({
      id: "slow",
      conversationId: "c1",
      parentTaskId: "p1",
      text: "slow",
      attachments: [],
    });
    const coord = new OutboxDrainCoordinator({
      outbox,
      db,
      createFollowUp: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await gate;
        concurrent -= 1;
        return { task: fakeTask("t-slow"), kind: "fresh" };
      },
    });
    coord.schedule();
    coord.schedule();
    coord.schedule();
    resolveCreate();
    await coord.join();
    expect(maxConcurrent).toBe(1);
    expect(outbox.get("slow")?.status).toBe("accepted");
  });

  it("joins before stop so shutdown can close DB safely", async () => {
    outbox.enqueue({
      id: "shut",
      conversationId: "c1",
      parentTaskId: "p1",
      text: "x",
      attachments: [],
    });
    const coord = new OutboxDrainCoordinator({
      outbox,
      db,
      createFollowUp: async () => ({ task: fakeTask("t"), kind: "fresh" }),
    });
    coord.schedule();
    await coord.join();
    expect(outbox.get("shut")?.status).toBe("accepted");
  });
});
