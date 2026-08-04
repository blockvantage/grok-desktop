/**
 * Auto-grow composer height (Phase 6 extract from task-workspace follow-up).
 */

export const COMPOSER_LINE_HEIGHT_PX = 22;
export const COMPOSER_MAX_ROWS = 8;

/**
 * Clamp measured scrollHeight to max rows × line height.
 */
export function autoGrowComposerHeightPx(
  scrollHeight: number,
  maxRows: number = COMPOSER_MAX_ROWS,
  lineHeightPx: number = COMPOSER_LINE_HEIGHT_PX,
): number {
  const max = maxRows * lineHeightPx;
  if (!Number.isFinite(scrollHeight) || scrollHeight < 0) return 0;
  return Math.min(scrollHeight, max);
}
