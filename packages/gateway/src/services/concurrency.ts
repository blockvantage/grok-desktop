/**
 * Task runner concurrency helpers (Phase 6 extract).
 *
 * Global cap across conversations + at most one active run per conversation
 * (or legacy root-thread key when conversation_id is null).
 */

/**
 * Clamp maxConcurrent to a positive integer (default 3).
 */
export function clampMaxConcurrent(n: unknown, fallback = 3): number {
  if (typeof n === "number" && Number.isFinite(n) && n >= 1) {
    return Math.floor(n);
  }
  return fallback;
}

export type QueuedTaskLike = {
  id: string;
  status: string;
  conversationId?: string | null;
  parentTaskId?: string | null;
};

export type ThreadTaskLike = {
  id: string;
  conversationId?: string | null;
  parentTaskId?: string | null;
};

/**
 * Stable serialization key: prefer conversation_id, else walk parent chain
 * to the root task id so legacy rows still serialize.
 */
export function threadKeyForTask(
  task: ThreadTaskLike,
  resolveParent: (id: string) => ThreadTaskLike | null | undefined,
): string {
  if (task.conversationId && task.conversationId.trim()) {
    return `conv:${task.conversationId.trim()}`;
  }
  let cur: ThreadTaskLike = task;
  const seen = new Set<string>();
  while (cur.parentTaskId) {
    if (seen.has(cur.parentTaskId)) break;
    seen.add(cur.id);
    const parent = resolveParent(cur.parentTaskId);
    if (!parent) {
      return `root:${cur.parentTaskId}`;
    }
    if (parent.conversationId && parent.conversationId.trim()) {
      return `conv:${parent.conversationId.trim()}`;
    }
    cur = parent;
  }
  return `root:${cur.id}`;
}

/**
 * Select queued task ids to start given running set and concurrency cap.
 * Pure; does not start anything. Never starts two tasks that share a thread key.
 */
export function selectQueuedStarts(input: {
  queued: QueuedTaskLike[];
  runningIds: Set<string> | Iterable<string>;
  maxConcurrent: number;
  alreadyStarting?: number;
  /** Map of running task id → thread key (preferred). */
  runningThreadKeys?: Iterable<string>;
  /** Resolve parent for legacy thread keys on queued/running tasks. */
  resolveParent?: (id: string) => ThreadTaskLike | null | undefined;
  /** Optional lookup for running tasks missing from `queued`. */
  resolveTask?: (id: string) => ThreadTaskLike | null | undefined;
}): string[] {
  const running = input.runningIds instanceof Set
    ? input.runningIds
    : new Set(input.runningIds);
  const resolveParent = input.resolveParent ?? (() => null);
  const resolveTask = input.resolveTask ?? (() => null);

  const occupiedThreads = new Set<string>();
  if (input.runningThreadKeys) {
    for (const k of input.runningThreadKeys) occupiedThreads.add(k);
  } else {
    for (const id of running) {
      const t = resolveTask(id);
      if (t) {
        occupiedThreads.add(threadKeyForTask(t, resolveParent));
      } else {
        occupiedThreads.add(`root:${id}`);
      }
    }
  }

  const out: string[] = [];
  let reserved = running.size + (input.alreadyStarting ?? 0);
  for (const t of input.queued) {
    if (t.status !== "queued") continue;
    if (reserved >= input.maxConcurrent) break;
    if (running.has(t.id) || out.includes(t.id)) continue;
    const key = threadKeyForTask(t, resolveParent);
    if (occupiedThreads.has(key)) continue;
    out.push(t.id);
    reserved += 1;
    occupiedThreads.add(key);
  }
  return out;
}

/**
 * Whether start() should no-op before creating a new run.
 */
export function shouldSkipStart(input: {
  paused: boolean;
  alreadyRunning: boolean;
  atCapacity: boolean;
  status: string | undefined;
  /** Same-conversation / same-thread peer already running. */
  conversationBusy?: boolean;
}): boolean {
  if (input.paused) return true;
  if (input.alreadyRunning) return true;
  if (input.atCapacity) return true;
  if (input.conversationBusy) return true;
  if (!input.status || input.status !== "queued") return true;
  return false;
}
