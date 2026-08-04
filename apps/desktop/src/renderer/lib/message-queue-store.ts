/**
 * Durable queued messages keyed by conversation id.
 * Survives navigation, task replacement, and app restart (localStorage).
 */

import type { QueuedMessage } from "./message-queue";
import { createQueuedMessage } from "./message-queue";

export type DurableQueuedMessageStatus =
  | "pending"
  | "submitting"
  | "recovering"
  | "failed";

export type DurableQueueFailReason = "missing_attachment" | "send_failed";

export type DurableQueuedMessage = Omit<QueuedMessage, "status"> & {
  /** Conversation root this queue belongs to. */
  conversationId: string;
  status: DurableQueuedMessageStatus;
  /** Stable gateway idempotency key for this queued create. */
  clientMutationId: string;
  /** ISO timestamp for the active submission lease. */
  claimedAt: string | null;
  /** Why a failed row needs attention (CHAT-5 missing files, send error). */
  failReason?: DurableQueueFailReason | null;
};

export type QueueStoreSnapshot = {
  byConversation: Record<string, DurableQueuedMessage[]>;
  /** Soft-deleted item for Undo. */
  lastRemoved: DurableQueuedMessage | null;
  /** Index within the conversation queue where lastRemoved lived. */
  lastRemovedIndex: number | null;
};

const STORAGE_KEY = "grokdesk.queue.v1";
export const QUEUE_CLAIM_LEASE_MS = 2 * 60_000;
/** Hard cap on conversations and items loaded from localStorage. */
export const QUEUE_MAX_CONVERSATIONS = 50;
export const QUEUE_MAX_ITEMS_PER_CONVERSATION = 20;
export const QUEUE_MAX_TEXT_CHARS = 32_000;
export const QUEUE_MAX_ATTACHMENT_PATHS = 10;
const queueStoreListeners = new Set<(store: QueueStoreSnapshot) => void>();

export function subscribeQueueStore(
  listener: (store: QueueStoreSnapshot) => void,
): () => void {
  queueStoreListeners.add(listener);
  return () => queueStoreListeners.delete(listener);
}

export function emptyQueueStore(): QueueStoreSnapshot {
  return { byConversation: {}, lastRemoved: null, lastRemovedIndex: null };
}

export function loadQueueStore(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): QueueStoreSnapshot {
  if (!storage) return emptyQueueStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyQueueStore();
    // localStorage is typically ~5MB; refuse absurd blobs before JSON.parse.
    if (raw.length > 2_000_000) return emptyQueueStore();
    const parsed = JSON.parse(raw) as Partial<QueueStoreSnapshot>;
    const byConversation: Record<string, DurableQueuedMessage[]> = {};
    if (parsed.byConversation && typeof parsed.byConversation === "object") {
      const entries = Object.entries(parsed.byConversation).slice(
        0,
        QUEUE_MAX_CONVERSATIONS,
      );
      for (const [cid, list] of entries) {
        if (typeof cid !== "string" || cid.length > 128) continue;
        if (!Array.isArray(list)) continue;
        const items = list
          .filter((m) => m && typeof m === "object" && typeof m.id === "string")
          .slice(0, QUEUE_MAX_ITEMS_PER_CONVERSATION)
          .map((m) => normalizeDurable(m as DurableQueuedMessage, cid));
        // Prune empty conversation keys on load so historical empties don't
        // linger and grow the persisted blob toward the quota.
        if (items.length > 0) byConversation[cid] = items;
      }
    }
    const lastRemovedIndex =
      typeof parsed.lastRemovedIndex === "number" &&
      Number.isFinite(parsed.lastRemovedIndex) &&
      parsed.lastRemovedIndex >= 0
        ? Math.floor(parsed.lastRemovedIndex)
        : null;
    return recoverExpiredClaims({
      byConversation,
      lastRemoved: parsed.lastRemoved
        ? normalizeDurable(
            parsed.lastRemoved as DurableQueuedMessage,
            (parsed.lastRemoved as DurableQueuedMessage).conversationId || "",
          )
        : null,
      lastRemovedIndex: parsed.lastRemoved ? lastRemovedIndex : null,
    });
  } catch {
    return emptyQueueStore();
  }
}

