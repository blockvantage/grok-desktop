import type { TaskAttachment } from "@grokdesk/shared";
import type { ConversationTurn } from "./conversation-projector";

const TERMINAL_STATES = new Set<ConversationTurn["state"]>([
  "done",
  "failed",
  "cancelled",
]);

export type RevisionIntent = {
  sourceTaskId: string;
  initialText: string;
  allowed: boolean;
};

export type RevisionDraft = RevisionIntent & {
  attachments: TaskAttachment[];
};

/**
 * The first revision model is deliberately linear: only the newest accepted,
 * terminal task can start a new branch. Queued and active turns must finish or
 * be cancelled first so an edit cannot race the run it supersedes.
 */
export function revisionIntent(
  turn: ConversationTurn,
  latestAcceptedTaskId: string | null,
): RevisionIntent {
  return {
    sourceTaskId: turn.taskId,
    initialText: turn.userMessage,
    allowed:
      turn.taskId === latestAcceptedTaskId &&
      TERMINAL_STATES.has(turn.state) &&
      !turn.superseded &&
      turn.attachmentsKnown,
  };
}

/** Keep submit eligibility intact while hiding the action for an open edit. */
export function exposedRevisionEditTaskId(
  revisionEligibilityTaskId: string | null,
  hasOpenSession: boolean,
): string | null {
  return hasOpenSession ? null : revisionEligibilityTaskId;
}

/** Copy the accepted turn's input metadata into editable composer state. */
export function revisionDraft(
  turn: ConversationTurn,
  latestAcceptedTaskId: string | null,
): RevisionDraft {
  return {
    ...revisionIntent(turn, latestAcceptedTaskId),
    attachments: turn.attachments.map((attachment) => ({ ...attachment })),
  };
}

/** A revision is a new mutation, never an update of the accepted task row. */
export function newRevisionMutationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `revision-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
