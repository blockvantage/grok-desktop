/**
 * Pure payloads for task approval resolution and cancel-time cleanup
 * (Phase 6 extract from TaskRunner.approve / cancel).
 */

export type ApprovalDecision = "approve" | "reject";

export type PendingLike = {
  id: string;
  taskId: string;
  toolRequest: unknown;
};

/**
 * Audit detail written when a user resolves an approval.
 */
export function approvalAuditDetail(
  approvalId: string,
  decision: ApprovalDecision,
  toolRequest: unknown,
): Record<string, unknown> {
  return { approvalId, decision, tool: toolRequest };
}

/**
 * Stream event payload for approval_resolved.
 */
export function approvalResolvedEvent(
  approvalId: string,
  decision: ApprovalDecision,
  reason?: string,
): Record<string, unknown> {
  return reason
    ? { approvalId, decision, reason }
    : { approvalId, decision };
}

/**
 * Event when cancel rejects dangling approvals (prevents stale banners).
 */
export function cancelRejectedApprovalEvent(approvalId: string): Record<string, unknown> {
  return {
    approvalId,
    decision: "reject" as const,
    reason: "cancelled",
  };
}

/**
 * List pending approval ids owned by a task (for cancel cleanup).
 */
export function pendingApprovalIdsForTask(
  pending: Iterable<[string, PendingLike]>,
  taskId: string,
): string[] {
  const out: string[] = [];
  for (const [id, p] of pending) {
    if (p.taskId === taskId) out.push(id);
  }
  return out;
}

/**
 * Whether approve should call browserRememberOrigin after user approval.
 */
export function shouldRememberBrowserOrigin(
  tool: string,
  url: string,
): boolean {
  return tool === "browser_open" && url.length > 0;
}
