import { describe, expect, it } from "vitest";
import { pickFollowUpActions } from "./follow-up-actions";

describe("pickFollowUpActions", () => {
  it("offers summarize + takeaways when done", () => {
    const acts = pickFollowUpActions({ status: "done", hasArtifacts: false });
    expect(acts.map((a) => a.id)).toContain("summarize");
    expect(acts.map((a) => a.id)).toContain("takeaways");
    expect(acts.map((a) => a.id)).toContain("saveRecipe");
    expect(acts.map((a) => a.id)).toContain("copyAnswer");
    expect(acts.map((a) => a.id)).toContain("exportPack");
    expect(acts.map((a) => a.id)).not.toContain("retry");
    expect(acts.map((a) => a.id)).not.toContain("openFiles");
  });

  it("includes openFiles when artifacts exist", () => {
    const acts = pickFollowUpActions({ status: "done", hasArtifacts: true });
    expect(acts.map((a) => a.id)).toContain("openFiles");
  });

  it("offers retry after failure", () => {
    const acts = pickFollowUpActions({ status: "failed", hasArtifacts: false });
    expect(acts.map((a) => a.id)).toEqual(["retry"]);
  });
});
