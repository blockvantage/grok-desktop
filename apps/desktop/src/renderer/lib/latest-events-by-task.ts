/**
 * Fan-in: last stream event per taskId for subagent HUD (Phase 6 extract).
 * Skips synthetic goal-* rows injected by the chat event aggregator.
 */

export type StreamEventTaskLike = {
  id?: string | null;
  taskId?: string | null;
  kind: string;
  payload: unknown;
};

/**
 * Map taskId → latest non-goal event in stream order.
 * Preserves kind/payload types from the input event shape.
 * Tolerates malformed rows (missing id/taskId) so the workspace never white-screens.
 */
export function latestEventsByTaskId<
  E extends StreamEventTaskLike,
>(
  events: E[] | null | undefined,
): Record<string, Pick<E, "kind" | "payload"> | undefined> {
  const out: Record<string, Pick<E, "kind" | "payload"> | undefined> = {};
  if (!events?.length) return out;
  for (const ev of events) {
    if (!ev) continue;
    const id = typeof ev.id === "string" ? ev.id : "";
    // Synthetic user-goal rows from use-chat-events (id: goal-<taskId>)
    if (id.startsWith("goal-")) continue;
    const taskId = typeof ev.taskId === "string" ? ev.taskId : "";
    if (!taskId) continue;
    out[taskId] = { kind: ev.kind, payload: ev.payload };
  }
  return out;
}
