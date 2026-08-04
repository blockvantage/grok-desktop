/**
 * Remember the last workspace folder so users don't re-pick every launch.
 * Pure localStorage helpers — gateway settings stay optional.
 * Never persist or restore app-managed scratch paths as a user working dir.
 */

import { isManagedWorkspacePath } from "./managed-workspace";

export const LAST_WORKSPACE_KEY = "grokdesk.lastWorkspaceRoot";

const PATH_MAX = 4096;

export function readLastWorkspaceRoot(): string | null {
  try {
    const v = localStorage.getItem(LAST_WORKSPACE_KEY);
    const t = (v ?? "").trim().slice(0, PATH_MAX);
    if (!t || isManagedWorkspacePath(t)) {
      if (t && isManagedWorkspacePath(t)) {
        localStorage.removeItem(LAST_WORKSPACE_KEY);
      }
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

export function writeLastWorkspaceRoot(path: string | null | undefined): void {
  try {
    const t = (path ?? "").trim().slice(0, PATH_MAX);
    if (!t || isManagedWorkspacePath(t)) {
      localStorage.removeItem(LAST_WORKSPACE_KEY);
    } else {
      localStorage.setItem(LAST_WORKSPACE_KEY, t);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Prefer an explicit root, then last-used, then the most recent *user* task root.
 * Skips app-managed generated folders so Home never shows a synthetic path.
 */
export function resolveInitialWorkspaceRoot(opts: {
  explicit?: string | null;
  lastUsed?: string | null;
  taskRoots?: string[];
}): string {
  const explicit = (opts.explicit ?? "").trim();
  if (explicit && !isManagedWorkspacePath(explicit)) return explicit;
  const last = (opts.lastUsed ?? "").trim();
  if (last && !isManagedWorkspacePath(last)) return last;
  for (const r of opts.taskRoots ?? []) {
    const t = (r ?? "").trim();
    if (t && !isManagedWorkspacePath(t)) return t;
  }
  return "";
}
