import { describe, expect, it } from "vitest";
import {
  buildWeeklyRecap,
  formatWeeklyRecapBody,
  isoWeekKey,
  parseWeeklyRecapLines,
  recapInboxTaskId,
} from "./weekly-recap.js";

const now = new Date("2026-08-27T15:00:00.000Z");

describe("buildWeeklyRecap", () => {
  it("returns null for an empty week", () => {
    expect(
      buildWeeklyRecap({
        memoryItems: [],
        completedTaskSummaries: [],
        now,
      }),
    ).toBeNull();
  });

  it("builds two lines from two completed tasks", () => {
    const recap = buildWeeklyRecap({
      now,
      memoryItems: [],
      completedTaskSummaries: [
        {
          id: "t1",
          goal: "Draft the launch brief",
          doneAt: "2026-08-26T10:00:00.000Z",
        },
        {
          id: "t2",
          goal: "Organize the downloads folder",
          doneAt: "2026-08-25T10:00:00.000Z",
        },
      ],
    });
    expect(recap).not.toBeNull();
    expect(recap!.title).toBe("Learn from this week");
    expect(recap!.lines).toHaveLength(2);
    expect(recap!.lines.map((l) => l.text)).toEqual([
      "Draft the launch brief",
      "Organize the downloads folder",
    ]);
    expect(recap!.weekKey).toBe(isoWeekKey(now));
  });

  it("includes memory touched this week and ignores older items", () => {
    const recap = buildWeeklyRecap({
      now,
      completedTaskSummaries: [],
      memoryItems: [
        {
          id: "m-new",
          title: "Protect focus time",
          content: "No meetings before 11",
          updatedAt: "2026-08-24T12:00:00.000Z",
          kind: "standing",
        },
        {
          id: "m-old",
          title: "Ancient note",
          content: "From last month",
          updatedAt: "2026-07-01T12:00:00.000Z",
          kind: "project",
        },
      ],
    });
    expect(recap!.lines).toHaveLength(1);
    expect(recap!.lines[0]!.text).toBe("Protect focus time");
    expect(recap!.lines[0]!.suggestedMemory).toContain("No meetings before 11");
  });

  it("respects maxLines", () => {
    const recap = buildWeeklyRecap({
      now,
      maxLines: 1,
      memoryItems: [],
      completedTaskSummaries: [
        { id: "a", goal: "One", doneAt: "2026-08-26T10:00:00.000Z" },
        { id: "b", goal: "Two", doneAt: "2026-08-26T11:00:00.000Z" },
      ],
    });
    expect(recap!.lines).toHaveLength(1);
  });

  it("formats and parses inbox body without JSON", () => {
    const recap = buildWeeklyRecap({
      now,
      memoryItems: [],
      completedTaskSummaries: [
        { id: "t1", goal: "Ship notes", doneAt: "2026-08-26T10:00:00.000Z" },
      ],
    })!;
    const body = formatWeeklyRecapBody(recap);
    expect(body).not.toMatch(/[{[]/);
    expect(parseWeeklyRecapLines(body)).toEqual(["Ship notes"]);
    expect(recapInboxTaskId(recap.weekKey)).toBe(`recap:${recap.weekKey}`);
  });
});
