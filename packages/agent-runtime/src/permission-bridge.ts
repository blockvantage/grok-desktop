/**
 * Correlates provider-side human permission waits (ACP ask / plan review)
 * with gateway runner approve/reject decisions.
 */
export type HumanPermissionDecision = "allow" | "deny" | "allow_once";

/** Default TTL so a missed exit path cannot wedge a CLI permission forever. */
export const HUMAN_PERMISSION_TTL_MS = 5 * 60_000;

const waiters = new Map<
  string,
  {
    resolve: (d: HumanPermissionDecision) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

export function waitHumanPermission(
  requestId: string,
  ttlMs: number = HUMAN_PERMISSION_TTL_MS,
): Promise<HumanPermissionDecision> {
  return new Promise((resolve, reject) => {
    const existing = waiters.get(requestId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error("permission_replaced"));
      waiters.delete(requestId);
    }
    const timer = setTimeout(() => {
      const w = waiters.get(requestId);
      if (!w) return;
      waiters.delete(requestId);
      w.reject(new Error("permission_timeout"));
    }, ttlMs);
    timer.unref?.();
    waiters.set(requestId, { resolve, reject, timer });
  });
}

export function resolveHumanPermission(
  requestId: string,
  decision: HumanPermissionDecision,
): void {
  const w = waiters.get(requestId);
  if (!w) return;
  waiters.delete(requestId);
  clearTimeout(w.timer);
  w.resolve(decision);
}

export function rejectHumanPermission(
  requestId: string,
  reason = "permission cancelled",
): void {
  const w = waiters.get(requestId);
  if (!w) return;
  waiters.delete(requestId);
  clearTimeout(w.timer);
  w.reject(new Error(reason));
}

export function clearHumanPermissions(): void {
  for (const [, w] of waiters) {
    clearTimeout(w.timer);
    w.reject(new Error("cleared"));
  }
  waiters.clear();
}

export function humanPermissionPendingCount(): number {
  return waiters.size;
}
