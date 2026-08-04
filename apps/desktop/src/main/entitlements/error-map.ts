/**
 * Map entitlement service / local failures to safe renderer-facing codes.
 *
 * Never surfaces raw response bodies, crypto causes, stack traces, product keys,
 * nonces, proofs, or lease material.
 */

import {
  EntitlementApiError,
  isStableErrorCode,
  STABLE_ERROR_MESSAGES,
  type StableErrorCode,
} from "@grokdesk/entitlement-client";
import type { DesktopLicenseState } from "@grokdesk/shared";
import { isCredentialStoreError } from "./types.js";
import type { AuthoritativeState } from "./state-store.js";

/** Recovery actions exposed to the renderer (Task 6 DTO). */
export type RecoveryAction =
  | "none"
  | "retry"
  | "portal"
  | "purchase"
  | "credential_help";

export type MappedEntitlementError = {
  /** Stable service or local code (never free-form). */
  code: StableErrorCode | "credential_store_failure" | "unactivated";
  /** Safe desktop UX state. */
  state: DesktopLicenseState;
  recoveryAction: RecoveryAction;
  retryable: boolean;
  /** Safe human message from the frozen contract table only. */
  message: string;
  requestId?: string;
};

const STABLE_TO_STATE: Record<StableErrorCode, DesktopLicenseState> = {
  invalid_key_format: "unactivated",
  invalid_key_signature: "unactivated",
  key_rotated: "read_only",
  entitlement_suspended: "suspended",
  entitlement_refunded: "refunded",
  entitlement_revoked: "revoked",
  seat_limit: "seat_limit",
  challenge_expired: "service_unavailable",
  challenge_replayed: "service_unavailable",
  device_signature_invalid: "service_unavailable",
  clock_skew: "service_unavailable",
  unsupported_client: "read_only",
  unsupported_architecture: "read_only",
  device_deactivated: "device_deactivated",
  lease_expired: "lease_expired",
  lease_device_mismatch: "read_only",
  grant_expired: "service_unavailable",
  grant_used: "service_unavailable",
  grant_binding_mismatch: "service_unavailable",
  legacy_key_unsupported: "unactivated",
  legacy_key_not_allowlisted: "unactivated",
  legacy_exchange_closed: "unactivated",
  fulfillment_pending: "service_unavailable",
  service_unavailable: "service_unavailable",
};

const STABLE_TO_RECOVERY: Record<StableErrorCode, RecoveryAction> = {
  invalid_key_format: "retry",
  invalid_key_signature: "retry",
  key_rotated: "portal",
  entitlement_suspended: "portal",
  entitlement_refunded: "portal",
  entitlement_revoked: "portal",
  seat_limit: "portal",
  challenge_expired: "retry",
  challenge_replayed: "retry",
  device_signature_invalid: "retry",
  clock_skew: "retry",
  unsupported_client: "purchase",
  unsupported_architecture: "purchase",
  device_deactivated: "portal",
  lease_expired: "retry",
  lease_device_mismatch: "credential_help",
  grant_expired: "none",
  grant_used: "none",
  grant_binding_mismatch: "none",
  // GD1/H1 and non-allowlisted / post-sunset GD2 exchange: send user to purchase/portal path.
  legacy_key_unsupported: "purchase",
  legacy_key_not_allowlisted: "portal",
  legacy_exchange_closed: "purchase",
  fulfillment_pending: "retry",
  service_unavailable: "retry",
};

/** Authoritative denial codes that must be written to state immediately. */
export const AUTHORITATIVE_DENIAL_CODES = [
  "entitlement_suspended",
  "entitlement_refunded",
  "entitlement_revoked",
  "device_deactivated",
] as const satisfies readonly StableErrorCode[];

export type AuthoritativeDenialCode =
  (typeof AUTHORITATIVE_DENIAL_CODES)[number];

export function isAuthoritativeDenialCode(
  code: string,
): code is AuthoritativeDenialCode {
  return (AUTHORITATIVE_DENIAL_CODES as readonly string[]).includes(code);
}

export function denialCodeToAuthoritativeState(
  code: AuthoritativeDenialCode,
): Exclude<AuthoritativeState, "none"> {
  switch (code) {
    case "entitlement_suspended":
      return "suspended";
    case "entitlement_refunded":
      return "refunded";
    case "entitlement_revoked":
      return "revoked";
    case "device_deactivated":
      return "device_deactivated";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export function mapStableErrorCode(
  code: StableErrorCode,
  options: { requestId?: string; retryable?: boolean } = {},
): MappedEntitlementError {
  const retryable =
    options.retryable ??
    (code === "service_unavailable" ||
      code === "fulfillment_pending" ||
      code === "challenge_expired" ||
      code === "challenge_replayed" ||
      code === "clock_skew" ||
      code === "lease_expired");

  return {
    code,
    state: STABLE_TO_STATE[code],
    recoveryAction: STABLE_TO_RECOVERY[code],
    retryable,
    message: STABLE_ERROR_MESSAGES[code],
    requestId: options.requestId,
  };
}

/**
 * Map any thrown value to a safe error for renderer / logs.
 * Unknown values become service_unavailable without leaking detail.
 */
export function mapEntitlementError(err: unknown): MappedEntitlementError {
  if (isCredentialStoreError(err)) {
    return {
      code: "credential_store_failure",
      state: "credential_store_failure",
      recoveryAction: "credential_help",
      retryable: false,
      message: "Credential store is unavailable",
    };
  }

  if (err instanceof EntitlementApiError) {
    return mapStableErrorCode(err.code, {
      requestId: err.requestId,
      retryable: err.retryable,
    });
  }

  if (
    err &&
    typeof err === "object" &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    const code = (err as { code: string }).code;
    if (isStableErrorCode(code)) {
      const requestId =
        typeof (err as { requestId?: unknown }).requestId === "string"
          ? (err as { requestId: string }).requestId
          : undefined;
      const retryable =
        typeof (err as { retryable?: unknown }).retryable === "boolean"
          ? (err as { retryable: boolean }).retryable
          : undefined;
      return mapStableErrorCode(code, { requestId, retryable });
    }
    if (code === "credential_store_failure") {
      return {
        code: "credential_store_failure",
        state: "credential_store_failure",
        recoveryAction: "credential_help",
        retryable: false,
        message: "Credential store is unavailable",
      };
    }
    if (code === "multiple_keys" || code === "invalid_key_format") {
      return mapStableErrorCode("invalid_key_format");
    }
  }

  if (err instanceof Error) {
    if (err.message === "multiple_keys" || err.message === "invalid_key_format") {
      return mapStableErrorCode("invalid_key_format");
    }
  }

  return mapStableErrorCode("service_unavailable", { retryable: true });
}

/** Recovery action for a successful / derived desktop state (no error). */
export function recoveryActionForState(
  state: DesktopLicenseState,
): RecoveryAction {
  switch (state) {
    case "active":
    case "refresh_due":
    case "offline_grace":
    case "activating":
      return "none";
    case "unactivated":
      return "purchase";
    case "seat_limit":
    case "suspended":
    case "refunded":
    case "revoked":
    case "device_deactivated":
      return "portal";
    case "lease_expired":
    case "service_unavailable":
      return "retry";
    case "read_only":
      return "portal";
    case "credential_store_failure":
      return "credential_help";
    case "migration_required":
      return "retry";
    default:
      return "none";
  }
}
