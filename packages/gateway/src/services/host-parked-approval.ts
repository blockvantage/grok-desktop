/**
 * Build the synthetic tool_request used for host-parked browser approvals
 * (Phase 6 extract from TaskRunner.registerHostBrowserApproval).
 */

export type HostParkedApprovalInput = {
  approvalId: string;
  /** Browser session id (chat root). */
  browserSessionId: string;
  tool: string;
  reason: string;
  url?: string;
  args?: Record<string, unknown>;
};

export type HostParkedToolRequest = {
  type: "tool_request";
  id: string;
  tool: string;
  meta: Record<string, unknown>;
};

/**
 * Shape stored on approval_required events and pending map entries.
 */
export function buildHostParkedToolRequest(
  input: HostParkedApprovalInput,
): HostParkedToolRequest {
  return {
    type: "tool_request",
    id: input.approvalId,
    tool: input.tool,
    meta: {
      ...(input.args ?? {}),
      ...(input.url ? { url: input.url } : {}),
      hostParked: true,
      browserSessionId: input.browserSessionId,
    },
  };
}

/**
 * approval_required event payload for the stream.
 */
export function hostParkedApprovalRequiredPayload(
  input: HostParkedApprovalInput,
  toolRequest: HostParkedToolRequest | { type: string; id: string; tool: string; meta?: Record<string, unknown> },
): Record<string, unknown> {
  return {
    approvalId: input.approvalId,
    tool: toolRequest,
    reason: input.reason,
    browserSessionId: input.browserSessionId,
  };
}

/**
 * Whether cancel should flip task status to cancelled (not already terminal).
 */
export function shouldMarkCancelled(status: string): boolean {
  return (
    status !== "done" && status !== "failed" && status !== "cancelled"
  );
}

/**
 * Extract URL for browser_open remember-origin after user approves.
 */
export function browserOpenUrlFromToolMeta(
  meta: Record<string, unknown> | undefined,
): string {
  return String(meta?.url ?? meta?.href ?? "");
}
