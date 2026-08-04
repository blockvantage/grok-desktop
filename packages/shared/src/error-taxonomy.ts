/**
 * Classify engine/task error messages for desktop recovery UX.
 * Pure — no I/O. Keep in sync with Grok Build usage/rate-limit strings.
 */

import type { DesktopErrorCode } from "./desktop-types.js";
import { DESKTOP_RECOVERY_COPY } from "./desktop-types.js";

export type RecoveryKind =
  | "usage_exhausted"
  | "usage_limit"
  | "rate_limited"
  | "needs_reauth"
  | "context_pressure"
  | "desktop_permission"
  | "desktop_paused"
  | "desktop_disabled"
  | "generic";

export interface ClassifiedError {
  kind: RecoveryKind;
  retryable: boolean;
  desktopCode?: DesktopErrorCode;
}

export function classifyEngineError(message: string): ClassifiedError {
  const m = message.toLowerCase();
  if (
    /usage_pool_exhausted|out of (credits|balance)|no credits|credit limit/i.test(
      m,
    )
  ) {
    return { kind: "usage_exhausted", retryable: false };
  }
  if (/usage_limit_reached|spending cap|monthly limit/i.test(m)) {
    return { kind: "usage_limit", retryable: false };
  }
  if (
    /desktop_rate_limited|rate.?limit|too many requests|\b429\b/i.test(m)
  ) {
    return { kind: "rate_limited", retryable: true };
  }
  if (
    /not logged|please\s+log\s*in|unauthorized|invalid.?token|reauth|\b401\b/i.test(
      m,
    )
  ) {
    return { kind: "needs_reauth", retryable: false };
  }
  if (
    /context (window|length)|maximum context|prompt too long|compact/i.test(m)
  ) {
    return { kind: "context_pressure", retryable: true };
  }
  if (/desktop_permission_|screen recording|accessibility/i.test(m)) {
    return { kind: "desktop_permission", retryable: false };
  }
  if (/desktop_paused|desktop_yielded/i.test(m)) {
    return { kind: "desktop_paused", retryable: true };
  }
  if (/desktop_disabled_/i.test(m)) {
    return { kind: "desktop_disabled", retryable: false };
  }
  return { kind: "generic", retryable: false };
}

/** Map stable desktop error codes to recovery UX. */
export function classifyDesktopCode(code: DesktopErrorCode): ClassifiedError {
  switch (code) {
    case "desktop_permission_capture":
    case "desktop_permission_input":
    case "desktop_capture_failed":
    case "desktop_input_failed":
      return { kind: "desktop_permission", retryable: false, desktopCode: code };
    case "desktop_paused":
    case "desktop_yielded":
      return { kind: "desktop_paused", retryable: true, desktopCode: code };
    case "desktop_disabled_machine":
    case "desktop_disabled_task":
      return { kind: "desktop_disabled", retryable: false, desktopCode: code };
    case "desktop_rate_limited":
      return { kind: "rate_limited", retryable: true, desktopCode: code };
    default:
      return { kind: "generic", retryable: false, desktopCode: code };
  }
}

export function desktopRecoveryMessage(code: DesktopErrorCode): string {
  return DESKTOP_RECOVERY_COPY[code] ?? DESKTOP_RECOVERY_COPY.desktop_invalid_args;
}