export function saveQueueStore(
  store: QueueStoreSnapshot,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    for (const listener of queueStoreListeners) listener(store);
  } catch {
    /* quota / private mode */
  }
}

function normalizeDurable(
  m: DurableQueuedMessage,
  conversationId: string,
): DurableQueuedMessage {
  const status: DurableQueuedMessageStatus =
    m.status === "failed" ||
    m.status === "submitting" ||
    m.status === "recovering" ||
    m.status === "pending"
      ? m.status
      : (m.status as string) === "sending"
        ? "submitting"
        : "pending";
  const claimedAtMs = Date.parse(String(m.claimedAt ?? ""));
  const failReason: DurableQueueFailReason | null | undefined =
    m.failReason === "missing_attachment" || m.failReason === "send_failed"
      ? m.failReason
      : m.failReason == null
        ? null
        : undefined;
  const text = String(m.text ?? "").slice(0, QUEUE_MAX_TEXT_CHARS);
  const attachmentPaths = Array.isArray(m.attachmentPaths)
    ? m.attachmentPaths
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => p.slice(0, 4096))
        .slice(0, QUEUE_MAX_ATTACHMENT_PATHS)
    : undefined;
  const cid = String(m.conversationId || conversationId).slice(0, 128);
  return {
    id: String(m.id).slice(0, 128),
    text,
    createdAt: m.createdAt || new Date().toISOString(),
    attachmentPaths:
      attachmentPaths && attachmentPaths.length > 0
        ? attachmentPaths
        : undefined,
    status,
    conversationId: cid,
    clientMutationId: String(m.clientMutationId || m.id).slice(0, 128),
    claimedAt: Number.isFinite(claimedAtMs)
      ? new Date(claimedAtMs).toISOString()
      : null,
    failReason: failReason ?? null,
  };
}

export function recoverExpiredClaims(
  store: QueueStoreSnapshot,
  nowMs = Date.now(),
): QueueStoreSnapshot {
  let changed = false;
  const byConversation: Record<string, DurableQueuedMessage[]> = {};
  for (const [conversationId, list] of Object.entries(store.byConversation)) {
    byConversation[conversationId] = list.map((item) => {
      if (item.status !== "submitting") return item;
      const claimedAtMs = item.claimedAt ? Date.parse(item.claimedAt) : NaN;
      if (
        Number.isFinite(claimedAtMs) &&
        nowMs - claimedAtMs < QUEUE_CLAIM_LEASE_MS
      ) {
        return item;
      }
      changed = true;
      return { ...item, status: "recovering", claimedAt: null };
    });
  }
  return changed ? { ...store, byConversation } : store;
}

/**
 * Release observably recovering claims for a fresh claim attempt.
 *
 * This is intentionally separate from `recoverExpiredClaims`: callers must
 * first persist/render the recovery phase before making an item claimable.
 */
export function releaseRecoveringClaims(
  store: QueueStoreSnapshot,
  conversationId: string,
): QueueStoreSnapshot {
  if (!conversationId) return store;
  let changed = false;
  const list = store.byConversation[conversationId] ?? [];
  const next = list.map((item) => {
    if (item.status !== "recovering") return item;
    changed = true;
    return { ...item, status: "pending" as const, claimedAt: null };
  });
  return changed
    ? {
        ...store,
        byConversation: { ...store.byConversation, [conversationId]: next },
      }
    : store;
}

export function isDurableQueueItemLocked(
  item: Pick<DurableQueuedMessage, "status">,
): boolean {
  return item.status === "submitting" || item.status === "recovering";
}

