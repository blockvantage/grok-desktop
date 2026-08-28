import { describe, expect, it } from "vitest";
import { rosterActivityLabelKey, rosterRowView } from "./roster-row";

describe("rosterRowView", () => {
  it("clips last-turn text and maps waiting onto needs_input", () => {
    const row = rosterRowView({
      latestGoal: "Drafted three channels for the Q3 launch. More later.",
      status: "waiting_user",
    });
    expect(row.lastTurnSummary).toBe(
      "Drafted three channels for the Q3 launch.",
    );
    expect(row.activity).toBe("needs_input");
    expect(rosterActivityLabelKey(row.activity)).toBe(
      "roster.activity.needs_input",
    );
  });

  it("treats running as working", () => {
    expect(
      rosterRowView({ latestGoal: "Go", status: "running" }).activity,
    ).toBe("working");
  });
});
