import { describe, expect, it } from "vitest";
import {
  CONVERSATION_VIRTUALIZE_THRESHOLD,
  conversationTicks,
  isLongAnswer,
  LONG_ANSWER_CHARS,
  shouldShowTimelineRail,
  shouldVirtualizeConversation,
  tickIndexForTurnId,
} from "./conversation-timeline";

function turn(
  id: string,
  message: string,
  extras?: { state?: string; answer?: string },
) {
  return {
    id,
    userMessage: message,
    state: extras?.state ?? "done",
    answer: extras?.answer ? { text: extras.answer } : null,
  };
}

describe("conversationTicks", () => {
  it("builds 1-based ticks with truncated labels", () => {
    const ticks = conversationTicks([
      turn("a", "Write the launch brief"),
      turn(
        "b",
        "Now expand the competitive section with more sources and a table",
        { answer: "Here is the table." },
      ),
    ]);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({
      id: "a",
      index: 1,
      hasAnswer: false,
      label: "Write the launch brief",
    });
    expect(ticks[1]?.index).toBe(2);
    expect(ticks[1]?.hasAnswer).toBe(true);
    expect(ticks[1]?.label.endsWith("…")).toBe(true);
    expect(ticks[1]?.label.length).toBeLessThanOrEqual(42);
  });
});

describe("shouldShowTimelineRail / shouldVirtualizeConversation", () => {
  it("hides the rail on a single turn", () => {
    expect(shouldShowTimelineRail(1)).toBe(false);
    expect(shouldShowTimelineRail(2)).toBe(true);
  });

  it("virtualizes only long threads", () => {
    expect(shouldVirtualizeConversation(CONVERSATION_VIRTUALIZE_THRESHOLD)).toBe(
      false,
    );
    expect(
      shouldVirtualizeConversation(CONVERSATION_VIRTUALIZE_THRESHOLD + 1),
    ).toBe(true);
  });
});

describe("isLongAnswer", () => {
  it("flags replies at the character threshold", () => {
    expect(isLongAnswer("short")).toBe(false);
    expect(isLongAnswer("x".repeat(LONG_ANSWER_CHARS))).toBe(true);
    expect(isLongAnswer(null)).toBe(false);
  });
});

describe("tickIndexForTurnId", () => {
  it("returns the virtualizer index for a turn id", () => {
    const ticks = conversationTicks([turn("a", "one"), turn("b", "two")]);
    expect(tickIndexForTurnId(ticks, "b")).toBe(1);
    expect(tickIndexForTurnId(ticks, "missing")).toBeNull();
  });
});
