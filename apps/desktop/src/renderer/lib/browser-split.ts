/**
 * Chat | browser split ratios when the agent browser pane is open.
 * Pure helpers so layout math is unit-tested without React.
 */

/** Default chat column share of the workspace (browser fills the rest). */
export const DEFAULT_CHAT_SPLIT_PCT = 40;

export const MIN_CHAT_SPLIT_PCT = 28;
export const MAX_CHAT_SPLIT_PCT = 58;

/** Keep the chat column usable on both very narrow and wide shells. */
export function clampChatSplitPct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_CHAT_SPLIT_PCT;
  return Math.min(MAX_CHAT_SPLIT_PCT, Math.max(MIN_CHAT_SPLIT_PCT, pct));
}

/**
 * Convert a pointer X (relative to the split container) into a chat %.
 */
export function chatSplitPctFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
): number {
  if (containerWidth < 1) return DEFAULT_CHAT_SPLIT_PCT;
  const raw = ((clientX - containerLeft) / containerWidth) * 100;
  return clampChatSplitPct(raw);
}

/**
 * Whether the deliverables rail should render.
 * Chat-first: only when the user has opened the rail (`railOpen`), and still
 * hide it when the agent browser is open unless the shell is ultra-wide.
 */
export function showDeliverablesRail(opts: {
  browserOpen: boolean;
  railOpen: boolean;
  /** viewport width in CSS px */
  viewportWidth: number;
}): boolean {
  if (!opts.railOpen) return false;
  // Browser open: only on ultra-wide so chat stays beside browser without squeeze.
  if (opts.browserOpen) return opts.viewportWidth >= 1600;
  // User opted into the rail — show it from a usable width (not phone-narrow).
  return opts.viewportWidth >= 720;
}
