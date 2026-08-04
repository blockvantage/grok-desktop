/**
 * Map evaluateToolRequest decisions into audit + operation receipt fields
 * (Phase 6 extract from TaskRunner.handleEvent).
 */

export type PolicyDecisionKind = "allow" | "deny" | "needs_approval";

export type AuditDecision = "allow" | "deny" | "info";
export type ReceiptDecision = "allow" | "deny" | "ask";

export function policyDecisionToAuditDecision(
  decision: PolicyDecisionKind,
): AuditDecision {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  return "info";
}

export function policyDecisionToReceiptDecision(
  decision: PolicyDecisionKind,
): ReceiptDecision {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  return "ask";
}

export function policyDecisionEffect(
  decision: PolicyDecisionKind,
): string | null {
  return decision === "allow" ? "pending_or_provider" : null;
}

export type ToolRequestLike = {
  id: string;
  tool: string;
  path?: string;
  command?: string;
  meta?: Record<string, unknown>;
};

export function toolPolicyAuditDetail(
  event: ToolRequestLike,
  decision: { decision: PolicyDecisionKind; reason: string },
): Record<string, unknown> {
  return {
    tool: event.tool,
    path: event.path,
    decision: decision.decision,
    reason: decision.reason,
  };
}

export function toolPolicyReceiptFields(
  event: ToolRequestLike,
  decision: { decision: PolicyDecisionKind; reason: string },
): {
  action: string;
  decision: ReceiptDecision;
  effect: string | null;
  detail: Record<string, unknown>;
  correlationId: string;
} {
  return {
    action: `tool:${event.tool}`,
    decision: policyDecisionToReceiptDecision(decision.decision),
    effect: policyDecisionEffect(decision.decision),
    detail: {
      tool: event.tool,
      path: event.path,
      command: event.command,
      reason: decision.reason,
    },
    correlationId: event.id,
  };
}
