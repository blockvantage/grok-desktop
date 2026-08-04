import { describe, it, expect } from "vitest";
import {
  latestErrorMessage,
  recoveryBannerMessage,
  shouldShowRecoveryBanner,
} from "./recovery-banner-state";

describe("latestErrorMessage", () => {
  it("returns last error message", () => {
    expect(
      latestErrorMessage([
        { kind: "error", payload: { message: "first" } },
        { kind: "message", payload: {} },
        { kind: "error", payload: { message: "second" } },
      ]),
    ).toBe("second");
  });

  it("returns undefined when no error", () => {
    expect(
      latestErrorMessage([{ kind: "message", payload: {} }]),
    ).toBeUndefined();
  });
});

describe("recoveryBannerMessage", () => {
  it("prefers event message", () => {
    expect(
      recoveryBannerMessage({
        events: [{ kind: "error", payload: { message: "boom" } }],
        taskStatus: "failed",
        fallbackFailedMessage: "Task failed",
      }),
    ).toBe("boom");
  });

  it("falls back when failed without event", () => {
    expect(
      recoveryBannerMessage({
        events: [],
        taskStatus: "failed",
        fallbackFailedMessage: "Task failed",
      }),
    ).toBe("Task failed");
  });

  it("null when not failed and no error", () => {
    expect(
      recoveryBannerMessage({
        events: [],
        taskStatus: "running",
        fallbackFailedMessage: "Task failed",
      }),
    ).toBeNull();
  });
});

describe("shouldShowRecoveryBanner", () => {
  it("hides generic unless failed", () => {
    expect(
      shouldShowRecoveryBanner({
        recoveryKind: "generic",
        taskStatus: "running",
      }),
    ).toBe(false);
    expect(
      shouldShowRecoveryBanner({
        recoveryKind: "generic",
        taskStatus: "failed",
      }),
    ).toBe(true);
  });

  it("shows non-generic always", () => {
    expect(
      shouldShowRecoveryBanner({
        recoveryKind: "usage_limit",
        taskStatus: "running",
      }),
    ).toBe(true);
  });
});
