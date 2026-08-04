/**
 * Freeze the composer placeholder while the field is focused and non-empty
 * so status-driven placeholder swaps (live ↔ terminal) cannot rewrite the
 * hint under the user's caret (CHAT-6).
 */

export function freezePlaceholderKey(input: {
  liveKey: string;
  focused: boolean;
  valueNonEmpty: boolean;
  frozenKey: string | null;
}): { displayKey: string; nextFrozenKey: string | null } {
  if (input.focused && input.valueNonEmpty) {
    const key = input.frozenKey ?? input.liveKey;
    return { displayKey: key, nextFrozenKey: key };
  }
  return { displayKey: input.liveKey, nextFrozenKey: null };
}
