import { describe, it, expect } from "vitest";
import {
  needsYouInboxItems,
  primaryNeedsYouDeepLink,
} from "./inbox-needs-you";

describe("needsYouInboxItems (I10)", () => {
  it("prefers approvals over unfinished", () => {
    const items = needsYouInboxItems([
      { kind: "unfinished", title: "Almost", read: false, taskId: "t0" },
      {
        kind: "approval",
        title: "Shell",
        read: false,
        taskId: "t1",
        approvalId: "a1",
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("approval");
    expect(items[0]!.deepLink).toEqual({ taskId: "t1", approvalId: "a1" });
  });

  it("dedupes same taskId+approvalId", () => {
    const items = needsYouInboxItems([
      {
        kind: "approval",
        title: "A",
        read: false,
        taskId: "t1",
        approvalId: "a1",
      },
      {
        kind: "approval",
        title: "A again",
        read: false,
        taskId: "t1",
        approvalId: "a1",
      },
      {
        kind: "approval",
        title: "B",
        read: false,
        taskId: "t2",
        approvalId: "a2",
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.deepLink.taskId)).toEqual(["t1", "t2"]);
  });

  it("skips generic Task failed unfinished on Home", () => {
    const items = needsYouInboxItems([
      { kind: "unfinished", title: "Task failed", read: false, taskId: "t9" },
    ]);
    expect(items).toHaveLength(0);
  });

  it("primaryNeedsYouDeepLink returns first with taskId", () => {
    const items = needsYouInboxItems([
      {
        kind: "approval",
        title: "X",
        read: false,
        taskId: "tx",
        approvalId: "ax",
      },
    ]);
    expect(primaryNeedsYouDeepLink(items)).toEqual({
      taskId: "tx",
      approvalId: "ax",
    });
  });
});
