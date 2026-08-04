/**
 * SuperGrok usage bar color by percent used.
 * Graduated so the meter communicates pressure before hard-limit chips fire.
 */
export function usageBarClass(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "bg-success";
  const p = Math.max(0, Math.min(100, pct));
  if (p >= 95) return "bg-destructive";
  if (p >= 80) return "bg-warning";
  if (p >= 60) return "bg-warning/80";
  return "bg-success";
}

/** Optional track ring tint when usage is elevated. */
export function usageTrackClass(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "bg-black/30";
  if (pct >= 95) return "bg-destructive/20";
  if (pct >= 80) return "bg-warning/20";
  if (pct >= 60) return "bg-warning/15";
  return "bg-black/30";
}
