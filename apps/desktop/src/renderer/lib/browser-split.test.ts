import { describe, expect, it } from "vitest";
import {
  chatSplitPctFromPointer,
  clampChatSplitPct,
  DEFAULT_CHAT_SPLIT_PCT,
  MAX_CHAT_SPLIT_PCT,
  MIN_CHAT_SPLIT_PCT,
  showDeliverablesRail,
} from "./browser-split";

describe("browser-split", () => {
  it("clamps chat split into the usable band", () => {
    expect(clampChatSplitPct(10)).toBe(MIN_CHAT_SPLIT_PCT);
    expect(clampChatSplitPct(90)).toBe(MAX_CHAT_SPLIT_PCT);
    expect(clampChatSplitPct(DEFAULT_CHAT_SPLIT_PCT)).toBe(
      DEFAULT_CHAT_SPLIT_PCT,
    );
    expect(clampChatSplitPct(Number.NaN)).toBe(DEFAULT_CHAT_SPLIT_PCT);
  });

  it("maps pointer X to chat percent", () => {
    // Midpoint of a 1000px container at x=100 → 50% raw, clamped to max 58
    expect(chatSplitPctFromPointer(600, 100, 1000)).toBe(50);
    expect(chatSplitPctFromPointer(100, 100, 1000)).toBe(MIN_CHAT_SPLIT_PCT);
    expect(chatSplitPctFromPointer(0, 0, 0)).toBe(DEFAULT_CHAT_SPLIT_PCT);
  });

  it("hides rail when browser is open unless ultra-wide", () => {
    expect(
      showDeliverablesRail({
        browserOpen: true,
        railOpen: true,
        viewportWidth: 1440,
      }),
    ).toBe(false);
    expect(
      showDeliverablesRail({
        browserOpen: true,
        railOpen: true,
        viewportWidth: 1700,
      }),
    ).toBe(true);
    expect(
      showDeliverablesRail({
        browserOpen: false,
        railOpen: true,
        viewportWidth: 800,
      }),
    ).toBe(true);
    expect(
      showDeliverablesRail({
        browserOpen: false,
        railOpen: false,
        viewportWidth: 2000,
      }),
    ).toBe(false);
  });

  it("stays closed by default (chat-first) until user opens rail", () => {
    expect(
      showDeliverablesRail({
        browserOpen: false,
        railOpen: false,
        viewportWidth: 1600,
      }),
    ).toBe(false);
  });
});
