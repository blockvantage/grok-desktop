/**
 * Strip secrets / credentials / data URLs from diagnostic text.
 * Pure helpers — unit tested without Electron.
 *
 * Commerce secrets (product keys, leases, private keys, proofs, portal/magic/
 * grant tokens) are redacted via shared patterns. Prefer
 * `formatSafeEntitlementLog` for entitlement lifecycle telemetry so bodies
 * never enter the log path.
 */

import {
  formatSafeEntitlementLog,
  redactCommerceSecrets,
  redactSecretString,
  type EntitlementRetryClass,
  type SafeEntitlementLogFields,
} from "@grokdesk/shared";

export {
  formatSafeEntitlementLog,
  type EntitlementRetryClass,
  type SafeEntitlementLogFields,
};

/** Desktop-local patterns layered before shared commerce redaction. */
const LOCAL_PATTERNS: RegExp[] = [
  // API keys / tokens (assignment forms)
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd|authorization)\s*[=:]\s*["']?[^\s"',;]+/gi,
  // Loopback MCP host tokens (hex) — never echo in stderr/logs
  /\bGROKDESK_(?:BROWSER|DESKTOP)_TOKEN\s*[=:]\s*["']?[A-Fa-f0-9]{20,}/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bxai-[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi,
  // PEM blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z ]*PUBLIC KEY-----[\s\S]*?-----END [A-Z ]*PUBLIC KEY-----/g,
  // Data URLs (can be multi-MB)
  /data:(?:image|video|application)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of LOCAL_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, "[REDACTED]");
  }
  // Shared path covers GD1–GD3, lease JWT, PKCS#8, private JWK, field forms.
  out = redactSecretString(out);
  out = redactCommerceSecrets(out);
  return out;
}

/** Restart backoff delays in ms (attempt 0, 1, 2, …). */
export function restartBackoffMs(attempt: number): number {
  const base = 500;
  const capped = Math.min(attempt, 5);
  return base * Math.pow(2, capped);
}

export type GatewayLifecycleStatus =
  | "idle"
  | "starting"
  | "ready"
  | "restarting"
  | "dead";

export const MAX_GATEWAY_RESTARTS = 3;

/**
 * Decide whether to schedule another restart after an unexpected exit.
 */
export function shouldRestartGateway(opts: {
  intentionalStop: boolean;
  wasReady: boolean;
  restartCount: number;
  maxRestarts?: number;
}): boolean {
  if (opts.intentionalStop) return false;
  if (!opts.wasReady) return false;
  const max = opts.maxRestarts ?? MAX_GATEWAY_RESTARTS;
  return opts.restartCount < max;
}
