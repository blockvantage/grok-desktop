/**
 * Platform modifier glyphs for shortcut chrome (Phase 2.6).
 * Apple: ⌘ ⇧ ⌥ ; others: Ctrl Shift Alt.
 */

export function isApplePlatform(
  platform: string = typeof navigator !== "undefined"
    ? navigator.platform
    : process.platform,
): boolean {
  const p = platform.toLowerCase();
  return (
    p === "darwin" ||
    p.includes("mac") ||
    p.includes("iphone") ||
    p.includes("ipad") ||
    p.includes("ipod")
  );
}

export function modifierKeyGlyph(apple = isApplePlatform()): string {
  return apple ? "⌘" : "Ctrl";
}

export function shiftKeyGlyph(apple = isApplePlatform()): string {
  return apple ? "⇧" : "Shift";
}

export function altKeyGlyph(apple = isApplePlatform()): string {
  return apple ? "⌥" : "Alt";
}
