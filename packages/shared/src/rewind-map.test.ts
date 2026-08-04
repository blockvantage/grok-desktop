import { describe, it, expect } from "vitest";
import { mapTurnToRewindPoint } from "./rewind-map.js";

describe("mapTurnToRewindPoint", () => {
  const points = [
    { id: "0", label: "first" },
    { id: "1", label: "second" },
    { id: "2", label: "third" },
  ];

  it("maps equal-length turns 1:1 by order", () => {
    const turns = [{ id: "t0" }, { id: "t1" }, { id: "t2" }];
    expect(mapTurnToRewindPoint(turns, points, "t0")?.id).toBe("0");
    expect(mapTurnToRewindPoint(turns, points, "t1")?.id).toBe("1");
    expect(mapTurnToRewindPoint(turns, points, "t2")?.id).toBe("2");
  });

  it("aligns from the end when more turns than points", () => {
    const turns = [{ id: "t0" }, { id: "t1" }, { id: "t2" }, { id: "t3" }];
    // 4 turns, 3 points → t1,t2,t3 map to 0,1,2; t0 has no point
    expect(mapTurnToRewindPoint(turns, points, "t0")).toBeNull();
    expect(mapTurnToRewindPoint(turns, points, "t1")?.id).toBe("0");
    expect(mapTurnToRewindPoint(turns, points, "t3")?.id).toBe("2");
  });

  it("skips superseded turns when indexing", () => {
    const turns = [
      { id: "t0" },
      { id: "t1", superseded: true },
      { id: "t2" },
      { id: "t3" },
    ];
    // active: t0, t2, t3 → points 0,1,2
    expect(mapTurnToRewindPoint(turns, points, "t1")).toBeNull();
    expect(mapTurnToRewindPoint(turns, points, "t2")?.id).toBe("1");
  });

  it("returns null for empty points or unknown turn", () => {
    expect(mapTurnToRewindPoint([{ id: "t0" }], [], "t0")).toBeNull();
    expect(mapTurnToRewindPoint([{ id: "t0" }], points, "missing")).toBeNull();
  });
});
