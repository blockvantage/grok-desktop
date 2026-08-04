import { describe, it, expect } from "vitest";
import {
  blocksFromCollapsed,
  hasPendingQuestionChips,
} from "./pending-question";

describe("blocksFromCollapsed", () => {
  it("maps string text only", () => {
    expect(
      blocksFromCollapsed([
        { kind: "message", id: "1", text: "hi" },
        { kind: "step", id: "2", text: 1 },
      ]),
    ).toEqual([
      { kind: "message", id: "1", text: "hi" },
      { kind: "step", id: "2", text: undefined },
    ]);
  });
});

describe("hasPendingQuestionChips", () => {
  it("false when not terminal or live or no follow-up", () => {
    expect(
      hasPendingQuestionChips({
        isTerminal: false,
        isLive: false,
        hasFollowUp: true,
        blocks: [],
        taskStatus: "running",
        questionChips: () => ({}),
      }),
    ).toBe(false);
    expect(
      hasPendingQuestionChips({
        isTerminal: true,
        isLive: true,
        hasFollowUp: true,
        blocks: [],
        taskStatus: "running",
        questionChips: () => ({}),
      }),
    ).toBe(false);
  });

  it("true when chips present", () => {
    expect(
      hasPendingQuestionChips({
        isTerminal: true,
        isLive: false,
        hasFollowUp: true,
        blocks: [{ kind: "message", id: "1", text: "?" }],
        taskStatus: "done",
        questionChips: () => [{ label: "A" }],
      }),
    ).toBe(true);
    expect(
      hasPendingQuestionChips({
        isTerminal: true,
        isLive: false,
        hasFollowUp: true,
        blocks: [],
        taskStatus: "done",
        questionChips: () => null,
      }),
    ).toBe(false);
  });
});
