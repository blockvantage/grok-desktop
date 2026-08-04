import { describe, expect, it } from "vitest";
import {
  buildScheduleCreateFromDraft,
  parseSuggestionDraftSchedule,
} from "./inbox-actions";

describe("parseSuggestionDraftSchedule", () => {
  it("parses proactivity body format", () => {
    const body = [
      "Based on your standing context...",
      "",
      "Draft schedule: Weekly priority review (0 9 * * 1)",
      "Goal: Review standing priorities and open loops.",
    ].join("\n");
    const d = parseSuggestionDraftSchedule(body);
    expect(d).toEqual({
      name: "Weekly priority review",
      cron: "0 9 * * 1",
      goalTemplate: "Review standing priorities and open loops.",
    });
  });

  it("parses biweekly and multi-word names", () => {
    const body = [
      "You often reorganize files.",
      "Draft schedule: Biweekly file tidy (0 10 1,15 * *)",
      "Goal: Tidy project folders and note what moved.",
    ].join("\n");
    expect(parseSuggestionDraftSchedule(body)).toEqual({
      name: "Biweekly file tidy",
      cron: "0 10 1,15 * *",
      goalTemplate: "Tidy project folders and note what moved.",
    });
  });

  it("returns null when not a suggestion draft", () => {
    expect(parseSuggestionDraftSchedule("Task failed")).toBeNull();
    expect(parseSuggestionDraftSchedule("")).toBeNull();
    expect(
      parseSuggestionDraftSchedule("Draft schedule: Missing goal only"),
    ).toBeNull();
  });

  it("returns null when Goal line is present but Draft schedule is not", () => {
    expect(
      parseSuggestionDraftSchedule("Goal: Something useful to do later."),
    ).toBeNull();
  });
});

describe("buildScheduleCreateFromDraft", () => {
  it("fills defaults for schedule.create params", () => {
    const draft = {
      name: "Weekly priority review",
      cron: "0 9 * * 1",
      goalTemplate: "Review standing priorities.",
    };
    const params = buildScheduleCreateFromDraft(draft, {
      workspaceRoots: ["/tmp/ws"],
    });
    expect(params.name).toBe(draft.name);
    expect(params.cron).toBe(draft.cron);
    expect(params.goalTemplate).toBe(draft.goalTemplate);
    expect(params.workspaceRoots).toEqual(["/tmp/ws"]);
    expect(params.approvalMode).toBe("balanced");
    expect(params.model).toBe("grok-4.5");
    expect(params.effort).toBe("normal");
    expect(params.quietHoursRespect).toBe(true);
    expect(params.timezone.length).toBeGreaterThan(0);
  });

  it("respects explicit options", () => {
    const draft = {
      name: "Daily standup",
      cron: "0 9 * * 1-5",
      goalTemplate: "Summarize open loops.",
    };
    const params = buildScheduleCreateFromDraft(draft, {
      workspaceRoots: ["/projects/a"],
      timezone: "America/Los_Angeles",
      approvalMode: "strict",
      model: "grok-4",
      effort: "fast",
      rolePack: "ops",
      quietHoursRespect: false,
    });
    expect(params).toEqual({
      name: "Daily standup",
      goalTemplate: "Summarize open loops.",
      cron: "0 9 * * 1-5",
      timezone: "America/Los_Angeles",
      approvalMode: "strict",
      model: "grok-4",
      effort: "fast",
      workspaceRoots: ["/projects/a"],
      rolePack: "ops",
      quietHoursRespect: false,
    });
  });
});
