/**
 * Stable public entitlement error codes — frozen contract with landing
 * entitlement-api. Codes must match services/entitlement-api/src/errors.ts.
 */

export const STABLE_ERROR_CODES = [
  "invalid_key_format",
  "invalid_key_signature",
  "key_rotated",
  "entitlement_suspended",
  "entitlement_refunded",
  "entitlement_revoked",
  "seat_limit",
  "challenge_expired",
  "challenge_replayed",
  "device_signature_invalid",
  "clock_skew",
  "unsupported_client",
  "unsupported_architecture",
  "device_deactivated",
  "lease_expired",
  "lease_device_mismatch",
  "grant_expired",
  "grant_used",
  "grant_binding_mismatch",
  "legacy_key_unsupported",
  "legacy_key_not_allowlisted",
  "legacy_exchange_closed",
  "fulfillment_pending",
  "service_unavailable",
] as const;

export type StableErrorCode = (typeof STABLE_ERROR_CODES)[number];

/** Alias used by contract tests. */
export const stableErrorCodes: readonly StableErrorCode[] = STABLE_ERROR_CODES;

/** Default human-readable messages for stable codes (no sensitive detail). */
export const STABLE_ERROR_MESSAGES: Readonly<Record<StableErrorCode, string>> = {
  invalid_key_format: "Product key format is invalid",
  invalid_key_signature: "Product key signature is invalid",
  key_rotated: "Product key has been rotated",
  entitlement_suspended: "Entitlement is suspended",
  entitlement_refunded: "Entitlement has been refunded",
  entitlement_revoked: "Entitlement has been revoked",
  seat_limit: "All device seats are in use",
  challenge_expired: "Challenge has expired",
  challenge_replayed: "Challenge has already been used",
  device_signature_invalid: "Device signature is invalid",
  clock_skew: "Client clock is too far from server time",
  unsupported_client: "Client version is not supported",
  unsupported_architecture: "Architecture is not supported",
  device_deactivated: "Device has been deactivated",
  lease_expired: "Device lease has expired",
  lease_device_mismatch: "Lease is not bound to this device",
  grant_expired: "Download grant has expired",
  grant_used: "Download grant has already been used",
  grant_binding_mismatch: "Download grant binding mismatch",
  legacy_key_unsupported:
    "This legacy key type cannot be exchanged; use recovery or support",
  legacy_key_not_allowlisted:
    "Legacy key is not eligible for automatic exchange",
  legacy_exchange_closed: "Legacy key exchange window has closed",
  fulfillment_pending: "Purchase fulfillment is still processing",
  service_unavailable: "Service temporarily unavailable",
};

/** HTTP status hints for stable codes (not part of public wire format). */
export const STABLE_ERROR_STATUS: Readonly<Record<StableErrorCode, number>> = {
  invalid_key_format: 400,
  invalid_key_signature: 401,
  key_rotated: 409,
  entitlement_suspended: 403,
  entitlement_refunded: 403,
  entitlement_revoked: 403,
  seat_limit: 409,
  challenge_expired: 400,
  challenge_replayed: 409,
  device_signature_invalid: 401,
  clock_skew: 400,
  unsupported_client: 400,
  unsupported_architecture: 400,
  device_deactivated: 403,
  lease_expired: 401,
  lease_device_mismatch: 403,
  grant_expired: 410,
  grant_used: 409,
  grant_binding_mismatch: 403,
  legacy_key_unsupported: 400,
  legacy_key_not_allowlisted: 404,
  legacy_exchange_closed: 410,
  fulfillment_pending: 503,
  service_unavailable: 503,
};

export function isStableErrorCode(code: string): code is StableErrorCode {
  return (STABLE_ERROR_CODES as readonly string[]).includes(code);
}
