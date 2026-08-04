/**
 * Early-exit preconditions for TaskRunner.handleEvent (Phase 6 extract).
 */

export type HandleEventTaskLike = {
  status: string;
} | null | undefined;

/**
 * True when the runner should abort processing an engine event
 * (paused queue, missing task, or cancelled task).
 */
export function shouldAbortHandleEvent(opts: {
  paused: boolean;
  task: HandleEventTaskLike;
}): boolean {
  if (opts.paused) return true;
  if (!opts.task) return true;
  if (opts.task.status === "cancelled") return true;
  return false;
}

/**
 * After a parked approval resolves, true when the task was cancelled
 * (or deleted) while waiting.
 */
export function shouldAbortAfterApprovalWait(
  task: HandleEventTaskLike,
): boolean {
  if (!task) return true;
  if (task.status === "cancelled") return true;
  return false;
}
