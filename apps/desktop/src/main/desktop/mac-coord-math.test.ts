import { describe, it, expect } from "vitest";
import {
  electronDisplayToMetrics,
  imageToCgEventPoint,
  cgEventTypesForButton,
  CG_MOUSE,
} from "./mac-coord-math";

describe("mac-coord-math", () => {
  it("keeps bounds in DIP while width/height are physical pixels", () => {
    const m = electronDisplayToMetrics({
      id: 1,
      label: "Built-in",
      size: { width: 1440, height: 900 },
      scaleFactor: 2,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      isPrimary: true,
    });
    expect(m.width).toBe(2880);
    expect(m.height).toBe(1800);
    expect(m.bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    expect(m.scaleFactor).toBe(2);
  });

  it("does not multiply secondary display origin by scaleFactor", () => {
    const m = electronDisplayToMetrics({
      id: 2,
      size: { width: 1920, height: 1080 },
      scaleFactor: 2,
      bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
      isPrimary: false,
    });
    expect(m.bounds.x).toBe(1440); // DIP, not 2880
    expect(m.width).toBe(3840);
  });

  it("maps image center on Retina to DIP center for CGEvent (not 2×)", () => {
    // Physical 2880×1800 @2x, image downscaled 1440×900
    const pt = imageToCgEventPoint(720, 450, 1440, 900, {
      deviceWidth: 2880,
      deviceHeight: 1800,
      scaleFactor: 2,
      boundsDip: { x: 0, y: 0, width: 1440, height: 900 },
    });
    // device (1440, 900) → dip (720, 450)
    expect(pt).toEqual({ x: 720, y: 450 });
  });

  it("exports correct CGEvent button types", () => {
    expect(cgEventTypesForButton("left")).toEqual({
      down: CG_MOUSE.leftDown,
      up: CG_MOUSE.leftUp,
      btn: 0,
    });
    expect(cgEventTypesForButton("right")).toEqual({
      down: 3,
      up: 4,
      btn: 1,
    });
    expect(cgEventTypesForButton("middle")).toEqual({
      down: 25,
      up: 26,
      btn: 2,
    });
  });
});
