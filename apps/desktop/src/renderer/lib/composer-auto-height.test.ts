import { describe, it, expect } from "vitest";
import {
  autoGrowComposerHeightPx,
  COMPOSER_MAX_ROWS,
  COMPOSER_LINE_HEIGHT_PX,
} from "./composer-auto-height";

describe("autoGrowComposerHeightPx", () => {
  it("returns scrollHeight when under max", () => {
    expect(autoGrowComposerHeightPx(40)).toBe(40);
  });

  it("clamps to max rows", () => {
    const max = COMPOSER_MAX_ROWS * COMPOSER_LINE_HEIGHT_PX;
    expect(autoGrowComposerHeightPx(max + 100)).toBe(max);
  });

  it("handles invalid heights", () => {
    expect(autoGrowComposerHeightPx(NaN)).toBe(0);
    expect(autoGrowComposerHeightPx(-5)).toBe(0);
  });
});
