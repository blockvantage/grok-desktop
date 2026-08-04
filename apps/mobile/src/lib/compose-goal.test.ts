import { describe, expect, it } from "vitest";
import { composeTaskGoal } from "./compose-goal";

describe("composeTaskGoal (P3 attachments/voice parity)", () => {
  it("returns plain goal when no extras", () => {
    expect(composeTaskGoal({ goal: "  Ship P3  " })).toBe("Ship P3");
  });

  it("appends voice and attachment notes in order", () => {
    const g = composeTaskGoal({
      goal: "Review PR",
      voiceTranscript: "look at the remote client",
      note: "screenshot later from desk",
    });
    expect(g).toContain("Review PR");
    expect(g).toContain("[Voice note]");
    expect(g).toContain("look at the remote client");
    expect(g).toContain("[Attachment note]");
    expect(g).toContain("screenshot later from desk");
    expect(g.indexOf("[Voice note]")).toBeLessThan(
      g.indexOf("[Attachment note]"),
    );
  });

  it("allows note-only when goal empty is invalid — empty goal yields notes only", () => {
    // Caller still validates non-empty before create; helper is pure compose.
    expect(
      composeTaskGoal({ goal: "", note: "just a note" }),
    ).toBe("[Attachment note]\njust a note");
  });
});
