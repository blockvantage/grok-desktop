/**
 * Entitlement and desktop license states — frozen with landing contracts
 * and the desktop entitlement enforcement design.
 */

/** Server-side entitlement lifecycle states (landing entitlement-api). */
export const ENTITLEMENT_STATES = [
  "active",
  "suspended",
  "chargeback_pending",
  "refunded",
  "revoked",
  "manual_review",
] as const;

export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];

/**
 * Safe renderer / desktop license UX states.
 * Explicit rather than inferred from booleans.
 */
export const DESKTOP_LICENSE_STATES = [
  "unactivated",
  "activating",
  "active",
  "refresh_due",
  "offline_grace",
  "seat_limit",
  "suspended",
  "refunded",
  "revoked",
  "lease_expired",
  "service_unavailable",
  "device_deactivated",
  "read_only",
  "credential_store_failure",
  "migration_required",
] as const;

export type DesktopLicenseState = (typeof DESKTOP_LICENSE_STATES)[number];

/** Capability categories for gateway/main entitlement guards. */
export const ENTITLEMENT_CAPABILITY_CATEGORIES = [
  "grok_operation",
  "local_read",
  "local_manage",
  "recovery",
] as const;

export type EntitlementCapabilityCategory =
  (typeof ENTITLEMENT_CAPABILITY_CATEGORIES)[number];

/** Subset of desktop states that allow Grok-backed operations. */
export const GROK_OPERATION_ALLOWED_STATES: readonly DesktopLicenseState[] = [
  "active",
  "refresh_due",
  "offline_grace",
];
