import { describe, it, expect } from "vitest";
import { ROLE_PACKS, getRolePack } from "./role-packs.js";

describe("role packs", () => {
  it("includes marketing pack", () => {
    expect(ROLE_PACKS.map((p) => p.id)).toContain("marketing");
    expect(getRolePack("marketing")?.defaultEffort).toBe("normal");
  });

  it("returns undefined for unknown", () => {
    expect(getRolePack("nope")).toBeUndefined();
  });
});
