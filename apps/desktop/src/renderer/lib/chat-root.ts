/**
 * Resolve chat-root task id for a turn (one browser session per thread).
 * Phase 6 extract from TaskWorkspaceView.
 */

export type ThreadTaskNode = {
  id: string;
  parentTaskId: string | null;
};

/**
 * Walk parent links within `thread` to the root. If the parent chain leaves the
 * loaded set, prefer any explicit root (no parent) in the thread.
 */
export function resolveChatRootId(
  task: ThreadTaskNode,
  threadTasks?: ThreadTaskNode[] | null,
): string {
  const thread = threadTasks?.length ? threadTasks : [task];
  const byId = new Map(thread.map((t) => [t.id, t]));
  let cur = byId.get(task.id) ?? task;
  const seen = new Set<string>();
  while (
    cur.parentTaskId &&
    byId.has(cur.parentTaskId) &&
    !seen.has(cur.id)
  ) {
    seen.add(cur.id);
    cur = byId.get(cur.parentTaskId)!;
  }
  // Parent not present in threadTasks (e.g. only latest loaded).
  if (cur.parentTaskId && !byId.has(cur.parentTaskId)) {
    const roots = thread.filter((t) => !t.parentTaskId);
    if (roots[0]) return roots[0].id;
  }
  return cur.id;
}
