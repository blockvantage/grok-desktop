import { describe, it, expect } from "vitest";
import { isUsefulDoneSummary } from "./done-summary.js";

describe("isUsefulDoneSummary", () => {
  it("rejects empty and lifecycle boilerplate", () => {
    expect(isUsefulDoneSummary("")).toBe(false);
    expect(isUsefulDoneSummary("   ")).toBe(false);
    expect(isUsefulDoneSummary("Grok Build completed")).toBe(false);
    expect(isUsefulDoneSummary("Done.")).toBe(false);
    expect(isUsefulDoneSummary("EndTurn")).toBe(false);
    expect(isUsefulDoneSummary("Grok Build finished (code 0)")).toBe(false);
  });

  it("accepts real summaries", () => {
    expect(isUsefulDoneSummary("Wrote the marketing brief.")).toBe(true);
    expect(isUsefulDoneSummary("Completed the refactor of auth.ts")).toBe(true);
  });
});
