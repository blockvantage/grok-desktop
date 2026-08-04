/**
 * Grok account auth surface for the gateway (composition uses engine-composition).
 * Keeps OAuth/login/logout out of the main Gateway class body.
 */
import type { AuthState } from "@grokdesk/shared";
import {
  completeGrokSignOut,
  resolveManagedGrokBinary,
  getGrokAuthStatus,
  startGrokLogin,
} from "../engine-composition.js";

export async function authStatus(): Promise<
  AuthState & { models?: string[] }
> {
  const st = await getGrokAuthStatus();
  return {
    signedIn: st.signedIn,
    accountLabel: st.accountLabel,
    accountName: st.accountName,
    needsReauth: st.needsReauth,
    engineStatus: st.engineStatus,
    models: st.models,
  } as AuthState & { models?: string[] };
}

export async function authSignIn(): Promise<{ ok: boolean; message: string }> {
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
 * Sign out of SuperGrok for Desk:
 * 1) `grok logout` when managed CLI is available
 * 2) clear `~/.grok/auth.json` so status cannot flip back to signed-in from stale tokens
 * Returns whether the session is actually gone (not a silent always-ok).
 */
export async function authSignOut(): Promise<{
  ok: boolean;
  signedOut: boolean;
  message?: string;
}> {
  const binary = await resolveManagedGrokBinary();
  const result = await completeGrokSignOut({ binary });
  return {
    ok: result.ok,
    signedOut: result.signedOut,
    message: result.message,
  };
}
