import { describe, it, expect } from "vitest";
import { resolveLiveThreadTask } from "./live-thread-task.js";

describe("resolveLiveThreadTask", () => {
  it("returns null for empty thread", () => {
    expect(resolveLiveThreadTask([])).toBeNull();
  });

  it("prefers running over earlier done", () => {
    const t = resolveLiveThreadTask([
      { id: "a", status: "done" },
      { id: "b", status: "running" },
      { id: "c", status: "done" },
    ]);
    expect(t?.id).toBe("b");
  });

  it("falls back to last member when none live", () => {
    const t = resolveLiveThreadTask([
      { id: "a", status: "done" },
      { id: "b", status: "failed" },
    ]);
    expect(t?.id).toBe("b");
  });

  it("treats waiting_approval and queued as live", () => {
    expect(
      resolveLiveThreadTask([
        { id: "a", status: "done" },
        { id: "b", status: "waiting_approval" },
      ])?.id,
    ).toBe("b");
    expect(
      resolveLiveThreadTask([{ id: "q", status: "queued" }])?.id,
    ).toBe("q");
  });
});
