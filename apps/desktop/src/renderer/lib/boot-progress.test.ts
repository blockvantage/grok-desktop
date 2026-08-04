import { describe, expect, it } from "vitest";
import { BOOT_STAGES, bootProgress } from "./boot-progress";

describe("bootProgress", () => {
  it("maps real boot milestones to increasing determinate progress", () => {
    expect(BOOT_STAGES).toEqual([
      "starting",
      "loading_workspace",
      "restoring_session",
      "ready",
    ]);
    const values = BOOT_STAGES.map(bootProgress);
    expect(values[0]).toBeGreaterThan(0);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(100);
  });
});
