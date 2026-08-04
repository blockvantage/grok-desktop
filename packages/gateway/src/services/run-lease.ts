/**
 * Run-attempt lease duration constants (Phase 6 extract from TaskRunner).
 */

/** Default lease TTL when claiming/heartbeating a run attempt (ms). */
export const RUN_ATTEMPT_LEASE_MS = 60_000;

/**
 * Heartbeat extension interval uses the same lease window.
 */
export function leaseHeartbeatMs(leaseMs: number = RUN_ATTEMPT_LEASE_MS): number {
  return leaseMs > 0 ? leaseMs : RUN_ATTEMPT_LEASE_MS;
}
