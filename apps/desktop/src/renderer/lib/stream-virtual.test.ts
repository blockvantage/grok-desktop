import { describe, it, expect } from "vitest";
import {
  shouldVirtualizeStream,
  STREAM_VIRTUALIZE_THRESHOLD,
  scrollTargetForStream,
} from "./stream-virtual";

describe("shouldVirtualizeStream", () => {
  it("stays off under the threshold", () => {
    expect(shouldVirtualizeStream(0)).toBe(false);
    expect(shouldVirtualizeStream(STREAM_VIRTUALIZE_THRESHOLD)).toBe(false);
  });

  it("turns on above the threshold", () => {
    expect(shouldVirtualizeStream(STREAM_VIRTUALIZE_THRESHOLD + 1)).toBe(true);
    expect(shouldVirtualizeStream(500)).toBe(true);
  });
});

describe("scrollTargetForStream", () => {
  it("uses viewport-end for short streams", () => {
    expect(scrollTargetForStream({ itemCount: 10 })).toEqual({
      mode: "viewport-end",
    });
  });

  it("uses last index when virtualizing", () => {
    const n = STREAM_VIRTUALIZE_THRESHOLD + 5;
    expect(scrollTargetForStream({ itemCount: n })).toEqual({
      mode: "index",
      index: n - 1,
    });
  });

  it("respects explicit virtualize flag", () => {
    expect(
      scrollTargetForStream({ itemCount: 3, virtualize: true }),
    ).toEqual({ mode: "index", index: 2 });
    expect(
      scrollTargetForStream({ itemCount: 100, virtualize: false }),
    ).toEqual({ mode: "viewport-end" });
  });
});
