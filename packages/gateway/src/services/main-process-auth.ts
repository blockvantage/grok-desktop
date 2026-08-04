/**
 * SuperGrok usage/privacy/billing must stay in Electron main (token boundary).
 * Gateway rejects mis-routed methods so tokens never flow through the child.
 */

export const MAIN_PROCESS_AUTH_METHODS = [
  "auth.usage",
  "auth.openBilling",
  "auth.openAccountPrivacy",
  "auth.privacy.get",
  "auth.privacy.set",
] as const;

export type MainProcessAuthMethod = (typeof MAIN_PROCESS_AUTH_METHODS)[number];

export function isMainProcessAuthMethod(
  method: string,
): method is MainProcessAuthMethod {
  return (MAIN_PROCESS_AUTH_METHODS as readonly string[]).includes(method);
}

/**
 * Error message when a SuperGrok main-only method is invoked on the gateway.
 */
export function mainProcessAuthErrorMessage(method: string): string {
  return `${method} must be handled by the desktop main process`;
}
