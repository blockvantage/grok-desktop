/**
 * Terminal / live task status helpers for workspace UI (Phase 6 extract).
 */

/**
 * True when the task has finished (success, fail, or cancel).
 */
export function isTerminalTaskStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/**
 * True only while the agent is actively producing a turn and therefore cannot
 * accept a new one — the ONLY state in which a follow-up is queued.
 *
 * Every other non-terminal state ("waiting_user", "waiting_approval",
 * "blocked") means the agent is idle *awaiting the user*, so a composer submit
 * must send straight through (it IS the input the agent is waiting for) and any
 * stacked queue must drain. Queuing in those states silently swallowed replies
 * because the queue only drained on terminal.
 */
export function isBusyTaskStatus(status: string): boolean {
  return status === "running" || status === "queued";
}
