import { describe, it, expect } from "vitest";
import { shouldHarvestDeliverablesOnList } from "./artifacts-list.js";

describe("shouldHarvestDeliverablesOnList", () => {
  it("harvests only terminal task statuses with taskId", () => {
    expect(shouldHarvestDeliverablesOnList("t1", "done")).toBe(true);
    expect(shouldHarvestDeliverablesOnList("t1", "failed")).toBe(true);
    expect(shouldHarvestDeliverablesOnList("t1", "cancelled")).toBe(true);
    expect(shouldHarvestDeliverablesOnList("t1", "running")).toBe(false);
    expect(shouldHarvestDeliverablesOnList(undefined, "done")).toBe(false);
    expect(shouldHarvestDeliverablesOnList("t1", null)).toBe(false);
  });
});
