import { describe, it, expect } from "vitest";
import {
  imagineFromTaskNavState,
  scheduleFromTaskNavState,
  seedScheduleFormGoal,
} from "./imagine-schedule-nav";

describe("imagineFromTaskNavState", () => {
  it("homes with goal", () => {
    expect(imagineFromTaskNavState("Draw a logo")).toEqual({
      goal: "Draw a logo",
      nav: "home",
    });
  });
});

describe("scheduleFromTaskNavState", () => {
  it("scheduled with template", () => {
    expect(scheduleFromTaskNavState("Weekly report")).toEqual({
      goal: "Weekly report",
      nav: "scheduled",
    });
  });
});

describe("seedScheduleFormGoal", () => {
  it("trims draft for ScheduledView create form", () => {
    expect(seedScheduleFormGoal("  daily standup  ")).toBe("daily standup");
    expect(seedScheduleFormGoal(null)).toBe("");
    expect(seedScheduleFormGoal(undefined)).toBe("");
    expect(seedScheduleFormGoal("")).toBe("");
  });

  it("accepts scheduleFromTaskNavState goal as form seed (intent path)", () => {
    const nav = scheduleFromTaskNavState(
      "Set up a recurring schedule for this work. Propose a clear name.",
    );
    expect(nav.nav).toBe("scheduled");
    // Same function ScheduledView uses for useState / useEffect seed.
    expect(seedScheduleFormGoal(nav.goal)).toBe(nav.goal);
    expect(seedScheduleFormGoal(nav.goal).length).toBeGreaterThan(10);
  });
});
