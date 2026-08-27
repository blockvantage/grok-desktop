/**
 * One "Waiting on you" stream (Phase 1.4).
 * PendingInteraction / InteractionResolved drive inbox, dock, sidebar, and
 * notification copy — no per-surface heuristics.
 */

export const PENDING_INTERACTION_KINDS = [
  "permission",
  "question",
  "plan_approval",
  "mcp_elicitation",
] as const;

export type PendingInteractionKind = (typeof PENDING_INTERACTION_KINDS)[number];

export type PendingInteraction = {
  id: string;
  kind: PendingInteractionKind;
  title: string;
};

export type WaitingOnYouView = {
  pending: PendingInteraction[];
  inboxBadge: number;
  needsInput: boolean;
  notificationTitle: string | null;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asKind(value: unknown): PendingInteractionKind | null {
  const token = typeof value === "string" ? value.trim() : "";
  if ((PENDING_INTERACTION_KINDS as readonly string[]).includes(token)) {
    return token as PendingInteractionKind;
  }
  if (token === "plan") return "plan_approval";
  if (token === "ask_user" || token === "ask_user_question") return "question";
  if (token === "mcp" || token === "elicitation") return "mcp_elicitation";
  return null;
}

export function decodePendingInteraction(raw: unknown): PendingInteraction | null {
  const obj = rec(raw);
  if (!obj) return null;
  const nested = rec(obj.pending_interaction) ?? rec(obj);
  const id = String(nested.id ?? nested.tool_call_id ?? nested.toolCallId ?? "").trim();
  const kind = asKind(nested.kind);
  if (!id || !kind) return null;
  const title =
    typeof nested.title === "string" && nested.title.trim()
      ? nested.title.trim()
      : kind;
  return { id, kind, title };
}

export function decodeInteractionResolved(raw: unknown): string | null {
  const obj = rec(raw);
  if (!obj) return null;
  const nested = rec(obj.interaction_resolved) ?? obj;
  const id = String(
    nested.id ?? nested.tool_call_id ?? nested.toolCallId ?? "",
  ).trim();
  return id || null;
}

export function emptyWaitingOnYou(): WaitingOnYouView {
  return {
    pending: [],
    inboxBadge: 0,
    needsInput: false,
    notificationTitle: null,
  };
}

export function applyWaitingOnYouEvent(
  prev: WaitingOnYouView,
  event: { type: "pending" | "resolved"; raw: unknown },
): WaitingOnYouView {
  if (event.type === "pending") {
    const item = decodePendingInteraction(event.raw);
    if (!item) return prev;
    const pending = [
      ...prev.pending.filter((p) => p.id !== item.id),
      item,
    ];
    return viewFromPending(pending);
  }
  const id = decodeInteractionResolved(event.raw);
  if (!id) return prev;
  return viewFromPending(prev.pending.filter((p) => p.id !== id));
}

function viewFromPending(pending: PendingInteraction[]): WaitingOnYouView {
  const last = pending[pending.length - 1];
  return {
    pending,
    inboxBadge: pending.length,
    needsInput: pending.length > 0,
    notificationTitle: last ? last.title : null,
  };
}
