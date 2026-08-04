/**
 * I1: conversation-as-noun copy helpers.
 * Tasks remain engine storage; user-facing strings use "conversation".
 */

/** Map internal list labels that still say "task" to conversation keys. */
export const CONVERSATION_I18N = {
  listTitle: "conversation.listTitle",
  empty: "conversation.empty",
  deleteConfirm: "conversation.deleteConfirm",
  export: "conversation.export",
  open: "conversation.open",
  new: "conversation.new",
  resume: "conversation.resume",
  unit: "conversation.unit",
  units: "conversation.units",
} as const;

/**
 * Prefer conversation wording for counts (e.g. "3 conversations").
 * Falls back to English for unit tests without i18n provider.
 */
export function conversationCountLabel(
  count: number,
  t: (key: string, vars?: Record<string, string | number>) => string = (k) => k,
): string {
  if (count === 1) {
    return t("conversation.countOne", { count: 1 });
  }
  return t("conversation.countMany", { count });
}

/** True when a user-visible string still uses raw "task" as the unit of work. */
export function usesTaskAsUserNoun(text: string): boolean {
  return /\b(task|tasks)\b/i.test(text) && !/\btask id\b/i.test(text);
}
