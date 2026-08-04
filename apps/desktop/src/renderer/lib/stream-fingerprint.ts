/**
 * Fingerprint stream growth so soft-follow re-scrolls on merges (Phase 6 extract).
 */

export type StreamEventLike = {
  id?: string | number;
  payload?: { text?: unknown } | null;
};

/**
 * Compact signature of event list + task status for follow-scroll effects.
 */
export function streamFingerprint(
  events: StreamEventLike[],
  taskStatus: string,
): string {
  const last = events[events.length - 1];
  const lastText =
    last && typeof last.payload?.text === "string"
      ? last.payload.text.length
      : 0;
  return `${events.length}:${last?.id ?? ""}:${lastText}:${taskStatus}`;
}

/**
 * True when status transitioned into "done" (for one-shot celebrate UI).
 */
export function shouldCelebrateDone(
  prevStatus: string | null | undefined,
  nextStatus: string,
): boolean {
  return prevStatus !== "done" && nextStatus === "done";
}
