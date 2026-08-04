/**
 * Select the live approval banner for the open chat.
 * Scans only the newest non-terminal turn so a cancelled turn's dangling
 * approval_required never resurfaces on a later follow-up.
 */

import type { TaskEvent } from "@grokdesk/shared";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** Newest turn that is still live (running / queued / waiting / blocked). */
export function newestNonTerminalTaskId(
  turns: readonly { id: string; status: string }[],
): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (!TERMINAL.has(t.status)) return t.id;
  }
  return null;
}

function approvalId(event: TaskEvent): string | null {
  const value = event.payload?.approvalId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compareEvents(a: TaskEvent, b: TaskEvent): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.seq - b.seq ||
    a.id.localeCompare(b.id)
  );
}

/** Resolve each approval independently, then choose the newest open key. */
export function findPendingApproval(
  events: readonly TaskEvent[],
  liveTaskId: string | null | undefined,
): TaskEvent | null {
  if (!liveTaskId) return null;
  const pending = new Map<string, TaskEvent>();
  const ordered = events
    .filter((event) => event.taskId === liveTaskId)
    .slice()
    .sort(compareEvents);
  for (const event of ordered) {
    const id = approvalId(event);
    if (!id) continue;
    if (event.kind === "approval_required") pending.set(id, event);
    if (event.kind === "approval_resolved") pending.delete(id);
  }
  return [...pending.values()].sort(compareEvents).at(-1) ?? null;
}
