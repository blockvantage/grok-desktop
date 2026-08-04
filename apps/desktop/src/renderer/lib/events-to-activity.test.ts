import { describe, expect, it } from "vitest";
import { activityStoreFromEvents } from "./events-to-activity";
import { visibleTimelineEvents, workersForHud } from "./activity-store";

describe("activityStoreFromEvents", () => {
  it("builds progressive timeline with live work and messages in order", () => {
    const state = activityStoreFromEvents(
      [
        {
          id: "1",
          kind: "message",
          payload: { role: "user", text: "Do research" },
          createdAt: "t1",
          taskId: "r1",
        },
        {
          id: "2",
          kind: "tool_request",
          payload: { tool: "browser_open", url: "https://x.ai" },
          createdAt: "t2",
          taskId: "r1",
        },
        {
          id: "3",
          kind: "step",
          payload: { title: "Reviewed 4 sources", status: "end" },
          createdAt: "t3",
          taskId: "r1",
        },
        {
          id: "4",
          kind: "message",
          payload: { role: "assistant", text: "Here is a summary." },
          createdAt: "t4",
          taskId: "r1",
        },
      ],
      "r1",
    );
    const visible = visibleTimelineEvents(state);
    expect(visible.map((e) => e.kind)).toContain("user_message");
    expect(visible.map((e) => e.kind)).toContain("phase");
    expect(visible.map((e) => e.kind)).toContain("assistant_message");
    expect(workersForHud(state)).toEqual([]);
  });

  it("surfaces workers only from truthful worker lifecycle events", () => {
    const state = activityStoreFromEvents(
      [
        {
          id: "w1",
          kind: "worker_started",
          payload: { workerId: "agent-1", label: "Researcher" },
          createdAt: "t1",
          taskId: "r1",
        },
        {
          id: "w2",
          kind: "worker_completed",
          payload: { workerId: "agent-1" },
          createdAt: "t2",
          taskId: "r1",
        },
      ],
      "r1",
    );
    expect(state.workersAvailable).toBe(true);
    expect(workersForHud(state)).toHaveLength(1);
    expect(workersForHud(state)[0]?.status).toBe("done");
  });

  it("uses only explicit truthful worker payload fields", () => {
    const state = activityStoreFromEvents(
      [
        {
          id: "missing-id-start",
          kind: "worker_started",
          payload: { id: "fabricated-id", name: "Invented label" },
          createdAt: "t1",
          taskId: "r1",
        },
        {
          id: "missing-id-activity",
          kind: "worker_activity",
          payload: { summary: "Run-level detail" },
          createdAt: "t2",
          taskId: "r1",
        },
        {
          id: "truthful",
          kind: "worker_started",
          payload: {
            workerId: "agent-1",
            label: "Researcher",
            parentWorkerId: "manager-1",
          },
          createdAt: "t3",
          taskId: "r1",
        },
      ],
      "r1",
    );

    expect(Object.keys(state.workers)).toEqual(["agent-1"]);
    expect(state.workers["agent-1"]?.parentWorkerId).toBe("manager-1");
    expect(
      state.events.some((entry) => entry.workerId === "fabricated-id"),
    ).toBe(false);
    expect(
      state.events.some((entry) => entry.summary === "Run-level detail"),
    ).toBe(true);
  });

  it("records browserProvider on browser tool receipts", () => {
    const state = activityStoreFromEvents(
      [
        {
          id: "b1",
          kind: "tool_request",
          payload: { tool: "browser_open" },
          createdAt: "t1",
          taskId: "r1",
        },
      ],
      "r1",
    );
    const receipt = state.events.find((e) => e.kind === "tool_receipt");
    expect(receipt?.receipt?.browserProvider).toBe("desk-browser");
  });
});
