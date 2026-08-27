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
  /** Task that owns this interaction, when known. */
  taskId?: string;
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
  if (!nested) return null;
  const id = String(nested.id ?? nested.tool_call_id ?? nested.toolCallId ?? "").trim();
  const kind = asKind(nested.kind);
  if (!id || !kind) return null;
  const title =
    typeof nested.title === "string" && nested.title.trim()
      ? nested.title.trim()
      : kind;
  const taskId = String(nested.taskId ?? nested.task_id ?? "").trim();
  return { id, kind, title, ...(taskId ? { taskId } : {}) };
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

export type WaitingOnYouTaskLike = {
  id: string;
  status: string;
  title?: string | null;
  goal?: string | null;
};

export type WaitingOnYouEventLike = {
  type?: string;
  kind?: string;
  raw?: unknown;
  payload?: unknown;
  id?: string;
  title?: string;
  tool?: string;
  command?: string;
  taskId?: string;
  approvalId?: string;
};

function taskDisplayTitle(task: WaitingOnYouTaskLike, fallback: string): string {
  const title = typeof task.title === "string" ? task.title.trim() : "";
  if (title) return title;
  const goal = typeof task.goal === "string" ? task.goal.trim() : "";
  if (goal) return goal.slice(0, 200);
  return fallback;
}

/** Parked gateway tasks that still need a human, when no live ACP event exists. */
export function pendingFromTask(
  task: WaitingOnYouTaskLike,
): PendingInteraction | null {
  if (task.status === "waiting_approval") {
    return {
      id: `task:${task.id}`,
      kind: "permission",
      title: taskDisplayTitle(task, "permission"),
      taskId: task.id,
    };
  }
  if (task.status === "waiting_user") {
    return {
      id: `task:${task.id}`,
      kind: "question",
      title: taskDisplayTitle(task, "question"),
      taskId: task.id,
    };
  }
  return null;
}

function eventToken(event: WaitingOnYouEventLike): string {
  return String(event.type ?? event.kind ?? "")
    .trim()
    .toLowerCase();
}

function eventRaw(event: WaitingOnYouEventLike): unknown {
  if (event.raw !== undefined) return event.raw;
  if (event.payload !== undefined) return event.payload;
  return event;
}

/**
 * Classify a runtime / ACP / task event onto the pending/resolved stream.
 * Unknown shapes are ignored (forward-compat).
 */
export function classifyWaitingOnYouEvent(
  event: WaitingOnYouEventLike,
): { type: "pending" | "resolved"; raw: unknown } | null {
  const token = eventToken(event);
  const raw = eventRaw(event);

  if (
    token === "pending_interaction" ||
    token === "pending" ||
    token === "pendinginteraction"
  ) {
    return { type: "pending", raw };
  }
  if (
    token === "interaction_resolved" ||
    token === "resolved" ||
    token === "interactionresolved"
  ) {
    return { type: "resolved", raw };
  }
  if (token === "permission_request" || token === "approval_required") {
    const obj = rec(raw) ?? rec(event);
    const nested = rec(obj?.tool) ?? obj;
    const id = String(
      nested?.id ??
        nested?.approvalId ??
        obj?.id ??
        obj?.approvalId ??
        event.id ??
        event.approvalId ??
        "",
    ).trim();
    if (!id) return null;
    const kind =
      asKind(nested?.kind ?? obj?.kind ?? event.tool) ?? "permission";
    const title = String(
      nested?.title ??
        obj?.title ??
        obj?.command ??
        obj?.reason ??
        event.title ??
        event.command ??
        kind,
    ).trim();
    const taskId = String(
      nested?.taskId ?? obj?.taskId ?? event.taskId ?? "",
    ).trim();
    return {
      type: "pending",
      raw: { id, kind, title, ...(taskId ? { taskId } : {}) },
    };
  }
  if (token === "approval_resolved") {
    const obj = rec(raw) ?? rec(event);
    const id = String(
      obj?.id ?? obj?.approvalId ?? event.id ?? event.approvalId ?? "",
    ).trim();
    if (!id) return null;
    return { type: "resolved", raw: { id } };
  }

  if (decodePendingInteraction(raw) || decodePendingInteraction(event)) {
    return { type: "pending", raw };
  }
  if (decodeInteractionResolved(raw) || decodeInteractionResolved(event)) {
    return { type: "resolved", raw };
  }
  return null;
}

/**
 * One projector for inbox badge, dock/tray, sidebar needs_input, and OS notify.
 * Live ACP PendingInteraction events win; parked waiting_* tasks fill gaps.
 */
export function projectWaitingOnYou(input: {
  events?: WaitingOnYouEventLike[];
  tasks?: WaitingOnYouTaskLike[];
}): WaitingOnYouView {
  let state = emptyWaitingOnYou();
  for (const event of input.events ?? []) {
    const classified = classifyWaitingOnYouEvent(event);
    if (classified) state = applyWaitingOnYouEvent(state, classified);
  }
  const seenTaskIds = new Set(
    state.pending.map((p) => p.taskId).filter((id): id is string => Boolean(id)),
  );
  const extra: PendingInteraction[] = [];
  for (const task of input.tasks ?? []) {
    const item = pendingFromTask(task);
    if (!item) continue;
    if (seenTaskIds.has(task.id)) continue;
    if (state.pending.some((p) => p.id === item.id)) continue;
    extra.push(item);
    seenTaskIds.add(task.id);
  }
  return extra.length ? viewFromPending([...state.pending, ...extra]) : state;
}

export function waitingOnYouTaskIds(view: WaitingOnYouView): string[] {
  return view.pending
    .map((p) => p.taskId)
    .filter((id): id is string => Boolean(id));
}
