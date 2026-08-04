import { describe, it, expect } from "vitest";
import {
  parseDesktopToolArgs,
  normalizeDesktopKey,
  normalizeModifiers,
} from "./desktop-tool-schemas.js";

describe("parseDesktopToolArgs", () => {
  it("accepts click with coords", () => {
    const r = parseDesktopToolArgs("desktop_click", { x: 10, y: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.x).toBe(10);
      expect(r.args.y).toBe(20);
    }
  });

  it("rejects unknown tool", () => {
    const r = parseDesktopToolArgs("desktop_fly", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_invalid_args");
  });

  it("requires dx or dy for scroll", () => {
    const bad = parseDesktopToolArgs("desktop_scroll", { x: 0, y: 0 });
    expect(bad.ok).toBe(false);
    const good = parseDesktopToolArgs("desktop_scroll", {
      x: 0,
      y: 0,
      dy: -100,
    });
    expect(good.ok).toBe(true);
  });

  it("requires name or path for open_app", () => {
    expect(parseDesktopToolArgs("desktop_open_app", {}).ok).toBe(false);
    expect(
      parseDesktopToolArgs("desktop_open_app", { name: "Calculator" }).ok,
    ).toBe(true);
  });

  it("accepts type with text", () => {
    const r = parseDesktopToolArgs("desktop_type", { text: "hello" });
    expect(r.ok).toBe(true);
  });

  it("rejects oversized type text and open_app path", () => {
    expect(
      parseDesktopToolArgs("desktop_type", { text: "x".repeat(8001) }).ok,
    ).toBe(false);
    expect(
      parseDesktopToolArgs("desktop_open_app", {
        path: "/" + "a".repeat(4096),
      }).ok,
    ).toBe(false);
    expect(
      parseDesktopToolArgs("desktop_key", { key: "k".repeat(65) }).ok,
    ).toBe(false);
  });

  it("rejects non-finite or extreme coordinates", () => {
    expect(
      parseDesktopToolArgs("desktop_click", { x: Number.NaN, y: 0 }).ok,
    ).toBe(false);
    expect(
      parseDesktopToolArgs("desktop_click", { x: 1e9, y: 0 }).ok,
    ).toBe(false);
  });
});

describe("normalizeDesktopKey", () => {
  it("normalizes aliases", () => {
    expect(normalizeDesktopKey("Return")).toBe("enter");
    expect(normalizeDesktopKey("ESC")).toBe("escape");
    expect(normalizeDesktopKey("ArrowUp")).toBe("up");
  });
});

describe("normalizeModifiers", () => {
  it("maps cmd/meta/option", () => {
    expect(normalizeModifiers(["Command", "option", "SHIFT"])).toEqual([
      "cmd",
      "alt",
      "shift",
    ]);
  });
});
