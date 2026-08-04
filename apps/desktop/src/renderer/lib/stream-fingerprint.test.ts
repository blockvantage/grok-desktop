import { describe, it, expect } from "vitest";
import {
  shouldCelebrateDone,
  streamFingerprint,
} from "./stream-fingerprint";

describe("streamFingerprint", () => {
  it("encodes length, last id, text len, status", () => {
    expect(
      streamFingerprint(
        [
          { id: "1", payload: { text: "hi" } },
          { id: "2", payload: { text: "hello" } },
        ],
        "running",
      ),
    ).toBe("2:2:5:running");
  });

  it("handles empty list", () => {
    expect(streamFingerprint([], "queued")).toBe("0::0:queued");
  });
});

describe("shouldCelebrateDone", () => {
  it("fires only on transition into done", () => {
    expect(shouldCelebrateDone("running", "done")).toBe(true);
    expect(shouldCelebrateDone("done", "done")).toBe(false);
    expect(shouldCelebrateDone("failed", "done")).toBe(true);
    expect(shouldCelebrateDone("running", "failed")).toBe(false);
  });
});
