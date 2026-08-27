import { describe, expect, it } from "vitest";
import { projectToolKindCard, toolKindDetail } from "./tool-kind-card";

describe("projectToolKindCard", () => {
  it("summarizes edit/write as a filename-first one-liner", () => {
    const card = projectToolKindCard({
      kind: "edit",
      path: "/ws/launch-brief.md",
      diff: "- old\n+ new\n+ extra",
    });
    expect(card.kind).toBe("edit");
    expect(card.summary).toBe("Updated launch-brief.md — 3 lines changed");
    expect(card.summary).not.toMatch(/\{/);
    expect(toolKindDetail(card)).toContain("+ new");
  });

  it("summarizes execute without dumping JSON", () => {
    const card = projectToolKindCard({
      tool: "shell",
      command: "npm test",
      output: "ok",
    });
    expect(card).toMatchObject({
      kind: "execute",
      summary: "Ran npm test",
    });
    expect(JSON.stringify(card.summary)).not.toContain("output");
  });

  it("maps ask_user and media, and sinks unknown kinds to other", () => {
    expect(
      projectToolKindCard({ kind: "ask_user", prompt: "Which tone?" }).summary,
    ).toBe("Which tone?");
    expect(
      projectToolKindCard({
        kind: "image_gen",
        path: "/ws/art.png",
      }).summary,
    ).toBe("Created art.png");
    const other = projectToolKindCard({
      tool: "mystery_tool",
      title: "Looked up a fact",
    });
    expect(other.kind).toBe("other");
    expect(other.summary).toBe("Looked up a fact");
    expect(other.summary).not.toMatch(/[{[]/);
  });
});
