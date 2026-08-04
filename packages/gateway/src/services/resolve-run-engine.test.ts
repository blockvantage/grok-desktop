import { describe, it, expect } from "vitest";
import { resolveRunEngine } from "./resolve-run-engine.js";

describe("resolveRunEngine", () => {
  it("prefers pinned engine", () => {
    const pinned = { id: "pin" };
    const current = { id: "cur" };
    const map = new Map([["t1", pinned]]);
    expect(resolveRunEngine(map, "t1", current)).toBe(pinned);
    expect(resolveRunEngine(map, "other", current)).toBe(current);
  });
});
