/**
 * License-package error surface. Prefer shared stable codes for wire errors.
 * Crypto-local codes (unknown_key, sequence_rollback) stay package-private.
 */

export {
  STABLE_ERROR_CODES,
  stableErrorCodes,
  STABLE_ERROR_MESSAGES,
  STABLE_ERROR_STATUS,
  isStableErrorCode,
  type StableErrorCode,
} from "@grokdesk/shared";

/** Alias used by lease decision types. */
export type StableEntitlementError = import("@grokdesk/shared").StableErrorCode;

export type CryptoLocalErrorCode =
  | "unknown_key"
  | "sequence_rollback"
  | "multiple_keys"
  | "hmac_disabled";

export type LicenseVerifyErrorCode =
  | StableEntitlementError
  | CryptoLocalErrorCode;
