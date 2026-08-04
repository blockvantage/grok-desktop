import { describe, it, expect } from "vitest";
import {
  harvestSinceMs,
  selectNewDeliverableArtifacts,
} from "./harvest-deliverables.js";
import path from "node:path";

describe("selectNewDeliverableArtifacts", () => {
  it("skips known paths and maps new files", () => {
    const known = new Set([path.resolve("/ws/a.md")]);
    const events = selectNewDeliverableArtifacts(
      [
        { name: "a.md", path: "/ws/a.md" },
        { name: "b.png", path: "/ws/b.png" },
      ],
      known,
      {
        resolvePath: (p) => path.resolve(p),
        guessKind: (n) => (n.endsWith(".png") ? "media" : "file"),
      },
    );
    expect(events).toEqual([
      {
        title: "b.png",
        path: path.resolve("/ws/b.png"),
        kind: "media",
      },
    ]);
  });
});

describe("harvestSinceMs", () => {
  it("subtracts 30s slack", () => {
    const iso = "2026-07-14T12:00:30.000Z";
    expect(harvestSinceMs(iso)).toBe(Date.parse(iso) - 30_000);
  });

  it("returns 0 for invalid date", () => {
    expect(harvestSinceMs("not-a-date")).toBe(0);
  });
});
