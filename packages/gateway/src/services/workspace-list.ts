/**
 * Shallow workspace file listing for UI “what’s on disk?” (Phase 6 extract).
 */
import fs from "node:fs";
import path from "node:path";
import {
  PATH_OUTSIDE_WORKSPACE_ROOTS,
  confineExistingWorkspacePath,
} from "./workspace-path-confine.js";

export function listWorkspaceFiles(
  root: string,
  max = 40,
  allowedRoots: string[] = [],
): Array<{ name: string; path: string; isDir: boolean; mtimeMs: number }> {
  // Fail closed: require an allowed root set (same policy as read/preview).
  if (allowedRoots.length === 0) {
    throw new Error(PATH_OUTSIDE_WORKSPACE_ROOTS);
  }
  const abs = confineExistingWorkspacePath(path.resolve(root), allowedRoots);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return [];
  }
  const out: Array<{
    name: string;
    path: string;
    isDir: boolean;
    mtimeMs: number;
  }> = [];
  const skip = new Set([
    "node_modules",
    ".git",
    ".grok",
    "dist",
    ".DS_Store",
  ]);
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) break;
      if (ent.name.startsWith(".") || skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      out.push({
        name: ent.name,
        path: full,
        isDir: ent.isDirectory(),
        mtimeMs: st.mtimeMs,
      });
      // Match prior Gateway.listWorkspaceFiles: one nested level only.
      if (ent.isDirectory() && depth < 1) walk(full, depth + 1);
    }
  };
  walk(abs, 0);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, max);
}
