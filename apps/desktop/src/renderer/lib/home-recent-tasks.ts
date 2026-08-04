/**
 * Recent-task strip on Home: never let failed/cancelled history dominate.
 */

/** Terminal statuses that should not headline the Home recent list. */
export function isHomeRecentClutterStatus(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/**
 * Pick recent tasks for the Home desk: prefer non-failed work, cap length.
 * If everything is clutter, return empty so the section can hide.
 */
export function recentTasksForHomeDesk<T extends { status: string }>(
  tasks: T[],
  limit = 3,
): T[] {
  const meaningful = tasks.filter((t) => !isHomeRecentClutterStatus(t.status));
  return meaningful.slice(0, limit);
}
