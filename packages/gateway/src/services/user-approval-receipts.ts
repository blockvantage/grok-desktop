/**
 * Operation receipt fields for user approve/reject of a tool request
 * (Phase 6 extract from TaskRunner.handleEvent).
 */

export type ToolRequestLike = {
  id: string;
  tool: string;
  path?: string;
};

export function userRejectedToolReceipt(event: ToolRequestLike): {
  action: string;
  decision: "deny";
  effect: "user_rejected";
  detail: Record<string, unknown>;
  correlationId: string;
} {
  return {
    action: `tool:${event.tool}`,
    decision: "deny",
    effect: "user_rejected",
    detail: {
      tool: event.tool,
      path: event.path,
      reason: "user_rejected",
    },
    correlationId: event.id,
  };
}

export function userApprovedToolReceipt(event: ToolRequestLike): {
  action: string;
  decision: "allow";
  effect: "user_approved";
  detail: Record<string, unknown>;
  correlationId: string;
} {
  return {
    action: `tool:${event.tool}`,
    decision: "allow",
    effect: "user_approved",
    detail: {
      tool: event.tool,
      path: event.path,
      reason: "user_approved",
    },
    correlationId: event.id,
  };
}
