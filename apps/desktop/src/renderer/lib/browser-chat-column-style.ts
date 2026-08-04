/**
 * Pure layout styles for chat column when browser split is open (Phase 6).
 */

export type ChatColumnStyle = {
  flexBasis: string;
  width: string;
  maxWidth: string;
  minWidth: number;
};

/**
 * Inline style for the conversation column when the agent browser is open.
 * When closed, returns undefined so flex-1 layout applies.
 */
export function browserChatColumnStyle(input: {
  browserOpen: boolean;
  chatSplitPct: number;
  railVisible: boolean;
}): ChatColumnStyle | undefined {
  if (!input.browserOpen) return undefined;
  return {
    flexBasis: `${input.chatSplitPct}%`,
    width: `${input.chatSplitPct}%`,
    maxWidth: input.railVisible ? "46%" : "58%",
    minWidth: 260,
  };
}

/**
 * Flex class fragment for the chat column (open vs closed).
 */
export function browserChatColumnFlexClass(browserOpen: boolean): string {
  return browserOpen ? "shrink-0 grow-0" : "min-w-0 flex-1";
}
