import { describe, expect, it } from "vitest";
import {
  claimDurable,
  completeDurableSend,
  editDurable,
  emptyQueueStore,
  enqueueDurable,
  loadQueueStore,
  markDurablePending,
  purgeLastRemoved,
  QUEUE_CLAIM_LEASE_MS,
  queueForConversation,
  recoverExpiredClaims,
  releaseRecoveringClaims,
  removeDurableWithUndo,
  saveQueueStore,
  undoLastRemove,
} from "./message-queue-store";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
  } as Storage;
}

describe("message-queue-store", () => {
  it("persists by conversation across load/save", () => {
    const storage = memStorage();
    let store = emptyQueueStore();
    store = enqueueDurable(store, "c1", "hello", ["/a.png"]);
    store = enqueueDurable(store, "c2", "other");
    saveQueueStore(store, storage);
    const loaded = loadQueueStore(storage);
    expect(queueForConversation(loaded, "c1").map((m) => m.text)).toEqual([
      "hello",
    ]);
    expect(queueForConversation(loaded, "c1")[0]?.attachmentPaths).toEqual([
      "/a.png",
    ]);
    expect(queueForConversation(loaded, "c2")).toHaveLength(1);
    const item = queueForConversation(loaded, "c1")[0]!;
    expect(item.clientMutationId).toBe(item.id);
    expect(item.claimedAt).toBeNull();
  });

  it("edits text and attachments while pending", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "old");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = editDurable(store, "c1", id, {
      text: "new",
      attachmentPaths: ["/x.png"],
    });
    const m = queueForConversation(store, "c1")[0]!;
    expect(m.text).toBe("new");
    expect(m.attachmentPaths).toEqual(["/x.png"]);
  });

  it("can add and clear attachmentPaths via editDurable (product edit path)", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "with files", [
      "/a.png",
    ]);
    const id = queueForConversation(store, "c1")[0]!.id;
    // Add second attachment (as queue UI does after pickFiles)
    store = editDurable(store, "c1", id, {
      attachmentPaths: ["/a.png", "/b.pdf"],
    });
    expect(queueForConversation(store, "c1")[0]?.attachmentPaths).toEqual([
      "/a.png",
      "/b.pdf",
    ]);
    // Remove one attachment
    store = editDurable(store, "c1", id, {
      attachmentPaths: ["/b.pdf"],
    });
    expect(queueForConversation(store, "c1")[0]?.attachmentPaths).toEqual([
      "/b.pdf",
    ]);
    // Clear all attachments
    store = editDurable(store, "c1", id, { attachmentPaths: [] });
    expect(queueForConversation(store, "c1")[0]?.attachmentPaths).toBeUndefined();
  });

  it("only one claim path can own a submitting item", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "once");
    const id = queueForConversation(store, "c1")[0]!.id;
    const claimedAt = Date.parse("2026-07-15T12:00:00.000Z");
    const a = claimDurable(store, "c1", id, claimedAt);
    expect(a.item?.status).toBe("submitting");
    expect(a.item?.claimedAt).toBe(new Date(claimedAt).toISOString());
    store = a.store;
    const b = claimDurable(store, "c1", id);
    expect(b.item).toBeNull();
    const auto = claimDurable(store, "c1");
    expect(auto.item).toBeNull();
  });

  it("complete sent removes; failed marks failed", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "x");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = claimDurable(store, "c1", id).store;
    store = completeDurableSend(store, "c1", id, "failed");
    expect(queueForConversation(store, "c1")[0]?.status).toBe("failed");
    store = markDurablePending(store, "c1", id);
    store = claimDurable(store, "c1", id).store;
    store = completeDurableSend(store, "c1", id, "sent");
    expect(queueForConversation(store, "c1")).toHaveLength(0);
  });

  it("remove supports undo at the original index", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "a");
    store = enqueueDurable(store, "c1", "b");
    store = enqueueDurable(store, "c1", "c");
    const mid = queueForConversation(store, "c1")[1]!.id;
    store = removeDurableWithUndo(store, "c1", mid);
    expect(queueForConversation(store, "c1").map((m) => m.text)).toEqual([
      "a",
      "c",
    ]);
    store = undoLastRemove(store);
    expect(queueForConversation(store, "c1").map((m) => m.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("purgeLastRemoved drops the undo stash", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "bye");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = removeDurableWithUndo(store, "c1", id);
    expect(store.lastRemoved?.id).toBe(id);
    store = purgeLastRemoved(store);
    expect(store.lastRemoved).toBeNull();
    store = undoLastRemove(store);
    expect(queueForConversation(store, "c1")).toHaveLength(0);
  });

  it("id-scoped undo/purge ignore a superseded stash (two quick deletes)", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "a");
    store = enqueueDurable(store, "c1", "b");
    const aId = queueForConversation(store, "c1")[0]!.id;
    const bId = queueForConversation(store, "c1")[1]!.id;
    // Delete A, then B before A's toast expires — the stash now holds B.
    store = removeDurableWithUndo(store, "c1", aId);
    store = removeDurableWithUndo(store, "c1", bId);
    expect(store.lastRemoved?.id).toBe(bId);
    // A's stale purge timer must NOT evict B's stash.
    store = purgeLastRemoved(store, aId);
    expect(store.lastRemoved?.id).toBe(bId);
    // A's stale Undo must NOT resurrect B.
    store = undoLastRemove(store, aId);
    expect(queueForConversation(store, "c1").map((m) => m.text)).toEqual([]);
    // B's own Undo restores B.
    store = undoLastRemove(store, bId);
    expect(queueForConversation(store, "c1").map((m) => m.text)).toEqual(["b"]);
  });

  it("preserves an unexpired submitting claim across load", () => {
    const storage = memStorage();
    let store = enqueueDurable(emptyQueueStore(), "c1", "mid");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = claimDurable(store, "c1", id).store;
    saveQueueStore(store, storage);
    const loaded = loadQueueStore(storage);
    expect(queueForConversation(loaded, "c1")[0]?.status).toBe("submitting");
  });

  it("makes an expired lease observably recovering before it is pending", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    let store = enqueueDurable(emptyQueueStore(), "c1", "mid");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = claimDurable(store, "c1", id, now).store;

    store = recoverExpiredClaims(store, now + QUEUE_CLAIM_LEASE_MS - 1);
    expect(queueForConversation(store, "c1")[0]?.status).toBe("submitting");

    store = recoverExpiredClaims(store, now + QUEUE_CLAIM_LEASE_MS);
    const recovered = queueForConversation(store, "c1")[0]!;
    expect(recovered.status).toBe("recovering");
    expect(recovered.claimedAt).toBeNull();

    store = releaseRecoveringClaims(store, "c1");
    expect(queueForConversation(store, "c1")[0]).toMatchObject({
      status: "pending",
      claimedAt: null,
      clientMutationId: recovered.clientMutationId,
    });
  });

  it("releases recovery only for the conversation that observed it", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    let store = enqueueDurable(emptyQueueStore(), "c1", "first");
    store = enqueueDurable(store, "c2", "second");
    for (const conversationId of ["c1", "c2"]) {
      const id = queueForConversation(store, conversationId)[0]!.id;
      store = claimDurable(store, conversationId, id, now).store;
    }
    store = recoverExpiredClaims(store, now + QUEUE_CLAIM_LEASE_MS);

    store = releaseRecoveringClaims(store, "c1");

    expect(queueForConversation(store, "c1")[0]?.status).toBe("pending");
    expect(queueForConversation(store, "c2")[0]?.status).toBe("recovering");
  });

  it("locks recovering items against claim, edit, and removal", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    let store = enqueueDurable(emptyQueueStore(), "c1", "recover safely");
    const original = queueForConversation(store, "c1")[0]!;
    store = claimDurable(store, "c1", original.id, now).store;
    store = recoverExpiredClaims(store, now + QUEUE_CLAIM_LEASE_MS);

    expect(claimDurable(store, "c1", original.id).item).toBeNull();
    expect(
      queueForConversation(
        editDurable(store, "c1", original.id, { text: "changed" }),
        "c1",
      )[0]?.text,
    ).toBe("recover safely");
    expect(
      queueForConversation(
        removeDurableWithUndo(store, "c1", original.id),
        "c1",
      ),
    ).toHaveLength(1);
  });

  it("caps the queue by evicting the oldest PENDING message, not the front", () => {
    let store = emptyQueueStore();
    // Fill to the cap of 3 with pending messages a, b, c.
    for (const t of ["a", "b", "c"]) {
      store = enqueueDurable(store, "c1", t, undefined, 3);
    }
    // A 4th push drops the oldest pending ("a"), keeping the cap at 3.
    store = enqueueDurable(store, "c1", "d", undefined, 3);
    expect(queueForConversation(store, "c1").map((m) => m.text)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("never evicts an in-flight (submitting) message when at capacity", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    let store = emptyQueueStore();
    for (const t of ["a", "b", "c"]) {
      store = enqueueDurable(store, "c1", t, undefined, 3);
    }
    // Claim the OLDEST ("a") so it is mid-send with a live lease.
    const aId = queueForConversation(store, "c1")[0]!.id;
    store = claimDurable(store, "c1", aId, now).store;
    // A new push at capacity must protect the in-flight "a" and instead drop
    // the oldest *pending* row ("b").
    store = enqueueDurable(store, "c1", "d", undefined, 3);
    const rows = queueForConversation(store, "c1");
    expect(rows.map((m) => m.text)).toEqual(["a", "c", "d"]);
    expect(rows.find((m) => m.text === "a")?.status).toBe("submitting");
  });

  it("refuses a new message when the queue is full of locked/failed rows", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    let store = emptyQueueStore();
    // Two failed + one in-flight, all at a cap of 3 → nothing pending to evict.
    store = enqueueDurable(store, "c1", "f1", undefined, 3);
    store = enqueueDurable(store, "c1", "f2", undefined, 3);
    store = enqueueDurable(store, "c1", "live", undefined, 3);
    const [f1, f2, live] = queueForConversation(store, "c1").map((m) => m.id);
    store = completeDurableSend(store, "c1", f1!, "failed");
    store = completeDurableSend(store, "c1", f2!, "failed");
    store = claimDurable(store, "c1", live!, now).store;
    // Back-pressure: the new message is refused rather than clobbering a failed
    // or in-flight row. The user keeps their draft; nothing is silently lost.
    const after = enqueueDurable(store, "c1", "overflow", undefined, 3);
    expect(queueForConversation(after, "c1").map((m) => m.text)).toEqual([
      "f1",
      "f2",
      "live",
    ]);
  });

  it("marks only failed items pending for an explicit retry", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    let store = enqueueDurable(emptyQueueStore(), "c1", "retry contract");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = claimDurable(store, "c1", id, now).store;

    const unchanged = markDurablePending(store, "c1", id);
    expect(queueForConversation(unchanged, "c1")[0]).toMatchObject({
      status: "submitting",
      claimedAt: new Date(now).toISOString(),
    });

    store = completeDurableSend(store, "c1", id, "failed");
    store = markDurablePending(store, "c1", id);
    expect(queueForConversation(store, "c1")[0]).toMatchObject({
      status: "pending",
      claimedAt: null,
    });
  });

  it("drops the conversation key when the last queued item sends", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "only one");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = completeDurableSend(store, "c1", id, "sent");
    expect(queueForConversation(store, "c1")).toEqual([]);
    // Key removed, not left as an empty array that accumulates forever.
    expect(Object.keys(store.byConversation)).not.toContain("c1");
  });

  it("drops the conversation key on remove but still restores via undo", () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "only one");
    const id = queueForConversation(store, "c1")[0]!.id;
    store = removeDurableWithUndo(store, "c1", id);
    expect(Object.keys(store.byConversation)).not.toContain("c1");
    store = undoLastRemove(store, id);
    expect(queueForConversation(store, "c1").map((m) => m.text)).toEqual([
      "only one",
    ]);
  });

  it("prunes empty conversation arrays on load", () => {
    const storage = memStorage();
    storage.setItem(
      "grokdesk.queue.v1",
      JSON.stringify({
        byConversation: { emptyA: [], emptyB: [] },
        lastRemoved: null,
        lastRemovedIndex: null,
      }),
    );
    const loaded = loadQueueStore(storage);
    expect(Object.keys(loaded.byConversation)).toEqual([]);
  });
});
