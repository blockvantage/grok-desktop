/**
 * Pure delivery-phase model: separate local persistence, connection,
 * acceptance, queue, and execution. Working only after gateway acceptance
 * while the task is actually running.
 */

export type DeliveryPhase =
  | "draft"
  | "saving"
  | "saved_local"
  | "connecting"
  | "accepted"
  | "queued"
  | "running"
  | "needs_attention"
  | "terminal"
  | "delivery_unknown";

export type DeliveryInput = {
  /** Composer still holds unsent draft. */
  hasDraft?: boolean;
  /** Local enqueue / create RPC in flight. */
  saving?: boolean;
  /** Gateway acknowledged outbox or create (SQLite durable). */
  savedLocal?: boolean;
  /** Engine reconnecting / not ready. */
  connecting?: boolean;
  /** Task row accepted by gateway. */
  accepted?: boolean;
  /** Task status from gateway. */
  taskStatus?: string | null;
  /** Outbox row present for this mutation. */
  outboxPending?: boolean;
  /** Acceptance deadline expired without confirmation. */
  acceptanceTimedOut?: boolean;
  /** Terminal task status. */
  terminal?: boolean;
  /** Needs user (approval / waiting_user / failed outbox). */
  needsAttention?: boolean;
};

export function deriveDeliveryPhase(input: DeliveryInput): DeliveryPhase {
  if (input.terminal) return "terminal";
  if (input.needsAttention) return "needs_attention";
  if (input.connecting && !input.savedLocal && !input.accepted) {
    return "connecting";
  }
  if (input.saving) return "saving";
  if (input.acceptanceTimedOut && !input.accepted) return "delivery_unknown";
  if (input.outboxPending && input.savedLocal) return "saved_local";
  if (input.outboxPending) return "saved_local";

  const status = (input.taskStatus ?? "").toLowerCase();
  if (status === "running") {
    return input.accepted || input.savedLocal ? "running" : "delivery_unknown";
  }
  if (status === "queued") {
    return input.accepted || input.savedLocal ? "queued" : "accepted";
  }
  if (
    status === "waiting_approval" ||
    status === "waiting_user" ||
    status === "blocked"
  ) {
    return "needs_attention";
  }
  if (status === "done" || status === "failed" || status === "cancelled") {
    return "terminal";
  }
  if (input.accepted) return "accepted";
  if (input.savedLocal) return "saved_local";
  if (input.hasDraft) return "draft";
  return "draft";
}

export function deliveryPhaseLabel(phase: DeliveryPhase): string {
  switch (phase) {
    case "draft":
      return "Draft";
    case "saving":
      return "Saving…";
    case "saved_local":
      return "Saved locally";
    case "connecting":
      return "Draft kept — waiting for the engine";
    case "accepted":
      return "Accepted";
    case "queued":
      return "Queued";
    case "running":
      return "Working";
    case "needs_attention":
      return "Needs attention";
    case "terminal":
      return "Done";
    case "delivery_unknown":
      return "Checking delivery…";
    default:
      return "";
  }
}

/** Whether the Working indicator may render. */
export function mayShowWorking(phase: DeliveryPhase): boolean {
  return phase === "running";
}
