import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { isPathInsideAnyRoot } from "@grokdesk/shared";

export type RevealResult = {
  ok: boolean;
  /** Absolute path that was opened/revealed, if any. */
  path?: string;
  /** Human-readable failure or partial-success note. */
  error?: string;
};

/** Denial when the target is outside every allowed reveal root (fail-closed). */
export const PATH_OUTSIDE_REVEAL_ROOTS =
  "Path is outside allowed reveal roots";

export type RevealOptions = {
  /**
   * Absolute directories the path must stay under. Fail-closed when empty:
   * nothing may be revealed.
   */
  allowedRoots: string[];
};

/**
 * App-managed directories that may be revealed in Finder/Explorer.
 *
 * Mirrors gateway workspace-path-confine intent for main-owned shell:
 * - managed workspaces base (`…/workspaces`) — primary artifact deliverables
 * - exports dirs under dataDir / userData
 * - pending paste attachments
 * - main logs
 * - OS downloads (user-chosen save targets)
 * - extraRoots (user project folders from pickDirectory / task workspace roots)
 */
export function collectRevealAllowedRoots(input: {
  userDataDir: string;
  /** Gateway data dir (often `…/GrokDesk`; may differ from Electron userData). */
  dataDir?: string;
  downloadsDir?: string | null;
  extraRoots?: Iterable<string | null | undefined>;
}): string[] {
  const roots = new Set<string>();
  const add = (p?: string | null) => {
    if (typeof p === "string" && p.trim()) {
      roots.add(path.resolve(p.trim()));
    }
  };

  if (input.dataDir) {
    add(path.join(input.dataDir, "workspaces"));
    add(path.join(input.dataDir, "exports"));
  }
  add(path.join(input.userDataDir, "workspaces"));
  add(path.join(input.userDataDir, "exports"));
  add(path.join(input.userDataDir, "pending-attachments"));
  add(path.join(input.userDataDir, "logs"));
  add(input.downloadsDir);
  for (const r of input.extraRoots ?? []) {
    add(r);
  }
  return [...roots];
}

/**
 * Gateway data directory layout (same as packages/gateway config.ts).
 * Kept local so main does not import the full gateway package.
 */
export function resolveGatewayDataDir(env: {
  platform: NodeJS.Platform | string;
  home: string;
  appData?: string;
}): string {
  if (env.platform === "darwin") {
    return path.join(env.home, "Library", "Application Support", "GrokDesk");
  }
  if (env.platform === "win32") {
    return path.join(env.appData || env.home, "GrokDesk");
  }
  return path.join(env.home, ".local", "share", "GrokDesk");
}

function normalizeRevealInput(filePath: string): string | null {
  if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
    return null;
  }

  // Strip file:// if a caller passes a URL-ish path.
  let raw = filePath.trim().replace(/^file:\/\//, "");
  // file:///Users/... → /Users/...
  if (raw.startsWith("/") === false && raw.match(/^[A-Za-z]:[\\/]/) == null) {
    // leave relative paths for path.resolve against cwd (last resort)
  } else if (process.platform !== "win32" && !raw.startsWith("/")) {
    raw = `/${raw}`;
  }

  return path.resolve(raw);
}

/**
 * Open a file or folder in the OS file manager (Finder / Explorer).
 *
 * - Existing file → select it in its parent folder
 * - Existing directory → open the folder
 * - Missing path → walk up to the nearest existing parent and open that
 *   (common for cleaned OS-temp chat workspaces), still confined to roots
 *
 * Requires `allowedRoots`. Paths outside all roots are rejected before shell.
 */
export async function revealInFileManager(
  filePath: string,
  options?: RevealOptions,
): Promise<RevealResult> {
  const abs = normalizeRevealInput(filePath);
  if (!abs) {
    return { ok: false, error: "No path provided" };
  }

  const allowedRoots = (options?.allowedRoots ?? []).map((r) =>
    path.resolve(r),
  );
  if (!isPathInsideAnyRoot(abs, allowedRoots)) {
    return { ok: false, path: abs, error: PATH_OUTSIDE_REVEAL_ROOTS };
  }

  if (fs.existsSync(abs)) {
    try {
      // Re-check after realpath so a workspace symlink cannot open outside roots.
      let real = abs;
      try {
        real = fs.realpathSync(abs);
      } catch {
        return { ok: false, path: abs, error: PATH_OUTSIDE_REVEAL_ROOTS };
      }
      const realRoots = allowedRoots.map((r) => {
        try {
          return fs.existsSync(r) ? fs.realpathSync(r) : r;
        } catch {
          return r;
        }
      });
      if (!isPathInsideAnyRoot(real, realRoots)) {
        return { ok: false, path: abs, error: PATH_OUTSIDE_REVEAL_ROOTS };
      }
      const st = fs.statSync(real);
      if (st.isDirectory()) {
        const err = await shell.openPath(real);
        if (err) return { ok: false, path: real, error: err };
        return { ok: true, path: real };
      }
      // File: highlight in folder. showItemInFolder is sync and silent on miss.
      shell.showItemInFolder(real);
      return { ok: true, path: real };
    } catch (e) {
      return {
        ok: false,
        path: abs,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // Missing file/folder — open nearest existing ancestor still inside roots.
  let parent = path.dirname(abs);
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    if (!isPathInsideAnyRoot(parent, allowedRoots)) {
      break;
    }
    if (fs.existsSync(parent)) {
      const err = await shell.openPath(parent);
      if (err) {
        return {
          ok: false,
          path: parent,
          error: `Path no longer exists (${abs}). Could not open parent: ${err}`,
        };
      }
      return {
        ok: true,
        path: parent,
        error: `Original path is gone; opened ${parent}`,
      };
    }
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }

  return {
    ok: false,
    error: `Path not found: ${abs}`,
  };
}
