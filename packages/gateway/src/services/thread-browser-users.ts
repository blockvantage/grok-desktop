/**
 * Whether other non-terminal tasks still use a chat-root browser session.
 */

const ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "waiting_approval",
  "waiting_user",
  "blocked",
]);

export type ThreadTaskStatus = {
  id: string;
  status: string;
};

/**
 * True if any thread member other than excludingTaskId is still active.
 * On collect failure (DB closed), returns false so destroy can proceed.
 */
export function threadHasActiveBrowserUsers(
  threadTasks: ThreadTaskStatus[],
  excludingTaskId: string,
): boolean {
  for (const t of threadTasks) {
    if (t.id === excludingTaskId) continue;
    if (ACTIVE_STATUSES.has(t.status)) return true;
  }
  return false;
}

export function isActiveTaskStatusForBrowser(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}
