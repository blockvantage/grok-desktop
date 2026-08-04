import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueOffline,
  flushOfflineQueue,
  isOfflineQueueableMethod,
  parseOfflineQueue,
  serializeOfflineQueue,
} from "@grokdesk/shared/remote";
import {
  clearOfflineQueue,
  loadOfflineQueue,
  saveOfflineQueue,
} from "../storage/offline-queue";

describe("mobile offline queue storage + flush (shipped path)", () => {
  beforeEach(async () => {
    await clearOfflineQueue();
  });

  it("persists queue across load/save", async () => {
    let q = enqueueOffline([], "memory.upsert", {
      kind: "preference",
      title: "Theme",
      content: "dark",
    });
    q = enqueueOffline(q, "schedule.setEnabled", { id: "rule-1", enabled: false });
    await saveOfflineQueue(q);
    const loaded = await loadOfflineQueue();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.method).toBe("memory.upsert");
    expect(loaded[1]!.params).toEqual({ id: "rule-1", enabled: false });
  });

  it("flush while offline-simulated sends in order then clears durable store", async () => {
    let q = enqueueOffline([], "memory.upsert", {
      kind: "now",
      title: "Note",
      content: "hello",
    });
    q = enqueueOffline(q, "memory.delete", { id: "m-old" });
    await saveOfflineQueue(q);

    const order: string[] = [];
    const send = vi.fn(async (method: string, params: unknown) => {
      order.push(method);
      return { ok: true, params };
    });

    const items = await loadOfflineQueue();
    const result = await flushOfflineQueue(items, send);
    expect(result.error).toBeUndefined();
    expect(result.remaining).toEqual([]);
    expect(order).toEqual(["memory.upsert", "memory.delete"]);
    await saveOfflineQueue(result.remaining);
    expect(await loadOfflineQueue()).toEqual([]);
  });

  it("clearOfflineQueue wipes durable store (unpair/revoke hygiene)", async () => {
    let q = enqueueOffline([], "memory.upsert", {
      kind: "now",
      title: "x",
      content: "y",
    });
    await saveOfflineQueue(q);
    expect(await loadOfflineQueue()).toHaveLength(1);
    await clearOfflineQueue();
    expect(await loadOfflineQueue()).toEqual([]);
  });

  it("does not treat telepresence as queueable (no pretend success path)", () => {
    expect(isOfflineQueueableMethod("remote.telepresence.start")).toBe(false);
    expect(isOfflineQueueableMethod("remote.telepresence.input")).toBe(false);
    expect(() =>
      parseOfflineQueue(
        serializeOfflineQueue([
          {
            id: "x",
            method: "remote.telepresence.start",
            params: {},
            createdAt: 1,
          } as never,
        ]),
      ),
    ).not.toThrow();
    // parse drops invalid method even if forced into JSON
    const forced = JSON.stringify([
      {
        id: "x",
        method: "remote.telepresence.start",
        params: {},
        createdAt: 1,
      },
    ]);
    expect(parseOfflineQueue(forced)).toEqual([]);
  });
});
