/**
 * Pure terminal fields for user-initiated cancel (Phase 6 extract).
 */

export type CancelAttemptTerminal = {
  status: "cancelled";
  reason: "user_cancel";
};

export function userCancelAttemptTerminal(): CancelAttemptTerminal {
  return { status: "cancelled", reason: "user_cancel" };
}

/**
 * Whether cancel should set task status to cancelled for this prior status.
 * Re-exported convenience alias kept local to avoid circular imports with host-parked.
 */
export { shouldMarkCancelled } from "./host-parked-approval.js";
