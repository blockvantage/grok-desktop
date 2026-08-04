/**
 * Pure detection of pending multi-choice question chips (Phase 6 extract).
 * Suppresses "What next?" while question chips are pending (CH-8).
 */

export type EventBlockLike = {
  kind: string;
  id: string;
  text?: string;
};

/**
 * Map collapsed stream blocks into the minimal shape used by
 * questionChipsForTerminalTurn.
 */
export function blocksFromCollapsed(
  collapsed: Array<{
    kind: string;
    id: string;
    text?: unknown;
    [key: string]: unknown;
  }>,
): EventBlockLike[] {
  return collapsed.map((b) => ({
    kind: b.kind,
    id: b.id,
    text: typeof b.text === "string" ? b.text : undefined,
  }));
}

/**
 * True when the terminal turn should suppress next-action chips because
 * multi-choice questions are still pending.
 */
export function hasPendingQuestionChips(input: {
  isTerminal: boolean;
  isLive: boolean;
  hasFollowUp: boolean;
  blocks: EventBlockLike[];
  taskStatus: string;
  questionChips: (
    blocks: EventBlockLike[],
    status: string,
  ) => unknown | null | undefined;
}): boolean {
  if (!input.isTerminal || input.isLive || !input.hasFollowUp) return false;
  return input.questionChips(input.blocks, input.taskStatus) != null;
}
