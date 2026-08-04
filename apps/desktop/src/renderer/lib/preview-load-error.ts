/**
 * Pure messages for workspace file preview failures (Phase 6 extract).
 */

import { isArtifactMissingError } from "./artifact-availability";

export function isFileMissingError(detail: string): boolean {
  return isArtifactMissingError(detail) || /not found/i.test(detail);
}

/**
 * Body text for a failed media/text preview load.
 * Missing files get a short graceful message  -  never raw 500 / protocol noise.
 */
export function previewLoadErrorContent(input: {
  detail: string;
  missingHint: string;
  genericHint: string;
}): string {
  const missing = isFileMissingError(input.detail);
  if (missing) {
    // Prefer the product hint; keep a short path snippet when present.
    const pathMatch = input.detail.match(/File not found:\s*(.+)$/i);
    if (pathMatch?.[1]) {
      return `${input.missingHint}\n\n${pathMatch[1].trim()}`;
    }
    return input.missingHint;
  }
  return `${input.detail}\n\n${input.genericHint}`;
}

/**
 * Fallback preview object when read fails entirely.
 */
export function failedTextPreview(input: {
  path: string;
  name: string;
  content: string;
}): {
  path: string;
  name: string;
  content: string;
  truncated: false;
} {
  return {
    path: input.path,
    name: input.name,
    content: input.content,
    truncated: false,
  };
}
