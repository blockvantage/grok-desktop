import { describe, it, expect } from "vitest";
import { usageChipFromSnapshot } from "./usage-chip";

describe("usageChipFromSnapshot", () => {
  it("null when unavailable or non-warn", () => {
    expect(usageChipFromSnapshot(null)).toBeNull();
    expect(
      usageChipFromSnapshot({
        rawAvailable: false,
        creditUsagePercent: 90,
        warnLevel: "hard",
      }),
    ).toBeNull();
    expect(
      usageChipFromSnapshot({
        rawAvailable: true,
        creditUsagePercent: 50,
        warnLevel: "ok",
      }),
    ).toBeNull();
  });

  it("returns rounded pct for soft/hard", () => {
    expect(
      usageChipFromSnapshot({
        rawAvailable: true,
        creditUsagePercent: 87.6,
        warnLevel: "soft",
      }),
    ).toEqual({ pct: 88, level: "soft" });
  });
});
