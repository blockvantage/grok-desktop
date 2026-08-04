import { describe, it, expect } from "vitest";
import {
  assembleRunPreamble,
  assembleRunPreambleFromSources,
} from "./run-preamble.js";

describe("assembleRunPreamble", () => {
  it("joins memory, attachments, and transcript with provenance", () => {
    const r = assembleRunPreambleFromSources({
      memoryPreamble: "User prefers TypeScript.",
      memoryHitCount: 2,
      attachmentsPreamble: "Attached: photo.png",
      transcriptFallback: "user: hello\nassistant: hi",
    });
    expect(r.systemPreamble).toContain("User prefers TypeScript.");
    expect(r.systemPreamble).toContain("Attached: photo.png");
    expect(r.systemPreamble).toContain("Prior conversation:");
    expect(r.systemPreamble).toContain("user: hello");
    expect(r.provenance).toEqual([
      "memory:2",
      "attachments",
      "transcript_fallback",
    ]);
  });

  it("omits empty sections", () => {
    const r = assembleRunPreambleFromSources({
      memoryPreamble: "",
      memoryHitCount: 0,
      attachmentsPreamble: null,
      transcriptFallback: null,
    });
    expect(r.systemPreamble).toBe("");
    expect(r.provenance).toEqual([]);
  });

  it("does not double-prefix Prior conversation", () => {
    const r = assembleRunPreamble({
      transcriptBlock: "Prior conversation:\nalready labeled",
    });
    expect(r.systemPreamble).toBe("Prior conversation:\nalready labeled");
    expect(r.provenance).toEqual(["transcript_fallback"]);
  });

  it("memory-only preamble", () => {
    const r = assembleRunPreambleFromSources({
      memoryPreamble: "Standing instruction.",
      memoryHitCount: 1,
    });
    expect(r.systemPreamble).toBe("Standing instruction.");
    expect(r.provenance).toEqual(["memory:1"]);
  });
});
