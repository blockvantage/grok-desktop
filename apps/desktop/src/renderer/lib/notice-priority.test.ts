import { describe, expect, it } from "vitest";
import {
  isBlockingNoticeKind,
  noticePriority,
  selectNotices,
} from "./notice-priority";

describe("selectNotices", () => {
  it("keeps only the top 2 by priority when all fire at once", () => {
    const selected = selectNotices(
      [
        { id: "u", kind: "usage", priority: noticePriority("usage") },
        { id: "r", kind: "running", priority: noticePriority("running") },
        { id: "n", kind: "needs_you", priority: noticePriority("needs_you") },
        { id: "a", kind: "reauth", priority: noticePriority("reauth") },
        { id: "g", kind: "gateway_dead", priority: noticePriority("gateway_dead") },
      ],
      2,
    );
    // Hard blocker present → soft running/usage suppressed; gateway + reauth win.
    expect(selected.map((n) => n.kind)).toEqual(["gateway_dead", "reauth"]);
  });

  it("suppresses running/usage while entitlement/runtime blocker is active", () => {
    const selected = selectNotices(
      [
        { id: "e", kind: "entitlement", priority: noticePriority("entitlement") },
        { id: "run", kind: "running", priority: noticePriority("running") },
        { id: "u", kind: "usage", priority: noticePriority("usage") },
        { id: "n", kind: "needs_you", priority: noticePriority("needs_you") },
      ],
      2,
    );
    expect(selected.map((n) => n.kind)).toEqual(["entitlement", "needs_you"]);
    expect(selected.some((n) => n.kind === "usage")).toBe(false);
  });

  it("returns all when under the max and no hard blocker", () => {
    expect(
      selectNotices(
        [{ id: "r", kind: "running", priority: noticePriority("running") }],
        2,
      ),
    ).toHaveLength(1);
  });

  it("ranks readiness above needs_you", () => {
    expect(noticePriority("readiness")).toBeLessThan(
      noticePriority("needs_you"),
    );
    expect(isBlockingNoticeKind("readiness")).toBe(true);
    expect(isBlockingNoticeKind("usage")).toBe(false);
  });
});
