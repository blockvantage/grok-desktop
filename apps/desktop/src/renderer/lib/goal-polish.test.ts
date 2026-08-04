import { describe, expect, it } from "vitest";
import { polishGoal, shouldOfferGoalPolish } from "./goal-polish";

describe("goal-polish", () => {
  it("polishes vague short goals with a deliverable line", () => {
    const r = polishGoal("fix this");
    expect(r.changed).toBe(true);
    expect(r.polished).toMatch(/deliverable/i);
    expect(r.hints.length).toBeGreaterThan(0);
  });

  it("leaves strong goals mostly intact", () => {
    const g =
      "Research competitor pricing for three tools and save a markdown brief under ./artifacts.";
    const r = polishGoal(g);
    expect(r.polished.toLowerCase()).toContain("research competitor");
    expect(shouldOfferGoalPolish(g)).toBe(true);
  });

  it("rejects empty and tiny goals for the chip", () => {
    expect(shouldOfferGoalPolish("hi")).toBe(false);
    expect(polishGoal("").polished).toBe("");
  });
});
