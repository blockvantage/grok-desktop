import { describe, it, expect } from "vitest";
import { computeTrayStatus } from "./tray-status.js";
import type { Task } from "@grokdesk/shared";

function task(status: Task["status"]): Task {
  return {
    id: status,
    goal: "g",
    title: null,
    mode: "agent",
    status,
    model: "m",
    effort: "low",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/w"],
      allowShell: true,
      allowNetworkTools: true,
    },
    projectId: null,
    parentTaskId: null,
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

describe("computeTrayStatus", () => {
  it("paused overrides running", () => {
    expect(computeTrayStatus([task("running")], true)).toMatchObject({
      status: "paused",
      runningCount: 0,
      needsInput: false,
      inboxBadge: 0,
    });
  });

  it("needs_you when waiting approval", () => {
    const view = computeTrayStatus(
      [task("waiting_approval"), task("running")],
      false,
    );
    expect(view.status).toBe("needs_you");
    expect(view.needsInput).toBe(true);
    expect(view.inboxBadge).toBe(1);
    expect(view.notificationTitle).toBe("g");
  });

  it("needs_you when waiting_user (same projector)", () => {
    const view = computeTrayStatus([task("waiting_user")], false);
    expect(view.status).toBe("needs_you");
    expect(view.pending[0]?.kind).toBe("question");
  });

  it("working when only running", () => {
    expect(
      computeTrayStatus([task("running"), task("queued")], false),
    ).toMatchObject({
      status: "working",
      runningCount: 1,
      needsInput: false,
    });
  });

  it("idle when nothing active", () => {
    expect(computeTrayStatus([task("done"), task("failed")], false)).toMatchObject({
      status: "idle",
      runningCount: 0,
      needsInput: false,
    });
  });
});
