/**
 * TASK-02 + OPS: follow-up create reuses conversation and carries correlation
 * through TaskSubmissionService → operation receipts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { desktopRequestContext } from "../services/request-context.js";
import { parseIpcRequest } from "@grokdesk/shared";

describe("follow-up create correlation + conversation (TASK-02)", () => {
  let dir: string;
  let gw: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-fuc-"));
    gw = new Gateway(
      {
        dataDir: dir,
        logsDir: path.join(dir, "logs"),
        dbPath: path.join(dir, "db.sqlite"),
      },
      { engine: new TestEngine() },
    );
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parent and follow-up share conversation; each has distinct request correlation", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);

    const parentReq = parseIpcRequest({
      id: "req-parent-1",
      method: "tasks.create",
      params: {
        goal: "root work",
        workspaceRoots: [ws],
        mode: "interactive",
        effort: "fast",
        approvalMode: "autopilot",
      },
    });
    const parent = (await gw.handle(
      parentReq,
      desktopRequestContext("req-parent-1"),
    )) as { id: string; parentTaskId: string | null };
    expect(parent.parentTaskId).toBeNull();

    const childReq = parseIpcRequest({
      id: "req-child-2",
      method: "tasks.create",
      params: {
        goal: "follow up",
        workspaceRoots: [ws],
        parentTaskId: parent.id,
        mode: "interactive",
        effort: "fast",
        approvalMode: "autopilot",
      },
    });
    const child = (await gw.handle(
      childReq,
      desktopRequestContext("req-child-2"),
    )) as { id: string; parentTaskId: string | null };
    expect(child.parentTaskId).toBe(parent.id);

    // Conversation reuse
    const parentRow = gw.db
      .prepare(`SELECT conversation_id as cid FROM tasks WHERE id = ?`)
      .get(parent.id) as { cid: string | null };
    const childRow = gw.db
      .prepare(`SELECT conversation_id as cid FROM tasks WHERE id = ?`)
      .get(child.id) as { cid: string | null };
    expect(parentRow.cid).toBeTruthy();
    expect(childRow.cid).toBe(parentRow.cid);

    const turns = gw.conversations.listTurns(parentRow.cid!);
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect(turns.some((t) => t.content === "root work")).toBe(true);
    expect(turns.some((t) => t.content === "follow up")).toBe(true);

    // Distinct correlation on submit receipts
    const parentSubmit = gw.operationReceipts
      .listForTask(parent.id)
      .find((r) => r.action === "task.submit");
    const childSubmit = gw.operationReceipts
      .listForTask(child.id)
      .find((r) => r.action === "task.submit");
    expect(parentSubmit?.correlationId).toBe("req-parent-1");
    expect(childSubmit?.correlationId).toBe("req-child-2");

    // Run attempts allocated for both
    expect(gw.runAttempts.latestForTask(parent.id)).not.toBeNull();
    expect(gw.runAttempts.latestForTask(child.id)).not.toBeNull();

    // Follow-up reuses managed workspace roots (no new chat folder when parent roots given)
    const parentTask = gw.tasks.get(parent.id)!;
    const childTask = gw.tasks.get(child.id)!;
    expect(childTask.policySnapshot.workspaceRoots[0]).toBe(
      parentTask.policySnapshot.workspaceRoots[0],
    );
  });
});
