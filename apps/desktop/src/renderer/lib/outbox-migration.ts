/**
 * One-time migration of localStorage `grokdesk.queue.v1` into the gateway
 * conversation outbox. Restart-safe via stable clientMutationId replay.
 * Never truncates local data on failure — incomplete migration keeps the
 * local snapshot and returns a recovery notice.
 */
import type { OutboxEnqueueResult } from "@grokdesk/shared";
import {
  emptyQueueStore,
  loadQueueStore,
  saveQueueStore,
  type DurableQueuedMessage,
  type QueueStoreSnapshot,
} from "./message-queue-store";
import { attachmentsFromQueuedPaths } from "./message-queue";

export const OUTBOX_MIGRATION_FLAG_KEY = "grokdesk.outbox.migrated.v1";
export const OUTBOX_MIGRATION_NOTICE_KEY = "grokdesk.outbox.migration-notice.v1";

export type OutboxMigrationRpc = (
  method: "outbox.enqueue",
  params: Record<string, unknown>,
) => Promise<OutboxEnqueueResult>;

export type OutboxMigrationResult =
  | { status: "already_complete" }
  | { status: "nothing_to_migrate" }
  | {
      status: "complete";
      migrated: number;
    }
  | {
      status: "partial";
      migrated: number;
      remaining: number;
      reason: "full" | "persistence_failed" | "error";
      message: string;
    };

function migrationComplete(
  storage: Pick<Storage, "getItem" | "setItem">,
): boolean {
  return storage.getItem(OUTBOX_MIGRATION_FLAG_KEY) === "1";
}

export function markMigrationComplete(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  storage.setItem(OUTBOX_MIGRATION_FLAG_KEY, "1");
  storage.removeItem(OUTBOX_MIGRATION_NOTICE_KEY);
}

export function setMigrationNotice(
  storage: Pick<Storage, "setItem">,
  message: string,
): void {
  storage.setItem(OUTBOX_MIGRATION_NOTICE_KEY, message);
}

export function readMigrationNotice(
  storage: Pick<Storage, "getItem"> | null,
): string | null {
  if (!storage) return null;
  return storage.getItem(OUTBOX_MIGRATION_NOTICE_KEY);
}

/**
 * Replay every local queue item through outbox.enqueue with its existing
 * clientMutationId. Remove each local row only after gateway acceptance.
 */
export async function migrateLocalQueueToOutbox(opts: {
  rpc: OutboxMigrationRpc;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Resolve parent task for a conversation root (usually the root task id). */
  parentTaskIdForConversation: (conversationId: string) => string | null;
}): Promise<OutboxMigrationResult> {
  const storage =
    opts.storage ??
    (typeof localStorage !== "undefined" ? localStorage : null);
  if (!storage) return { status: "nothing_to_migrate" };
  if (migrationComplete(storage)) return { status: "already_complete" };

  let store = loadQueueStore(storage);
  const entries = Object.entries(store.byConversation);
  if (entries.length === 0 && !store.lastRemoved) {
    markMigrationComplete(storage);
    return { status: "nothing_to_migrate" };
  }

  let migrated = 0;
  let remaining = 0;

  for (const [conversationId, list] of entries) {
    const parentTaskId = opts.parentTaskIdForConversation(conversationId);
    const kept: DurableQueuedMessage[] = [];
    for (const item of list) {
      if (!parentTaskId) {
        kept.push(item);
        remaining += 1;
        continue;
      }
      try {
        const result = await opts.rpc("outbox.enqueue", {
          id: item.clientMutationId || item.id,
          conversationId,
          parentTaskId,
          text: item.text,
          attachments:
            attachmentsFromQueuedPaths(item.attachmentPaths ?? []) ?? [],
        });
        if (result.outcome === "accepted") {
          migrated += 1;
          continue;
        }
        kept.push(item);
        remaining += 1;
        // Persist remaining and stop with structured reason.
        const next: QueueStoreSnapshot = {
          ...store,
          byConversation: {
            ...store.byConversation,
            [conversationId]: [...kept, ...list.slice(list.indexOf(item) + 1)],
          },
        };
        // Keep unmigrated tail too.
        const tail = list.slice(list.indexOf(item) + 1);
        next.byConversation[conversationId] = [...kept, ...tail];
        if (next.byConversation[conversationId]!.length === 0) {
          delete next.byConversation[conversationId];
        }
        saveQueueStore(next, storage as Storage);
        const reason =
          result.outcome === "full" ? "full" : "persistence_failed";
        const message =
          result.outcome === "full"
            ? `outbox full (limit ${result.limit})`
            : result.message;
        setMigrationNotice(storage, message);
        return {
          status: "partial",
          migrated,
          remaining: remaining + tail.length,
          reason,
          message,
        };
      } catch (e) {
        kept.push(item);
        remaining += 1;
        const nextList = [...kept, ...list.slice(list.indexOf(item) + 1)];
        const next: QueueStoreSnapshot = {
          ...store,
          byConversation: {
            ...store.byConversation,
            [conversationId]: nextList,
          },
        };
        saveQueueStore(next, storage as Storage);
        const message = e instanceof Error ? e.message : "migration error";
        setMigrationNotice(storage, message);
        return {
          status: "partial",
          migrated,
          remaining: nextList.length,
          reason: "error",
          message,
        };
      }
    }
    if (kept.length === 0) {
      const { [conversationId]: _, ...rest } = store.byConversation;
      store = { ...store, byConversation: rest };
    } else {
      store = {
        ...store,
        byConversation: {
          ...store.byConversation,
          [conversationId]: kept,
        },
      };
    }
    saveQueueStore(store, storage as Storage);
  }

  // Clear undo stash only after queues are empty — do not drop recoverable undo.
  if (Object.keys(store.byConversation).length === 0) {
    store = emptyQueueStore();
    saveQueueStore(store, storage as Storage);
    markMigrationComplete(storage);
    return { status: "complete", migrated };
  }

  setMigrationNotice(
    storage,
    "Some queued messages could not be migrated yet",
  );
  return {
    status: "partial",
    migrated,
    remaining: Object.values(store.byConversation).reduce(
      (n, list) => n + list.length,
      0,
    ),
    reason: "error",
    message: "parent task unresolved for some conversations",
  };
}
