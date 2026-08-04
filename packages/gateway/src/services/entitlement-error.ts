/**
 * Safe entitlement enforcement errors for the gateway.
 *
 * Failure surface is always `entitlement_read_only` with a safe desktop state
 * and the blocked action — never lease tokens, claims, product keys, or crypto
 * causes.
 */

import type {
  DesktopLicenseState,
  EntitlementCapabilityCategory,
  StableErrorCode,
} from "@grokdesk/shared";

/** Gateway wire/local code when a Grok-backed op is refused. */
export const ENTITLEMENT_READ_ONLY_CODE = "entitlement_read_only" as const;
export type EntitlementReadOnlyCode = typeof ENTITLEMENT_READ_ONLY_CODE;

/** Underlying denial reason (safe; no secrets). Not always a StableErrorCode. */
export type EntitlementDenialCode =
  | StableErrorCode
  | "unactivated"
  | "unknown_key"
  | "corrupt_state"
  | "managed_runtime_unavailable"
  | "update_readiness_unavailable"
  | "admission_paused"
  | "security_block"
  | "readiness_state_invalid";

export type EntitlementReadOnlyErrorInit = {
  state: DesktopLicenseState;
  action: string;
  capability: EntitlementCapabilityCategory;
  /** Optional safe underlying code for diagnostics/receipts (no secrets). */
  denialCode?: EntitlementDenialCode;
};

/**
 * Thrown when `grok_operation` (or another gated capability) is denied.
 * Properties are intentionally limited to safe fields.
 */
export class EntitlementReadOnlyError extends Error {
  readonly code: EntitlementReadOnlyCode = ENTITLEMENT_READ_ONLY_CODE;
  readonly state: DesktopLicenseState;
  readonly action: string;
  readonly capability: EntitlementCapabilityCategory;
  readonly denialCode?: EntitlementDenialCode;

  constructor(init: EntitlementReadOnlyErrorInit) {
    super("Entitlement is read-only for this operation");
    this.name = "EntitlementReadOnlyError";
    this.state = init.state;
    this.action = init.action;
    this.capability = init.capability;
    if (init.denialCode !== undefined) {
      this.denialCode = init.denialCode;
    }
  }

  /** JSON-safe view — never includes lease/claims. */
  toJSON(): {
    code: EntitlementReadOnlyCode;
    state: DesktopLicenseState;
    action: string;
    capability: EntitlementCapabilityCategory;
    denialCode?: EntitlementDenialCode;
    message: string;
  } {
    return {
      code: this.code,
      state: this.state,
      action: this.action,
      capability: this.capability,
      ...(this.denialCode !== undefined
        ? { denialCode: this.denialCode }
        : {}),
      message: this.message,
    };
  }
}

export function isEntitlementReadOnlyError(
  err: unknown,
): err is EntitlementReadOnlyError {
  return (
    err instanceof EntitlementReadOnlyError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "EntitlementReadOnlyError" &&
      (err as { code?: string }).code === ENTITLEMENT_READ_ONLY_CODE)
  );
}
