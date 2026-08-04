/**
 * Confine workspace file serving to configured roots (F2).
 * Uses the same isPathInsideAnyRoot check as agent tool policy.
 */
import fs from "node:fs";
import path from "node:path";
import { isPathInsideAnyRoot } from "@grokdesk/shared";

/** Policy-aligned denial for paths outside all allowed roots. */
export const PATH_OUTSIDE_WORKSPACE_ROOTS =
  "Path is outside configured workspace roots";

/**
 * Throw when the resolved absolute path is not under any allowed root.
 * Fail-closed: empty roots deny every path.
 */
export function assertPathInsideWorkspaceRoots(
  absPath: string,
  allowedRoots: string[],
): void {
  if (!isPathInsideAnyRoot(absPath, allowedRoots)) {
    throw new Error(PATH_OUTSIDE_WORKSPACE_ROOTS);
  }
}

/**
 * Lexical check, then if the path exists, re-check after realpath so a
 * workspace symlink cannot smuggle reads/previews to files outside roots.
 * Roots are also realpath'd (e.g. /tmp → /private/tmp on macOS) so honest
 * files under a root that is itself a symlink still pass.
 * Returns the real path when resolvable, otherwise the lexical absolute path.
 */
export function confineExistingWorkspacePath(
  absPath: string,
  allowedRoots: string[],
  opts?: {
    realpathSync?: typeof fs.realpathSync;
    existsSync?: typeof fs.existsSync;
  },
): string {
  const existsSync = opts?.existsSync ?? fs.existsSync.bind(fs);
  const realpathSync = opts?.realpathSync ?? fs.realpathSync.bind(fs);
  const lexical = path.resolve(absPath);
  assertPathInsideWorkspaceRoots(lexical, allowedRoots);
  if (!existsSync(lexical)) {
    return lexical;
  }
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    // Unresolvable symlink / race — refuse rather than open blind.
    throw new Error(PATH_OUTSIDE_WORKSPACE_ROOTS);
  }
  const realRoots = allowedRoots.map((r) => {
    const absRoot = path.resolve(r);
    try {
      return existsSync(absRoot) ? realpathSync(absRoot) : absRoot;
    } catch {
      return absRoot;
    }
  });
  assertPathInsideWorkspaceRoots(real, realRoots);
  return real;
}

/**
 * Allowed roots for workspace.readFile / readAsset / prepareAsset:
 * - every task policy workspace root (managed + user project folders)
 * - the app-managed workspaces base (covers ensureTemp before task bind)
 */
export function collectAllowedWorkspaceRoots(input: {
  dataDir: string;
  taskRoots: Iterable<string | null | undefined>;
}): string[] {
  const roots = new Set<string>();
  roots.add(path.resolve(input.dataDir, "workspaces"));
  for (const r of input.taskRoots) {
    if (typeof r === "string" && r.trim()) {
      roots.add(path.resolve(r.trim()));
    }
  }
  return [...roots];
}
