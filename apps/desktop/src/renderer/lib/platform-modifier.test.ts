import { describe, expect, it } from "vitest";
import {
  altKeyGlyph,
  isApplePlatform,
  modifierKeyGlyph,
  shiftKeyGlyph,
} from "./platform-modifier";

describe("platform modifier glyphs", () => {
  it("uses Apple glyphs on darwin / MacIntel", () => {
    expect(isApplePlatform("darwin")).toBe(true);
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(modifierKeyGlyph(true)).toBe("⌘");
    expect(shiftKeyGlyph(true)).toBe("⇧");
    expect(altKeyGlyph(true)).toBe("⌥");
  });

  it("uses Ctrl/Shift/Alt on Windows and Linux", () => {
    expect(isApplePlatform("Win32")).toBe(false);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
    expect(modifierKeyGlyph(false)).toBe("Ctrl");
    expect(shiftKeyGlyph(false)).toBe("Shift");
    expect(altKeyGlyph(false)).toBe("Alt");
  });
});
