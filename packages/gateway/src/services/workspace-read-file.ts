/**
 * Safe text preview for workspace files (Phase 6 extract from Gateway).
 */
import fs from "node:fs";
import path from "node:path";
import { confineExistingWorkspacePath } from "./workspace-path-confine.js";

export type WorkspaceFilePreview = {
  path: string;
  name: string;
  content: string;
  truncated: boolean;
  size: number;
};

/**
 * Read a text-ish workspace file for in-app preview.
 * Refuses paths outside allowedRoots, missing paths, oversized files;
 * binary blobs get a placeholder.
 */
export function readWorkspaceFilePreview(
  filePath: string,
  maxChars = 80_000,
  opts?: {
    maxBytes?: number;
    /** Required for confinement; empty/omitted fails closed. */
    allowedRoots?: string[];
    readFileSync?: typeof fs.readFileSync;
    existsSync?: typeof fs.existsSync;
    statSync?: typeof fs.statSync;
  },
): WorkspaceFilePreview {
  const existsSync = opts?.existsSync ?? fs.existsSync.bind(fs);
  const statSync = opts?.statSync ?? fs.statSync.bind(fs);
  const readFileSync = opts?.readFileSync ?? fs.readFileSync.bind(fs);
  const maxBytes = opts?.maxBytes ?? 5 * 1024 * 1024;

  const abs = confineExistingWorkspacePath(
    path.resolve(filePath),
    opts?.allowedRoots ?? [],
    {
      existsSync,
      // realpathSync not injectable via opts today — use fs default for confinement
    },
  );
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error("File not found");
  }
  const st = statSync(abs);
  if (st.size > maxBytes) {
    throw new Error("File too large to preview");
  }
  const name = path.basename(abs);
  const buf = readFileSync(abs);
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  if (sample.includes(0)) {
    return {
      path: abs,
      name,
      content: `(Binary file — ${st.size.toLocaleString()} bytes. Open in Finder.)`,
      truncated: false,
      size: st.size,
    };
  }
  let content = buf.toString("utf8");
  let truncated = false;
  if (content.length > maxChars) {
    content = content.slice(0, maxChars);
    truncated = true;
  }
  return { path: abs, name, content, truncated, size: st.size };
}
