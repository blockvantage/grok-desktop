/**
 * Screenshot image space ↔ device pixels ↔ DIP/points (input APIs) ↔ global screen.
 * Pure math — no I/O.
 *
 * Coordinate systems:
 * - **image**: model-visible screenshot pixels (top-left origin)
 * - **device**: physical display pixels (backing store)
 * - **DIP / points**: logical coordinates for CGEvent / Electron / Windows logical cursor
 * - **screen**: global DIP with multi-monitor origin (bounds.x/y)
 */

export function imageToDevice(
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
  deviceW: number,
  deviceH: number,
): { x: number; y: number } {
  if (imageW <= 0 || imageH <= 0 || deviceW <= 0 || deviceH <= 0) {
    return { x: 0, y: 0 };
  }
  const x = Math.round((imageX / imageW) * deviceW);
  const y = Math.round((imageY / imageH) * deviceH);
  return {
    x: Math.min(deviceW - 1, Math.max(0, x)),
    y: Math.min(deviceH - 1, Math.max(0, y)),
  };
}

/** Physical device pixels → logical DIP/points (CGEvent, Electron bounds). */
export function deviceToDip(
  deviceX: number,
  deviceY: number,
  scaleFactor: number,
): { x: number; y: number } {
  const s = scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(deviceX / s),
    y: Math.round(deviceY / s),
  };
}

export function deviceToScreen(
  deviceX: number,
  deviceY: number,
  bounds: { x: number; y: number },
): { x: number; y: number } {
  return { x: bounds.x + deviceX, y: bounds.y + deviceY };
}

/**
 * Map screenshot-space point to global **DIP/points** for synthetic input.
 * `bounds` must be in DIP (Electron display.bounds), not physical pixels.
 */
export function imageToScreenDip(
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
  deviceW: number,
  deviceH: number,
  scaleFactor: number,
  boundsDip: { x: number; y: number },
): { x: number; y: number } {
  const d = imageToDevice(imageX, imageY, imageW, imageH, deviceW, deviceH);
  const dip = deviceToDip(d.x, d.y, scaleFactor);
  return {
    x: boundsDip.x + dip.x,
    y: boundsDip.y + dip.y,
  };
}

/**
 * @deprecated Prefer imageToScreenDip when scaleFactor is known.
 * Treats device coords as if scaleFactor === 1 (legacy).
 */
export function imageToScreen(
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
  deviceW: number,
  deviceH: number,
  bounds: { x: number; y: number },
): { x: number; y: number } {
  return imageToScreenDip(
    imageX,
    imageY,
    imageW,
    imageH,
    deviceW,
    deviceH,
    1,
    bounds,
  );
}

export function computeDownscale(
  deviceW: number,
  deviceH: number,
  maxLongEdge: number,
): { imageW: number; imageH: number; imageToDeviceScale: number } {
  const longEdge = Math.max(deviceW, deviceH);
  if (longEdge <= 0) {
    return { imageW: 1, imageH: 1, imageToDeviceScale: 1 };
  }
  if (longEdge <= maxLongEdge) {
    return { imageW: deviceW, imageH: deviceH, imageToDeviceScale: 1 };
  }
  const scale = maxLongEdge / longEdge;
  return {
    imageW: Math.max(1, Math.round(deviceW * scale)),
    imageH: Math.max(1, Math.round(deviceH * scale)),
    imageToDeviceScale: 1 / scale,
  };
}
