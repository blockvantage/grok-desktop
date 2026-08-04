/**
 * Multi-chat LRU cache for per-turn event streams.
 * Survives conversation switches so return visits paint instantly.
 */

import { TASK_EVENT_KINDS, type TaskEvent } from "@grokdesk/shared";

export type ChatTurnCache = {
  perTurn: Map<string, TaskEvent[]>;
  /** Turns whose initial gateway read completed, including empty histories. */
  loadedTurns: Set<string>;
  /** One gateway fetch per turn at a time; notify and polling share it. */
  inFlight: Map<string, Promise<unknown>>;
  /** A trigger received during a fetch requires one serialized trailing read. */
  reloadRequested: Set<string>;
  /** Touch order for LRU eviction (most recent last). */
  touchedAt: number;
};

export type MultiChatEventsCache = {
  byChatId: Map<string, ChatTurnCache>;
  maxChats: number;
  clock: number;
};

export function createMultiChatEventsCache(
  maxChats = 24,
): MultiChatEventsCache {
  return { byChatId: new Map(), maxChats, clock: 0 };
}

export function emptyTurnCache(touchedAt = 0): ChatTurnCache {
  return {
    perTurn: new Map(),
    loadedTurns: new Set(),
    inFlight: new Map(),
    reloadRequested: new Set(),
    touchedAt,
  };
}

const TASK_EVENT_KIND_SET = new Set<TaskEvent["kind"]>(TASK_EVENT_KINDS);

