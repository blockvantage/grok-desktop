import { describe, it, expect } from "vitest";
import path from "node:path";
import { knownArtifactPathsFromEvents } from "./known-artifact-paths.js";

describe("knownArtifactPathsFromEvents", () => {
  it("collects resolved artifact paths only", () => {
    const set = knownArtifactPathsFromEvents(
      [
        {
          kind: "artifact_created",
          payload: { path: "/ws/a.md" },
        },
        {
          kind: "message",
          payload: { path: "/ws/ignore.md" },
        },
        {
          kind: "artifact_created",
          payload: { path: 123 },
        },
        {
          kind: "artifact_created",
          payload: { path: "/ws/b.png" },
        },
      ],
      (p) => path.resolve(p),
    );
    expect(set.has(path.resolve("/ws/a.md"))).toBe(true);
    expect(set.has(path.resolve("/ws/b.png"))).toBe(true);
    expect(set.size).toBe(2);
  });
});
