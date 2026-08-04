import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getBundledSkillsRoot,
  hasSkillPacks,
  listSkillPackNames,
  resolveSkillsPaths,
} from "./skills-resolve.js";

describe("skills-resolve", () => {
  it("finds bundled skills root with SKILL.md packs on disk", () => {
    const root = getBundledSkillsRoot();
    expect(hasSkillPacks(root)).toBe(true);
    const packs = listSkillPackNames(root);
    expect(packs.length).toBeGreaterThanOrEqual(3);
    expect(packs).toContain("desk-defaults");
    expect(fs.existsSync(path.join(root, "desk-defaults", "SKILL.md"))).toBe(
      true,
    );
  });

  it("includes bundled root when user skillsPaths is empty", () => {
    const resolved = resolveSkillsPaths([]);
    expect(resolved.length).toBeGreaterThanOrEqual(1);
    expect(hasSkillPacks(resolved[0]!)).toBe(true);
  });

  it("appends unique user paths after bundled root", () => {
    const user = path.join(process.cwd(), "node_modules");
    const resolved = resolveSkillsPaths([user, user]);
    expect(resolved[0]).toBe(path.resolve(getBundledSkillsRoot()));
    expect(resolved.filter((p) => p === path.resolve(user))).toHaveLength(1);
  });
});
