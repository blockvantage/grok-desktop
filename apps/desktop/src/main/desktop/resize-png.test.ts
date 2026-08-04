import { describe, it, expect } from "vitest";
import {
  createSolidPng,
  readPngSize,
  resizePngNearest,
  ensurePngSize,
} from "./resize-png";

describe("resize-png", () => {
  it("createSolidPng IHDR matches dimensions", () => {
    const png = createSolidPng(200, 100);
    expect(readPngSize(png)).toEqual({ width: 200, height: 100 });
  });

  it("resizePngNearest produces exact target IHDR", () => {
    const src = createSolidPng(200, 100, [10, 20, 30]);
    const out = resizePngNearest(src, 100, 50);
    expect(readPngSize(out)).toEqual({ width: 100, height: 50 });
  });

  it("ensurePngSize is no-op when already sized", () => {
    const src = createSolidPng(64, 48);
    const r = ensurePngSize(src, "image/png", 64, 48);
    expect(r.bytes).toBe(src);
    expect(readPngSize(r.bytes)).toEqual({ width: 64, height: 48 });
  });

  it("ensurePngSize resizes when larger than target", () => {
    const src = createSolidPng(256, 128);
    const r = ensurePngSize(src, "image/png", 128, 64);
    expect(readPngSize(r.bytes)).toEqual({ width: 128, height: 64 });
  });
});
