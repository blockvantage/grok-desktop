import { describe, it, expect } from "vitest";
import {
  isTeleFrameBlobSendable,
  TELE_FRAME_MAX_B64_LEN,
} from "./tele-frame-limits.js";

describe("tele-frame-limits", () => {
  it("rejects empty and oversized", () => {
    expect(isTeleFrameBlobSendable(0)).toBe(false);
    expect(isTeleFrameBlobSendable(TELE_FRAME_MAX_B64_LEN + 1)).toBe(false);
  });

  it("accepts at and under limit", () => {
    expect(isTeleFrameBlobSendable(1)).toBe(true);
    expect(isTeleFrameBlobSendable(TELE_FRAME_MAX_B64_LEN)).toBe(true);
  });
});
