import { describe, it, expect } from "vitest";
import {
  browserChatColumnStyle,
  browserChatColumnFlexClass,
} from "./browser-chat-column-style";

describe("browserChatColumnStyle", () => {
  it("undefined when browser closed", () => {
    expect(
      browserChatColumnStyle({
        browserOpen: false,
        chatSplitPct: 40,
        railVisible: false,
      }),
    ).toBeUndefined();
  });

  it("applies pct and rail maxWidth", () => {
    expect(
      browserChatColumnStyle({
        browserOpen: true,
        chatSplitPct: 42,
        railVisible: true,
      }),
    ).toEqual({
      flexBasis: "42%",
      width: "42%",
      maxWidth: "46%",
      minWidth: 260,
    });
    expect(
      browserChatColumnStyle({
        browserOpen: true,
        chatSplitPct: 40,
        railVisible: false,
      })?.maxWidth,
    ).toBe("58%");
  });
});

describe("browserChatColumnFlexClass", () => {
  it("open vs closed", () => {
    expect(browserChatColumnFlexClass(true)).toBe("shrink-0 grow-0");
    expect(browserChatColumnFlexClass(false)).toBe("min-w-0 flex-1");
  });
});
