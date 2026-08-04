import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the monorepo / app-bundled `skills/` root that ships default SKILL.md packs.
 * Search order is intentional for tests (cwd), packaged app, and monorepo layouts.
 */
export function getBundledSkillsRoot(override?: string | null): string {
  const env = process.env.GROKDESK_BUNDLED_SKILLS?.trim();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    override?.trim() || null,
    env || null,
    // packages/shared/src → ../../../skills
    path.resolve(here, "../../../skills"),
    // packages/shared/dist → ../../../skills
    path.resolve(here, "../../skills"),
    path.join(process.cwd(), "skills"),
  ].filter((c): c is string => Boolean(c));

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && hasSkillPacks(c)) return path.resolve(c);
    } catch {
      // continue
    }
  }
  // Prefer monorepo-relative path for diagnostics even if missing.
  return path.resolve(candidates[0] ?? path.join(process.cwd(), "skills"));
}

export function hasSkillPacks(root: string): boolean {
  try {
    if (!fs.existsSync(root)) return false;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries.some((ent) => {
      if (!ent.isDirectory()) return false;
      return fs.existsSync(path.join(root, ent.name, "SKILL.md"));
    });
  } catch {
    return false;
  }
}

/** List skill pack directory names that contain SKILL.md under a root. */
export function listSkillPackNames(root: string): string[] {
  try {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((ent) => ent.isDirectory())
      .filter((ent) =>
        fs.existsSync(path.join(root, ent.name, "SKILL.md")),
      )
      .map((ent) => ent.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Merge user skill directories with the bundled defaults root.
 * Bundled root is always first when present; user paths are unique and absolute-normalized.
 */
export function resolveSkillsPaths(
  userPaths: string[] | null | undefined,
  opts?: { bundledRoot?: string | null },
): string[] {
  const bundled = getBundledSkillsRoot(opts?.bundledRoot);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (p: string) => {
    const n = path.resolve(p);
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  if (hasSkillPacks(bundled)) push(bundled);
  for (const p of userPaths ?? []) {
    if (typeof p === "string" && p.trim()) push(p.trim());
  }
  return out;
}
