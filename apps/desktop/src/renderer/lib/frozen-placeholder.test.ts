import { describe, expect, it } from "vitest";
import { freezePlaceholderKey } from "./frozen-placeholder";

describe("freezePlaceholderKey", () => {
  it("tracks the live key when unfocused or empty", () => {
    expect(
      freezePlaceholderKey({
        liveKey: "workspace.followUpLive",
        focused: false,
        valueNonEmpty: true,
        frozenKey: null,
      }),
    ).toEqual({
      displayKey: "workspace.followUpLive",
      nextFrozenKey: null,
    });

    expect(
      freezePlaceholderKey({
        liveKey: "workspace.followUp",
        focused: true,
        valueNonEmpty: false,
        frozenKey: "workspace.followUpLive",
      }),
    ).toEqual({
      displayKey: "workspace.followUp",
      nextFrozenKey: null,
    });
  });

  it("freezes the first live key while focused with text", () => {
    const first = freezePlaceholderKey({
      liveKey: "workspace.followUpLive",
      focused: true,
      valueNonEmpty: true,
      frozenKey: null,
    });
    expect(first).toEqual({
      displayKey: "workspace.followUpLive",
      nextFrozenKey: "workspace.followUpLive",
    });

    // Live key flips to terminal follow-up — display stays frozen.
    const second = freezePlaceholderKey({
      liveKey: "workspace.followUp",
      focused: true,
      valueNonEmpty: true,
      frozenKey: first.nextFrozenKey,
    });
    expect(second).toEqual({
      displayKey: "workspace.followUpLive",
      nextFrozenKey: "workspace.followUpLive",
    });
  });
});
