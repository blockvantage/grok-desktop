/**
 * Pure path / mime / size checks for workspace media previews.
 * Used by Gateway.prepareWorkspaceAsset / readWorkspaceAsset and unit-tested
 * without opening sqlite.
 */
import fs from "node:fs";
import path from "node:path";
import { confineExistingWorkspacePath } from "./services/workspace-path-confine.js";

/** Absolute path, or root-relative when `root` is set. */
export function resolveWorkspacePath(filePath: string, root?: string): string {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  if (root && root.trim()) return path.resolve(root, filePath);
  return path.resolve(filePath);
}

/** Map a file extension to an image or video MIME type, or null if unknown. */
export function mediaMimeForPath(p: string): string | null {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".bmp":
      return "image/bmp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogv":
      return "video/ogg";
    case ".mov":
      return "video/quicktime";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
    case ".oga":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    default:
      return null;
  }
}

export type PreparedWorkspaceAsset = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

/**
 * Resolve + validate a media path for preview without reading bytes.
 * `allowedRoots` confines the resolved absolute path (fail-closed if empty).
 */
export function prepareWorkspaceAssetMeta(
  filePath: string,
  maxBytes = 256 * 1024 * 1024,
  root?: string,
  allowedRoots: string[] = [],
): PreparedWorkspaceAsset {
  const lexical = resolveWorkspacePath(filePath, root);
  const abs = confineExistingWorkspacePath(lexical, allowedRoots);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`File not found: ${abs}`);
  }
  const mime = mediaMimeForPath(abs);
  if (!mime) {
    throw new Error("Not a previewable file");
  }
  const st = fs.statSync(abs);
  if (st.size > maxBytes) {
    throw new Error("File too large to preview");
  }
  return {
    path: abs,
    name: path.basename(abs),
    mime,
    size: st.size,
  };
}

/**
 * Read bytes as a data URL after validation (small assets / legacy path).
 */
export function readWorkspaceAssetDataUrl(
  filePath: string,
  maxBytes = 64 * 1024 * 1024,
  root?: string,
  allowedRoots: string[] = [],
): PreparedWorkspaceAsset & { dataUrl: string } {
  const meta = prepareWorkspaceAssetMeta(
    filePath,
    maxBytes,
    root,
    allowedRoots,
  );
  const buf = fs.readFileSync(meta.path);
  if (meta.mime === "image/svg+xml") {
    const text = buf.toString("utf8");
    const dataUrl = `data:${meta.mime};charset=utf-8,${encodeURIComponent(text)}`;
    return { ...meta, dataUrl };
  }
  const dataUrl = `data:${meta.mime};base64,${buf.toString("base64")}`;
  return { ...meta, dataUrl };
}
