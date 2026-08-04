import { describe, it, expect } from "vitest";
import { needsYouOpenTarget } from "./needs-you-open";
import {
  needsYouInboxItems,
  primaryNeedsYouDeepLink,
} from "./inbox-needs-you";

describe("needsYouOpenTarget (I10 deep-link)", () => {
  it("prefers deepLink over raw taskId", () => {
    expect(
      needsYouOpenTarget({
        taskId: "wrong",
        deepLink: { taskId: "t1", approvalId: "a1" },
      }),
    ).toEqual({ taskId: "t1", approvalId: "a1" });
  });

  it("integrates with needsYouInboxItems + primaryNeedsYouDeepLink", () => {
    const items = needsYouInboxItems([
      {
        kind: "approval",
        title: "Shell",
        read: false,
        taskId: "tx",
        approvalId: "ax",
      },
    ]);
    const primary = primaryNeedsYouDeepLink(items);
    expect(primary).toEqual({ taskId: "tx", approvalId: "ax" });
    expect(needsYouOpenTarget(items[0]!)).toEqual(primary);
  });

  it("skips suggestion ids", () => {
    expect(
      needsYouOpenTarget({ taskId: "suggestion:foo" }),
    ).toBeNull();
  });
});
