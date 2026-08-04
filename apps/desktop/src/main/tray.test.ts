import { describe, expect, it } from "vitest";
import { trayAssetName } from "./tray";

describe("trayAssetName", () => {
  it("chooses the light glyph for dark system appearance", () => {
    expect(trayAssetName(true)).toBe("tray-icon-light.png");
  });

  it("chooses the dark glyph for light system appearance", () => {
    expect(trayAssetName(false)).toBe("tray-icon-dark.png");
  });
});
