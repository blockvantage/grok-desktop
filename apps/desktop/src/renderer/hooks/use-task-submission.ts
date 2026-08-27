/**
 * Task 16: root create + follow-up submission orchestration.
 * Single busy flag (`starting`) and stable mutation ids — no duplicated
 * delivery state.
 */
import { useCallback } from "react";
import type { OutboxRunSettings, Task, TaskAttachment } from "@grokdesk/shared";
import type { OutboxEnqueueResult } from "@grokdesk/shared";
import {
  beginMutation,
  clearPendingMutation,
  newClientMutationId,
  readPendingMutation,
} from "@/lib/client-mutation";
import {
  buildOutboxFollowUpParams,
  FOLLOW_UP_OUTBOX_METHOD,
} from "@/lib/outbox-follow-up";
import { canFollowUpOnTask } from "@/lib/create-task-optimistic";
import { shouldBlockNewRootSubmit } from "@/lib/home-draft-hydrate";

export type TaskSubmissionRpc = <T>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

export type UseTaskSubmissionOpts = {
  starting: boolean;
  setStarting: (v: boolean) => void;
  rpc: TaskSubmissionRpc;
  /** Refresh outbox projection after accepted follow-up enqueue. */
  refreshOutbox: () => void;
  onFollowUpAccepted?: () => void;
  onFollowUpRejected?: (kind: "full" | "failed") => void;
  onFollowUpError?: (error: unknown) => void;
};

/**
 * Follow-up submission always goes through outbox.enqueue.
 * Returns false when busy, blocked, or enqueue was not accepted.
 */
export function useTaskSubmission(opts: UseTaskSubmissionOpts) {
  const followUpTask = useCallback(
    async (input: {
      goalText: string;
      base: Task | null | undefined;
      conversationId: string | null | undefined;
      attachments?: TaskAttachment[];
      clientMutationId?: string;
      revisionOfTaskId?: string;
      runSettings?: OutboxRunSettings;
    }): Promise<boolean> => {
      if (opts.starting) return false;
      if (!canFollowUpOnTask(input.base)) return false;
      const conversationId = input.conversationId ?? input.base!.id;
      const mutationId =
        input.clientMutationId?.trim() || newClientMutationId();
      opts.setStarting(true);
      try {
        const params = buildOutboxFollowUpParams({
          conversationId,
          parentTaskId: input.base!.id,
          text: input.goalText,
          clientMutationId: mutationId,
          attachments: input.attachments,
          revisionOfTaskId: input.revisionOfTaskId,
          entryPoint: input.revisionOfTaskId ? "revision" : "composer",
          runSettings: input.runSettings,
        });
        const { entryPoint: _ep, ...enqueueBody } = params;
        const result = await opts.rpc<OutboxEnqueueResult>(
          FOLLOW_UP_OUTBOX_METHOD,
          enqueueBody as Record<string, unknown>,
        );
        if (result.outcome !== "accepted") {
          opts.onFollowUpRejected?.(
            result.outcome === "full" ? "full" : "failed",
          );
          return false;
        }
        opts.refreshOutbox();
        opts.onFollowUpAccepted?.();
        return true;
      } catch (e) {
        opts.onFollowUpError?.(e);
        return false;
      } finally {
        opts.setStarting(false);
      }
    },
    [opts],
  );

  /**
   * Persist pending root create before RPC. Caller owns optimistic UI.
   */
  const beginRootCreate = useCallback(
    (createBody: Record<string, unknown>, fallbackMutationId: string) => {
      if (shouldBlockNewRootSubmit(readPendingMutation())) {
        return { blocked: true as const, pending: null };
      }
      const pending = beginMutation({
        method: "tasks.create",
        payload: createBody,
        clientMutationId:
          typeof createBody.clientMutationId === "string"
            ? createBody.clientMutationId
            : fallbackMutationId,
      });
      return { blocked: false as const, pending };
    },
    [],
  );

  const completeRootCreate = useCallback(() => {
    clearPendingMutation();
  }, []);

  return {
    followUpTask,
    beginRootCreate,
    completeRootCreate,
    readPendingMutation,
  };
}
