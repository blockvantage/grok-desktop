/**
 * Register a host-parked browser approval into the runner stream + audit log
 * (Phase 6 extract from Gateway browser.hostApproval).
 */

export type HostBrowserApprovalParams = {
  approvalId: string;
  taskId: string;
  tool: string;
  reason: string;
  url?: string;
  args?: Record<string, unknown>;
};

export interface BrowserHostApprovalDeps {
  registerHostBrowserApproval(p: HostBrowserApprovalParams): void;
  appendAudit(entry: {
    taskId: string;
    action: "policy_check";
    detail: Record<string, unknown>;
    decision: "info";
  }): void;
}

/**
 * Park MCP/host browser exec for UI approval and record an audit info row.
 */
export function registerBrowserHostApproval(
  p: HostBrowserApprovalParams,
  deps: BrowserHostApprovalDeps,
): { ok: true } {
  deps.registerHostBrowserApproval(p);
  deps.appendAudit({
    taskId: p.taskId,
    action: "policy_check",
    detail: {
      tool: p.tool,
      url: p.url,
      decision: "needs_approval",
      reason: p.reason,
      hostParked: true,
    },
    decision: "info",
  });
  return { ok: true };
}
