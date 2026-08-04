import type { DesktopLicenseState, StableErrorCode } from "@grokdesk/shared";
import type { DeviceLeaseClaims } from "./lease.js";
import type { StableEntitlementError } from "./errors.js";

/**
 * Derive desktop entitlement UX state from a verified lease and context.
 * Never mutates lease `exp` — network failures preserve the original expiry.
 */

export type LeaseDecision =
  | {
      ok: true;
      claims: DeviceLeaseClaims;
      state: Extract<
        DesktopLicenseState,
        "active" | "refresh_due" | "offline_grace"
      >;
    }
  | {
      ok: false;
      code: StableEntitlementError;
      state: DesktopLicenseState;
    };

export type AuthoritativeDenial = {
  code: Extract<
    StableErrorCode,
    | "entitlement_suspended"
    | "entitlement_refunded"
    | "entitlement_revoked"
    | "device_deactivated"
    | "seat_limit"
    | "key_rotated"
  >;
};

export type DeriveEntitlementStateInput = {
  /** Last cryptographically verified lease claims, if any. */
  claims?: DeviceLeaseClaims | null;
  /** Authoritative server denial (signed/API). Takes precedence. */
  denial?: AuthoritativeDenial | null;
  /** True when the last refresh/activation attempt failed with network/5xx/429. */
  networkError?: boolean;
  /** Unix seconds. */
  nowSeconds?: number;
};

export function deriveEntitlementState(
  input: DeriveEntitlementStateInput,
): LeaseDecision {
  if (input.denial) {
    return {
      ok: false,
      code: input.denial.code,
      state: denialToDesktopState(input.denial.code),
    };
  }

  const claims = input.claims;
  if (!claims) {
    return {
      ok: false,
      code: "invalid_key_format",
      state: "unactivated",
    };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (claims.exp <= now) {
    return {
      ok: false,
      code: "lease_expired",
      state: "lease_expired",
    };
  }

  // Network errors preserve a still-valid lease until original exp.
  if (input.networkError) {
    return {
      ok: true,
      claims,
      state: "offline_grace",
    };
  }

  if (now >= claims.refreshAfter) {
    return {
      ok: true,
      claims,
      state: "refresh_due",
    };
  }

  return {
    ok: true,
    claims,
    state: "active",
  };
}

function denialToDesktopState(
  code: AuthoritativeDenial["code"],
): DesktopLicenseState {
  switch (code) {
    case "entitlement_suspended":
      return "suspended";
    case "entitlement_refunded":
      return "refunded";
    case "entitlement_revoked":
      return "revoked";
    case "device_deactivated":
      return "device_deactivated";
    case "seat_limit":
      return "seat_limit";
    case "key_rotated":
      return "read_only";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
