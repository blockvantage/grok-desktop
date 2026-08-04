import { describe, expect, it } from "vitest";
import { placeMentionMenu } from "./textarea-caret";

function box(
  left: number,
  top: number,
  height = 18,
): { top: number; left: number; bottom: number; height: number } {
  return { top, left, bottom: top + height, height };
}

describe("placeMentionMenu", () => {
  it("prefers above when there is room", () => {
    const place = placeMentionMenu({
      caret: box(100, 400),
      menuWidth: 320,
      menuHeight: 160,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(place.placement).toBe("above");
    expect(place.top).toBeLessThan(400);
    expect(place.left).toBeGreaterThanOrEqual(8);
  });

  it("flips below when near the top of the viewport", () => {
    const place = placeMentionMenu({
      caret: box(40, 30),
      menuWidth: 320,
      menuHeight: 180,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(place.placement).toBe("below");
    expect(place.top).toBeGreaterThan(30);
  });

  it("clamps horizontally near the right edge", () => {
    const place = placeMentionMenu({
      caret: box(750, 300),
      menuWidth: 320,
      menuHeight: 120,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(place.left + place.width).toBeLessThanOrEqual(800 - 8);
  });
});
