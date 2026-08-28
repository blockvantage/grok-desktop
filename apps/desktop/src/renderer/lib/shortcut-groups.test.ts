import { describe, expect, it } from "vitest";
import { shortcutGroups } from "../components/shortcuts-help";

describe("shortcutGroups", () => {
  it("documents Esc-to-stop and queue send-now with platform glyphs", () => {
    const mac = shortcutGroups("⌘", "⇧");
    const keys = mac.flatMap((g) => g.rows.map((r) => r.labelKey));
    expect(keys).toContain("shortcuts.stopEsc");
    expect(keys).toContain("shortcuts.queueSendNow");
    expect(mac[0]!.rows[0]!.keys).toEqual(["⌘", "K"]);

    const win = shortcutGroups("Ctrl", "Shift");
    expect(win[0]!.rows[0]!.keys).toEqual(["Ctrl", "K"]);
    const queue = win
      .flatMap((g) => g.rows)
      .find((r) => r.labelKey === "shortcuts.queueSendNow");
    expect(queue?.keys).toEqual(["Ctrl", "Enter"]);
  });
});
