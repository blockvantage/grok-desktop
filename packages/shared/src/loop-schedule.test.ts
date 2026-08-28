import { describe, expect, it } from "vitest";
import {
  intervalToCron,
  parseLoopDraft,
} from "./loop-schedule.js";

describe("intervalToCron", () => {
  it("maps minutes, hours, and days", () => {
    expect(intervalToCron("30m")).toBe("*/30 * * * *");
    expect(intervalToCron("every 5 min")).toBe("*/5 * * * *");
    expect(intervalToCron("1h")).toBe("0 * * * *");
    expect(intervalToCron("2h")).toBe("0 */2 * * *");
    expect(intervalToCron("1d")).toBe("0 9 * * *");
    expect(intervalToCron("60s")).toBe("* * * * *");
    expect(intervalToCron("nope")).toBeNull();
  });
});

describe("parseLoopDraft", () => {
  it("reads /loop every 30m plus a prompt", () => {
    const draft = parseLoopDraft("/loop every 30m check if CI is green");
    expect(draft).toMatchObject({
      cron: "*/30 * * * *",
      prompt: "check if CI is green",
      intervalLabel: "every 30 minutes",
    });
    expect(draft?.name.toLowerCase()).toContain("ci");
  });

  it("returns null without an interval+prompt pair", () => {
    expect(parseLoopDraft("/loop")).toBeNull();
    expect(parseLoopDraft("write a brief")).toBeNull();
    expect(parseLoopDraft("")).toBeNull();
  });
});
