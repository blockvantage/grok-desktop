/**
 * On every transition to gateway `ready`, run one coalesced full resync.
 * Does not wait for the 30s safety poll.
 */
import { useEffect, useRef } from "react";

export type GatewayRecoveryStatus =
  | "ready"
  | "starting"
  | "restarting"
  | "dead"
  | "idle"
  | string;

export type GatewayResyncFns = {
  refreshTasks?: () => void | Promise<void>;
  refreshOutbox?: () => void | Promise<void>;
  refreshEvents?: () => void | Promise<void>;
  refreshAuth?: () => void | Promise<void>;
  refreshSideData?: () => void | Promise<void>;
  reconcilePendingRoot?: () => void | Promise<void>;
};

/**
 * Fire coalesced resync when status transitions into ready.
 * Concurrent ready edges collapse to a single in-flight pass.
 */
export function useGatewayRecovery(
  status: GatewayRecoveryStatus,
  resync: GatewayResyncFns,
): void {
  const prev = useRef<GatewayRecoveryStatus | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (status !== "ready") return;
    if (was === "ready") return;
    // First mount already ready, or transition into ready.
    if (inflight.current) return;

    const run = async () => {
      const fns = resyncRef.current;
      await Promise.allSettled([
        Promise.resolve(fns.refreshTasks?.()),
        Promise.resolve(fns.refreshOutbox?.()),
        Promise.resolve(fns.refreshEvents?.()),
        Promise.resolve(fns.refreshAuth?.()),
        Promise.resolve(fns.refreshSideData?.()),
        Promise.resolve(fns.reconcilePendingRoot?.()),
      ]);
    };
    inflight.current = run().finally(() => {
      inflight.current = null;
    });
  }, [status]);
}

/** Pure helper for tests: should we resync on this edge? */
export function shouldResyncOnReadyEdge(
  previous: GatewayRecoveryStatus | null,
  next: GatewayRecoveryStatus,
): boolean {
  return next === "ready" && previous !== "ready";
}
