import { describe, it, expect } from "vitest";
import {
  naturalLanguageToCron,
  nextRunAt,
  isInQuietHours,
  parseQuietHoursClock,
} from "./recurrence.js";

describe("recurrence", () => {
  it("maps NL to cron", () => {
    expect(naturalLanguageToCron("every monday 9am")).toBe("0 9 * * 1");
    expect(naturalLanguageToCron("daily at 9am")).toBe("0 9 * * *");
    expect(naturalLanguageToCron("nonsense")).toBeNull();
  });

  it("computes next run in UTC", () => {
    const from = new Date("2026-07-10T08:00:00.000Z");
    const next = nextRunAt("0 9 * * *", "UTC", from);
    expect(next.toISOString()).toBe("2026-07-10T09:00:00.000Z");
  });

  it("detects quiet hours spanning midnight", () => {
    const night = new Date("2026-07-10T23:30:00");
    expect(
      isInQuietHours(night, { start: "22:00", end: "08:00" }),
    ).toBe(true);
    const day = new Date("2026-07-10T12:00:00");
    expect(isInQuietHours(day, { start: "22:00", end: "08:00" })).toBe(false);
  });

  it("evaluates quiet hours in the configured IANA timezone", () => {
    // 14:00 UTC = 07:00 America/Los_Angeles in July (PDT, UTC-7).
    const utcMorningLA = new Date("2026-07-10T14:00:00.000Z");
    expect(
      isInQuietHours(utcMorningLA, {
        start: "22:00",
        end: "08:00",
        timezone: "America/Los_Angeles",
      }),
    ).toBe(true);
    // 20:00 UTC = 13:00 America/Los_Angeles — outside quiet window.
    const utcAfternoonLA = new Date("2026-07-10T20:00:00.000Z");
    expect(
      isInQuietHours(utcAfternoonLA, {
        start: "22:00",
        end: "08:00",
        timezone: "America/Los_Angeles",
      }),
    ).toBe(false);
  });

  it("rejects invalid quiet-hours clocks and stays not-quiet", () => {
    expect(parseQuietHoursClock("25:00")).toBeNull();
    expect(parseQuietHoursClock("12:60")).toBeNull();
    expect(parseQuietHoursClock("noon")).toBeNull();
    expect(parseQuietHoursClock("9:5")).toBeNull();
    expect(parseQuietHoursClock("09:00")).toBe(9 * 60);
    const now = new Date("2026-07-10T23:30:00Z");
    expect(
      isInQuietHours(now, { start: "25:00", end: "08:00", timezone: "UTC" }),
    ).toBe(false);
  });

  it("honors America/New_York across DST spring and fall instants", () => {
    // 2026-03-08 07:00 UTC = 02:00 EST (before spring-forward) — quiet 22–08.
    const preSpring = new Date("2026-03-08T07:00:00.000Z");
    expect(
      isInQuietHours(preSpring, {
        start: "22:00",
        end: "08:00",
        timezone: "America/New_York",
      }),
    ).toBe(true);
    // After spring-forward, 07:00 UTC = 03:00 EDT — still quiet.
    const postSpring = new Date("2026-03-08T07:30:00.000Z");
    expect(
      isInQuietHours(postSpring, {
        start: "22:00",
        end: "08:00",
        timezone: "America/New_York",
      }),
    ).toBe(true);
    // Midday EDT after spring — not quiet.
    const midday = new Date("2026-03-08T17:00:00.000Z");
    expect(
      isInQuietHours(midday, {
        start: "22:00",
        end: "08:00",
        timezone: "America/New_York",
      }),
    ).toBe(false);
    // Fall-back day 2026-11-01 06:30 UTC = 01:30 EST (second 1am window) — quiet.
    const fallBack = new Date("2026-11-01T06:30:00.000Z");
    expect(
      isInQuietHours(fallBack, {
        start: "22:00",
        end: "08:00",
        timezone: "America/New_York",
      }),
    ).toBe(true);
  });

  it("advances cron next run across America/New_York DST spring gap", () => {
    // Just before 2am local spring-forward: 2026-03-08 06:30 UTC = 01:30 EST.
    const from = new Date("2026-03-08T06:30:00.000Z");
    const next = nextRunAt("0 3 * * *", "America/New_York", from);
    // 3am EDT does not exist on spring day; cron-parser lands on 3am EDT = 07:00 UTC.
    expect(next.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
});
