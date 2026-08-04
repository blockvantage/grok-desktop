/**
 * Telepresence frame size limits (relay rejects oversized blobs ~350k).
 * Pure check used before send (Phase 6 extract).
 */

/** Max base64 blob length accepted for tele frames (conservative vs relay). */
export const TELE_FRAME_MAX_B64_LEN = 340_000;

/**
 * True when a base64-encoded sealed blob is small enough to send.
 */
export function isTeleFrameBlobSendable(b64Length: number): boolean {
  return b64Length > 0 && b64Length <= TELE_FRAME_MAX_B64_LEN;
}