export function queueForConversation(
  store: QueueStoreSnapshot,
  conversationId: string,
): DurableQueuedMessage[] {
  if (!conversationId) return [];
  return store.byConversation[conversationId] ?? [];
}

/**
 * Assign a conversation's queue, dropping the key entirely when it empties.
 * Empty-array keys would otherwise accumulate one-per-conversation forever
 * (they are never removed once a conversation's last item sends/deletes),
 * eventually tripping the localStorage quota — after which `saveQueueStore`
 * silently drops all future writes, so queued follow-ups stop persisting.
 */
function withConversationQueue(
  byConversation: Record<string, DurableQueuedMessage[]>,
  conversationId: string,
  next: DurableQueuedMessage[],
): Record<string, DurableQueuedMessage[]> {
  const updated = { ...byConversation, [conversationId]: next };
  if (next.length === 0) delete updated[conversationId];
  return updated;
}

export function enqueueDurable(
  store: QueueStoreSnapshot,
  conversationId: string,
  text: string,
  attachmentPaths?: string[],
  max = 20,
): QueueStoreSnapshot {
  if (!conversationId) return store;
  const base = createQueuedMessage(text, attachmentPaths);
  if (!base.text) return store;
  const item: DurableQueuedMessage = {
    ...base,
    status: "pending",
    conversationId,
    clientMutationId: base.id,
    claimedAt: null,
  };
  const prev = store.byConversation[conversationId] ?? [];
  let next = [...prev, item];
  if (next.length > max) {
    // At capacity: make room by dropping the OLDEST *pending* message only.
    // A blind slice would evict whatever sits at the front — including an
    // in-flight (submitting/recovering) row, which carries a live send lease +
    // idempotency key, or a failed row the user may still retry. Losing either
    // is silent data loss. Never evict a locked or failed item; if nothing
    // pending is evictable, refuse the new message (back-pressure) instead.
    const evictIdx = next.findIndex(
      (m) => m.id !== item.id && m.status === "pending",
    );
    if (evictIdx < 0) return store;
    next = next.filter((_, i) => i !== evictIdx);
  }
  return {
    ...store,
    byConversation: { ...store.byConversation, [conversationId]: next },
  };
}

export function editDurable(
  store: QueueStoreSnapshot,
  conversationId: string,
  id: string,
  patch: { text?: string; attachmentPaths?: string[] | undefined },
): QueueStoreSnapshot {
  const list = store.byConversation[conversationId] ?? [];
  const next = list.map((m) => {
    if (m.id !== id) return m;
    if (isDurableQueueItemLocked(m)) return m;
    const text =
      patch.text !== undefined ? patch.text.trim() : m.text;
    if (!text) return m;
    return {
      ...m,
      text,
      attachmentPaths:
        patch.attachmentPaths !== undefined
          ? patch.attachmentPaths.length
            ? [...patch.attachmentPaths]
            : undefined
          : m.attachmentPaths,
      status: m.status === "failed" ? ("pending" as const) : m.status,
      // Re-edit / re-pick clears the prior failure reason.
      failReason: m.status === "failed" ? null : m.failReason,
    };
  });
  return {
    ...store,
    byConversation: { ...store.byConversation, [conversationId]: next },
  };
}

/**
 * Atomically claim one pending item for send. Only one caller wins.
 * Returns null if nothing claimable or id already sending/gone.
 */
export function claimDurable(
  store: QueueStoreSnapshot,
  conversationId: string,
  id?: string,
  nowMs = Date.now(),
): { store: QueueStoreSnapshot; item: DurableQueuedMessage | null } {
  const list = store.byConversation[conversationId] ?? [];
  const target =
    id != null
      ? list.find((m) => m.id === id && m.status === "pending")
      : list.find((m) => m.status === "pending");
  if (!target) return { store, item: null };
  if (target.status === "submitting") return { store, item: null };
  const claimedAt = new Date(nowMs).toISOString();
  const next = list.map((m) =>
    m.id === target.id
      ? { ...m, status: "submitting" as const, claimedAt }
      : m,
  );
  return {
    store: {
      ...store,
      byConversation: { ...store.byConversation, [conversationId]: next },
    },
    item: { ...target, status: "submitting", claimedAt },
  };
}

