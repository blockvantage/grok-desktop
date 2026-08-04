type LegacyStreamItem = {
  kind: string;
  status?: string;
  block?: { kind?: string; phase?: string };
};

/** True only when the legacy renderer actually paints a live status row. */
export function legacyItemProvidesLiveSignal(item?: LegacyStreamItem): boolean {
  if (!item) return false;
  if (item.kind === "toolAction") return item.status === "running";
  return (
    item.kind === "block" &&
    item.block?.kind === "tool" &&
    item.block.phase === "request"
  );
}

export function legacyItemsHaveVisibleLiveSignal(
  items: LegacyStreamItem[],
): boolean {
  return items.some(legacyItemProvidesLiveSignal);
}

export function shouldShowLegacyWorking(input: {
  active: boolean;
  streamingAssistant: boolean;
  visibleLiveSignal: boolean;
}): boolean {
  return (
    input.active && !input.streamingAssistant && !input.visibleLiveSignal
  );
}
