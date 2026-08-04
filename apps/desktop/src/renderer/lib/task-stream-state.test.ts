import { describe, expect, it } from "vitest";
import {
  legacyItemProvidesLiveSignal,
  legacyItemsHaveVisibleLiveSignal,
  shouldShowLegacyWorking,
} from "./task-stream-state";

describe("legacy task stream live status", () => {
  it("does not treat a suppressed progress row as a visible live signal", () => {
    expect(legacyItemProvidesLiveSignal({ kind: "progress" })).toBe(false);
  });

  it("shows one fallback status when active progress is suppressed", () => {
    expect(
      shouldShowLegacyWorking({
        active: true,
        streamingAssistant: false,
        visibleLiveSignal: false,
      }),
    ).toBe(true);
  });

  it("does not duplicate a visible running tool signal", () => {
    expect(
      legacyItemProvidesLiveSignal({ kind: "toolAction", status: "running" }),
    ).toBe(true);
    expect(
      shouldShowLegacyWorking({
        active: true,
        streamingAssistant: false,
        visibleLiveSignal: true,
      }),
    ).toBe(false);
  });

  it("keeps a running tool as the sole signal when suppressed progress follows", () => {
    const visibleLiveSignal = legacyItemsHaveVisibleLiveSignal([
      { kind: "toolAction", status: "running" },
      { kind: "progress" },
    ]);

    expect(visibleLiveSignal).toBe(true);
    expect(
      shouldShowLegacyWorking({
        active: true,
        streamingAssistant: false,
        visibleLiveSignal,
      }),
    ).toBe(false);
  });
});
