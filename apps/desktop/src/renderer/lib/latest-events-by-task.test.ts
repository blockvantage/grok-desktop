import { describe, it, expect } from "vitest";
import { latestEventsByTaskId } from "./latest-events-by-task";

describe("latestEventsByTaskId", () => {
  it("keeps the last event per task and skips goal-* ids", () => {
    const map = latestEventsByTaskId([
      {
        id: "goal-root",
        taskId: "root",
        kind: "message",
        payload: { text: "goal" },
      },
      {
        id: "1",
        taskId: "root",
        kind: "message",
        payload: { text: "a" },
      },
      {
        id: "2",
        taskId: "child",
        kind: "step",
        payload: { title: "x" },
      },
      {
        id: "3",
        taskId: "root",
        kind: "tool_request",
        payload: { tool: "shell" },
      },
    ]);
    expect(map.root).toEqual({
      kind: "tool_request",
      payload: { tool: "shell" },
    });
    expect(map.child).toEqual({ kind: "step", payload: { title: "x" } });
  });

  it("returns empty map for empty input", () => {
    expect(latestEventsByTaskId([])).toEqual({});
  });

  it("skips malformed rows without crashing", () => {
    const map = latestEventsByTaskId([
      // missing id (regression: used to throw on startsWith)
      {
        id: undefined as unknown as string,
        taskId: "t1",
        kind: "message",
        payload: { text: "hi" },
      },
      {
        id: "ok",
        taskId: "t1",
        kind: "step",
        payload: { title: "x" },
      },
      {
        id: "no-task",
        taskId: undefined as unknown as string,
        kind: "message",
        payload: {},
      },
    ]);
    expect(map.t1).toEqual({ kind: "step", payload: { title: "x" } });
    expect(map).not.toHaveProperty("undefined");
  });
});
