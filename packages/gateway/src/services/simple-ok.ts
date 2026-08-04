/**
 * Tiny IPC response shapes used by many mutation handlers.
 */

export function okResponse(): { ok: true } {
  return { ok: true };
}

export function okWithPayload<T extends Record<string, unknown>>(
  payload: T,
): { ok: true } & T {
  return { ok: true, ...payload };
}
