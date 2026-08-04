/**
 * Task 16: coalesced app resync on gateway ready edges.
 * Single place for recovery callbacks — no duplicated poll owners.
 */
import { useGatewayRecovery } from "@/hooks/use-gateway-recovery";
import type { GatewayUiStatus } from "@/lib/api";
import {
  clearPendingMutation,
  readPendingMutation,
} from "@/lib/client-mutation";
import type { Task } from "@grokdesk/shared";

export type AppSyncRpc = <T>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

export type UseAppSyncOpts = {
  gatewayUiStatus: GatewayUiStatus;
  refreshTasks: () => void;
  refreshOutbox: () => void;
  refreshAuth: () => void;
  refreshSideData: () => void;
  refreshEvents: () => void;
  rpc: AppSyncRpc;
  onPendingRootAccepted: (task: Task) => void;
};

/**
 * Wire gateway recovery + pending root reconciliation once.
 */
export function useAppSync(opts: UseAppSyncOpts): void {
  useGatewayRecovery(opts.gatewayUiStatus, {
    refreshTasks: opts.refreshTasks,
    refreshOutbox: opts.refreshOutbox,
    refreshAuth: opts.refreshAuth,
    refreshSideData: opts.refreshSideData,
    refreshEvents: opts.refreshEvents,
    reconcilePendingRoot: () => {
      const pending = readPendingMutation();
      if (!pending || pending.method !== "tasks.create") return;
      void opts
        .rpc<Task>("tasks.create", {
          ...pending.payload,
          clientMutationId: pending.clientMutationId,
        })
        .then((task) => {
          clearPendingMutation();
          opts.onPendingRootAccepted(task);
        })
        .catch(() => {
          /* keep pending for another ready edge */
        });
    },
  });
}
