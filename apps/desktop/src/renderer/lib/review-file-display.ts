/**
 * Review-changes presentation helpers (Task 14).
 * Filename-first labels; path on demand; unavailable marking.
 */

export function reviewFileBasename(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return path;
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

export type ReviewFileAvailability = {
  path: string;
  available: boolean;
};

/**
 * Mark vanished files unavailable without dropping them from the list
 * (never silently drop review rows).
 */
export function withReviewFileAvailability(
  files: ReadonlyArray<{ path: string }>,
  exists: (path: string) => boolean,
): ReviewFileAvailability[] {
  return files.map((f) => ({
    path: f.path,
    available: exists(f.path),
  }));
}

/** True when status dots may animate (radar/live pulse). */
export function statusDotMayAnimate(status: string): boolean {
  return status === "running";
}
