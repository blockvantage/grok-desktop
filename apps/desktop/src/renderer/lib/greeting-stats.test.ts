import { describe, it, expect } from "vitest";
import {
  greetingNameFromAuth,
  greetingStatsFromLists,
} from "./greeting-stats";

describe("greetingStatsFromLists", () => {
  it("counts total, running, done, enabled schedules", () => {
    const isActive = (s: string) => s === "running" || s === "queued";
    expect(
      greetingStatsFromLists(
        [
          { status: "running" },
          { status: "done" },
          { status: "queued" },
          { status: "failed" },
        ],
        [{ enabled: true }, { enabled: false }, { enabled: true }],
        isActive,
      ),
    ).toEqual({
      total: 4,
      running: 2,
      done: 1,
      enabledSchedules: 2,
    });
  });
});

describe("greetingNameFromAuth", () => {
  it("prefers accountName then accountLabel", () => {
    expect(
      greetingNameFromAuth({ accountName: "Ada", accountLabel: "x" }),
    ).toBe("Ada");
    expect(greetingNameFromAuth({ accountLabel: "lab" })).toBe("lab");
    expect(greetingNameFromAuth(null)).toBe("");
  });
});
