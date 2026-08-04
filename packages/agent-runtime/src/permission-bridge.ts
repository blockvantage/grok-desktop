/**
 * Correlates provider-side human permission waits (ACP ask / plan review)
 * with gateway runner approve/reject decisions.
 */
export type HumanPermissionDecision = "allow" | "deny" | "allow_once";

const waiters = new Map<
  string,
  {
    resolve: (d: HumanPermissionDecision) => void;
    reject: (e: Error) => void;
  }
>();

export function waitHumanPermission(
  requestId: string,
): Promise<HumanPermissionDecision> {
  return new Promise((resolve, reject) => {
    waiters.set(requestId, { resolve, reject });
  });
}

export function resolveHumanPermission(
  requestId: string,
  decision: HumanPermissionDecision,
): void {
  const w = waiters.get(requestId);
  if (!w) return;
  waiters.delete(requestId);
  w.resolve(decision);
}

export function rejectHumanPermission(
  requestId: string,
  reason = "permission cancelled",
): void {
  const w = waiters.get(requestId);
  if (!w) return;
  waiters.delete(requestId);
  w.reject(new Error(reason));
}

export function clearHumanPermissions(): void {
  for (const [, w] of waiters) {
    w.reject(new Error("cleared"));
  }
  waiters.clear();
}

export function humanPermissionPendingCount(): number {
  return waiters.size;
}
