import { describe, expect, it } from "vitest";
import { pickSmartStarts, scoreSmartStart, SMART_START_CATALOG } from "./smart-starts";

describe("smart-starts", () => {
  it("boosts research pack cards", () => {
    const research = SMART_START_CATALOG.find((d) => d.id === "research")!;
    const organize = SMART_START_CATALOG.find((d) => d.id === "organize")!;
    const withResearch = scoreSmartStart(research, {
      rolePackId: "research",
      hasWorkspace: false,
      hasRecentTask: false,
    });
    const without = scoreSmartStart(organize, {
      rolePackId: "research",
      hasWorkspace: false,
      hasRecentTask: false,
    });
    expect(withResearch).toBeGreaterThan(without);
  });

  it("hides continue without recent tasks", () => {
    const picks = pickSmartStarts({
      rolePackId: null,
      hasWorkspace: true,
      hasRecentTask: false,
    });
    expect(picks.map((p) => p.id)).not.toContain("continue");
  });

  it("surfaces continue when there is recent work", () => {
    const picks = pickSmartStarts({
      rolePackId: null,
      hasWorkspace: false,
      hasRecentTask: true,
    });
    expect(picks[0]?.id).toBe("continue");
  });

  it("returns at most limit cards", () => {
    expect(
      pickSmartStarts(
        { rolePackId: "marketing", hasWorkspace: true, hasRecentTask: true },
        3,
      ),
    ).toHaveLength(3);
  });

  it("shares goal templates with slash commands (SC-7)", () => {
    const shared = SMART_START_CATALOG.filter((d) =>
      ["brief", "organize", "visual", "research"].includes(d.id),
    );
    for (const def of shared) {
      expect(def.goalKey.startsWith("slash.")).toBe(true);
    }
  });
});
