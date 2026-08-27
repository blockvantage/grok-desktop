/**
 * Persist waiting-on-you pending items as inbox rows (one stream → inbox).
 */
import type { InboxKind, WaitingOnYouView } from "@grokdesk/shared";

export type WaitingInboxWriter = {
  addDeduped: (input: {
    kind: InboxKind;
    title: string;
    body: string;
    taskId?: string | null;
  }) => unknown;
};

export function inboxKindForPending(kind: string): InboxKind {
  return kind === "question" || kind === "mcp_elicitation"
    ? "clarification"
    : "approval";
}

/** Add one inbox row per pending interaction. Deduped by kind+taskId. */
export function syncInboxFromWaitingOnYou(
  inbox: WaitingInboxWriter,
  view: WaitingOnYouView,
): number {
  let n = 0;
  for (const pending of view.pending) {
    const item = inbox.addDeduped({
      kind: inboxKindForPending(pending.kind),
      title: pending.title,
      body: pending.kind,
      taskId: pending.taskId ?? null,
    });
    if (item) n++;
  }
  return n;
}
