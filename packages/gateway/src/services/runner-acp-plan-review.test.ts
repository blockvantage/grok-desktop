/**
 * Integration: tool_request with meta.planReview/acpAsk parks waiting_approval
 * and tasks.approve resolves the human-permission bridge (exit_plan_mode path).
 * Teardown paths (cancel / stopLocalRuns / loseLease) must also clear the waiter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { TaskRunner } from "./runner.js";
import { RunAttemptService } from "./run-attempts.js";
import type { EngineAdapter, EngineRunOptions } from "@grokdesk/engine-grok";
import {
  waitHumanPermission,
  humanPermissionPendingCount,
  clearHumanPermissions,
} from "@grokdesk/agent-runtime";

/** Mirror AcpMediatedSession.askHuman: waiter + planReview park event. */
function planReviewEngine(acpRequestId: string): EngineAdapter {
  return {
    // false so runner evaluates tool_request (ACP mediation path).
    executesOwnTools: false,
    async cancel() {},
    async run(opts: EngineRunOptions) {
      const decisionP = waitHumanPermission(acpRequestId);
      void opts.onEvent({
        type: "tool_request",
        id: acpRequestId,
        tool: "other",
        command: "exit_plan_mode",
        meta: {
          permissionRequest: true,
          acpAsk: true,
          planReview: true,
          planContent: "# Plan\n- step",
          acpRequestId,
        },
      });
      await opts.onEvent({
        type: "plan_update",
        content: "# Plan\n- step",
        status: "awaiting_approval",
      });
      try {
        const decision = await decisionP;
        if (decision !== "allow" && decision !== "allow_once") {
          await opts.onEvent({
            type: "error",
            message: "plan rejected",
          });
          return;
        }
        await opts.onEvent({ type: "done", summary: "plan approved" });
      } catch {
        // rejectHumanPermission on cancel/stop/lease-loss — settle cleanly.
      }
    },
  };
}

async function waitForApproval(
  runner: TaskRunner,
  taskId: string,
): Promise<string> {
  let approvalId: string | undefined;
  for (let i = 0; i < 80; i++) {
    const pending = runner.getPendingApprovals(taskId);
    if (pending.length > 0) {
      approvalId = pending[0]!.id;
      break;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  expect(approvalId).toBeTruthy();
  return approvalId!;
}

describe("TaskRunner ACP plan-review parking", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let audit: AuditService;
  let runner: TaskRunner;

  beforeEach(() => {
    clearHumanPermissions();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-plan-park-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    audit = new AuditService(db);
  });

  afterEach(() => {
    clearHumanPermissions();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parks planReview tool_request and approve resolves human bridge", async () => {
    const acpRequestId = "exit-plan-tc-1";
    runner = new TaskRunner(tasks, audit, planReviewEngine(acpRequestId));

    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "draft a plan",
      workspaceRoots: [ws],
      approvalMode: "balanced",
    });

    const startP = runner.start(t.id);
    const approvalId = await waitForApproval(runner, t.id);
    expect(tasks.get(t.id)?.status).toBe("waiting_approval");
    expect(humanPermissionPendingCount()).toBe(1);

    const planEv = tasks
      .listEvents(t.id)
      .find((e) => e.kind === "plan_update");
    expect(planEv?.payload).toMatchObject({
      content: "# Plan\n- step",
      status: "awaiting_approval",
    });

    const apprReq = tasks
      .listEvents(t.id)
      .find((e) => e.kind === "approval_required");
    expect(apprReq?.payload).toMatchObject({
      planReview: true,
      kind: "plan_review",
    });

    await runner.approve(approvalId, "approve");
    await startP;

    expect(humanPermissionPendingCount()).toBe(0);
    expect(tasks.get(t.id)?.status).toBe("done");
    const resolved = tasks
      .listEvents(t.id)
      .find((e) => e.kind === "approval_resolved");
    expect(resolved?.payload).toMatchObject({
      decision: "approve",
      planReview: true,
    });
  });

  it("cancel rejects human-permission waiter (no leak)", async () => {
    const acpRequestId = "exit-plan-cancel-1";
    runner = new TaskRunner(tasks, audit, planReviewEngine(acpRequestId));

    const ws = path.join(dir, "ws-cancel");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "draft a plan then cancel",
      workspaceRoots: [ws],
      approvalMode: "balanced",
    });

    const startP = runner.start(t.id);
    await waitForApproval(runner, t.id);
    expect(humanPermissionPendingCount()).toBe(1);

    await runner.cancel(t.id);
    await startP;

    expect(humanPermissionPendingCount()).toBe(0);
    expect(tasks.get(t.id)?.status).toBe("cancelled");
  });

  it("stopLocalRuns rejects human-permission waiter (no leak)", async () => {
    const acpRequestId = "exit-plan-stop-1";
    runner = new TaskRunner(tasks, audit, planReviewEngine(acpRequestId));

    const ws = path.join(dir, "ws-stop");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "draft a plan then stop gateway",
      workspaceRoots: [ws],
      approvalMode: "balanced",
    });

    const startP = runner.start(t.id);
    await waitForApproval(runner, t.id);
    expect(humanPermissionPendingCount()).toBe(1);

    await runner.stopLocalRuns();
    await startP;

    expect(humanPermissionPendingCount()).toBe(0);
    expect(tasks.get(t.id)?.status).toBe("cancelled");
  });

  it("loseLease rejects human-permission waiter after remote cancel (no leak)", async () => {
    // Owner parks on ACP waiter; remote process cancels task status.
    // Owner heartbeat → loseLease must clear the human-permission Map entry.
    const acpRequestId = "exit-plan-lease-1";
    const ws = path.join(dir, "ws-lease");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "draft a plan then lose lease",
      workspaceRoots: [ws],
      approvalMode: "balanced",
    });
    const attemptsA = new RunAttemptService(db, "gateway-a");
    attemptsA.create(t.id);
    const eng = planReviewEngine(acpRequestId);
    runner = new TaskRunner(tasks, audit, eng, {
      runAttempts: attemptsA,
      runAttemptLeaseMs: 90,
      runAttemptHeartbeatMs: 20,
    });

    const startP = runner.start(t.id);
    await waitForApproval(runner, t.id);
    expect(humanPermissionPendingCount()).toBe(1);

    // Second connection acts as a remote gateway that cancels the shared task.
    const dbB = openDatabase(path.join(dir, "t.sqlite"));
    const tasksB = new TaskService(dbB);
    const attemptsB = new RunAttemptService(dbB, "gateway-b");
    const runnerB = new TaskRunner(tasksB, new AuditService(dbB), eng, {
      runAttempts: attemptsB,
    });
    await runnerB.cancel(t.id);
    dbB.close();

    await startP;

    expect(humanPermissionPendingCount()).toBe(0);
    expect(tasks.get(t.id)?.status).toBe("cancelled");
  });
});
