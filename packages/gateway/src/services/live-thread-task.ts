/**
 * Pick which task in a chat thread should own a host-parked approval card
 * (Phase 6 extract from TaskRunner.registerHostBrowserApproval).
 */

export type ThreadTaskLike = {
  id: string;
  status: string;
};

const LIVE_STATUSES = new Set([
  "running",
  "waiting_approval",
  "queued",
]);

/**
 * Prefer a live task in the thread; else last member; else null (caller falls
 * back to the session id / root).
 */
export function resolveLiveThreadTask(
  thread: ThreadTaskLike[],
): ThreadTaskLike | null {
  if (thread.length === 0) return null;
  const live = thread.find((t) => LIVE_STATUSES.has(t.status));
  if (live) return live;
  return thread[thread.length - 1] ?? null;
}