function isEventForTurn(
  value: TaskEvent,
  taskId: string,
): value is TaskEvent {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    value.taskId === taskId &&
    Number.isInteger(value.seq) &&
    value.seq >= 1 &&
    TASK_EVENT_KIND_SET.has(value.kind) &&
    value.payload != null &&
    typeof value.payload === "object" &&
    !Array.isArray(value.payload) &&
    typeof value.createdAt === "string" &&
    value.createdAt.trim().length > 0 &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

/**
 * Validate, deduplicate, and sequence a turn's event history. Exact matching
 * identities refresh their payload so coalesced streaming rows stay current;
 * conflicting duplicate ids or sequences cannot rewrite history.
 */
export function mergeTurnEvents(
  existing: TaskEvent[],
  incoming: TaskEvent[],
  taskId: string,
): TaskEvent[] {
  const bySeq = new Map<number, number>();
  const byId = new Map<string, number>();
  const merged: TaskEvent[] = [];
  for (const event of existing) {
    if (!isEventForTurn(event, taskId)) continue;
    if (bySeq.has(event.seq) || byId.has(event.id)) continue;
    const index = merged.length;
    bySeq.set(event.seq, index);
    byId.set(event.id, index);
    merged.push(event);
  }
  for (const event of incoming) {
    if (!isEventForTurn(event, taskId)) continue;
    const seqIndex = bySeq.get(event.seq);
    const idIndex = byId.get(event.id);
    if (seqIndex != null || idIndex != null) {
      // Streaming messages are coalesced in place by the gateway. A matching
      // identity is therefore a newer snapshot of the same event, not a replay.
      if (seqIndex != null && seqIndex === idIndex) merged[seqIndex] = event;
      continue;
    }
    const index = merged.length;
    bySeq.set(event.seq, index);
    byId.set(event.id, index);
    merged.push(event);
  }
  merged.sort(
    (a, b) =>
      a.seq - b.seq ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  return merged;
}

/** Highest valid sequence in a turn, or zero for an empty history. */
export function nextTurnSeq(events: TaskEvent[]): number {
  let max = 0;
  for (const event of events) {
    if (Number.isInteger(event.seq) && event.seq > max) max = event.seq;
  }
  return max;
}

/** Overlap the latest row so in-place coalesced messages can be refreshed. */
export function afterSeqForTurn(events: TaskEvent[]): number {
  return Math.max(0, nextTurnSeq(events) - 1);
}

/**
 * Serialize reads for a turn. A trigger received while a read is pending marks
 * the turn dirty and guarantees one trailing read before the promise settles.
 * Generic so callers can return boolean or structured load results.
 */
export function serializeTurnLoad<T = boolean>(
  entry: ChatTurnCache,
  taskId: string,
  loadOnce: () => Promise<T>,
  isChanged: (result: T) => boolean = (r) => Boolean(r),
  merge: (acc: T | undefined, next: T) => T = (_acc, next) => next,
): Promise<T> {
  const pending = entry.inFlight.get(taskId) as Promise<T> | undefined;
  if (pending) {
    entry.reloadRequested.add(taskId);
    return pending;
  }

  let request: Promise<T>;
  request = (async () => {
    let acc: T | undefined;
    let lastError: unknown = null;
    let anyChanged = false;
    while (true) {
      entry.reloadRequested.delete(taskId);
      try {
        const next = await loadOnce();
        acc = merge(acc, next);
        anyChanged = anyChanged || isChanged(next);
        lastError = null;
      } catch (error) {
        lastError = error;
      }
      if (entry.reloadRequested.delete(taskId)) continue;
      if (lastError != null && !anyChanged) throw lastError;
      if (acc === undefined) throw lastError ?? new Error("empty load result");
      return acc;
    }
  })().finally(() => {
    if (entry.inFlight.get(taskId) === request) {
      entry.inFlight.delete(taskId);
    }
  });
  entry.inFlight.set(taskId, request);
  return request;
}

export type OwnedChatEvents = {
  chatId: string;
  events: TaskEvent[];
  loading: boolean;
};

/** Never render a state snapshot under a chat that does not own it. */
export function selectOwnedChatEvents(
  snapshot: OwnedChatEvents,
  requestedChatId: string,
  cachedEvents: TaskEvent[] | null,
): { events: TaskEvent[]; loading: boolean } {
  if (snapshot.chatId === requestedChatId) {
    return { events: snapshot.events, loading: snapshot.loading };
  }
  if (cachedEvents) return { events: cachedEvents, loading: false };
  return { events: [], loading: true };
}

/** Get or create a chat entry and mark it most-recently used. */
export function touchChatCache(
  cache: MultiChatEventsCache,
  chatId: string,
): ChatTurnCache {
  cache.clock += 1;
  let entry = cache.byChatId.get(chatId);
  if (!entry) {
    entry = emptyTurnCache(cache.clock);
    cache.byChatId.set(chatId, entry);
    evictIfNeeded(cache);
  } else {
    entry.touchedAt = cache.clock;
  }
  return entry;
}

export function getChatCache(
  cache: MultiChatEventsCache,
  chatId: string,
): ChatTurnCache | undefined {
  return cache.byChatId.get(chatId);
}

/** Record a successful gateway read even when that turn has no events. */
export function markTurnLoaded(entry: ChatTurnCache, taskId: string): void {
  entry.loadedTurns.add(taskId);
}

function evictIfNeeded(cache: MultiChatEventsCache): void {
  while (cache.byChatId.size > cache.maxChats) {
    let oldestId: string | null = null;
    let oldestTouch = Number.POSITIVE_INFINITY;
    for (const [id, entry] of cache.byChatId) {
      if (entry.touchedAt < oldestTouch) {
        oldestTouch = entry.touchedAt;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    cache.byChatId.delete(oldestId);
  }
}

/** True when we already have any turn events for this chat (warm paint). */
export function chatCacheHasEvents(entry: ChatTurnCache): boolean {
  for (const evs of entry.perTurn.values()) {
    if (evs.length > 0) return true;
  }
  return false;
}

/** A successful empty read is warm and must not flash the cold-chat loader. */
export function chatCacheIsWarm(entry: ChatTurnCache): boolean {
  return entry.loadedTurns.size > 0 || chatCacheHasEvents(entry);
}
