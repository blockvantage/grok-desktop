/**
 * Workspace deliverable harvest (extracted from TaskRunner — Phase 6).
 */
import fsSync from "node:fs";
import path from "node:path";
import { mediaMimeForPath } from "../workspace-asset.js";

const SKIP_FILE_NAMES = new Set([
  "node_modules",
  ".git",
  ".grok",
  "dist",
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/**
 * Directories that are never deliverables. User-staged chat media lives under
 * `attachments/` — harvesting them would list inputs as “what Grok made”.
 */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".grok",
  "dist",
  "attachments",
]);

/** Non-media per-file ceiling (still under the asset serve cap). */
export const MAX_DELIVERABLE_BYTES = 25 * 1024 * 1024;
/** Media (image/video/audio) ceiling — under the 256 MB serve cap (ASSET-4). */
export const MAX_MEDIA_DELIVERABLE_BYTES = 200 * 1024 * 1024;

export type DeliverableSkipStats = {
  oversize: number;
  overflow: number;
};

export type DeliverableFile = {
  name: string;
  path: string;
  sizeBytes: number;
};

export type ListDeliverableFilesResult = {
  files: DeliverableFile[];
  skipped: DeliverableSkipStats;
};

function sizeCeilingForName(name: string): number {
  return guessArtifactKind(name) === "media"
    ? MAX_MEDIA_DELIVERABLE_BYTES
    : MAX_DELIVERABLE_BYTES;
}

/**
 * Workspace scan for user-facing deliverables (files only).
 * @param sinceMs when set, only files with mtime ≥ sinceMs are returned
 */
export function listDeliverableFiles(
  root: string,
  max = 40,
  sinceMs = 0,
): ListDeliverableFilesResult {
  const abs = path.resolve(root);
  if (!fsSync.existsSync(abs) || !fsSync.statSync(abs).isDirectory()) {
    return { files: [], skipped: { oversize: 0, overflow: 0 } };
  }

  const out: Array<{
    name: string;
    path: string;
    mtimeMs: number;
    sizeBytes: number;
  }> = [];
  const skipped: DeliverableSkipStats = { oversize: 0, overflow: 0 };
  const maxDepth = 3;
  // Hard backstop so a pathological tree can't grow the scan set without bound.
  // Well above any realistic deliverable count; the media-first sort + `max`
  // slice below is what actually chooses the surfaced files.
  const MAX_SCAN = 5000;

  const walkSync = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let ents: fsSync.Dirent[];
    try {
      ents = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.name.startsWith(".") || SKIP_FILE_NAMES.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      let st: fsSync.Stats;
      try {
        st = fsSync.statSync(full);
      } catch {
        continue;
      }
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        if (depth < maxDepth) walkSync(full, depth + 1);
        continue;
      }
      if (st.size === 0) continue;
      if (st.size > sizeCeilingForName(ent.name)) {
        skipped.oversize += 1;
        continue;
      }
      if (sinceMs > 0 && st.mtimeMs < sinceMs) continue;
      // Collect everything eligible (up to the backstop), THEN rank + cap below,
      // so a media hero discovered late in the walk isn't dropped as overflow.
      if (out.length >= MAX_SCAN) {
        skipped.overflow += 1;
        continue;
      }
      out.push({
        name: ent.name,
        path: full,
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  };

  walkSync(abs, 0);
  out.sort((a, b) => {
    const am = guessArtifactKind(a.name) === "media" ? 0 : 1;
    const bm = guessArtifactKind(b.name) === "media" ? 0 : 1;
    if (am !== bm) return am - bm;
    return b.mtimeMs - a.mtimeMs;
  });
  // Overflow = eligible files that don't make the ranked cut (plus any dropped
  // past the scan backstop above).
  if (out.length > max) skipped.overflow += out.length - max;
  return {
    files: out
      .slice(0, max)
      .map(({ name, path: p, sizeBytes }) => ({ name, path: p, sizeBytes })),
    skipped,
  };
}

export function guessArtifactKind(
  name: string,
): "file" | "report" | "media" | "card" {
  if (/\.(md|txt|pdf|docx?|rtf)$/i.test(name)) return "report";
  if (
    /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|mp3|wav|m4a|aac|ogg|flac)$/i.test(
      name,
    )
  )
    return "media";
  return "file";
}

/**
 * Extension → mime for artifact event payloads (single map via mediaMimeForPath).
 */
export function guessArtifactMime(name: string): string | undefined {
  return mediaMimeForPath(name) ?? undefined;
}
