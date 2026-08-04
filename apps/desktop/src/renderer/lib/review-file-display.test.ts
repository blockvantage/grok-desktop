import { describe, expect, it } from "vitest";
import {
  reviewFileBasename,
  statusDotMayAnimate,
  withReviewFileAvailability,
} from "./review-file-display";

describe("reviewFileBasename", () => {
  it("shows filename first for posix and windows paths", () => {
    expect(reviewFileBasename("/ws/src/a.ts")).toBe("a.ts");
    expect(reviewFileBasename("C:\\\\Users\\\\me\\\\b.md")).toBe("b.md");
    expect(reviewFileBasename("solo.txt")).toBe("solo.txt");
  });

  it("handles trailing separators and empty", () => {
    expect(reviewFileBasename("/ws/src/")).toBe("src");
    expect(reviewFileBasename("")).toBe("");
  });
});

describe("withReviewFileAvailability", () => {
  it("marks vanished files unavailable without dropping rows", () => {
    const rows = withReviewFileAvailability(
      [{ path: "/ws/a.ts" }, { path: "/ws/gone.ts" }],
      (p) => p !== "/ws/gone.ts",
    );
    expect(rows).toEqual([
      { path: "/ws/a.ts", available: true },
      { path: "/ws/gone.ts", available: false },
    ]);
  });
});

describe("statusDotMayAnimate", () => {
  it("only running may animate; done/failed/queued are static", () => {
    expect(statusDotMayAnimate("running")).toBe(true);
    expect(statusDotMayAnimate("queued")).toBe(false);
    expect(statusDotMayAnimate("done")).toBe(false);
    expect(statusDotMayAnimate("failed")).toBe(false);
    expect(statusDotMayAnimate("waiting_approval")).toBe(false);
  });
});
