import { describe, expect, it, vi } from "vitest";
import {
  createOfflineQueueItem,
  enqueueOffline,
  flushOfflineQueue,
  isOfflineQueueableMethod,
  OFFLINE_QUEUE_MAX_ITEMS,
  parseOfflineQueue,
  serializeOfflineQueue,
} from "./remote-offline-queue.js";

describe("remote-offline-queue", () => {
  it("allows only safe subset", () => {
    expect(isOfflineQueueableMethod("memory.upsert")).toBe(true);
    expect(isOfflineQueueableMethod("memory.delete")).toBe(true);
    expect(isOfflineQueueableMethod("schedule.setEnabled")).toBe(true);
    expect(isOfflineQueueableMethod("schedule.create")).toBe(false);
    expect(isOfflineQueueableMethod("remote.telepresence.start")).toBe(false);
    expect(isOfflineQueueableMethod("tasks.list")).toBe(false);
  });

  it("evicts oldest items past OFFLINE_QUEUE_MAX_ITEMS", () => {
    let q: ReturnType<typeof enqueueOffline> = [];
    for (let i = 0; i < OFFLINE_QUEUE_MAX_ITEMS + 5; i++) {
      q = enqueueOffline(q, "memory.delete", { id: `m${i}` }, `q${i}`);
    }
    expect(q).toHaveLength(OFFLINE_QUEUE_MAX_ITEMS);
    expect(q[0]!.id).toBe("q5");
    expect(q[q.length - 1]!.id).toBe(`q${OFFLINE_QUEUE_MAX_ITEMS + 4}`);
  });

  it("refuses to create non-queueable items", () => {
    expect(() =>
      createOfflineQueueItem("remote.telepresence.start", {}),
    ).toThrow(/not offline-queueable/);
  });

  it("refuses oversized offline params", () => {
    expect(() =>
      createOfflineQueueItem("memory.upsert", {
        kind: "preference",
        title: "big",
        content: "x".repeat(20_000),
      }),
    ).toThrow(/too large/);
  });

  it("serialize/parse round-trips FIFO order", () => {
    let q = enqueueOffline([], "memory.upsert", {
      kind: "preference",
      title: "A",
      content: "1",
    });
    q = enqueueOffline(q, "schedule.setEnabled", { id: "r1", enabled: false });
    const raw = serializeOfflineQueue(q);
    const back = parseOfflineQueue(raw);
    expect(back).toHaveLength(2);
    expect(back[0]!.method).toBe("memory.upsert");
    expect(back[1]!.method).toBe("schedule.setEnabled");
    expect(back[0]!.params).toEqual({
      kind: "preference",
      title: "A",
      content: "1",
    });
  });

  it("parse drops invalid / non-queueable entries", () => {
    const raw = JSON.stringify([
      {
        id: "1",
        method: "memory.upsert",
        params: { kind: "now", title: "x", content: "y" },
        createdAt: 1,
      },
      { id: "2", method: "tasks.create", params: {}, createdAt: 2 },
      { bad: true },
    ]);
    expect(parseOfflineQueue(raw)).toHaveLength(1);
    expect(parseOfflineQueue(null)).toEqual([]);
    expect(parseOfflineQueue("not-json")).toEqual([]);
  });

  it("flush drops poison permanent errors and continues (CX-5)", async () => {
    const sent: string[] = [];
    const send = vi.fn(async (method: string) => {
      sent.push(method);
      if (method === "memory.delete") {
        throw new Error("permanent fail — not found");
      }
      return { ok: true };
    });

    const items = [
      createOfflineQueueItem("memory.upsert", { kind: "now", title: "a", content: "b" }, "q1"),
      createOfflineQueueItem("memory.delete", { id: "m1" }, "q2"),
      createOfflineQueueItem("schedule.setEnabled", { id: "s1", enabled: true }, "q3"),
    ];

    const result = await flushOfflineQueue(items, send);
    expect(sent).toEqual(["memory.upsert", "memory.delete", "schedule.setEnabled"]);
    // poison item dropped, rest flushed — queue empty
    expect(result.remaining).toEqual([]);
    expect(result.flushed.map((i) => i.id)).toEqual(["q1", "q2", "q3"]);
    expect(result.error).toMatch(/permanent fail|not found/i);
  });

  it("flush keeps remaining on transient transport failure (CX-5)", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "memory.delete") {
        throw new Error("timeout memory.delete — desk did not answer");
      }
      return { ok: true };
    });
    const items = [
      createOfflineQueueItem("memory.upsert", { kind: "now", title: "a", content: "b" }, "q1"),
      createOfflineQueueItem("memory.delete", { id: "m1" }, "q2"),
      createOfflineQueueItem("schedule.setEnabled", { id: "s1", enabled: true }, "q3"),
    ];
    const result = await flushOfflineQueue(items, send);
    expect(result.flushed.map((i) => i.id)).toEqual(["q1"]);
    expect(result.remaining.map((i) => i.id)).toEqual(["q2", "q3"]);
    expect(result.error).toMatch(/timeout|did not answer/i);
  });

  it("flush clears entire queue on full success", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const items = [
      createOfflineQueueItem("memory.upsert", { kind: "brand", title: "b", content: "c" }),
      createOfflineQueueItem("schedule.setEnabled", { id: "x", enabled: false }),
    ];
    const result = await flushOfflineQueue(items, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.flushed).toHaveLength(2);
    expect(result.remaining).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});
