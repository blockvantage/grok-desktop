/**
 * Home "needs you" strip driven by the waiting-on-you projector (Phase 1.4).
 * Inbox rows may still exist for history; the live badge/strip is the projector.
 */
import type { InboxItem, InboxKind, WaitingOnYouView } from "@grokdesk/shared";

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

/** Live Home strip + deep links from the one waiting-on-you stream. */
export function needsYouItemsFromWaiting(
  view: WaitingOnYouView,
): NeedsYouItem<
  InboxItem & { approvalId: string | null }
>[] {
  return view.pending.map((pending) => {
    const kind: InboxKind =
      pending.kind === "question" || pending.kind === "mcp_elicitation"
        ? "clarification"
        : "approval";
    const taskId = pending.taskId?.trim() || null;
    const approvalId =
      pending.kind === "permission" && !pending.id.startsWith("task:")
        ? pending.id
        : null;
    return {
      id: pending.id,
      kind,
      title: pending.title,
      body: pending.title,
      taskId,
      approvalId,
      read: false,
      createdAt: "",
      deepLink: { taskId, approvalId },
    };
  });
}

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
