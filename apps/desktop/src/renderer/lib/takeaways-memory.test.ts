import { describe, it, expect } from "vitest";
import {
  shouldReuseLocalEventsForTakeaways,
  takeawaysMemoryUpsert,
} from "./takeaways-memory";

describe("shouldReuseLocalEventsForTakeaways", () => {
  it("true when selected or workspace matches", () => {
    expect(
      shouldReuseLocalEventsForTakeaways({
        selectedId: "t1",
        workspaceTaskId: "t2",
        targetTaskId: "t1",
      }),
    ).toBe(true);
    expect(
      shouldReuseLocalEventsForTakeaways({
        selectedId: "x",
        workspaceTaskId: "t1",
        targetTaskId: "t1",
      }),
    ).toBe(true);
    expect(
      shouldReuseLocalEventsForTakeaways({
        selectedId: "a",
        workspaceTaskId: "b",
        targetTaskId: "c",
      }),
    ).toBe(false);
  });
});

describe("takeawaysMemoryUpsert", () => {
  it("builds title and content", () => {
    expect(
      takeawaysMemoryUpsert({
        task: { id: "t1", goal: "Ship it", title: "Ship" },
        events: [{ kind: "message", payload: { text: "done" } }],
        buildContent: ({ taskId, goal }) => `${taskId}:${goal}`,
      }),
    ).toEqual({
      kind: "episodic",
      title: "Takeaways: Ship",
      content: "t1:Ship it",
      provenance: "task:t1",
    });
  });

  it("falls back to goal for title and truncates", () => {
    const long = "x".repeat(80);
    const r = takeawaysMemoryUpsert({
      task: { id: "t", goal: long, title: null },
      events: [],
      buildContent: () => "body",
    });
    expect(r.title).toBe(`Takeaways: ${"x".repeat(60)}`);
  });
});
