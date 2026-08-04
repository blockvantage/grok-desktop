/**
 * Pure cancel outcome messaging (Phase 2/6 residual from TaskRunner.cancel).
 */

export type CancelRpcResult = {
  ok: boolean;
  message?: string;
};

/**
 * Shape a cancel result for IPC after runner attempts cancel.
 * Does not perform cancellation itself.
 */
export function cancelOutcomeFromTaskStatus(input: {
  taskFound: boolean;
  statusAfter?: string;
  wasActive: boolean;
}): CancelRpcResult {
  if (!input.taskFound) {
    return { ok: false, message: "task not found" };
  }
  if (input.statusAfter === "cancelled" || input.wasActive) {
    return { ok: true };
  }
  if (
    input.statusAfter === "done" ||
    input.statusAfter === "failed" ||
    input.statusAfter === "succeeded"
  ) {
    return { ok: true, message: "already terminal" };
  }
  return { ok: true };
}

/** True when cancel should short-circuit because id is optimistic/local-only. */
export function isNonGatewayTaskId(taskId: string): boolean {
  return taskId.startsWith("optimistic-") || taskId.startsWith("local-");
}
