/**
 * Pure helpers for macOS coordinate conversion (unit-tested without Electron).
 * CGEvent / NSEvent use global **points** (DIP), not physical pixels.
 */

import { imageToScreenDip } from "@grokdesk/shared";

export type MacDisplayMetrics = {
  /** Physical pixel size of the display backing store */
  deviceWidth: number;
  deviceHeight: number;
  scaleFactor: number;
  /** Electron display.bounds in DIP/points */
  boundsDip: { x: number; y: number; width: number; height: number };
};

/**
 * Build listDisplays-style metrics from Electron Screen Display fields.
 * - width/height (physical) = size * scaleFactor
 * - bounds remain DIP (do NOT multiply by scaleFactor)
 */
export function electronDisplayToMetrics(d: {
  id: number | string;
  label?: string;
  size: { width: number; height: number };
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
}): {
  id: string;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
} {
  const sf = d.scaleFactor > 0 ? d.scaleFactor : 1;
  return {
    id: String(d.id),
    label: d.label || `Display ${d.id}`,
    width: Math.round(d.size.width * sf),
    height: Math.round(d.size.height * sf),
    scaleFactor: sf,
    bounds: {
      x: Math.round(d.bounds.x),
      y: Math.round(d.bounds.y),
      width: Math.round(d.bounds.width),
      height: Math.round(d.bounds.height),
    },
    isPrimary: d.isPrimary,
  };
}

/** Map screenshot image coords to CGEvent global points. */
export function imageToCgEventPoint(
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
  m: MacDisplayMetrics,
): { x: number; y: number } {
  return imageToScreenDip(
    imageX,
    imageY,
    imageW,
    imageH,
    m.deviceWidth,
    m.deviceHeight,
    m.scaleFactor,
    m.boundsDip,
  );
}

/** CGEventType values for mouse buttons (from CGEventTypes.h). */
export const CG_MOUSE = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  move: 5,
  leftDragged: 6,
  otherDown: 25,
  otherUp: 26,
} as const;

export function cgEventTypesForButton(
  button: "left" | "right" | "middle",
): { down: number; up: number; btn: number } {
  if (button === "right") {
    return { down: CG_MOUSE.rightDown, up: CG_MOUSE.rightUp, btn: 1 };
  }
  if (button === "middle") {
    return { down: CG_MOUSE.otherDown, up: CG_MOUSE.otherUp, btn: 2 };
  }
  return { down: CG_MOUSE.leftDown, up: CG_MOUSE.leftUp, btn: 0 };
}
