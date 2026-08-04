/**
 * P0: at most one active run per conversation; different conversations may
 * still fill the global concurrency cap.
 */
import { describe, it, expect } from "vitest";
import {
  selectQueuedStarts,
  shouldSkipStart,
  threadKeyForTask,
} from "../services/concurrency.js";

describe("conversation-serialization (P0)", () => {
  it("two queued follow-ups in one conversation produce one start", () => {
    const starts = selectQueuedStarts({
      queued: [
        {
          id: "f1",
          status: "queued",
          conversationId: "conv-1",
          parentTaskId: "root",
        },
        {
          id: "f2",
          status: "queued",
          conversationId: "conv-1",
          parentTaskId: "root",
        },
      ],
      runningIds: new Set(),
      maxConcurrent: 3,
    });
    expect(starts).toEqual(["f1"]);
  });

  it("tasks in different conversations fill available slots", () => {
    const starts = selectQueuedStarts({
      queued: [
        { id: "a", status: "queued", conversationId: "c-a" },
        { id: "b", status: "queued", conversationId: "c-b" },
        { id: "c", status: "queued", conversationId: "c-c" },
      ],
      runningIds: new Set(),
      maxConcurrent: 2,
    });
    expect(starts).toEqual(["a", "b"]);
  });

  it("start admission skips when conversation peer is running", () => {
    expect(
      shouldSkipStart({
        paused: false,
        alreadyRunning: false,
        atCapacity: false,
        status: "queued",
        conversationBusy: true,
      }),
    ).toBe(true);
  });

  it("legacy NULL conversation_id serializes by root without blocking unrelated", () => {
    const byId: Record<
      string,
      { id: string; parentTaskId: string | null; conversationId: null }
    > = {
      r1: { id: "r1", parentTaskId: null, conversationId: null },
      r2: { id: "r2", parentTaskId: null, conversationId: null },
      c1: { id: "c1", parentTaskId: "r1", conversationId: null },
      c2: { id: "c2", parentTaskId: "r2", conversationId: null },
    };
    expect(threadKeyForTask(byId.c1!, (id) => byId[id] ?? null)).toBe(
      "root:r1",
    );
    expect(threadKeyForTask(byId.c2!, (id) => byId[id] ?? null)).toBe(
      "root:r2",
    );
    const starts = selectQueuedStarts({
      queued: [
        { id: "c1", status: "queued", parentTaskId: "r1", conversationId: null },
        { id: "c2", status: "queued", parentTaskId: "r2", conversationId: null },
      ],
      runningIds: new Set(),
      maxConcurrent: 3,
      resolveParent: (id) => byId[id] ?? null,
    });
    expect(starts).toEqual(["c1", "c2"]);
  });

  it("run intervals for same-conversation follow-ups do not overlap (selector model)", () => {
    // Model rapid double-submit: first selected while second waits; after first
    // enters running set, second still blocked; after first leaves, second starts.
    const timeline: string[] = [];
    let running = new Set<string>();
    const queued = [
      { id: "f1", status: "queued", conversationId: "c", parentTaskId: "r" },
      { id: "f2", status: "queued", conversationId: "c", parentTaskId: "r" },
    ];

    const tick = (label: string) => {
      const ids = selectQueuedStarts({
        queued: queued.filter((q) => !running.has(q.id) && q.status === "queued"),
        runningIds: running,
        maxConcurrent: 3,
        resolveTask: (id) => ({
          id,
          conversationId: "c",
          parentTaskId: "r",
        }),
      });
      for (const id of ids) {
        timeline.push(`${label}:start:${id}`);
        running.add(id);
        const q = queued.find((x) => x.id === id);
        if (q) q.status = "running";
      }
    };

    tick("t0");
    expect(timeline).toEqual(["t0:start:f1"]);
    tick("t1"); // still only f1 running
    expect(timeline).toEqual(["t0:start:f1"]);

    // Complete f1
    running.delete("f1");
    queued[0]!.status = "done";
    tick("t2");
    expect(timeline).toEqual(["t0:start:f1", "t2:start:f2"]);
  });
});
