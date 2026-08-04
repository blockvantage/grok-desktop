/**
 * CX-1 timeout fatality policy (Phase 6 extract from RemoteGatewayClient).
 * First timeout after a fresh transport → reconnect (non-fatal).
 * Second consecutive timeout without a successful reply → key-skew fatal.
 */

export type TimeoutStreakAction =
  | { type: "reconnect"; nextStreak: number }
  | { type: "fatal_key_skew"; nextStreak: number };

/**
 * True when the error is a desk RPC timeout (not revoke/tag skew strings).
 */
export function isDeskRpcTimeoutError(message: string): boolean {
  return (
    /timeout|did not answer/i.test(message) &&
    !/out of sync|invalid tag|revoked/i.test(message)
  );
}

/**
 * After a timeout, given the previous consecutive timeout count (before this one),
 * return the action. Caller increments streak before calling with prior+1, or
 * pass prior and this function treats the new streak as prior+1.
 */
export function timeoutStreakAction(priorConsecutiveTimeouts: number): TimeoutStreakAction {
  const next = priorConsecutiveTimeouts + 1;
  if (next <= 1) {
    return { type: "reconnect", nextStreak: Math.max(1, next) };
  }
  return { type: "fatal_key_skew", nextStreak: next };
}

/** Relay-level err codes that clear all pending RPCs (connection-level). */
export function isConnectionLevelRelayCode(code: string): boolean {
  return (
    code === "not_hello" ||
    code === "bad_hello" ||
    code === "desk_offline" ||
    code === "unauthorized"
  );
}

export const KEY_SKEW_MESSAGE =
  "Session keys out of sync with desk — Unpair, then scan a new QR";
