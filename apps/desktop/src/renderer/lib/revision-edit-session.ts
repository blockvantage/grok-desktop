import type { TaskAttachment } from "@grokdesk/shared";

export type RevisionEditSession = {
  conversationId: string;
  sourceTaskId: string;
  initialText: string;
  attachments: TaskAttachment[];
  previousText: string;
  previousAttachments: TaskAttachment[];
  clientMutationId: string;
};

export type RevisionSessionContext = {
  conversationId: string;
  editableTaskId: string | null;
};

export type RevisionSessionIneligibility =
  | "conversation_changed"
  | "source_no_longer_editable";

function cloneAttachments(items: TaskAttachment[]): TaskAttachment[] {
  return items.map((item) => ({ ...item }));
}

export function beginRevisionSession(input: Omit<
  RevisionEditSession,
  "clientMutationId"
> & { createMutationId: () => string }): RevisionEditSession {
  return {
    conversationId: input.conversationId,
    sourceTaskId: input.sourceTaskId,
    initialText: input.initialText,
    attachments: cloneAttachments(input.attachments),
    previousText: input.previousText,
    previousAttachments: cloneAttachments(input.previousAttachments),
    clientMutationId: input.createMutationId(),
  };
}

export function revisionSessionEligibility(
  session: RevisionEditSession,
  context: RevisionSessionContext,
): "eligible" | RevisionSessionIneligibility {
  if (context.conversationId !== session.conversationId) {
    return "conversation_changed";
  }
  if (context.editableTaskId !== session.sourceTaskId) {
    return "source_no_longer_editable";
  }
  return "eligible";
}

export function revisionSubmitIntent(
  session: RevisionEditSession,
  context: RevisionSessionContext,
):
  | {
      allowed: true;
      clientMutationId: string;
      revisionOfTaskId: string;
    }
  | { allowed: false; reason: RevisionSessionIneligibility } {
  const eligibility = revisionSessionEligibility(session, context);
  return eligibility === "eligible"
    ? {
        allowed: true,
        clientMutationId: session.clientMutationId,
        revisionOfTaskId: session.sourceTaskId,
      }
    : { allowed: false, reason: eligibility };
}

export function cancelRevisionSession(session: RevisionEditSession): {
  text: string;
  attachments: TaskAttachment[];
} {
  return {
    text: session.previousText,
    attachments: cloneAttachments(session.previousAttachments),
  };
}
