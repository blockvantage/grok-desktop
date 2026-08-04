import { describe, it, expect } from "vitest";
import { buildTakeawaysContent } from "./takeaways.js";

describe("buildTakeawaysContent", () => {
  it("uses last substantial assistant message", () => {
    const content = buildTakeawaysContent({
      taskId: "t1",
      goal: "Draft a brief",
      events: [
        {
          kind: "message",
          payload: {
            role: "assistant",
            channel: "thought",
            text: "thinking about the brief structure in depth",
          },
        },
        {
          kind: "message",
          payload: {
            role: "assistant",
            channel: "text",
            text: "Here is a full marketing brief with three channels and next steps for launch.",
          },
        },
      ],
    });
    expect(content).toContain("Here is a full marketing brief");
    expect(content).toContain("Goal: Draft a brief");
    expect(content).not.toContain("thinking about");
  });

  it("falls back to goal when no assistant text", () => {
    const content = buildTakeawaysContent({
      taskId: "t2",
      goal: "Organize downloads",
      events: [],
    });
    expect(content).toContain("Organize downloads");
    expect(content).toContain("No assistant answer");
  });
});
