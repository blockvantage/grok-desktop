/**
 * Pure helpers for SuperGrok sign-in polling loop (Phase 6 extract from App).
 */

export type AuthPollState = {
  signedIn: boolean;
  accountLabel?: string | null;
  models?: string[] | null;
};

/**
 * Decide whether to stop polling after an auth.status snapshot.
 */
export function shouldStopSignInPoll(state: AuthPollState): boolean {
  return Boolean(state.signedIn);
}

/**
 * Pick model when status returns a models list.
 * Keeps current if still listed; otherwise first available.
 */
export function resolveModelAfterAuth(
  currentModel: string,
  models: string[] | undefined | null,
  fallback = "grok-4.5",
): string {
  if (!models?.length) return currentModel;
  if (models.includes(currentModel)) return currentModel;
  return models[0] ?? fallback;
}

/** Default poll budget: 90 × 2s ≈ 3 minutes (matches App). */
export const SIGN_IN_POLL_ATTEMPTS = 90;
export const SIGN_IN_POLL_INTERVAL_MS = 2000;
