/**
 * Classify remote control errors for mobile UX (P4 hardening).
 * Pure — no I/O.
 */

export type RemoteErrorKind =
  | "revoked"
  | "not_allowed"
  | "offline"
  | "timeout"
  | "pair_expired"
  | "unknown";

export type ClassifiedRemoteError = {
  kind: RemoteErrorKind;
  /** True → wipe local session and return to pair. */
  fatalSession: boolean;
  message: string;
};

/**
 * Map thrown Error / string from control channel into a UX kind.
 *
 * Fatality rules (CX-1): never mark a bare RPC timeout as session-fatal from
 * message text alone. Transient network / backgrounding / busy desk all look
 * like "desk did not answer". The client decides fatality only after a second
 * consecutive timeout on a proven-fresh transport (key skew). True revoke /
 * invalid-token / out-of-sync key material remains fatal.
 */
export function classifyRemoteError(err: unknown): ClassifiedRemoteError {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "unknown error");
  const m = message.toLowerCase();

  if (
    /revoked|device revoked|not active|unknown device|invalid token|unauthorized|out of sync|unpair.*scan|keys invalid|invalid tag/.test(
      m,
    )
  ) {
    return { kind: "revoked", fatalSession: true, message };
  }
  if (/not allowed|method not allowed|allowlist/.test(m)) {
    return { kind: "not_allowed", fatalSession: false, message };
  }
  if (
    /not connected|offline|ws error|ws open timeout|econnrefused|network request|desk is not connected/.test(
      m,
    )
  ) {
    return { kind: "offline", fatalSession: false, message };
  }
  // Timeouts are never session-fatal by message alone (CX-1).
  if (/timeout|did not answer/.test(m)) {
    return { kind: "timeout", fatalSession: false, message };
  }
  if (/expired|pair.*expir|challenge expired|qr expired/.test(m)) {
    return { kind: "pair_expired", fatalSession: false, message };
  }
  return { kind: "unknown", fatalSession: false, message };
}

/** User-facing short label for chrome / banners. */
export function remoteErrorLabel(kind: RemoteErrorKind): string {
  switch (kind) {
    case "revoked":
      return "Device revoked on desk — re-pair required";
    case "not_allowed":
      return "Action not allowed from phone";
    case "offline":
      return "Desk or relay unreachable";
    case "timeout":
      return "Request timed out — if this persists, unpair and scan a new QR";
    case "pair_expired":
      return "Pairing code expired — refresh QR on desk";
    default:
      return "Something went wrong";
  }
}
