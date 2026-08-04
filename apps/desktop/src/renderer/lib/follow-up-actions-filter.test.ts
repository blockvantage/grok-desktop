import { describe, it, expect } from "vitest";
import { filterFollowUpActions } from "./follow-up-actions-filter";

describe("filterFollowUpActions", () => {
  const actions = [
    { kind: "followUp", id: "1" },
    { kind: "takeaways", id: "2" },
    { kind: "imagine", id: "3" },
  ];

  it("keeps takeaways when allowed", () => {
    expect(
      filterFollowUpActions(actions, {
        takeawaysDismissed: false,
        hasRememberTakeaways: true,
      }).map((a) => a.kind),
    ).toEqual(["followUp", "takeaways", "imagine"]);
  });

  it("drops takeaways when dismissed or no handler", () => {
    expect(
      filterFollowUpActions(actions, {
        takeawaysDismissed: true,
        hasRememberTakeaways: true,
      }).map((a) => a.kind),
    ).toEqual(["followUp", "imagine"]);
    expect(
      filterFollowUpActions(actions, {
        takeawaysDismissed: false,
        hasRememberTakeaways: false,
      }).map((a) => a.kind),
    ).toEqual(["followUp", "imagine"]);
  });
});
