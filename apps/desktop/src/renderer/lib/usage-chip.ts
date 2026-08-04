/**
 * Pure Home usage chip visibility from SuperGrok snapshot (Phase 6 extract).
 */

export type UsageSnapLike = {
  rawAvailable?: boolean | null;
  creditUsagePercent?: number | null;
  warnLevel?: string | null;
} | null;

export type UsageChipModel = {
  pct: number;
  level: "soft" | "hard";
};

/**
 * When elevated usage should surface on Home; null when hidden.
 */
export function usageChipFromSnapshot(
  snap: UsageSnapLike,
): UsageChipModel | null {
  if (!snap?.rawAvailable) return null;
  if (snap.creditUsagePercent == null) return null;
  if (snap.warnLevel !== "soft" && snap.warnLevel !== "hard") return null;
  return {
    pct: Math.round(snap.creditUsagePercent),
    level: snap.warnLevel,
  };
}
