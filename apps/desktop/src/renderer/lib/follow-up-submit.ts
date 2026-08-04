/**
 * Pure follow-up composer submit decision (Phase 6 extract).
 */

export function isOptimisticTaskId(id: string): boolean {
  return id.startsWith("optimistic-");
}

export type FollowUpSubmitDecision =
  | { action: "noop" }
  | { action: "enqueue"; goal: string }
  | { action: "send"; goal: string };

/**
 * Decide whether to ignore, queue, or send a follow-up turn.
 *
 * `agentBusy` is true ONLY while the agent is actively producing a turn
 * (running/queued). It replaces the old "isLive" gate, which also queued while
 * the agent was merely awaiting the user (waiting_user) — that swallowed the
 * user's reply into a queue that never drained. Now: queue only while the agent
 * is actually busy; otherwise send straight through.
 */
export function resolveFollowUpSubmit(input: {
  goal: string;
  busy: boolean;
  optimistic: boolean;
  agentBusy: boolean;
}): FollowUpSubmitDecision {
  const g = input.goal.trim();
  if (!g || input.busy || input.optimistic) return { action: "noop" };
  if (input.agentBusy) return { action: "enqueue", goal: g };
  return { action: "send", goal: g };
}

/**
 * Extract native file paths from a drag-and-drop FileList-like array.
 */
export function filePathsFromDropFiles(
  files: Array<{ path?: string }>,
): string[] {
  return files
    .map((f) => f.path)
    .filter((p): p is string => typeof p === "string" && Boolean(p));
}

/**
 * Whether the follow-up send control should be disabled.
 */
export function isFollowUpSendDisabled(input: {
  goal: string;
  busy: boolean;
  optimistic: boolean;
}): boolean {
  return !input.goal.trim() || input.busy || input.optimistic;
}
