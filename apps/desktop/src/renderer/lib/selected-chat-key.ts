/**
 * Stable key for chat turns so event subscriptions don't re-run every poll.
 * Phase 6 extract from App.
 */

export type ChatTurnsLike = {
  turns: Array<{ id: string }>;
};

/**
 * Join turn ids when a chat is selected; else fall back to selectedId.
 */
export function selectedChatKey(
  selectedChat: ChatTurnsLike | null | undefined,
  selectedId: string | null,
): string {
  if (selectedChat) {
    return selectedChat.turns.map((t) => t.id).join(",");
  }
  return selectedId ?? "";
}
