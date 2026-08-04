/**
 * Grok Build's image_gen / video tools write under
 * `$GROK_HOME/sessions/<cwd-hash>/<session-id>/images|videos/`, not the
 * workspace cwd. Desk runs with an isolated GROK_HOME that is deleted after
 * the run — so media must be promoted into the workspace before cleanup.
 *
 * Model shell `cp` from session → workspace also fails under `--sandbox
 * workspace` (session path is outside the sandbox root).
 */
import fs from "node:fs";
import path from "node:path";
import { isPathInsideRoot } from "@grokdesk/shared";

const MEDIA_SUBDIRS = ["images", "videos"] as const;
const MEDIA_EXT = /\.(jpe?g|png|webp|gif|mp4|webm|mov|m4v)$/i;

export type SessionMediaFile = {
  srcPath: string;
  relName: string;
  mtimeMs: number;
  sizeBytes: number;
};

export type PromotedMediaFile = {
  srcPath: string;
  destPath: string;
  name: string;
  kind: "media";
};

/**
 * Find media files written under a GROK_HOME sessions tree.
 * When `sinceMs` is set, only files with mtime ≥ sinceMs are returned.
 */
export function findSessionMediaFiles(
  grokHome: string,
  sinceMs = 0,
): SessionMediaFile[] {
  const sessionsRoot = path.join(grokHome, "sessions");
  if (!fs.existsSync(sessionsRoot)) return [];

  const out: SessionMediaFile[] = [];
  const maxDepth = 6;

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Only descend into session trees and known media folders.
        if (
          depth === 0 ||
          depth === 1 ||
          MEDIA_SUBDIRS.includes(ent.name as (typeof MEDIA_SUBDIRS)[number]) ||
          ent.name.startsWith("%") // url-encoded cwd hash dirs
        ) {
          walk(full, depth + 1);
        }
        continue;
      }
      if (!MEDIA_EXT.test(ent.name)) continue;
      // Prefer files under .../images/ or .../videos/
      const parent = path.basename(path.dirname(full));
      if (!MEDIA_SUBDIRS.includes(parent as (typeof MEDIA_SUBDIRS)[number])) {
        continue;
      }
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size === 0) continue;
      if (sinceMs > 0 && st.mtimeMs < sinceMs) continue;
      out.push({
        srcPath: full,
        relName: ent.name,
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  };

  walk(sessionsRoot, 0);
  out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return out;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/**
 * Copy session media into the workspace under `images/` or `videos/`.
 *
 * - `destDir`: legacy — write all files into this directory.
 * - `destRoot`: preferred — write images → `<destRoot>/images`, videos →
 *   `<destRoot>/videos`.
 */
export function promoteSessionMediaToWorkspace(opts: {
  grokHome: string;
  /** @deprecated Prefer destRoot; when set without destRoot, all files go here. */
  destDir?: string;
  /** Workspace root; media lands in images/ or videos/ beneath it. */
  destRoot?: string;
  sinceMs?: number;
  maxFiles?: number;
}): PromotedMediaFile[] {
  const { grokHome, sinceMs = 0, maxFiles = 20 } = opts;
  const found = findSessionMediaFiles(grokHome, sinceMs).slice(0, maxFiles);
  if (found.length === 0) return [];

  const promoted: PromotedMediaFile[] = [];
  const usedNames = new Set<string>();

  for (const file of found) {
    const name = uniqueMediaName(file.relName, usedNames);
    usedNames.add(name);
    let dir: string;
    if (opts.destRoot) {
      dir = path.join(
        opts.destRoot,
        VIDEO_EXT.test(name) ? "videos" : "images",
      );
    } else if (opts.destDir) {
      dir = opts.destDir;
    } else {
      continue;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      continue;
    }
    const destPath = path.join(dir, name);
    // Refuse if basename tricks still escape the media directory.
    const resolvedDest = path.resolve(destPath);
    const resolvedDir = path.resolve(dir);
    if (!isPathInsideRoot(resolvedDest, resolvedDir)) {
      continue;
    }
    try {
      fs.copyFileSync(file.srcPath, destPath);
      // Ensure harvest sees a fresh mtime.
      const now = new Date();
      fs.utimesSync(destPath, now, now);
      promoted.push({
        srcPath: file.srcPath,
        destPath,
        name,
        kind: "media",
      });
    } catch {
      /* skip unreadable/unwritable */
    }
  }
  return promoted;
}

/**
 * Basename-only media file name. Strips path segments and pure-dot names so
 * path.join(imagesDir, name) cannot escape the media folder.
 */
export function sanitizeMediaFileName(baseName: string): string {
  const base = path.basename(baseName.replace(/\\/g, "/"));
  const cleaned = base.replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || /^\.+$/.test(cleaned)) return "image.jpg";
  return cleaned;
}

/** Pick a non-colliding filename in the dest folder set. */
export function uniqueMediaName(
  baseName: string,
  used: Set<string>,
): string {
  const safe = sanitizeMediaFileName(baseName);
  if (!used.has(safe) && safe.length > 0) return safe;
  const ext = path.extname(safe) || ".jpg";
  const stem = path.basename(safe, ext) || "image";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}
