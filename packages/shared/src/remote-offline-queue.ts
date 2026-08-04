/**
 * Durable offline mutation queue for mobile remote control.
 * Only a safe subset of methods may be queued — never telepresence or pair-critical paths.
 */

export type OfflineQueueItem = {
  /** Stable client id (uuid or random). */
  id: string;
  method: string;
  params: unknown;
  createdAt: number;
};

/** Methods safe to enqueue while offline and flush in order on reconnect. */
export const OFFLINE_QUEUEABLE_METHODS = new Set<string>([
  "memory.upsert",
  "memory.delete",
  "schedule.setEnabled",
]);

/** CX-5: drop items older than 24h. */
export const OFFLINE_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cap durable queue depth. SecureStore has tight size limits on some platforms;
 * unbounded enqueue would silently fail or bloat device storage.
 */
export const OFFLINE_QUEUE_MAX_ITEMS = 50;

/** Max JSON size of a single offline item's params (SecureStore-friendly). */
export const OFFLINE_QUEUE_MAX_PARAMS_BYTES = 8_192;

export function isOfflineQueueableMethod(method: string): boolean {
  return OFFLINE_QUEUEABLE_METHODS.has(method);
}

export function createOfflineQueueItem(
  method: string,
  params: unknown,
  id?: string,
): OfflineQueueItem {
  if (!isOfflineQueueableMethod(method)) {
    throw new Error(`method not offline-queueable: ${method}`);
  }
  let paramsBytes = 0;
  try {
    const raw = JSON.stringify(params ?? null);
    paramsBytes =
      typeof TextEncoder !== "undefined"
        ? new TextEncoder().encode(raw).length
        : raw.length;
  } catch {
    throw new Error("offline queue params not serializable");
  }
  if (paramsBytes > OFFLINE_QUEUE_MAX_PARAMS_BYTES) {
    throw new Error(
      `offline queue params too large (${paramsBytes} > ${OFFLINE_QUEUE_MAX_PARAMS_BYTES})`,
    );
  }
  return {
    id: id ?? `q-${Math.random().toString(36).slice(2, 12)}`,
    method,
    params,
    createdAt: Date.now(),
  };
}

export function serializeOfflineQueue(items: OfflineQueueItem[]): string {
  return JSON.stringify(items);
}

export function parseOfflineQueue(raw: string | null | undefined): OfflineQueueItem[] {
  if (!raw) return [];
  // SecureStore-friendly bound; refuse absurd blobs before parse.
  if (raw.length > 500_000) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidItem).slice(0, OFFLINE_QUEUE_MAX_ITEMS);
  } catch {
    return [];
  }
}

function isValidItem(v: unknown): v is OfflineQueueItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length < 1 || o.id.length > 128) {
    return false;
  }
  if (typeof o.method !== "string" || !isOfflineQueueableMethod(o.method)) {
    return false;
  }
  if (typeof o.createdAt !== "number" || !Number.isFinite(o.createdAt)) {
    return false;
  }
  if (!("params" in o)) return false;
  return true;
}

export function enqueueOffline(
  items: OfflineQueueItem[],
  method: string,
  params: unknown,
  id?: string,
): OfflineQueueItem[] {
  const next = createOfflineQueueItem(method, params, id);
  const merged = [...items, next];
  if (merged.length <= OFFLINE_QUEUE_MAX_ITEMS) return merged;
  // Drop oldest first so the freshest offline intent survives.
  return merged.slice(merged.length - OFFLINE_QUEUE_MAX_ITEMS);
}

/** Drop items past TTL (CX-5). */
export function expireOfflineQueue(
  items: OfflineQueueItem[],
  now = Date.now(),
  ttlMs = OFFLINE_QUEUE_TTL_MS,
): OfflineQueueItem[] {
  return items.filter((i) => now - i.createdAt <= ttlMs);
}

/**
 * Permanent (drop-item) vs transient (keep + retry) flush failures (CX-5).
 * Validation / not-found → drop. Transport / timeout → keep.
 */
export function isPermanentOfflineFlushError(message: string): boolean {
  const m = message.toLowerCase();
  if (/timeout|did not answer|not connected|offline|ws |network|econnrefused/.test(m)) {
    return false;
  }
  return (
    /not found|unknown|invalid|validation|zod|required|does not exist|already deleted|no such|permanent/.test(
      m,
    ) || m.length > 0
  );
}

export type FlushSend = (
  method: string,
  params: unknown,
  /** Stable client mutation id for desk-side dedupe (CX-5). */
  clientId: string,
) => Promise<unknown>;

export type FlushResult = {
  /** Items that were sent successfully (in order). */
  flushed: OfflineQueueItem[];
  /** Remaining queue after partial or full flush. */
  remaining: OfflineQueueItem[];
  /** First permanent error message if flush stopped early. */
  error?: string;
};

/**
 * Flush queue FIFO. On success, item is dropped.
 * On permanent failure, drop the head item and continue (CX-5 poison-pill fix).
 * On transient failure, stop and leave remaining for retry.
 */
export async function flushOfflineQueue(
  items: OfflineQueueItem[],
  send: FlushSend,
  now = Date.now(),
): Promise<FlushResult> {
  const live = expireOfflineQueue(items, now);
  const flushed: OfflineQueueItem[] = [];
  // Count expired as flushed (dropped)
  const expired = items.length - live.length;
  const remaining: OfflineQueueItem[] = [];
  let error: string | undefined;

  for (let i = 0; i < live.length; i++) {
    const item = live[i]!;
    if (!isOfflineQueueableMethod(item.method)) {
      return {
        flushed,
        remaining: live.slice(i),
        error: `method not offline-queueable: ${item.method}`,
      };
    }
    try {
      // Transmit client id for desk-side idempotency (CX-5).
      await send(item.method, item.params, item.id);
      flushed.push(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPermanentOfflineFlushError(msg)) {
        // Drop poison item and continue
        flushed.push(item);
        error = msg;
        continue;
      }
      // Transient — stop, keep this item and the rest
      return {
        flushed,
        remaining: live.slice(i),
        error: msg,
      };
    }
  }
  return {
    flushed,
    remaining: remaining,
    error: expired > 0 && !error ? undefined : error,
  };
}
