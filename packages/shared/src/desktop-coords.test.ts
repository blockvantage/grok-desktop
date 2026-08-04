import { describe, it, expect } from "vitest";
import {
  imageToDevice,
  deviceToScreen,
  imageToScreen,
  imageToScreenDip,
  deviceToDip,
  computeDownscale,
} from "./desktop-coords.js";

describe("desktop-coords", () => {
  it("maps Retina 2x: 2560 device → 1280 image click (100,100) → device (200,200)", () => {
    const { imageW, imageH, imageToDeviceScale } = computeDownscale(
      2560,
      1600,
      1280,
    );
    expect(imageW).toBe(1280);
    expect(imageH).toBe(800);
    expect(imageToDeviceScale).toBeCloseTo(2);

    const d = imageToDevice(100, 100, imageW, imageH, 2560, 1600);
    expect(d).toEqual({ x: 200, y: 200 });
  });

  it("deviceToDip converts physical px to points for CGEvent", () => {
    expect(deviceToDip(200, 200, 2)).toEqual({ x: 100, y: 100 });
    expect(deviceToDip(2560, 1600, 2)).toEqual({ x: 1280, y: 800 });
  });

  it("imageToScreenDip: Retina center click lands in DIP space (not 2x too far)", () => {
    // Physical 200×100 @ 2x → DIP 100×50. Image downscaled to 100×50.
    // Click image center (50, 25) → device (100, 50) → DIP (50, 25) + origin.
    const s = imageToScreenDip(
      50,
      25,
      100,
      50,
      200,
      100,
      2,
      { x: 0, y: 0 },
    );
    expect(s).toEqual({ x: 50, y: 25 });
  });

  it("imageToScreenDip applies multi-display DIP origin", () => {
    // Secondary display at DIP x=1920; physical map then /2.
    const s = imageToScreenDip(10, 10, 100, 100, 200, 200, 2, {
      x: 1920,
      y: 0,
    });
    // device (20,20) → dip (10,10) → screen (1930, 10)
    expect(s).toEqual({ x: 1930, y: 10 });
  });

  it("identity scale when under max long edge", () => {
    const s = computeDownscale(800, 600, 1280);
    expect(s).toEqual({
      imageW: 800,
      imageH: 600,
      imageToDeviceScale: 1,
    });
  });

  it("clamps corners to device bounds", () => {
    expect(imageToDevice(-10, -5, 100, 100, 200, 200)).toEqual({
      x: 0,
      y: 0,
    });
    expect(imageToDevice(999, 999, 100, 100, 200, 200)).toEqual({
      x: 199,
      y: 199,
    });
  });

  it("applies multi-display offset via deviceToScreen", () => {
    const d = imageToDevice(50, 25, 100, 50, 200, 100);
    const s = deviceToScreen(d.x, d.y, { x: 1920, y: 0 });
    expect(s).toEqual({ x: 1920 + 100, y: 50 });
  });

  it("imageToScreen (legacy sf=1) composes map + offset", () => {
    const s = imageToScreen(10, 10, 100, 100, 200, 200, { x: 100, y: 50 });
    expect(s).toEqual({ x: 120, y: 70 });
  });
});
