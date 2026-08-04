/**
 * Normalize audit decision strings for AuditService.append (Phase 6 extract).
 */

export type AuditDecision =
  | "approve"
  | "reject"
  | "info"
  | "allow"
  | "deny";

/**
 * Coerce unknown decision to a valid AuditService decision (default info).
 */
export function normalizeAuditDecision(
  decision: string | null | undefined,
): AuditDecision {
  if (
    decision === "approve" ||
    decision === "reject" ||
    decision === "info" ||
    decision === "allow" ||
    decision === "deny"
  ) {
    return decision;
  }
  return "info";
}
