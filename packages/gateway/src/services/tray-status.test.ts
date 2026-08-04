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
    expect(computeTrayStatus([task("running")], true)).toEqual({
      status: "paused",
      runningCount: 0,
    });
  });

  it("needs_you when waiting approval", () => {
    expect(
      computeTrayStatus([task("waiting_approval"), task("running")], false)
        .status,
    ).toBe("needs_you");
  });

  it("working when only running", () => {
    expect(computeTrayStatus([task("running"), task("queued")], false)).toEqual(
      {
        status: "working",
        runningCount: 1,
      },
    );
  });

  it("idle when nothing active", () => {
    expect(computeTrayStatus([task("done"), task("failed")], false)).toEqual({
      status: "idle",
      runningCount: 0,
    });
  });
});
