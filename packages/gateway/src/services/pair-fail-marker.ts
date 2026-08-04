/**
 * Unsealed pair_fail marker payload for the pair channel (CX-12).
 * No secrets — only a machine-readable reason code.
 */

export type PairFailReason = "expired" | "invalid" | "unknown";

export function pairFailMarkerPayload(
  reason: PairFailReason,
): { kind: "pair_fail"; reason: PairFailReason } {
  return { kind: "pair_fail", reason };
}

/**
 * Build the cleartext UTF-8 bytes for the unsealed pair_fail blob.
 */
export function pairFailMarkerBytes(
  reason: PairFailReason,
  encode: (s: string) => Uint8Array = (s) => new TextEncoder().encode(s),
): Uint8Array {
  return encode(JSON.stringify(pairFailMarkerPayload(reason)));
}
