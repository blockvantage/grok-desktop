/**
 * Grok account auth surface for the gateway (composition uses engine-composition).
 * Keeps OAuth/login/logout out of the main Gateway class body.
 *
 * Desk sign-out is overlay-only (`deskSignedOut` settings flag). It must never
 * run `grok logout` or delete ~/.grok/auth.json — that file is the shared CLI
 * session.
 */
import type { AuthState } from "@grokdesk/shared";
import {
  overlayDeskSignedOut,
  resolveManagedGrokBinary,
  getGrokAuthStatus,
  startGrokLogin,
} from "../engine-composition.js";

export async function authStatus(opts?: {
  deskSignedOut?: boolean;
}): Promise<AuthState & { models?: string[] }> {
  const st = await getGrokAuthStatus();
  const overlaid = overlayDeskSignedOut(st, Boolean(opts?.deskSignedOut));
  return {
    signedIn: overlaid.signedIn,
    accountLabel: overlaid.accountLabel,
    accountName: overlaid.accountName,
    needsReauth: overlaid.needsReauth,
    engineStatus: overlaid.engineStatus,
    models: overlaid.models,
  };
}

export async function authSignIn(opts?: {
  clearDeskSignedOut?: () => void;
}): Promise<{ ok: boolean; message: string; reusedSession?: boolean }> {
  opts?.clearDeskSignedOut?.();
  const existing = await getGrokAuthStatus();
  if (existing.signedIn) {
    return {
      ok: true,
      reusedSession: true,
      message: "Using your existing SuperGrok session.",
    };
  }
  const binary = await resolveManagedGrokBinary();
  if (!binary) {
    return {
      ok: false,
      message:
        "Managed Grok runtime is not installed. Open Settings → Updates to install Grok, then try again.",
    };
  }
  const login = await startGrokLogin(binary, { oauth: true });
  if (login.skipped) {
    return {
      ok: true,
      message:
        "Login dry-run (tests/CI): browser not opened. Set GROKDESK_SKIP_BROWSER_LOGIN=0 to force OAuth.",
    };
  }
  return {
    ok: true,
    message:
      "Opened Grok login (OAuth). Complete sign-in in the browser, then click Refresh status.",
  };
}

/**
 * Desk-only sign-out. Caller persists `deskSignedOut: true`. Does not unlink
 * ~/.grok/auth.json and does not run `grok logout`.
 */
export async function authSignOut(opts?: {
  persistDeskSignedOut?: () => void;
}): Promise<{
  ok: boolean;
  signedOut: boolean;
  message?: string;
}> {
  opts?.persistDeskSignedOut?.();
  return { ok: true, signedOut: true };
}
