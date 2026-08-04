/**
 * Pure default approval mode parsing from settings payloads (Phase 6 extract).
 */

export type ApprovalMode = "strict" | "balanced" | "autopilot";

const MODES = new Set<ApprovalMode>(["strict", "balanced", "autopilot"]);

/**
 * Return a valid ApprovalMode when settings.defaultApprovalMode is one of the
 * known values; otherwise null (keep current UI state).
 */
export function approvalModeFromSettings(
  value: unknown,
): ApprovalMode | null {
  if (typeof value !== "string") return null;
  if (MODES.has(value as ApprovalMode)) return value as ApprovalMode;
  return null;
}
