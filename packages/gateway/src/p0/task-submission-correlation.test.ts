import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "../services/tasks.js";
import { RunAttemptService } from "../services/run-attempts.js";
import { TaskSubmissionService } from "../services/task-submission.js";
import {
  desktopRequestContext,
  remoteRequestContext,
} from "../services/request-context.js";
import { correlationLogFields } from "@grokdesk/shared";
import { OperationReceiptService } from "../services/operation-receipts.js";
import { withOperation } from "@grokdesk/shared";

describe("TaskSubmissionService correlation (OPS)", () => {
  let dir: string;
  let db: Db;
  let submit: TaskSubmissionService;
  let receipts: OperationReceiptService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-corr-"));
    db = openDatabase(path.join(dir, "t.db"));
    submit = new TaskSubmissionService(
      new TaskService(db),
      new RunAttemptService(db),
    );
    receipts = new OperationReceiptService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("binds requestId → taskId → runAttemptId from RequestContext", () => {
    const ctx = desktopRequestContext("req-desktop-42");
    const result = submit.submit(
      {
        goal: "hello",
        mode: "agent",
        model: "m",
        effort: "low",
        workspaceRoots: [dir],
      },
      ctx,
    );
    expect(result.correlation.requestId).toBe("req-desktop-42");
    expect(result.correlation.taskId).toBe(result.task.id);
    expect(result.correlation.runAttemptId).toBe(result.runAttempt.id);
    const fields = correlationLogFields(result.correlation);
    expect(fields.requestId).toBe("req-desktop-42");
    expect(fields.taskId).toBe(result.task.id);
    expect(JSON.stringify(fields)).not.toMatch(/password|secret|token/i);
  });

  it("remote principal is separate from correlation request id", () => {
    const ctx = remoteRequestContext({
      principalDeviceId: "phone-A",
      machineId: "mac-1",
      requestId: "req-remote-9",
    });
    const result = submit.submit(
      {
        goal: "remote task",
        mode: "agent",
        model: "m",
        effort: "low",
        workspaceRoots: [dir],
      },
      ctx,
    );
    expect(result.principalId).toBe("phone-A");
    expect(result.correlation.requestId).toBe("req-remote-9");
  });

  it("operation receipt can attach correlationId from the chain", () => {
    const result = submit.submit(
      {
        goal: "op",
        mode: "agent",
        model: "m",
        effort: "low",
        workspaceRoots: [dir],
      },
      desktopRequestContext("req-op-1"),
    );
    const op = receipts.append({
      taskId: result.task.id,
      runAttemptId: result.runAttempt.id,
      action: "task.submit",
      decision: "info",
      correlationId: result.correlation.requestId,
      detail: correlationLogFields(result.correlation),
    });
    const chain = withOperation(result.correlation, op.id);
    expect(chain.operationId).toBe(op.id);
    expect(op.correlationId).toBe("req-op-1");
    expect(JSON.stringify(op.detail)).not.toMatch(/password|api[_-]?key/i);
  });
});
