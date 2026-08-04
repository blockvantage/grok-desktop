/**
 * Canonical SuperGrok signed-in projection for shell surfaces.
 *
 * AccountController phase is the source of truth when resolved; auth.signedIn
 * is a fallback while phase is still checking / mid-sign-in.
 */
import type { AccountPhase } from "./account-state";

export type SignedInInput = {
  accountPhase?: AccountPhase | null;
  authSignedIn?: boolean | null;
};

/**
 * True when Home / Sidebar / Settings / palette should treat the user as signed in.
 */
export function isAccountSignedIn(input: SignedInInput): boolean {
  const phase = input.accountPhase ?? null;
  if (phase === "signed_in") return true;
  if (
    phase === "signed_out" ||
    phase === "reauth_required" ||
    phase === "signing_out"
  ) {
    return false;
  }
  // checking | signing_in | error | null  -  prefer last known auth flag
  return Boolean(input.authSignedIn);
}

/**
 * Whether sign-in should block Run / appear on the readiness checklist.
 * Never false-blocks while account status is still resolving.
 */
export function shouldBlockOnSignIn(input: {
  accountPhase?: AccountPhase | null;
  signedIn: boolean;
}): boolean {
  if (input.signedIn) return false;
  const phase = input.accountPhase ?? null;
  if (!phase || phase === "checking" || phase === "signing_in") {
    return false;
  }
  return true;
}

/**
 * Map controller phase + auth into readiness-facing flags.
 * Pure  -  used by readinessInputFromAppState and unit tests.
 */
export function readinessSignInFlags(input: SignedInInput): {
  signedIn: boolean;
  signInRequired: boolean;
  neverSignedIn: boolean;
} {
  const signedIn = isAccountSignedIn(input);
  const phase = input.accountPhase ?? null;
  const signInRequired = shouldBlockOnSignIn({
    accountPhase: phase,
    signedIn,
  });
  const neverSignedIn =
    !signedIn &&
    (phase === "signed_out" ||
      phase === null ||
      phase === "checking" ||
      phase === "error");
  return { signedIn, signInRequired, neverSignedIn };
}
