import { describe, it, expect } from "vitest";
import {
  resolveNextActionEffect,
  firstArtifactPath,
} from "./next-action-handlers";

describe("firstArtifactPath", () => {
  it("returns first non-empty path", () => {
    expect(firstArtifactPath([{ path: "/a" }, { path: "/b" }])).toBe("/a");
    expect(firstArtifactPath([])).toBeNull();
    expect(firstArtifactPath([{ path: null }])).toBeNull();
  });
});

describe("resolveNextActionEffect", () => {
  it("maps each kind", () => {
    expect(
      resolveNextActionEffect({ kind: "followUp", goalKey: "k" }, null),
    ).toEqual({ type: "followUp", goalKey: "k" });
    expect(resolveNextActionEffect({ kind: "takeaways" }, null)).toEqual({
      type: "takeaways",
    });
    expect(resolveNextActionEffect({ kind: "imagine" }, null)).toEqual({
      type: "imagine",
    });
    expect(
      resolveNextActionEffect({ kind: "openFiles" }, "/ws/a.md"),
    ).toEqual({ type: "openFiles", firstPath: "/ws/a.md" });
    expect(resolveNextActionEffect({ kind: "schedule" }, null)).toEqual({
      type: "schedule",
    });
    expect(resolveNextActionEffect({ kind: "saveRecipe" }, null)).toEqual({
      type: "saveRecipe",
    });
    expect(resolveNextActionEffect({ kind: "copyAnswer" }, null)).toEqual({
      type: "copyAnswer",
    });
    expect(resolveNextActionEffect({ kind: "exportPack" }, null)).toEqual({
      type: "exportPack",
    });
    expect(resolveNextActionEffect({ kind: "unknown" }, null)).toEqual({
      type: "none",
    });
  });
});
