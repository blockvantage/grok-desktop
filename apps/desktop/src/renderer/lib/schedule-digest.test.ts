import { describe, expect, it } from "vitest";
import {
  buildScheduleDigest,
  shouldShowScheduleDigest,
} from "./schedule-digest";

describe("schedule-digest", () => {
  it("summarizes overnight runs inside the lookback window", () => {
    const digest = buildScheduleDigest({
      now: new Date("2026-07-15T08:00:00.000Z"),
      lookbackHours: 16,
      runs: [
        {
          scheduleId: "s1",
          scheduleName: "Nightly research",
          status: "done",
          finishedAt: "2026-07-15T02:00:00.000Z",
          taskId: "t1",
        },
        {
          scheduleId: "s2",
          scheduleName: "Competitor scrape",
          status: "failed",
          finishedAt: "2026-07-15T03:00:00.000Z",
          goal: "scrape prices",
        },
        {
          scheduleId: "s3",
          scheduleName: "Old",
          status: "done",
          finishedAt: "2026-07-10T02:00:00.000Z",
        },
      ],
    });
    expect(digest.lines).toHaveLength(2);
    expect(digest.doneCount).toBe(1);
    expect(digest.failedCount).toBe(1);
    expect(digest.headline).toMatch(/failed/i);
    expect(shouldShowScheduleDigest(digest)).toBe(true);
  });

  it("returns empty digest when no recent runs", () => {
    const digest = buildScheduleDigest({
      now: new Date("2026-07-15T08:00:00.000Z"),
      runs: [],
    });
    expect(shouldShowScheduleDigest(digest)).toBe(false);
    expect(digest.headline).toMatch(/No scheduled/i);
  });
});
