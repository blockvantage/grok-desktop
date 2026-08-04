/**
 * Shared Grok admission helper.
 *
 * Free Desk: product-license fail-closed is retired. When a guard is present
 * (e.g. managed-runtime readiness), it is authoritative. When absent, admit.
 * SuperGrok auth remains a separate concern outside this helper.
 */

import type { EntitlementGuard } from "./entitlement-guard.js";

export type EnvLike = Record<string, string | undefined>;

/**
 * Desk product-license fail-closed is always off (free app).
 * Kept for call-site compatibility; always returns false.
 */
export function isEntitlementFailClosed(
  _env: EnvLike = process.env as EnvLike,
): boolean {
  return false;
}

/**
 * Sync admission for submit/scheduler. Throws when a wired guard denies.
 * No-op when no guard is installed (free Desk / unit tests).
 */
export function requireGrokAdmissionSync(
  guard: EntitlementGuard | null | undefined,
  action: string,
  _env: EnvLike = process.env as EnvLike,
): void {
  if (guard) {
    guard.assertCapabilitySync("grok_operation", action);
  }
}

/**
 * Async admission for runner/remote. Same free-app semantics as sync.
 */
export async function requireGrokAdmission(
  guard: EntitlementGuard | null | undefined,
  action: string,
  _env: EnvLike = process.env as EnvLike,
): Promise<void> {
  if (guard) {
    await guard.assertCapability("grok_operation", action);
  }
}
