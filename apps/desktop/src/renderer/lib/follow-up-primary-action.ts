/**
 * Primary action for the follow-up composer button (Phase 6 extract).
 * Live + empty draft → stop; otherwise send.
 */

export type FollowUpPrimaryAction = "stop" | "send";

export function followUpPrimaryAction(input: {
  isLive: boolean;
  goal: string;
}): FollowUpPrimaryAction {
  if (input.isLive && !input.goal.trim()) return "stop";
  return "send";
}

/**
 * i18n key for the follow-up textarea placeholder.
 */
export function followUpPlaceholderKey(input: {
  isTerminal: boolean;
  isLive: boolean;
}): "workspace.followUp" | "workspace.followUpLive" {
  if (input.isTerminal) return "workspace.followUp";
  if (input.isLive) return "workspace.followUpLive";
  return "workspace.followUp";
}

/**
 * Paths from staged attachments for queue enqueue.
 */
export function attachmentPathsForQueue(
  attachments: Array<{ stagedPath?: string | null; sourcePath?: string | null }>,
): string[] {
  return attachments.map((a) => a.stagedPath || a.sourcePath || "").filter(Boolean);
}
