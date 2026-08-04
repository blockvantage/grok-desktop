/**
 * Filter in-memory pending approvals (Phase 6 extract from TaskRunner).
 */

export type PendingApprovalLike = {
  id: string;
  taskId: string;
};

/**
 * List pending approvals, optionally scoped to a task id.
 */
export function filterPendingApprovals<T extends PendingApprovalLike>(
  pending: Iterable<T>,
  taskId?: string,
): T[] {
  const all = [...pending];
  return taskId ? all.filter((p) => p.taskId === taskId) : all;
}
