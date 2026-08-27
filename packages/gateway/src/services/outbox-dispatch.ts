/**
 * Local IPC dispatch for gateway-owned conversation outbox.
 * Not remote-allowlisted — desktop only.
 */
import {
  OutboxEnqueueParamsSchema,
  OutboxIdParamsSchema,
  OutboxListParamsSchema,
  OutboxUpdateParamsSchema,
  type ConversationOutboxItem,
  type OutboxEnqueueResult,
  type OutboxSummary,
} from "@grokdesk/shared";
import type { ConversationOutboxRepository } from "./conversation-outbox.js";

export const OUTBOX_METHODS = new Set([
  "outbox.enqueue",
  "outbox.list",
  "outbox.update",
  "outbox.remove",
  "outbox.retry",
  "outbox.sendNow",
  "outbox.summary",
]);

export function isOutboxMethod(method: string): boolean {
  return OUTBOX_METHODS.has(method);
}

export type OutboxSendNowResult =
  | { delivered: true; item: ConversationOutboxItem }
  | {
      delivered: false;
      reason:
        | "unsupported"
        | "timeout"
        | "failed"
        | "terminal"
        | "not_found"
        | "not_pending";
      item: ConversationOutboxItem | null;
    };

export type OutboxDispatchDeps = {
  outbox: ConversationOutboxRepository;
  /** Content-free notify after committed mutation. */
  notifyOutboxChanged: (payload: {
    conversationId?: string;
    itemIds?: string[];
    reason?: string;
  }) => void;
  /** Kick the global drain coordinator (coalesced). */
  scheduleDrain?: () => void;
  /**
   * Attempt ACP interjection. Must not fall back to tasks.create.
   * Returns delivered=true only on provider acknowledgement.
   */
  interject?: (
    taskId: string,
    text: string,
    clientMutationId: string,
  ) => Promise<boolean>;
  /** False when the live engine has no interject method (headless). */
  supportsInterject?: () => boolean;
};

function notify(
  deps: OutboxDispatchDeps,
  conversationId: string | undefined,
  itemIds: string[],
  reason: string,
): void {
  deps.notifyOutboxChanged({
    conversationId,
    itemIds,
    reason,
  });
}

/**
 * Dispatch an outbox.* method. Throws on unknown method / validation for
 * update/remove/retry; enqueue returns structured failure outcomes.
 */
export async function dispatchOutboxMethod(
  method: string,
  params: Record<string, unknown>,
  deps: OutboxDispatchDeps,
): Promise<unknown> {
  switch (method) {
    case "outbox.enqueue": {
      const parsed = OutboxEnqueueParamsSchema.parse(params);
      const result: OutboxEnqueueResult = deps.outbox.enqueue(parsed);
      if (result.outcome === "accepted") {
        notify(deps, parsed.conversationId, [result.item.id], "enqueue");
        deps.scheduleDrain?.();
      }
      return result;
    }
    case "outbox.list": {
      const parsed = OutboxListParamsSchema.parse(params ?? {});
      return deps.outbox.list({
        conversationId: parsed.conversationId,
        includeTerminal: parsed.includeTerminal,
      });
    }
    case "outbox.update": {
      const parsed = OutboxUpdateParamsSchema.parse(params);
      if (parsed.text === undefined && parsed.attachments === undefined) {
        throw new Error("outbox.update requires text and/or attachments");
      }
      const item = deps.outbox.updatePending(parsed.id, {
        text: parsed.text,
        attachments: parsed.attachments,
      });
      if (!item) throw new Error("outbox item not found");
      notify(deps, item.conversationId, [item.id], "update");
      deps.scheduleDrain?.();
      return item;
    }
    case "outbox.remove": {
      const parsed = OutboxIdParamsSchema.parse(params);
      const existing = deps.outbox.get(parsed.id);
      if (!existing) throw new Error("outbox item not found");
      deps.outbox.removePending(parsed.id);
      notify(deps, existing.conversationId, [parsed.id], "remove");
      return { ok: true, id: parsed.id };
    }
    case "outbox.retry": {
      const parsed = OutboxIdParamsSchema.parse(params);
      const item = deps.outbox.retry(parsed.id);
      if (!item) throw new Error("outbox item not found");
      notify(deps, item.conversationId, [item.id], "retry");
      deps.scheduleDrain?.();
      return item;
    }
    case "outbox.sendNow": {
      const parsed = OutboxIdParamsSchema.parse(params);
      const item = deps.outbox.get(parsed.id);
      if (!item) {
        const empty: OutboxSendNowResult = {
          delivered: false,
          reason: "not_found",
          item: null,
        };
        return empty;
      }
      if (
        item.status === "accepted" ||
        item.status === "delivered" ||
        item.status === "cancelled"
      ) {
        const terminal: OutboxSendNowResult = {
          delivered: false,
          reason: "terminal",
          item,
        };
        return terminal;
      }
      if (
        item.status !== "pending" &&
        item.status !== "failed" &&
        item.status !== "blocked_missing_attachment"
      ) {
        // submitting: leave queued; do not create concurrent follow-up.
        const busy: OutboxSendNowResult = {
          delivered: false,
          reason: "not_pending",
          item,
        };
        return busy;
      }
      if (!deps.interject) {
        const unsupported: OutboxSendNowResult = {
          delivered: false,
          reason: "unsupported",
          item,
        };
        return unsupported;
      }
      let delivered = false;
      try {
        delivered = await deps.interject(
          item.parentTaskId,
          item.text,
          item.id,
        );
      } catch {
        const failed: OutboxSendNowResult = {
          delivered: false,
          reason: "failed",
          item,
        };
        return failed;
      }
      if (delivered) {
        const next = deps.outbox.markDelivered(item.id) ?? item;
        notify(deps, item.conversationId, [item.id], "sendNow_delivered");
        const ok: OutboxSendNowResult = { delivered: true, item: next };
        return ok;
      }
      // Unsupported / not delivered — keep queued. Never tasks.create fallback.
      const kept: OutboxSendNowResult = {
        delivered: false,
        reason: "unsupported",
        item,
      };
      return kept;
    }
    case "outbox.summary": {
      const summary: OutboxSummary = {
        ...deps.outbox.summary(),
        sendNowSupported:
          typeof deps.supportsInterject === "function"
            ? deps.supportsInterject()
            : Boolean(deps.interject),
      };
      return summary;
    }
    default:
      throw new Error(`Unhandled outbox method: ${method}`);
  }
}
