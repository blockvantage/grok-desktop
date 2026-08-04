/**
 * Extract approvalId from a pending approval stream event (Phase 6 extract).
 */

export function approvalIdFromPendingEvent(
  event: { payload?: { approvalId?: unknown } | null } | null | undefined,
): string | null {
  if (!event?.payload) return null;
  const id = event.payload.approvalId;
  return typeof id === "string" && id ? id : null;
}
