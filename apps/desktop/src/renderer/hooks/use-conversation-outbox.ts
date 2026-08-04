/**
 * Renderer projection of the gateway-owned conversation outbox.
 * All follow-ups go through outbox.enqueue; the gateway drains globally.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConversationOutboxItem,
  OutboxEnqueueResult,
  TaskAttachment,
} from "@grokdesk/shared";
import { rpc, subscribeGatewayNotify } from "@/lib/api";
import { attachmentsFromQueuedPaths } from "@/lib/message-queue";
import type { DurableQueuedMessage } from "@/lib/message-queue-store";

export type OutboxControllerItem = DurableQueuedMessage & {
  /** Gateway outbox status (may be richer than local durable status). */
  outboxStatus?: ConversationOutboxItem["status"];
  position?: number | null;
};

function toControllerItem(item: ConversationOutboxItem): OutboxControllerItem {
  const status: DurableQueuedMessage["status"] =
    item.status === "submitting"
      ? "submitting"
      : item.status === "failed"
        ? "failed"
        : item.status === "blocked_missing_attachment"
          ? "failed"
          : "pending";
  return {
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    attachmentPaths: item.attachments.map((a) => a.sourcePath),
    status,
    conversationId: item.conversationId,
    clientMutationId: item.id,
    claimedAt: item.status === "submitting" ? item.updatedAt : null,
    failReason:
      item.status === "blocked_missing_attachment"
        ? "missing_attachment"
        : item.status === "failed"
          ? "send_failed"
          : null,
    outboxStatus: item.status,
    position: item.position,
  };
}

export type EnqueueOutcome =
  | { outcome: "accepted"; item: OutboxControllerItem }
  | { outcome: "full"; limit: number }
  | { outcome: "persistence_failed"; message: string }
  | { outcome: "unavailable"; message: string };

