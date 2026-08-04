import { describe, it, expect } from "vitest";
import { filterPendingApprovals } from "./pending-approvals.js";

describe("filterPendingApprovals", () => {
  const items = [
    { id: "a", taskId: "t1" },
    { id: "b", taskId: "t2" },
    { id: "c", taskId: "t1" },
  ];

  it("returns all when no task filter", () => {
    expect(filterPendingApprovals(items)).toHaveLength(3);
  });

  it("filters by taskId", () => {
    expect(filterPendingApprovals(items, "t1").map((p) => p.id)).toEqual([
      "a",
      "c",
    ]);
  });
});
