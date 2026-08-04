import { describe, expect, it } from "vitest";
import {
  fitImageInView,
  phoneViewToImageCoords,
  qualityConstraints,
  qualityDiffers,
  teleChannel,
} from "./telepresence.js";

describe("telepresence quality presets", () => {
  it("auto/smooth/crisp produce different encode constraints", () => {
    expect(qualityDiffers("smooth", "crisp")).toBe(true);
    expect(qualityDiffers("auto", "smooth")).toBe(true);
    const smooth = qualityConstraints("smooth");
    const crisp = qualityConstraints("crisp");
    expect(crisp.maxLongEdge).toBeGreaterThan(smooth.maxLongEdge);
    expect(crisp.fps).toBeGreaterThanOrEqual(smooth.fps);
    expect(crisp.jpegQuality).toBeGreaterThan(smooth.jpegQuality);
  });
});

describe("phoneViewToImageCoords (letterbox)", () => {
  it("maps center of content to center of image", () => {
    // view 200x100, image 100x100 → content 100x100 centered at x=50
    const p = phoneViewToImageCoords(100, 50, 200, 100, 100, 100);
    expect(p).toEqual({ x: 50, y: 50 });
  });

  it("returns null for black-bar region", () => {
    const p = phoneViewToImageCoords(10, 50, 200, 100, 100, 100);
    expect(p).toBeNull();
  });

  it("maps corners of content to image corners", () => {
    const box = fitImageInView(200, 100, 100, 100);
    const tl = phoneViewToImageCoords(
      box.contentX + 0.5,
      box.contentY + 0.5,
      200,
      100,
      100,
      100,
    );
    expect(tl).not.toBeNull();
    expect(tl!.x).toBeLessThan(5);
    expect(tl!.y).toBeLessThan(5);
  });
});

describe("teleChannel", () => {
  it("builds stable channel id", () => {
    expect(teleChannel("m1", "d1")).toBe("tele:m1:d1");
  });
});