export function useConversationOutbox(opts: {
  conversationId: string | null | undefined;
  parentTaskId: string | null | undefined;
  taskId?: string | null;
  isTerminal: boolean;
  gatewayReady?: boolean;
  onSendFailed?: () => void;
  onUndoAvailable?: (removedId: string) => void;
}) {
  const conversationId = opts.conversationId?.trim() || "";
  const parentTaskId = opts.parentTaskId?.trim() || "";
  const [items, setItems] = useState<OutboxControllerItem[]>([]);
  const [interjectingIds, setInterjectingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const interjectingRef = useRef<Set<string>>(new Set());
  const listGen = useRef(0);
  const lastRemovedRef = useRef<ConversationOutboxItem | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setItems([]);
      return;
    }
    // While reconnecting, keep the last good projection — SQLite rows still exist.
    if (opts.gatewayReady === false) {
      return;
    }
    const gen = ++listGen.current;
    try {
      const list = await rpc<ConversationOutboxItem[]>("outbox.list", {
        conversationId,
        includeTerminal: false,
      });
      if (gen !== listGen.current) return;
      setItems(list.map(toControllerItem));
    } catch {
      // Keep last good projection; mark nothing as lost.
    }
  }, [conversationId, opts.gatewayReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeGatewayNotify((msg) => {
      if (msg.method !== "notify.outboxChanged") return;
      const cid = msg.params.conversationId;
      if (typeof cid === "string" && cid && cid !== conversationId) return;
      void refresh();
    });
  }, [conversationId, refresh]);

  const enqueue = useCallback(
    async (
      text: string,
      attachmentPaths?: string[],
      clientMutationId?: string,
      revisionOfTaskId?: string,
    ): Promise<EnqueueOutcome> => {
      const trimmed = text.trim();
      if (!trimmed || !conversationId || !parentTaskId) {
        return {
          outcome: "unavailable",
          message: "conversation or parent task missing",
        };
      }
      if (opts.gatewayReady === false) {
        return {
          outcome: "unavailable",
          message: "engine not ready",
        };
      }
      const id =
        clientMutationId?.trim() ||
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      const attachments =
        attachmentsFromQueuedPaths(attachmentPaths ?? []) ?? [];
      try {
        const result = await rpc<OutboxEnqueueResult>("outbox.enqueue", {
          id,
          conversationId,
          parentTaskId,
          text: trimmed,
          attachments,
          ...(revisionOfTaskId?.trim()
            ? { revisionOfTaskId: revisionOfTaskId.trim() }
            : {}),
        });
        if (result.outcome === "accepted") {
          await refresh();
          return {
            outcome: "accepted",
            item: toControllerItem(result.item),
          };
        }
        if (result.outcome === "full") {
          return { outcome: "full", limit: result.limit };
        }
        return {
          outcome: "persistence_failed",
          message: result.message,
        };
      } catch (e) {
        return {
          outcome: "persistence_failed",
          message: e instanceof Error ? e.message : "enqueue failed",
        };
      }
    },
    [conversationId, opts.gatewayReady, parentTaskId, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const existing = items.find((i) => i.id === id);
        await rpc("outbox.remove", { id });
        lastRemovedRef.current = existing
          ? {
              id: existing.id,
              conversationId: existing.conversationId,
              parentTaskId,
              text: existing.text,
              attachments:
                attachmentsFromQueuedPaths(existing.attachmentPaths ?? []) ??
                [],
              status: "cancelled",
              position: null,
              acceptedTaskId: null,
              attemptCount: 0,
              failReason: null,
              createdAt: existing.createdAt,
              updatedAt: new Date().toISOString(),
            }
          : null;
        await refresh();
        opts.onUndoAvailable?.(id);
      } catch {
        opts.onSendFailed?.();
      }
    },
    [items, opts, parentTaskId, refresh],
  );

  const undoRemove = useCallback(
    async (id?: string) => {
      const stash = lastRemovedRef.current;
      if (!stash) return;
      if (id && stash.id !== id) return;
      await enqueue(
        stash.text,
        stash.attachments.map((a) => a.sourcePath),
        stash.id,
      );
      lastRemovedRef.current = null;
    },
    [enqueue],
  );

  const purgeUndo = useCallback((id?: string) => {
    if (!id || lastRemovedRef.current?.id === id) {
      lastRemovedRef.current = null;
    }
  }, []);

  const edit = useCallback(
    async (
      id: string,
      patch: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      try {
        await rpc("outbox.update", {
          id,
          text: patch.text,
          attachments:
            patch.attachmentPaths !== undefined
              ? attachmentsFromQueuedPaths(patch.attachmentPaths)
              : undefined,
        });
        await refresh();
      } catch {
        opts.onSendFailed?.();
      }
    },
    [opts, refresh],
  );

  const retry = useCallback(
    async (m: OutboxControllerItem) => {
      try {
        await rpc("outbox.retry", { id: m.id });
        await refresh();
      } catch {
        opts.onSendFailed?.();
      }
    },
    [opts, refresh],
  );

  /**
   * Send now → outbox.sendNow (interjection only). Never creates concurrent task.
   */
  const interjectNow = useCallback(
    async (m: OutboxControllerItem): Promise<boolean> => {
      if (opts.isTerminal) return false;
      if (interjectingRef.current.has(m.id)) return true;
      interjectingRef.current.add(m.id);
      setInterjectingIds(new Set(interjectingRef.current));
      try {
        const result = await rpc<{
          delivered: boolean;
          reason?: string;
        }>("outbox.sendNow", { id: m.id });
        await refresh();
        return result.delivered === true;
      } catch {
        return false;
      } finally {
        interjectingRef.current.delete(m.id);
        setInterjectingIds(new Set(interjectingRef.current));
      }
    },
    [opts.isTerminal, refresh],
  );

  /** Gateway drain owns promotion; sendNow only attempts interjection. */
  const sendNow = useCallback(
    (m: OutboxControllerItem) => {
      void interjectNow(m);
    },
    [interjectNow],
  );

  const editAndSendNow = useCallback(
    async (
      m: OutboxControllerItem,
      patch: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      await edit(m.id, patch);
      void interjectNow(m);
    },
    [edit, interjectNow],
  );

  // Compatibility: sync enqueue shape used by older callers (returns void).
  const enqueueSync = useCallback(
    (text: string, attachmentPaths?: string[]) => {
      void enqueue(text, attachmentPaths);
    },
    [enqueue],
  );

  return {
    messageQueue: items,
    enqueue: enqueueSync,
    enqueueAsync: enqueue,
    remove: (id: string) => {
      void remove(id);
    },
    edit: (
      id: string,
      patch: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      void edit(id, patch);
    },
    retry: (m: OutboxControllerItem) => {
      void retry(m);
    },
    sendNow,
    interjectNow,
    interjectingIds,
    editAndSendNow: (
      m: OutboxControllerItem,
      patch: { text?: string; attachmentPaths?: string[] | undefined },
    ) => {
      void editAndSendNow(m, patch);
    },
    undoRemove: (id?: string) => {
      void undoRemove(id);
    },
    purgeUndo,
    refresh,
  };
}

export type ConversationOutboxController = ReturnType<
  typeof useConversationOutbox
>;

// Silence unused TaskAttachment import for consumers re-exporting types.
export type { TaskAttachment };
