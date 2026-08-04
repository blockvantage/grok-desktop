/**
 * Whether the scroll viewport is parked near the bottom (Phase 6 extract).
 */

export const NEAR_BOTTOM_THRESHOLD_PX = 90;

/**
 * Distance from bottom: scrollHeight - scrollTop - clientHeight.
 * True when distance is strictly less than threshold.
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  const dist = scrollHeight - scrollTop - clientHeight;
  return dist < thresholdPx;
}
