import { describe, expect, it } from "vitest";
import { buildScheduleOutcomeInbox } from "./schedule-outcomes.js";

describe("buildScheduleOutcomeInbox", () => {
  it("returns schedule_done for done task with scheduleRuleId", () => {
    const item = buildScheduleOutcomeInbox({
      task: {
        id: "t1",
        goal: "Brief the launch",
        status: "done",
        scheduleRuleId: "s1",
        title: "Launch brief",
      },
      scheduleName: "Night shift",
    });
    expect(item?.kind).toBe("schedule_done");
    expect(item?.title).toMatch(/Night shift|Launch brief/i);
    expect(item?.taskId).toBe("t1");
  });

  it("returns unfinished for failed scheduled task", () => {
    const item = buildScheduleOutcomeInbox({
      task: {
        id: "t2",
        goal: "x",
        status: "failed",
        scheduleRuleId: "s1",
        title: null,
      },
      scheduleName: "Night shift",
    });
    expect(item?.kind).toBe("unfinished");
  });

  it("returns null when scheduleRuleId is null (interactive)", () => {
    expect(
      buildScheduleOutcomeInbox({
        task: {
          id: "t3",
          goal: "x",
          status: "done",
          scheduleRuleId: null,
          title: null,
        },
        scheduleName: null,
      }),
    ).toBeNull();
  });
});
