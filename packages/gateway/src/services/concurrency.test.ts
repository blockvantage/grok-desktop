import { describe, it, expect } from "vitest";
import {
  clampMaxConcurrent,
  selectQueuedStarts,
  shouldSkipStart,
  threadKeyForTask,
} from "./concurrency.js";

describe("clampMaxConcurrent", () => {
  it("floors positive finite numbers", () => {
    expect(clampMaxConcurrent(2.9)).toBe(2);
    expect(clampMaxConcurrent(1)).toBe(1);
  });

  it("falls back for invalid", () => {
    expect(clampMaxConcurrent(0)).toBe(3);
    expect(clampMaxConcurrent(-1)).toBe(3);
    expect(clampMaxConcurrent("x")).toBe(3);
    expect(clampMaxConcurrent(NaN, 5)).toBe(5);
  });
});

describe("threadKeyForTask", () => {
  it("prefers conversation id", () => {
    expect(
      threadKeyForTask(
        { id: "t1", conversationId: "c1", parentTaskId: "p" },
        () => null,
      ),
    ).toBe("conv:c1");
  });

  it("falls back to root parent chain for legacy null conversation", () => {
    const byId: Record<
      string,
      { id: string; parentTaskId: string | null; conversationId: string | null }
    > = {
      child: { id: "child", parentTaskId: "mid", conversationId: null },
      mid: { id: "mid", parentTaskId: "root", conversationId: null },
      root: { id: "root", parentTaskId: null, conversationId: null },
    };
    expect(
      threadKeyForTask(byId.child!, (id) => byId[id] ?? null),
    ).toBe("root:root");
  });
});

describe("selectQueuedStarts", () => {
  it("fills remaining slots", () => {
    const ids = selectQueuedStarts({
      queued: [
        { id: "a", status: "queued", conversationId: "c-a" },
        { id: "b", status: "queued", conversationId: "c-b" },
        { id: "c", status: "queued", conversationId: "c-c" },
      ],
      runningIds: new Set(["x"]),
      maxConcurrent: 3,
      resolveTask: (id) =>
        id === "x" ? { id: "x", conversationId: "c-x" } : null,
    });
    expect(ids).toEqual(["a", "b"]);
  });

  it("skips already running ids", () => {
    expect(
      selectQueuedStarts({
        queued: [
          { id: "a", status: "queued", conversationId: "c-a" },
          { id: "b", status: "queued", conversationId: "c-b" },
        ],
        runningIds: new Set(["a"]),
        maxConcurrent: 5,
        resolveTask: (id) => ({ id, conversationId: `c-${id}` }),
      }),
    ).toEqual(["b"]);
  });

  it("serializes two queued tasks in the same conversation to one start", () => {
    const ids = selectQueuedStarts({
      queued: [
        { id: "t1", status: "queued", conversationId: "same" },
        { id: "t2", status: "queued", conversationId: "same" },
      ],
      runningIds: new Set(),
      maxConcurrent: 5,
    });
    expect(ids).toEqual(["t1"]);
  });

  it("allows concurrent starts across different conversations up to cap", () => {
    const ids = selectQueuedStarts({
      queued: [
        { id: "a", status: "queued", conversationId: "c1" },
        { id: "b", status: "queued", conversationId: "c2" },
        { id: "c", status: "queued", conversationId: "c3" },
      ],
      runningIds: new Set(),
      maxConcurrent: 2,
    });
    expect(ids).toEqual(["a", "b"]);
  });

  it("does not start a follow-up while a peer in the conversation is running", () => {
    const ids = selectQueuedStarts({
      queued: [
        { id: "follow", status: "queued", conversationId: "c1", parentTaskId: "root" },
      ],
      runningIds: new Set(["root"]),
      maxConcurrent: 5,
      resolveTask: (id) =>
        id === "root"
          ? { id: "root", conversationId: "c1", parentTaskId: null }
          : null,
    });
    expect(ids).toEqual([]);
  });

  it("serializes legacy null conversation_id via parent root", () => {
    const byId: Record<
      string,
      { id: string; parentTaskId: string | null; conversationId: null }
    > = {
      root: { id: "root", parentTaskId: null, conversationId: null },
      f1: { id: "f1", parentTaskId: "root", conversationId: null },
      f2: { id: "f2", parentTaskId: "root", conversationId: null },
    };
    const ids = selectQueuedStarts({
      queued: [
        { id: "f1", status: "queued", parentTaskId: "root", conversationId: null },
        { id: "f2", status: "queued", parentTaskId: "root", conversationId: null },
      ],
      runningIds: new Set(),
      maxConcurrent: 5,
      resolveParent: (id) => byId[id] ?? null,
    });
    expect(ids).toEqual(["f1"]);
  });
});

describe("shouldSkipStart", () => {
  it("skips paused, running, at capacity, conversation busy, non-queued", () => {
    expect(
      shouldSkipStart({
        paused: true,
        alreadyRunning: false,
        atCapacity: false,
        status: "queued",
      }),
    ).toBe(true);
    expect(
      shouldSkipStart({
        paused: false,
        alreadyRunning: true,
        atCapacity: false,
        status: "queued",
      }),
    ).toBe(true);
    expect(
      shouldSkipStart({
        paused: false,
        alreadyRunning: false,
        atCapacity: true,
        status: "queued",
      }),
    ).toBe(true);
    expect(
      shouldSkipStart({
        paused: false,
        alreadyRunning: false,
        atCapacity: false,
        conversationBusy: true,
        status: "queued",
      }),
    ).toBe(true);
    expect(
      shouldSkipStart({
        paused: false,
        alreadyRunning: false,
        atCapacity: false,
        status: "running",
      }),
    ).toBe(true);
    expect(
      shouldSkipStart({
        paused: false,
        alreadyRunning: false,
        atCapacity: false,
        status: "queued",
      }),
    ).toBe(false);
  });
});
