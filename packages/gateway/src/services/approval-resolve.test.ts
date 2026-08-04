import { describe, it, expect } from "vitest";
import {
  approvalAuditDetail,
  approvalResolvedEvent,
  cancelRejectedApprovalEvent,
  pendingApprovalIdsForTask,
  shouldRememberBrowserOrigin,
} from "./approval-resolve.js";

describe("approval-resolve", () => {
  it("builds audit and resolved event payloads", () => {
    expect(
      approvalAuditDetail("a1", "approve", { tool: "shell" }),
    ).toEqual({
      approvalId: "a1",
      decision: "approve",
      tool: { tool: "shell" },
    });
    expect(approvalResolvedEvent("a1", "reject")).toEqual({
      approvalId: "a1",
      decision: "reject",
    });
    expect(cancelRejectedApprovalEvent("a2")).toEqual({
      approvalId: "a2",
      decision: "reject",
      reason: "cancelled",
    });
  });

  it("lists pending ids for a task", () => {
    const pending = new Map([
      ["x", { id: "x", taskId: "t1", toolRequest: {} }],
      ["y", { id: "y", taskId: "t2", toolRequest: {} }],
      ["z", { id: "z", taskId: "t1", toolRequest: {} }],
    ]);
    expect(pendingApprovalIdsForTask(pending, "t1").sort()).toEqual([
      "x",
      "z",
    ]);
  });

  it("remembers browser origin only for browser_open with url", () => {
    expect(shouldRememberBrowserOrigin("browser_open", "https://a")).toBe(
      true,
    );
    expect(shouldRememberBrowserOrigin("browser_open", "")).toBe(false);
    expect(shouldRememberBrowserOrigin("shell", "https://a")).toBe(false);
  });
});
