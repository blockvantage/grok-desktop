/**
 * Unread-message boundary for workspace streams (CHAT-4).
 * Tracks last-seen event seq per task; returns the first unseen seq.
 */

export const UNREAD_SEEN_KEY = "grokdesk.unreadSeen.v1";

export type UnreadSeenMap = Record<string, number>;

/** Max age for stored last-seen entries (same order as follow-up drafts). */
export const UNREAD_SEEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type UnreadSeenEntry = {
  seq: number;
  /** ISO timestamp of last update. */
  updatedAt: string;
};

export type UnreadSeenStore = Record<string, UnreadSeenEntry>;

/**
 * First block seq strictly greater than lastSeenSeq, or null when fully caught up.
 * Blocks are assumed chronological (non-decreasing seq).
 */
export function unreadBoundarySeq(
  lastSeenSeq: number | null | undefined,
  blocks: ReadonlyArray<{ seq: number }>,
): number | null {
  if (lastSeenSeq == null || !Number.isFinite(lastSeenSeq)) return null;
  if (blocks.length === 0) return null;
  for (const block of blocks) {
    if (typeof block.seq === "number" && block.seq > lastSeenSeq) {
      return block.seq;
    }
  }
  return null;
}

/** Highest seq in a list of blocks (0 when empty). */
export function maxBlockSeq(
  blocks: ReadonlyArray<{ seq: number }>,
): number {
  let max = 0;
  for (const block of blocks) {
    if (typeof block.seq === "number" && block.seq > max) max = block.seq;
  }
  return max;
}

function pruneUnreadSeen(
  store: UnreadSeenStore,
  nowMs = Date.now(),
): UnreadSeenStore {
  const next: UnreadSeenStore = {};
  for (const [taskId, entry] of Object.entries(store)) {
    const updated = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updated)) continue;
    if (nowMs - updated > UNREAD_SEEN_MAX_AGE_MS) continue;
    if (!Number.isFinite(entry.seq) || entry.seq < 0) continue;
    next[taskId] = entry;
  }
  return next;
}

export function loadUnreadSeen(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): UnreadSeenStore {
  if (!storage) return {};
  try {
    const raw = storage.getItem(UNREAD_SEEN_KEY);
    if (!raw) return {};
    if (raw.length > 500_000) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const store: UnreadSeenStore = {};
    let n = 0;
    for (const [taskId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (n >= 500) break;
      if (!taskId || taskId.length > 128) continue;
      // Legacy shape: bare number seq
      if (typeof value === "number" && Number.isFinite(value)) {
        store[taskId] = {
          seq: value,
          updatedAt: new Date(nowMs).toISOString(),
        };
        n += 1;
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const e = value as Partial<UnreadSeenEntry>;
      if (typeof e.seq !== "number" || !Number.isFinite(e.seq)) continue;
      store[taskId] = {
        seq: e.seq,
        updatedAt:
          typeof e.updatedAt === "string"
            ? e.updatedAt.slice(0, 64)
            : new Date(nowMs).toISOString(),
      };
      n += 1;
    }
    return pruneUnreadSeen(store, nowMs);
  } catch {
    return {};
  }
}

export function getLastSeenSeq(
  taskId: string,
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): number | null {
  if (!taskId) return null;
  const entry = loadUnreadSeen(storage, nowMs)[taskId];
  return entry ? entry.seq : null;
}

export function markTaskSeen(
  taskId: string,
  seq: number,
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): void {
  if (!taskId || !storage || !Number.isFinite(seq)) return;
  try {
    const store = loadUnreadSeen(storage, nowMs);
    const prev = store[taskId]?.seq ?? 0;
    // Never regress last-seen.
    const nextSeq = Math.max(prev, seq);
    store[taskId] = {
      seq: nextSeq,
      updatedAt: new Date(nowMs).toISOString(),
    };
    storage.setItem(
      UNREAD_SEEN_KEY,
      JSON.stringify(pruneUnreadSeen(store, nowMs)),
    );
  } catch {
    /* quota / private mode */
  }
}
