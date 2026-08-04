/**
 * auth.* IPC dispatch (Phase 6 extract from Gateway.dispatch).
 * SuperGrok usage/privacy/billing must stay in Electron main (token boundary).
 */

export type AuthDispatchDeps = {
  authStatus: () => unknown | Promise<unknown>;
  authSignIn: () => unknown | Promise<unknown>;
  authSignOut: () => unknown | Promise<unknown>;
  isMainProcessAuthMethod: (method: string) => boolean;
  mainProcessAuthErrorMessage: (method: string) => string;
};

export const AUTH_METHODS = new Set([
  "auth.status",
  "auth.signIn",
  "auth.signOut",
  "auth.usage",
  "auth.openBilling",
  "auth.openAccountPrivacy",
  "auth.privacy.get",
  "auth.privacy.set",
]);

export function isAuthMethod(method: string): boolean {
  return AUTH_METHODS.has(method);
}

/**
 * Dispatch auth methods. Main-process-only methods throw a clear error.
 */
export async function dispatchAuthMethod(
  method: string,
  deps: AuthDispatchDeps,
): Promise<unknown> {
  switch (method) {
    case "auth.status":
      return deps.authStatus();
    case "auth.signIn":
      return deps.authSignIn();
    case "auth.signOut":
      return deps.authSignOut();
    case "auth.usage":
    case "auth.openBilling":
    case "auth.openAccountPrivacy":
    case "auth.privacy.get":
    case "auth.privacy.set":
      // SuperGrok usage/privacy/billing are handled in Electron main (token boundary).
      // Gateway rejects if mis-routed so tokens never flow through the child process.
      if (!deps.isMainProcessAuthMethod(method)) {
        throw new Error(`Unhandled method: ${method}`);
      }
      throw new Error(deps.mainProcessAuthErrorMessage(method));
    default:
      throw new Error(`Unhandled auth method: ${method}`);
  }
}
