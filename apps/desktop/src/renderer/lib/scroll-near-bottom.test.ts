import { describe, it, expect } from "vitest";
import {
  isNearBottom,
  NEAR_BOTTOM_THRESHOLD_PX,
} from "./scroll-near-bottom";

describe("isNearBottom", () => {
  it("true when within threshold", () => {
    // height 1000, client 200, scrollTop 750 → dist 50
    expect(isNearBottom(1000, 750, 200)).toBe(true);
  });

  it("false when scrolled up", () => {
    // dist 200
    expect(isNearBottom(1000, 600, 200)).toBe(false);
  });

  it("uses default threshold constant (strictly less than)", () => {
    expect(NEAR_BOTTOM_THRESHOLD_PX).toBe(90);
    // dist = 1000 - 710 - 200 = 90 → not near
    expect(isNearBottom(1000, 710, 200, 90)).toBe(false);
    // dist = 89 → near
    expect(isNearBottom(1000, 711, 200, 90)).toBe(true);
  });
});
