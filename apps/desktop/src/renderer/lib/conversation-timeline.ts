/**
 * Conversation navigation for long threads (Phase 2.3).
 * Timeline ticks, virtualization threshold, and long-answer jump.
 */

export const CONVERSATION_VIRTUALIZE_THRESHOLD = 8;
export const TIMELINE_RAIL_MIN_TURNS = 2;
/** Characters of answer text before the "back to start" control appears. */
export const LONG_ANSWER_CHARS = 720;
const TICK_LABEL_MAX = 42;

export type ConversationTickTurn = {
  id: string;
  userMessage?: string | null;
  state: string;
  answer?: { text?: string | null } | null;
};

export type ConversationTick = {
  id: string;
  /** 1-based position in the thread. */
  index: number;
  state: string;
  label: string;
  hasAnswer: boolean;
};

function tickLabel(message: string | null | undefined): string {
  const clean = (message ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= TICK_LABEL_MAX) return clean;
  return `${clean.slice(0, TICK_LABEL_MAX - 1).trimEnd()}…`;
}

export function conversationTicks(
  turns: readonly ConversationTickTurn[],
): ConversationTick[] {
  return turns.map((turn, i) => ({
    id: turn.id,
    index: i + 1,
    state: turn.state,
    label: tickLabel(turn.userMessage),
    hasAnswer: Boolean(turn.answer?.text?.trim()),
  }));
}

export function shouldShowTimelineRail(turnCount: number): boolean {
  return turnCount >= TIMELINE_RAIL_MIN_TURNS;
}

export function shouldVirtualizeConversation(turnCount: number): boolean {
  return turnCount > CONVERSATION_VIRTUALIZE_THRESHOLD;
}

export function isLongAnswer(text: string | null | undefined): boolean {
  return (text ?? "").trim().length >= LONG_ANSWER_CHARS;
}

export function tickIndexForTurnId(
  ticks: readonly ConversationTick[],
  turnId: string | null | undefined,
): number | null {
  if (!turnId) return null;
  const i = ticks.findIndex((t) => t.id === turnId);
  return i >= 0 ? i : null;
}
