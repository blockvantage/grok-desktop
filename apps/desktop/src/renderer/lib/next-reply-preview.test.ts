import { describe, expect, it } from "vitest";
import {
  nextReplyWillUseParams,
  projectNextReplyPreview,
} from "./next-reply-preview";

describe("projectNextReplyPreview", () => {
  it("names the next turn's model and effort", () => {
    const preview = projectNextReplyPreview({
      model: "Grok 4.5",
      effort: "heavy",
    });
    expect(nextReplyWillUseParams(preview)).toEqual({
      summary: "Grok 4.5 · heavy",
    });
  });

  it("mentions plan-first, non-balanced approval, and role", () => {
    const preview = projectNextReplyPreview({
      model: "grok-4.5",
      effort: "fast",
      approvalMode: "strict",
      planFirst: true,
      rolePackName: "Editor",
    });
    expect(preview.parts).toEqual([
      "grok-4.5",
      "fast",
      "plan first",
      "strict",
      "Editor",
    ]);
  });
});
