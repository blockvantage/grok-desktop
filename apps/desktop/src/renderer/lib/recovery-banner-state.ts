/**
 * Pure recovery-banner visibility + message selection (Phase 6 extract).
 */

export type RecoveryEventLike = {
  kind: string;
  payload?: { message?: unknown } | null;
};

/**
 * Most recent error event message in stream order (scan reverse).
 * Returns undefined when no error event exists.
 */
export function latestErrorMessage(
  events: RecoveryEventLike[],
): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "error") continue;
    const msg = e.payload?.message;
    return typeof msg === "string" ? msg : "";
  }
  return undefined;
}

/**
 * Message for recoveryFromErrorMessage, or null when the banner should not render.
 * Mirrors prior workspace inline logic:
 * - prefer last error payload
 * - on failed, fall back to fallbackFailedMessage
 * - hide when no message and not failed
 */
export function recoveryBannerMessage(input: {
  events: RecoveryEventLike[];
  taskStatus: string;
  fallbackFailedMessage: string;
}): string | null {
  const fromEvent = latestErrorMessage(input.events);
  const msg =
    fromEvent ||
    (input.taskStatus === "failed" ? input.fallbackFailedMessage : "");
  if (!msg && input.taskStatus !== "failed") return null;
  return msg || input.fallbackFailedMessage;
}

/**
 * Whether a recovery model should be shown given task status.
 * Generic models are suppressed unless the task is failed.
 */
export function shouldShowRecoveryBanner(input: {
  recoveryKind: string;
  taskStatus: string;
}): boolean {
  if (input.recoveryKind === "generic" && input.taskStatus !== "failed") {
    return false;
  }
  return true;
}
