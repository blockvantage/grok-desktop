import { describe, it, expect, beforeEach } from "vitest";
import {
  migrateLocalQueueToOutbox,
  OUTBOX_MIGRATION_FLAG_KEY,
  readMigrationNotice,
} from "./outbox-migration";
import {
  emptyQueueStore,
  enqueueDurable,
  saveQueueStore,
  type QueueStoreSnapshot,
} from "./message-queue-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    _map: map,
  };
}

describe("migrateLocalQueueToOutbox", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("marks complete when nothing to migrate", async () => {
    const r = await migrateLocalQueueToOutbox({
      storage,
      rpc: async () => ({ outcome: "accepted", item: {} as never }),
      parentTaskIdForConversation: () => "t1",
    });
    expect(r.status).toBe("nothing_to_migrate");
    expect(storage.getItem(OUTBOX_MIGRATION_FLAG_KEY)).toBe("1");
  });

  it("replays items with stable ids and clears local on success", async () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "hello");
    store = enqueueDurable(store, "c1", "world");
    saveQueueStore(store, storage as unknown as Storage);
    const ids: string[] = [];
    const r = await migrateLocalQueueToOutbox({
      storage,
      rpc: async (_m, params) => {
        ids.push(String(params.id));
        return {
          outcome: "accepted",
          item: {
            id: String(params.id),
            conversationId: "c1",
            parentTaskId: "t1",
            text: String(params.text),
            attachments: [],
            status: "pending",
            position: 1,
            acceptedTaskId: null,
            attemptCount: 0,
            failReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
      parentTaskIdForConversation: () => "t1",
    });
    expect(r).toEqual({ status: "complete", migrated: 2 });
    expect(ids).toHaveLength(2);
    expect(storage.getItem(OUTBOX_MIGRATION_FLAG_KEY)).toBe("1");
    // Local queue emptied.
    const raw = storage.getItem("grokdesk.queue.v1");
    if (raw) {
      const parsed = JSON.parse(raw) as QueueStoreSnapshot;
      expect(Object.keys(parsed.byConversation ?? {})).toHaveLength(0);
    }
  });

  it("keeps local snapshot on capacity and is restart-safe", async () => {
    let store = enqueueDurable(emptyQueueStore(), "c1", "a");
    store = enqueueDurable(store, "c1", "b");
    saveQueueStore(store, storage as unknown as Storage);
    let calls = 0;
    const r = await migrateLocalQueueToOutbox({
      storage,
      rpc: async (_m, params) => {
        calls += 1;
        if (calls === 1) {
          return {
            outcome: "accepted",
            item: {
              id: String(params.id),
              conversationId: "c1",
              parentTaskId: "t1",
              text: String(params.text),
              attachments: [],
              status: "pending",
              position: 1,
              acceptedTaskId: null,
              attemptCount: 0,
              failReason: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
        }
        return { outcome: "full", limit: 200 };
      },
      parentTaskIdForConversation: () => "t1",
    });
    expect(r.status).toBe("partial");
    if (r.status === "partial") {
      expect(r.migrated).toBe(1);
      expect(r.remaining).toBeGreaterThan(0);
      expect(r.reason).toBe("full");
    }
    expect(storage.getItem(OUTBOX_MIGRATION_FLAG_KEY)).toBeNull();
    expect(readMigrationNotice(storage)).toMatch(/full/i);

    // Same-id replay on retry (restart-safe).
    const second = await migrateLocalQueueToOutbox({
      storage,
      rpc: async (_m, params) => ({
        outcome: "accepted",
        item: {
          id: String(params.id),
          conversationId: "c1",
          parentTaskId: "t1",
          text: String(params.text),
          attachments: [],
          status: "pending",
          position: 1,
          acceptedTaskId: null,
          attemptCount: 0,
          failReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      parentTaskIdForConversation: () => "t1",
    });
    expect(second.status).toBe("complete");
  });
});
