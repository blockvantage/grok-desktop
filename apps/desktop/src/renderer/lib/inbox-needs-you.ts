/**
 * Pure filter for Home "needs you" inbox strip (I10).
 * Dedupe + deep-link fields for exact approval/task navigation.
 */

export type InboxItemLike = {
  id?: string | null;
  read?: boolean | null;
  kind: string;
  title?: string | null;
  taskId?: string | null;
  approvalId?: string | null;
  /** Optional correlation key for dedupe (taskId + approvalId). */
  key?: string | null;
};

export type NeedsYouItem<T extends InboxItemLike = InboxItemLike> = T & {
  /** Deep-link target for openTask / focus approval. */
  deepLink: {
    taskId: string | null;
    approvalId: string | null;
  };
};

/**
 * Unread items for the Home nudge strip.
 * Prefer real approvals over a flood of "Task failed" unfinished rows —
 * bulk failures are summarized elsewhere so the landing stays calm.
 * I10: dedupe by taskId+approvalId (or item id/title), attach deepLink.
 */
export function needsYouInboxItems<T extends InboxItemLike>(
  items: T[],
): NeedsYouItem<T>[] {
  const unread = items.filter(
    (i) => !i.read && (i.kind === "approval" || i.kind === "unfinished"),
  );
  const approvals = unread.filter((i) => i.kind === "approval");
  const pool =
    approvals.length > 0
      ? approvals
      : unread.filter((i) => {
          if (i.kind !== "unfinished") return true;
          const title = (i.title ?? "").toLowerCase();
          return title !== "task failed" && !title.startsWith("task failed");
        });

  const seen = new Set<string>();
  const out: NeedsYouItem<T>[] = [];
  for (const item of pool) {
    const dedupeKey =
      item.key?.trim() ||
      (item.taskId && item.approvalId
        ? `${item.taskId}:${item.approvalId}`
        : null) ||
      (item.taskId ? `task:${item.taskId}` : null) ||
      (item.id ? `id:${item.id}` : null) ||
      `title:${(item.title ?? "").trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      ...item,
      deepLink: {
        taskId: item.taskId?.trim() || null,
        approvalId: item.approvalId?.trim() || null,
      },
    });
  }
  // Cap Home strip; full list lives in Inbox panel.
  return out.slice(0, 5);
}

/** Prefer the first deep-linkable approval for one-tap open. */
export function primaryNeedsYouDeepLink(
  items: readonly NeedsYouItem[],
): { taskId: string; approvalId: string | null } | null {
  for (const i of items) {
    if (i.deepLink.taskId) {
      return {
        taskId: i.deepLink.taskId,
        approvalId: i.deepLink.approvalId,
      };
    }
  }
  return null;
}
