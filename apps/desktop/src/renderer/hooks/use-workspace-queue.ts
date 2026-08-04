/**
 * Follow-up message queue for a live workspace turn.
 * Durable by conversation id; race-safe claim; edit + undo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskAttachment } from "@grokdesk/shared";
import { attachmentsFromQueuedPaths } from "@/lib/message-queue";
import {
  claimDurable,
  completeDurableSend,
  editDurable,
  enqueueDurable,
  loadQueueStore,
  markDurablePending,
  purgeLastRemoved,
  queueForConversation,
  QUEUE_CLAIM_LEASE_MS,
  recoverExpiredClaims,
  releaseRecoveringClaims,
  removeDurableWithUndo,
  saveQueueStore,
  subscribeQueueStore,
  undoLastRemove,
  type DurableQueuedMessage,
  type QueueStoreSnapshot,
} from "@/lib/message-queue-store";
import {
  missingAttachmentPaths,
  workspacePathExists,
} from "@/lib/queue-attachments";

/** Keep recovery visible long enough to be perceived before retrying. */
export const QUEUE_RECOVERY_VISIBLE_MS = 500;

export function useWorkspaceQueue(opts: {
  /** Conversation root — queue is keyed by this, not the current turn task id. */
  conversationId: string | null | undefined;
  /** Active task id for mid-run interjection (ACP). */
  taskId?: string | null;
  isTerminal: boolean;
  /**
   * True only while the agent is actively producing a turn (running/queued).
   * The queue drains whenever this is false — i.e. as soon as the agent goes
   * idle (waiting_user/approval/blocked) OR terminal — not only on terminal, so
   * stacked replies are never stranded while the agent waits for the user.
   */
  agentBusy?: boolean;
  followUpBusy?: boolean;
  onFollowUp?: (
    goal: string,
    attachments?: TaskAttachment[],
    clientMutationId?: string,
  ) => void | Promise<boolean | void>;
  /**
   * Attempt ACP interjection; return delivered=true to drop the queued item.
   * Pass the queue item's clientMutationId so gateway/provider can dedupe
   * reloads the same way as tasks.followUp / tasks.create.
   */
  onInterject?: (
    taskId: string,
    text: string,
    clientMutationId: string,
  ) => void | Promise<{ delivered: boolean }>;
  onSendFailed?: () => void;
  /** Fired after a delete: `removedId` scopes this toast's Undo/purge. */
  onUndoAvailable?: (removedId: string) => void;
}) {
  const conversationId = opts.conversationId?.trim() || "";
  const [store, setStore] = useState<QueueStoreSnapshot>(() => loadQueueStore());
  // Ids with an ACP interjection RPC in flight. The ref is the synchronous
  // double-click guard; the state mirror lets the row disable its Send-now
  // button while delivery is pending (a queued item keeps no durable lease
  // during an interjection, so nothing else marks it locked).
  const interjectingRef = useRef<Set<string>>(new Set());
  const [interjectingIds, setInterjectingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const commitStore = useCallback((next: QueueStoreSnapshot) => {
    saveQueueStore(next);
    setStore(next);
  }, []);

  useEffect(() => {
    return subscribeQueueStore((next) => {
      setStore(next);
    });
  }, []);

  const messageQueue: DurableQueuedMessage[] = conversationId
    ? queueForConversation(store, conversationId)
    : [];

  useEffect(() => {
    const nextExpiry = messageQueue.reduce<number | null>((earliest, item) => {
      if (item.status !== "submitting" || !item.claimedAt) return earliest;
      const expiresAt = Date.parse(item.claimedAt) + QUEUE_CLAIM_LEASE_MS;
      if (!Number.isFinite(expiresAt)) return Date.now();
      return earliest == null ? expiresAt : Math.min(earliest, expiresAt);
    }, null);
    if (nextExpiry == null) return;
    const timer = setTimeout(() => {
      const next = recoverExpiredClaims(loadQueueStore());
      commitStore(next);
    }, Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [commitStore, messageQueue]);

  const hasRecoveringClaim = messageQueue.some(
    (item) => item.status === "recovering",
  );
  useEffect(() => {
    if (!hasRecoveringClaim) return;
    const durableRecovery = recoverExpiredClaims(loadQueueStore());
    const stillRecovering = queueForConversation(
      durableRecovery,
      conversationId,
    ).some((item) => item.status === "recovering");
    commitStore(durableRecovery);
    if (!stillRecovering) return;
    const timer = setTimeout(() => {
      // Re-read durable state so a completion in another mounted owner wins.
      const recovered = recoverExpiredClaims(loadQueueStore());
      commitStore(releaseRecoveringClaims(recovered, conversationId));
    }, QUEUE_RECOVERY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [commitStore, conversationId, hasRecoveringClaim]);

  const finishClaim = useCallback(
    (
      item: DurableQueuedMessage,
      result: "sent" | "failed",
      failReason: "missing_attachment" | "send_failed" | null,
    ) => {
      const latest = loadQueueStore();
      // Only the claim that still owns the current lease may complete the row —
      // for success AND failure alike. A stale send that resolves after its
      // lease expired and the item was re-claimed must not remove/fail the row
      // the newer claim now owns; the live claim still lands exactly once
      // because the gateway dedupes the create via clientMutationId.
      const currentClaim = queueForConversation(
        latest,
        item.conversationId,
      ).find((queued) => queued.id === item.id);
      if (
        currentClaim?.status !== "submitting" ||
        currentClaim.claimedAt !== item.claimedAt
      ) {
        return;
      }
      const next = completeDurableSend(
        latest,
        item.conversationId,
        item.id,
        result,
        result === "failed" ? failReason : null,
      );
      commitStore(next);
      if (result === "failed") opts.onSendFailed?.();
    },
    [commitStore, opts.onSendFailed],
  );

  const submitClaim = useCallback(
    (item: DurableQueuedMessage) => {
      const send = () => {
        // Keep onFollowUp invocation synchronous (before any await) so existing
        // claim/remount tests and single-flight leases stay race-free.
        void (async () => {
          let result: "sent" | "failed" = "failed";
          try {
            const accepted = await Promise.resolve(
              opts.onFollowUp?.(
                item.text,
                attachmentsFromQueuedPaths(item.attachmentPaths),
                item.clientMutationId,
              ),
            );
            result = accepted === false ? "failed" : "sent";
          } catch {
            result = "failed";
          }
          finishClaim(item, result, result === "failed" ? "send_failed" : null);
        })();
      };

      const paths = item.attachmentPaths;
      if (!paths?.length) {
        send();
        return;
      }

      // CHAT-5: refuse drain when attachment paths vanished.
      void missingAttachmentPaths(paths, workspacePathExists).then((missing) => {
        if (missing.length > 0) {
          finishClaim(item, "failed", "missing_attachment");
          return;
        }
        send();
      });
    },
    [finishClaim, opts.onFollowUp],
  );

  const claimAndSubmit = useCallback(
    (
      id?: string,
      mode: "pending" | "retry" | "edit" = "pending",
      patch?: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      if (!opts.onFollowUp || !conversationId) return;
      let current = loadQueueStore();
      if (id) {
        const currentItem = queueForConversation(current, conversationId).find(
          (item) => item.id === id,
        );
        if (
          !currentItem ||
          currentItem.status === "submitting" ||
          currentItem.status === "recovering"
        ) {
          return;
        }
        if (mode === "retry") {
          if (currentItem.status !== "failed") return;
          current = markDurablePending(current, conversationId, id);
        } else if (mode === "edit") {
          current = editDurable(current, conversationId, id, patch ?? {});
        } else if (currentItem.status !== "pending") {
          return;
        }
      }
      const claimed = claimDurable(current, conversationId, id);
      if (!claimed.item) return;
      // The durable lease must exist before the gateway can accept the create.
      commitStore(claimed.store);
      void submitClaim(claimed.item);
    },
    [commitStore, conversationId, opts.onFollowUp, submitClaim],
  );

  useEffect(() => {
    // Drain as soon as the agent is idle (awaiting-user OR terminal), not only
    // on terminal — otherwise replies queued during a run never get sent.
    if (!conversationId || opts.agentBusy || opts.followUpBusy) return;
    claimAndSubmit();
  }, [
    claimAndSubmit,
    conversationId,
    messageQueue,
    opts.followUpBusy,
    opts.agentBusy,
  ]);

  const enqueue = useCallback(
    (text: string, attachmentPaths?: string[]) => {
      if (!conversationId) return;
      commitStore(
        enqueueDurable(
          loadQueueStore(),
          conversationId,
          text,
          attachmentPaths,
        ),
      );
    },
    [commitStore, conversationId],
  );

  const remove = useCallback(
    (id: string) => {
      if (!conversationId) return;
      const current = loadQueueStore();
      const next = removeDurableWithUndo(current, conversationId, id);
      commitStore(next);
      if (next !== current && next.lastRemoved) {
        opts.onUndoAvailable?.(next.lastRemoved.id);
      }
    },
    [commitStore, conversationId, opts.onUndoAvailable],
  );

  const undoRemove = useCallback(
    (id?: string) => {
      commitStore(undoLastRemove(loadQueueStore(), id));
    },
    [commitStore],
  );

  /** CHAT-5: drop undo stash after toast timeout so Undo cannot resurrect forever. */
  const purgeUndo = useCallback(
    (id?: string) => {
      commitStore(purgeLastRemoved(loadQueueStore(), id));
    },
    [commitStore],
  );

  const edit = useCallback(
    (
      id: string,
      patch: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      if (!conversationId) return;
      commitStore(editDurable(loadQueueStore(), conversationId, id, patch));
    },
    [commitStore, conversationId],
  );

  const retry = useCallback(
    (m: DurableQueuedMessage) => {
      claimAndSubmit(m.id, "retry");
    },
    [claimAndSubmit],
  );

  const sendNow = useCallback(
    (m: DurableQueuedMessage) => {
      claimAndSubmit(m.id);
    },
    [claimAndSubmit],
  );

  /**
   * Mid-run "Send now" via ACP interjection. Falls back to queue claim when
   * the extension is unsupported (delivered=false).
   *
   * Delivery is keyed by clientMutationId: we only drop the queued item after
   * the gateway/provider acknowledges that exact mutation id. A reload replay
   * of the same id must not re-send a second user message.
   */
  const interjectNow = useCallback(
    async (m: DurableQueuedMessage): Promise<boolean> => {
      const taskId = opts.taskId?.trim();
      if (!taskId || !opts.onInterject || opts.isTerminal) return false;
      const mutationId = m.clientMutationId?.trim();
      if (!mutationId) return false;
      // Guard a double-click while the RPC is in flight. Concurrent call is
      // treated as already handled so the caller does not fall back to claim.
      if (interjectingRef.current.has(m.id)) return true;
      interjectingRef.current.add(m.id);
      setInterjectingIds(new Set(interjectingRef.current));
      try {
        const result = await Promise.resolve(
          opts.onInterject(taskId, m.text, mutationId),
        );
        // Only mark delivered after ack of this exact mutation id.
        if (result?.delivered === true) {
          if (conversationId) {
            commitStore(
              removeDurableWithUndo(loadQueueStore(), conversationId, m.id),
            );
          }
          return true;
        }
      } catch {
        /* fall through — item stays queued for retry/claim */
      } finally {
        interjectingRef.current.delete(m.id);
        setInterjectingIds(new Set(interjectingRef.current));
      }
      return false;
    },
    [
      commitStore,
      conversationId,
      opts.isTerminal,
      opts.onInterject,
      opts.taskId,
    ],
  );

  const editAndSendNow = useCallback(
    (
      m: DurableQueuedMessage,
      patch: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      claimAndSubmit(m.id, "edit", patch);
    },
    [claimAndSubmit],
  );

  return {
    messageQueue,
    enqueue,
    remove,
    edit,
    retry,
    sendNow,
    interjectNow,
    interjectingIds,
    editAndSendNow,
    undoRemove,
    purgeUndo,
  };
}

export type WorkspaceQueueController = ReturnType<typeof useWorkspaceQueue>;
