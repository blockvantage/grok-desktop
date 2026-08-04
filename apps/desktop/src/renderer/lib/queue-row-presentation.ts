/**
 * Pure queue / composer delivery presentation (Task 13).
 * Labels and rejection feedback without React or storage.
 */

export type QueueLifecycleInput = {
  status: string;
  /** 0-based position in the conversation FIFO. */
  index: number;
  interjecting?: boolean;
  failReason?: string | null;
};

export type QueueLifecycleStatus = {
  /** i18n key under workspace.* */
  key: string;
  params?: Record<string, string | number>;
  /** English plain for structural tests (must match en locale). */
  plain: string;
};

/**
 * Position and state in plain language for a queue row.
 */
export function planQueueLifecycleStatus(
  input: QueueLifecycleInput,
): QueueLifecycleStatus {
  if (input.status === "submitting") {
    return { key: "workspace.queueSubmitting", plain: "Submitting…" };
  }
  if (input.status === "recovering") {
    return {
      key: "workspace.queueRecovering",
      plain: "Recovering queued message…",
    };
  }
  if (input.status === "failed") {
    if (input.failReason === "missing_attachment") {
      return {
        key: "workspace.queueMissingAttachment",
        plain: "Attachment missing — re-pick or remove it to send.",
      };
    }
    return { key: "workspace.queueNeedsRetry", plain: "Needs retry" };
  }
  if (input.interjecting) {
    return { key: "workspace.queueSending", plain: "Sending" };
  }
  const ahead = Math.max(0, input.index);
  if (ahead > 0) {
    return {
      key: "workspace.queueAhead",
      params: { count: ahead },
      plain: `Queued · ${ahead} ahead`,
    };
  }
  return { key: "workspace.queueSavedLocally", plain: "Saved locally" };
}

export type ComposerOfflineAction = {
  key: string;
  plain: string;
};

/**
 * Offline / reconnecting action copy for the follow-up surface.
 * Null when no special offline cue is needed.
 */
export function planComposerOfflineAction(input: {
  engineReady: boolean;
  hasDraft: boolean;
  hasSavedLocalQueue?: boolean;
  lastError?: "transient" | null;
}): ComposerOfflineAction | null {
  if (input.engineReady) {
    if (input.lastError === "transient") {
      return { key: "workspace.composerTryAgain", plain: "Try again" };
    }
    return null;
  }
  if (input.hasSavedLocalQueue && !input.hasDraft) {
    return { key: "workspace.queueSavedLocally", plain: "Saved locally" };
  }
  return {
    key: "workspace.composerSaveWhenReady",
    plain: "Save when engine is ready",
  };
}

export type EnqueueRejectionFeedback = {
  clearDraft: false;
  refocusComposer: true;
  announceOnce: true;
  messageKey: string;
  retainedText: string;
};

/**
 * Rejection paths never clear the composer draft; always refocus and announce once.
 */
export function planEnqueueRejectionFeedback(input: {
  outcome: "full" | "persistence_failed" | "unavailable" | string;
  reason?: string;
  previousText: string;
}): EnqueueRejectionFeedback {
  let messageKey = "workspace.queueSendFailed";
  if (input.outcome === "full") {
    messageKey = "workspace.queueFull";
  } else if (
    input.outcome === "unavailable" &&
    /engine not ready|not ready/i.test(input.reason ?? "")
  ) {
    messageKey = "workspace.composerSaveWhenReady";
  } else if (input.outcome === "unavailable") {
    messageKey = "workspace.composerTryAgain";
  }
  return {
    clearDraft: false,
    refocusComposer: true,
    announceOnce: true,
    messageKey,
    retainedText: input.previousText,
  };
}
