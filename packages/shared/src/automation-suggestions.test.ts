import { describe, it, expect } from "vitest";
import { suggestAutomationsFromMemory } from "./automation-suggestions.js";

describe("suggestAutomationsFromMemory", () => {
  it("returns empty without relevant memory", () => {
    expect(suggestAutomationsFromMemory([])).toEqual([]);
    expect(
      suggestAutomationsFromMemory([
        { id: "1", kind: "episodic", title: "chat", content: "hello" },
      ]),
    ).toEqual([]);
  });

  it("suggests weekly review from planning standing context", () => {
    const out = suggestAutomationsFromMemory([
      {
        id: "m1",
        kind: "standing",
        title: "Priorities",
        content: "Protect focus; weekly priorities and OKRs matter.",
      },
    ]);
    expect(out.some((s) => s.suggestionKey === "weekly-priority-review")).toBe(
      true,
    );
    expect(out[0]!.draftSchedule.cron).toBeTruthy();
  });

  it("suggests marketing pulse and skips duplicates of existing rules", () => {
    const memories = [
      {
        id: "b1",
        kind: "brand" as const,
        title: "Brand",
        content: "Campaign positioning for launch audience.",
      },
    ];
    const first = suggestAutomationsFromMemory(memories);
    expect(first.some((s) => s.suggestionKey === "weekly-marketing-pulse")).toBe(
      true,
    );
    const second = suggestAutomationsFromMemory(memories, [
      {
        name: "Weekly marketing pulse",
        goalTemplate: "already",
        enabled: true,
      },
    ]);
    expect(
      second.some((s) => s.suggestionKey === "weekly-marketing-pulse"),
    ).toBe(false);
  });
});
