/** Item count above which the chat stream uses windowing. */
export const STREAM_VIRTUALIZE_THRESHOLD = 40;

export function shouldVirtualizeStream(itemCount: number): boolean {
  return itemCount > STREAM_VIRTUALIZE_THRESHOLD;
}

/**
 * Pure helper: which index to scroll to for "end of stream".
 * Virtual lists use the last item index; non-virtual uses -1 (viewport end).
 */
export function scrollTargetForStream(opts: {
  itemCount: number;
  virtualize?: boolean;
}): { mode: "viewport-end" } | { mode: "index"; index: number } {
  const count = Math.max(0, opts.itemCount);
  const virtual =
    opts.virtualize ?? shouldVirtualizeStream(count);
  if (!virtual || count === 0) {
    return { mode: "viewport-end" };
  }
  return { mode: "index", index: count - 1 };
}
