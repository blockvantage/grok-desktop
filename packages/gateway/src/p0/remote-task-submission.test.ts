/**
 * Remote tasks.create goes through Gateway.handle → TaskSubmissionService
 * (one submission path for interactive + remote).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { remoteRequestContext } from "../services/request-context.js";
import { parseIpcRequest } from "@grokdesk/shared";

describe("remote tasks.create → TaskSubmissionService", () => {
  let dir: string;
  let gw: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-rts-"));
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

  it("allocates run attempt + task.submit receipt under remote principal", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const req = parseIpcRequest({
      id: "req-remote-submit-1",
      method: "tasks.create",
      params: {
        goal: "remote create",
        workspaceRoots: [ws],
        model: "fake",
        mode: "interactive",
        effort: "fast",
        approvalMode: "autopilot",
      },
    });
    const ctx = remoteRequestContext({
      principalDeviceId: "phone-A",
      machineId: "mac-1",
      requestId: "req-remote-submit-1",
    });
    const task = (await gw.handle(req, ctx)) as { id: string };
    expect(task.id).toBeTruthy();

    const attempt = gw.runAttempts.latestForTask(task.id);
    expect(attempt).not.toBeNull();

    const receipts = gw.operationReceipts.listForTask(task.id);
    const submit = receipts.find((r) => r.action === "task.submit");
    expect(submit?.correlationId).toBe("req-remote-submit-1");
    expect(submit?.principalId).toBe("phone-A");
  });
});
