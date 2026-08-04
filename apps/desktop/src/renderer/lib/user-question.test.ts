import { describe, it, expect, vi } from "vitest";
import {
  extractUserQuestion,
  findUnansweredQuestion,
  questionChipsForTerminalTurn,
} from "./user-question";

describe("extractUserQuestion", () => {
  it("extracts numbered options", () => {
    const q = extractUserQuestion(
      "How should we position Payverge?\n\n1. All-in-one OS\n2. AI Waiter focus\n3. Payments-first\n\nWhich do you prefer?",
    );
    expect(q).not.toBeNull();
    expect(q!.options.map((o) => o.label)).toEqual([
      "All-in-one OS",
      "AI Waiter focus",
      "Payments-first",
    ]);
    expect(q!.prompt).toMatch(/prefer|position|Which/i);
  });

  it("extracts bullet options", () => {
    const q = extractUserQuestion(
      "Pick a next step:\n- Draft a brief\n- Build a prospect list\n- Generate a share image",
    );
    expect(q?.options).toHaveLength(3);
    expect(q?.options[0]!.label).toMatch(/Draft a brief/);
  });

  it("extracts lettered options", () => {
    const q = extractUserQuestion(
      "Choose one:\nA) Keep it formal\nB) Keep it playful\n\nWhat tone?",
    );
    expect(q?.options.map((o) => o.label)).toEqual([
      "Keep it formal",
      "Keep it playful",
    ]);
  });

  it("detects yes/no", () => {
    const q = extractUserQuestion(
      "Should I regenerate the image with a darker background? (yes/no)",
    );
    expect(q?.options.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  it("returns open question without options when ending with ?", () => {
    const q = extractUserQuestion(
      "What city should we target first for the local GTM push?",
    );
    expect(q).not.toBeNull();
    expect(q!.options).toHaveLength(0);
    expect(q!.isQuestion).toBe(true);
  });

  it("returns null for ordinary prose", () => {
    expect(
      extractUserQuestion(
        "I created the share pack and saved it under payverge-share-image.",
      ),
    ).toBeNull();
  });
});

describe("findUnansweredQuestion", () => {
  it("returns question on last assistant when no later user", () => {
    const found = findUnansweredQuestion([
      { kind: "user", id: "u1", text: "Help" },
      {
        kind: "assistant",
        id: "a1",
        text: "Pick one:\n1. Option A\n2. Option B\n\nWhich?",
      },
    ]);
    expect(found?.assistantId).toBe("a1");
    expect(found?.question.options).toHaveLength(2);
  });

  it("returns null after user has answered", () => {
    const found = findUnansweredQuestion([
      {
        kind: "assistant",
        id: "a1",
        text: "Pick one:\n1. Option A\n2. Option B\n\nWhich?",
      },
      { kind: "user", id: "u2", text: "Option A" },
    ]);
    expect(found).toBeNull();
  });
});

describe("questionChipsForTerminalTurn", () => {
  const blocks = [
    { kind: "user" as const, id: "u1", text: "Help" },
    {
      kind: "assistant" as const,
      id: "a1",
      text: "Which path?\n1. Foo\n2. Bar\n\nChoose one?",
    },
  ];

  it("renders two chip labels for a terminal multi-choice question", () => {
    const chips = questionChipsForTerminalTurn(blocks, "done");
    expect(chips).not.toBeNull();
    expect(chips!.options.map((o) => o.label)).toEqual(["Foo", "Bar"]);
  });

  it("does not show chips while the turn is still live", () => {
    expect(questionChipsForTerminalTurn(blocks, "running")).toBeNull();
    expect(questionChipsForTerminalTurn(blocks, "waiting_approval")).toBeNull();
  });

  it("tapping a chip maps to onFollowUp with the option label", () => {
    const chips = questionChipsForTerminalTurn(blocks, "done");
    const onFollowUp = vi.fn();
    // Simulate the TaskStream wiring: chip tap → onAnswerQuestion(label) → onFollowUp
    for (const opt of chips!.options) {
      onFollowUp(opt.label);
    }
    expect(onFollowUp).toHaveBeenCalledWith("Foo");
    expect(onFollowUp).toHaveBeenCalledWith("Bar");
    expect(onFollowUp).toHaveBeenCalledTimes(2);
  });
});
