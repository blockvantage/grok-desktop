/**
 * CHAT-5: validate queued attachment paths before drain/send.
 */

import { rpc } from "@/lib/api";

/** Paths that no longer exist on disk (or fail the exists probe). */
export async function missingAttachmentPaths(
  paths: readonly string[] | null | undefined,
  exists: (path: string) => boolean | Promise<boolean>,
): Promise<string[]> {
  if (!paths?.length) return [];
  const missing: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    let ok = false;
    try {
      ok = Boolean(await Promise.resolve(exists(path)));
    } catch {
      ok = false;
    }
    if (!ok) missing.push(path);
  }
  return missing;
}

/**
 * Probe whether a path still exists via workspace.readFile.
 * Binary files still pass (gateway returns a binary placeholder).
 */
export async function workspacePathExists(
  path: string,
  readFile: (path: string) => Promise<unknown> = defaultReadFile,
): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadFile(path: string): Promise<unknown> {
  // Static import of rpc — avoid dual static/dynamic import of api.ts (Vite warning).
  return rpc("workspace.readFile", { path, maxChars: 1 });
}
