import { describe, it, expect } from "vitest";
import { applyRolePackToCreateParams } from "./role-pack-apply.js";

const pack = {
  id: "researcher",
  name: "Researcher",
  skills: ["web", "notes"],
  defaultEffort: "heavy" as const,
  standingInstructions: "Be thorough.",
};

describe("applyRolePackToCreateParams", () => {
  it("no-ops without rolePack", () => {
    const params = { skills: ["a"] };
    const r = applyRolePackToCreateParams(params, () => pack, {
      effortWasExplicit: false,
    });
    expect(r.applied).toBe(false);
    expect(params.skills).toEqual(["a"]);
  });

  it("merges skills and sets default effort when not explicit", () => {
    const params: {
      rolePack: string;
      skills?: string[];
      effort?: "fast" | "normal" | "heavy";
    } = { rolePack: "researcher", skills: ["web"] };
    const r = applyRolePackToCreateParams(params, () => pack, {
      effortWasExplicit: false,
    });
    expect(r.applied).toBe(true);
    expect(params.skills).toEqual(["web", "notes"]);
    expect(params.effort).toBe("heavy");
    expect(r.standingMemory?.provenance).toBe("rolePack:researcher");
    expect(r.standingMemory?.id).toBe("role-pack:researcher");
  });

  it("preserves explicit effort", () => {
    const params = {
      rolePack: "researcher",
      effort: "fast" as const,
    };
    applyRolePackToCreateParams(params, () => pack, {
      effortWasExplicit: true,
    });
    expect(params.effort).toBe("fast");
  });

  it("no-ops when pack missing", () => {
    const params = { rolePack: "nope" };
    const r = applyRolePackToCreateParams(params, () => null, {
      effortWasExplicit: false,
    });
    expect(r.applied).toBe(false);
  });
});
