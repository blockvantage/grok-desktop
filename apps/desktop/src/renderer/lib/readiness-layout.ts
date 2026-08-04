/**
 * Layout helpers for Home readiness at the app minimum window (960×640).
 * Pure — unit tests assert CTA rows stay within a content-width budget.
 */

/** Documented Electron min window width (main process). */
export const APP_MIN_WINDOW_WIDTH = 960;

/**
 * Approximate horizontal chrome outside the Home content column at min width:
 * expanded sidebar (~256) + home paddings (~64). Default budget must force
 * stack mode so primary CTAs never clip at 960×640 with the daily sidebar open.
 */
export const HOME_MIN_SIDEBAR_WIDTH = 256;
export const HOME_MIN_CONTENT_PAD = 64;
export const HOME_MIN_CONTENT_WIDTH_BUDGET =
  APP_MIN_WINDOW_WIDTH - HOME_MIN_SIDEBAR_WIDTH - HOME_MIN_CONTENT_PAD;

/**
 * Whether a readiness CTA layout fits without horizontal overflow.
 * Models a flex-wrap row: label takes natural width, CTA wraps under when needed.
 */
export function readinessCtaFitsMinWidth(input: {
  contentWidth: number;
  labelWidth: number;
  ctaWidth: number;
  gap?: number;
  iconWidth?: number;
}): boolean {
  const gap = input.gap ?? 8;
  const icon = input.iconWidth ?? 16;
  // Always fits if content width can hold the CTA alone (wraps under label).
  if (input.ctaWidth <= input.contentWidth) return true;
  const singleLine = icon + gap + input.labelWidth + gap + input.ctaWidth;
  return singleLine <= input.contentWidth;
}

/**
 * Preferred layout mode for readiness at a given content width.
 * - "stack": each CTA on its own full-width row (min window / expanded sidebar)
 * - "inline": label + CTA on one row when there is room
 */
export function readinessLayoutMode(
  contentWidth: number,
): "stack" | "inline" {
  // Stack until clearly wide enough for icon + long label + "Open license" CTA.
  // Min window with expanded sidebar (~640–700px content) must never clip.
  return contentWidth < 720 ? "stack" : "inline";
}
