import { describe, it, expect, vi } from "vitest";
import {
  dispatchEventsExportMethod,
  isEventsExportMethod,
} from "./events-export-dispatch.js";

describe("isEventsExportMethod", () => {
  it("matches events.list, events.page, and chats.exportMarkdown", () => {
    expect(isEventsExportMethod("events.list")).toBe(true);
    expect(isEventsExportMethod("events.page")).toBe(true);
    expect(isEventsExportMethod("chats.exportMarkdown")).toBe(true);
    expect(isEventsExportMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchEventsExportMethod", () => {
  it("events.list uses params", () => {
    const listEvents = vi.fn(() => [
      {
        id: "e1",
        taskId: "t1",
        seq: 4,
        kind: "message",
        payload: { text: "hi" },
        createdAt: "t",
      },
    ]);
    const deps = {
      listEvents,
      getTask: vi.fn(),
      listTasks: vi.fn(),
      dataDir: "/data",
    };
    expect(
      dispatchEventsExportMethod(
        "events.list",
        { taskId: "t1", afterSeq: 3 },
        deps,
      ),
    ).toEqual([
      {
        id: "e1",
        taskId: "t1",
        seq: 4,
        kind: "message",
        payload: { text: "hi" },
        createdAt: "t",
      },
    ]);
    expect(listEvents).toHaveBeenCalledWith("t1", 3);
  });

  it("events.page returns cursor and hasMore without pretending full cache", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      taskId: "t1",
      seq: i + 1,
      kind: "message",
      payload: {},
      createdAt: "t",
    }));
    const listEvents = vi.fn(() => events);
    const page = dispatchEventsExportMethod(
      "events.page",
      { taskId: "t1", afterSeq: 0, limit: 2 },
      {
        listEvents,
        getTask: vi.fn(),
        listTasks: vi.fn(),
        dataDir: "/data",
      },
    ) as {
      events: unknown[];
      nextAfterSeq: number;
      hasMore: boolean;
    };
    expect(page.events).toHaveLength(2);
    expect(page.nextAfterSeq).toBe(2);
    expect(page.hasMore).toBe(true);
  });
});
