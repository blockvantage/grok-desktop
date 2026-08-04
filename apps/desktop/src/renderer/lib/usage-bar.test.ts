import { describe, expect, it } from "vitest";
import { usageBarClass, usageTrackClass } from "./usage-bar";

describe("usageBarClass", () => {
  it("is success for low usage", () => {
    expect(usageBarClass(0)).toContain("success");
    expect(usageBarClass(59)).toContain("success");
  });

  it("shifts warning then destructive as usage climbs", () => {
    expect(usageBarClass(60)).toContain("warning");
    expect(usageBarClass(79)).toContain("warning");
    expect(usageBarClass(80)).toContain("warning");
    expect(usageBarClass(94)).toContain("warning");
    expect(usageBarClass(95)).toContain("destructive");
    expect(usageBarClass(100)).toContain("destructive");
  });

  it("handles null / NaN", () => {
    expect(usageBarClass(null)).toContain("success");
    expect(usageBarClass(undefined)).toContain("success");
  });
});

describe("usageTrackClass", () => {
  it("tints track when elevated", () => {
    expect(usageTrackClass(50)).toContain("black");
    expect(usageTrackClass(70)).toContain("warning");
    expect(usageTrackClass(96)).toContain("destructive");
  });
});
