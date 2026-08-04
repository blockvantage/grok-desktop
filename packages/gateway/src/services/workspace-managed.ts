/**
 * Rules for app-managed workspaces under dataDir/workspaces.
 * Never delete user project roots — only paths nested under the managed base.
 */
import path from "node:path";
import { isPathInsideRoot } from "@grokdesk/shared";

/**
 * True when `root` is a chat/temp workspace under the app data dir, not a
 * user project folder and not the workspaces base itself.
 */
export function isManagedWorkspaceRoot(
  root: string,
  dataDir: string,
): boolean {
  const managedBase = path.resolve(path.join(dataDir, "workspaces"));
  const abs = path.resolve(root);
  // Nested under managed base, but not the base itself. isPathInsideRoot
  // treats equal paths as inside and is Windows-case-aware for drive letters.
  if (!isPathInsideRoot(abs, managedBase)) return false;
  return !isPathInsideRoot(managedBase, abs);
}

/**
 * Collect unique primary roots from task policy snapshots that are safe to
 * delete when removing a chat thread.
 */
export function collectManagedRootsToDelete(
  roots: Iterable<string | null | undefined>,
  dataDir: string,
): string[] {
  const out = new Set<string>();
  for (const r of roots) {
    if (!r) continue;
    if (isManagedWorkspaceRoot(r, dataDir)) {
      out.add(path.resolve(r));
    }
  }
  return [...out];
}
