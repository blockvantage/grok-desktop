import { describe, expect, it } from "vitest";
import {
  briefingSubtitle,
  buildMorningBriefing,
} from "./morning-briefing";

describe("morning-briefing", () => {
  it("builds actionable morning desk from needs-you and schedules", () => {
    const briefing = buildMorningBriefing({
      now: new Date("2026-07-15T08:30:00"),
      tasks: [
        {
          id: "t1",
          goal: "Approve the PR summary",
          status: "waiting_approval",
          updatedAt: "2026-07-15T07:00:00.000Z",
        },
        {
          id: "t2",
          goal: "scrape failed",
          status: "failed",
          updatedAt: "2026-07-14T22:00:00.000Z",
        },
      ],
      schedules: [
        {
          id: "s1",
          name: "Daily standup notes",
          enabled: true,
          nextRunAt: "2026-07-15T09:00:00.000Z",
        },
      ],
      inbox: [
        {
          id: "i1",
          kind: "approval",
          title: "Task needs you",
          read: false,
        },
      ],
    });

    expect(briefing.title).toMatch(/morning/i);
    expect(briefing.actionable).toBe(true);
    expect(briefing.lines.some((l) => l.kind === "needs_you")).toBe(true);
    // Failed tasks stay off Home; retry from Chats.
    expect(briefing.lines.some((l) => l.kind === "failed")).toBe(false);
    expect(briefing.lines.some((l) => l.kind === "schedule")).toBe(true);
    expect(briefingSubtitle(briefing).length).toBeGreaterThan(5);
  });

  it("reports clear desk when nothing is pending", () => {
    const briefing = buildMorningBriefing({
      now: new Date("2026-07-15T15:00:00"),
      tasks: [
        {
          id: "t1",
          goal: "done",
          status: "done",
          updatedAt: "2026-07-15T10:00:00.000Z",
        },
      ],
      schedules: [],
      inbox: [],
    });
    expect(briefing.actionable).toBe(false);
    expect(briefing.lines[0]!.kind).toBe("clear");
  });
});
