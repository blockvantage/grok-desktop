/**
 * Gateway entitlement redaction surfaces.
 *
 * Stdio / remote frames carry only safe codes. Internal causes stay local and
 * are commerce-redacted before any diagnostic dump. Fetch bodies are never
 * logged through these helpers.
 */

import {
  formatSafeEntitlementLog,
  redactCommerceSecrets,
  redactCommerceValue,
  toSafeEntitlementWireError,
  type SafeEntitlementLogFields,
} from "@grokdesk/shared";
import {
  EntitlementReadOnlyError,
  isEntitlementReadOnlyError,
  type EntitlementReadOnlyErrorInit,
} from "./entitlement-error.js";

export {
  formatSafeEntitlementLog,
  redactCommerceSecrets,
  redactCommerceValue,
  toSafeEntitlementWireError,
  type SafeEntitlementLogFields,
};

/**
 * Stdio / remote error frame for entitlement denials.
 * Separate from internal Exception details — never includes lease/claims/keys.
 */
export type SafeEntitlementStdioFrame = {
  code: "entitlement_read_only";
  state: string;
  action: string;
  capability: string;
  denialCode?: string;
  message: string;
};

/**
 * Map any entitlement denial (or unknown throw) to a safe stdio/remote frame.
 * Unknown values collapse to service_unavailable-shaped read-only without
 * leaking free-form text.
 */
export function toSafeEntitlementStdioFrame(
  err: unknown,
  fallback: Partial<EntitlementReadOnlyErrorInit> = {},
): SafeEntitlementStdioFrame {
  if (isEntitlementReadOnlyError(err)) {
    const frame: SafeEntitlementStdioFrame = {
      code: "entitlement_read_only",
      state: err.state,
      action: err.action,
      capability: err.capability,
      message: "Entitlement is read-only for this operation",
    };
    if (err.denialCode !== undefined) {
      frame.denialCode = err.denialCode;
    }
    return frame;
  }

  const wire = toSafeEntitlementWireError({
    code: "entitlement_read_only",
    state: fallback.state ?? "read_only",
    action: fallback.action ?? "unknown",
    capability: fallback.capability ?? "grok_operation",
    denialCode: fallback.denialCode ?? "service_unavailable",
  });

  return {
    code: "entitlement_read_only",
    state: wire.state ?? "read_only",
    action: wire.action ?? "unknown",
    capability: wire.capability ?? "grok_operation",
    denialCode: wire.denialCode,
    message: "Entitlement is read-only for this operation",
  };
}

/**
 * Build the JSON-lines stdio error payload (`{ id, ok: false, error }`).
 * `error` is either a stable string code or a safe frame object — never raw
 * exception text that may contain canaries.
 */
export function toStdioErrorPayload(
  id: string | null | undefined,
  err: unknown,
): { id: string | null | undefined; ok: false; error: SafeEntitlementStdioFrame | string } {
  if (isEntitlementReadOnlyError(err) || err instanceof EntitlementReadOnlyError) {
    return {
      id,
      ok: false,
      error: toSafeEntitlementStdioFrame(err),
    };
  }
  // Non-entitlement errors: redact free-form message as a last line of defense.
  const raw = err instanceof Error ? err.message : String(err);
  return {
    id,
    ok: false,
    error: redactCommerceSecrets(raw),
  };
}

/**
 * Redact free-form diagnostic text before writing gateway logs.
 */
export function redactGatewayDiagnosticText(text: string): string {
  return redactCommerceSecrets(text);
}
