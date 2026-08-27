/**
 * Pure builders for routing every follow-up entry point through outbox.enqueue.
 * The gateway drain is the only path that calls tasks.create for follow-ups.
 */
import type {
  OutboxEnqueueParams,
  OutboxRunSettings,
  TaskAttachment,
} from "@grokdesk/shared";

export type FollowUpEntryPoint =
  | "composer"
  | "answer_question"
  | "turn_retry"
  | "recovery_retry"
  | "post_run_chip"
  | "revision";

export type BuildOutboxFollowUpInput = {
  conversationId: string;
  parentTaskId: string;
  text: string;
  /** Stable id — never regenerate on retry of the same user action. */
  clientMutationId: string;
  attachments?: TaskAttachment[];
  revisionOfTaskId?: string;
  entryPoint: FollowUpEntryPoint;
  runSettings?: OutboxRunSettings;
};

/**
 * Build outbox.enqueue params for any follow-up surface.
 * Throws on empty text / missing ids so callers keep the composer intact.
 */
export function buildOutboxFollowUpParams(
  input: BuildOutboxFollowUpInput,
): OutboxEnqueueParams & { entryPoint: FollowUpEntryPoint } {
  const conversationId = input.conversationId.trim();
  const parentTaskId = input.parentTaskId.trim();
  const text = input.text.trim();
  const id = input.clientMutationId.trim();
  if (!conversationId) throw new Error("conversationId required");
  if (!parentTaskId) throw new Error("parentTaskId required");
  if (!text) throw new Error("follow-up text required");
  if (!id) throw new Error("clientMutationId required");

  return {
    id,
    conversationId,
    parentTaskId,
    text,
    attachments: input.attachments ?? [],
    ...(input.revisionOfTaskId?.trim()
      ? { revisionOfTaskId: input.revisionOfTaskId.trim() }
      : {}),
    ...(input.runSettings ? { runSettings: input.runSettings } : {}),
    entryPoint: input.entryPoint,
  };
}

/** RPC method used by every follow-up path (never tasks.create from renderer). */
export const FOLLOW_UP_OUTBOX_METHOD = "outbox.enqueue" as const;
