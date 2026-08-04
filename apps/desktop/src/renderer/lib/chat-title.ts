/**
 * Pure chat rename / delete selection helpers + scan titles (Task 15).
 */

/** Default max length for list/scan titles (not full goal dump). */
export const SCAN_TITLE_MAX = 48;

/**
 * Trimmed non-empty title for setTitle, or null when empty.
 */
export function cleanChatTitle(title: string): string | null {
  const clean = title.trim();
  return clean ? clean : null;
}

/**
 * True when the open selection belongs to the chat being deleted.
 */
export function chatContainsSelectedTurn(
  turns: Array<{ id: string }> | undefined,
  selectedId: string | null | undefined,
): boolean {
  if (!selectedId || !turns) return false;
  return turns.some((t) => t.id === selectedId);
}

/**
 * Normalize a goal into a short first-line scan title.
 * Prefers sentence boundary when short; caps length for list scanning.
 * Keeps non-Latin / emoji characters (no ASCII-only stripping).
 */
export function normalizeGoalScanTitle(
  goal: string,
  maxLen: number = SCAN_TITLE_MAX,
): string {
  if (!goal.trim()) return "";
  // First line only when multi-line goals are pasted (before collapsing newlines).
  const firstLineRaw = goal.split(/\r?\n/)[0] ?? goal;
  const firstLine = firstLineRaw.replace(/\s+/g, " ").trim();
  if (!firstLine) return "";
  const firstSentence =
    firstLine.split(/(?<=[.!?…])\s/u)[0]?.trim() ?? firstLine;
  const base =
    firstSentence.length > 0 && firstSentence.length <= maxLen
      ? firstSentence
      : firstLine;
  if (base.length <= maxLen) return base;
  // Cap without mid-surrogate splits for common BMP; slice is fine for scan.
  const cut = base.slice(0, Math.max(1, maxLen - 1)).trimEnd();
  return `${cut}…`;
}

/**
 * Prefer generated short title; else normalized goal scan line.
 */
export function preferredChatScanTitle(input: {
  title?: string | null;
  goal: string;
  maxLen?: number;
}): string {
  const maxLen = input.maxLen ?? SCAN_TITLE_MAX;
  const stored = input.title?.trim();
  if (stored) {
    return stored.length <= maxLen
      ? stored
      : `${stored.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
  }
  return normalizeGoalScanTitle(input.goal, maxLen);
}

export type ScanTitleItem = {
  id: string;
  scanTitle: string;
  /** Optional workspace folder name for collision suffix. */
  workspaceName?: string | null;
  /** ISO date for collision suffix when workspace missing. */
  updatedAt?: string | null;
};

/**
 * When multiple rows share the same scan title, append a small distinguishing
 * suffix (workspace name or date) rather than identical labels.
 */
export function disambiguateScanTitles(
  items: readonly ScanTitleItem[],
): Map<string, string> {
  const byTitle = new Map<string, ScanTitleItem[]>();
  for (const item of items) {
    const key = item.scanTitle.trim().toLowerCase() || "\0empty";
    const arr = byTitle.get(key);
    if (arr) arr.push(item);
    else byTitle.set(key, [item]);
  }
  const out = new Map<string, string>();
  for (const group of byTitle.values()) {
    if (group.length === 1) {
      const only = group[0]!;
      out.set(only.id, only.scanTitle || "…");
      continue;
    }
    for (const item of group) {
      const suffix =
        workspaceSuffix(item.workspaceName) ||
        dateSuffix(item.updatedAt) ||
        item.id.slice(0, 6);
      const base = item.scanTitle || "…";
      out.set(item.id, `${base} · ${suffix}`);
    }
  }
  return out;
}

function workspaceSuffix(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const parts = name.trim().split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last && last.length <= 24 ? last : last?.slice(0, 23) ?? null;
}

function dateSuffix(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return null;
  // YYYY-MM-DD for stable scan
  return new Date(d).toISOString().slice(0, 10);
}
