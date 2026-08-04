/**
 * Pure toast intents for auth.signIn start + poll completion (Phase 6 extract).
 * Also covers sign-out outcome toasts.
 */

export type SignInStartToast = {
  description: string;
  variant: "default" | "destructive";
};

/**
 * Toast after auth.signIn RPC returns.
 */
export function signInStartToast(
  res: { ok: boolean; message: string },
  completeLoginLabel: string,
): SignInStartToast {
  return {
    description: res.ok ? completeLoginLabel : res.message,
    variant: res.ok ? "default" : "destructive",
  };
}

/**
 * Success toast after sign-in poll detects signed-in state.
 */
export function signedInSuccessToast(
  accountLabel: string | null | undefined,
  signedInAs: (name: string) => string,
  fallbackName = "SuperGrok",
): { description: string; variant: "success" } {
  return {
    description: signedInAs(accountLabel ?? fallbackName),
    variant: "success",
  };
}

export type SignOutRpcResult = {
  ok?: boolean;
  signedOut?: boolean;
  message?: string;
};

/**
 * Optimistic signed-out AuthState for immediate UI feedback (before refresh).
 */
export function signedOutAuthState(): {
  signedIn: false;
  accountLabel: null;
  accountName: null;
  needsReauth: false;
  engineStatus: "needs_auth";
  models: string[];
} {
  return {
    signedIn: false,
    accountLabel: null,
    accountName: null,
    needsReauth: false,
    engineStatus: "needs_auth",
    models: [],
  };
}

/**
 * Toast after auth.signOut completes (or fails).
 */
export function signOutResultToast(
  res: SignOutRpcResult | null | undefined,
  labels: { signedOut: string; failed: string },
): { description: string; variant: "default" | "destructive" | "success" } {
  if (res?.signedOut) {
    return { description: labels.signedOut, variant: "success" };
  }
  if (res?.message) {
    return { description: res.message, variant: "destructive" };
  }
  return { description: labels.failed, variant: "destructive" };
}
