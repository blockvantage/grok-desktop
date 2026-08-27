import { describe, expect, it } from "vitest";
import {
  foldGoalProgressFields,
  formatGoalProgressLine,
} from "./goal-update.js";

describe("foldGoalProgressFields", () => {
  it("reads GoalUpdated / goal_update payloads", () => {
    const fields = foldGoalProgressFields([
      {
        kind: "step",
        payload: {
          title: "goal_update",
          objective: "Ship the launch brief",
          progress: "Drafting outline",
        },
      },
    ]);
    expect(fields).toEqual({
      objective: "Ship the launch brief",
      progress: "Drafting outline",
    });
    expect(formatGoalProgressLine(fields)).toBe(
      "Ship the launch brief — Drafting outline",
    );
  });

  it("ignores step status start/end tokens", () => {
    const fields = foldGoalProgressFields([
      {
        kind: "step",
        payload: { title: "goal_update", status: "start", objective: "Done" },
      },
    ]);
    expect(fields.progress).toBeNull();
    expect(fields.objective).toBe("Done");
  });

  it("does not treat the goal_update title token as the objective", () => {
    const fields = foldGoalProgressFields([
      {
        kind: "step",
        payload: { title: "goal_update", progress: "Drafting" },
      },
    ]);
    expect(fields.objective).toBeNull();
    expect(fields.progress).toBe("Drafting");
    expect(formatGoalProgressLine(fields)).toBe("Drafting");
  });
});