export function completeDurableSend(
  store: QueueStoreSnapshot,
  conversationId: string,
  id: string,
  result: "sent" | "failed",
  failReason: DurableQueueFailReason | null = "send_failed",
): QueueStoreSnapshot {
  const list = store.byConversation[conversationId] ?? [];
  if (result === "sent") {
    return {
      ...store,
      byConversation: withConversationQueue(
        store.byConversation,
        conversationId,
        list.filter((item) => item.id !== id),
      ),
    };
  }
  return {
    ...store,
    byConversation: {
      ...store.byConversation,
      [conversationId]: list.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "failed" as const,
              claimedAt: null,
              failReason: failReason ?? "send_failed",
            }
          : item,
      ),
    },
  };
}

export function removeDurableWithUndo(
  store: QueueStoreSnapshot,
  conversationId: string,
  id: string,
): QueueStoreSnapshot {
  const list = store.byConversation[conversationId] ?? [];
  const index = list.findIndex((m) => m.id === id);
  if (index < 0) return store;
  const item = list[index]!;
  if (isDurableQueueItemLocked(item)) return store;
  return {
    byConversation: withConversationQueue(
      store.byConversation,
      conversationId,
      list.filter((queued) => queued.id !== id),
    ),
    lastRemoved: { ...item, conversationId },
    lastRemovedIndex: index,
  };
}

/**
 * Restore the soft-deleted item. When `expectedId` is given, only acts if it
 * still matches the stashed item — so a stale undo toast (superseded by a later
 * delete) becomes a no-op instead of resurrecting the wrong message.
 */
export function undoLastRemove(
  store: QueueStoreSnapshot,
  expectedId?: string,
): QueueStoreSnapshot {
  const item = store.lastRemoved;
  if (!item?.conversationId) return store;
  if (expectedId != null && item.id !== expectedId) return store;
  const list = store.byConversation[item.conversationId] ?? [];
  if (list.some((m) => m.id === item.id)) {
    return { ...store, lastRemoved: null, lastRemovedIndex: null };
  }
  const restored: DurableQueuedMessage = {
    ...item,
  };
  const index =
    store.lastRemovedIndex != null
      ? Math.min(Math.max(0, store.lastRemovedIndex), list.length)
      : list.length;
  const next = [...list];
  next.splice(index, 0, restored);
  return {
    byConversation: {
      ...store.byConversation,
      [item.conversationId]: next,
    },
    lastRemoved: null,
    lastRemovedIndex: null,
  };
}

/**
 * Drop the soft-deleted undo stash (e.g. after toast timeout). When `expectedId`
 * is given, only clears if it still matches the stash — so an older toast's purge
 * timer can't prematurely evict a message removed more recently.
 */
export function purgeLastRemoved(
  store: QueueStoreSnapshot,
  expectedId?: string,
): QueueStoreSnapshot {
  if (!store.lastRemoved && store.lastRemovedIndex == null) return store;
  if (expectedId != null && store.lastRemoved?.id !== expectedId) return store;
  return { ...store, lastRemoved: null, lastRemovedIndex: null };
}

export function markDurablePending(
  store: QueueStoreSnapshot,
  conversationId: string,
  id: string,
): QueueStoreSnapshot {
  const list = store.byConversation[conversationId] ?? [];
  return {
    ...store,
    byConversation: {
      ...store.byConversation,
      [conversationId]: list.map((item) =>
        item.id === id && item.status === "failed"
          ? {
              ...item,
              status: "pending" as const,
              claimedAt: null,
              failReason: null,
            }
          : item,
      ),
    },
  };
}
