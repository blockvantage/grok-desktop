/**
 * Pure field extraction from RunContext for TaskRunner.runTask (Phase 6).
 */

export type RunContextLike = {
  systemPreamble?: string | null;
  requestId?: string | null;
} | null | undefined;

export function systemPreambleFromContext(ctx: RunContextLike): string {
  return ctx?.systemPreamble ?? "";
}

export function requestIdFromContext(ctx: RunContextLike): string | null {
  const id = ctx?.requestId;
  return typeof id === "string" && id ? id : null;
}
