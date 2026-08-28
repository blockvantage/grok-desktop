/**
 * Weekly recap builder (Phase 3.3). Locale-free: UI adds copy.
 * Never invents content — only titles/goals already in Desk's store.
 */

export type RecapInputItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  kind: string;
};

export type RecapCompletedTask = {
  id: string;
  goal: string;
  doneAt: string;
};

export type WeeklyRecapLine = {
  text: string;
  suggestedMemory: string | null;
  sourceId: string;
};

export type WeeklyRecap = {
  title: string;
  lines: WeeklyRecapLine[];
  weekStartIso: string;
  weekEndIso: string;
  weekKey: string;
};

const DAY_MS = 24 * 3600_000;
const DEFAULT_MAX_LINES = 8;

/** ISO week key YYYY-Www (UTC date). */
export function isoWeekKey(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function recapWindow(now: Date): { start: Date; end: Date } {
  const end = now;
  const start = new Date(now.getTime() - 7 * DAY_MS);
  return { start, end };
}

function inWindow(iso: string, start: Date, end: Date): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function oneLine(text: string, max = 160): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Trailing 7 days of completed tasks + memory touched in that window.
 * Returns null when nothing happened (no empty inbox spam).
 */
export function buildWeeklyRecap(opts: {
  memoryItems: RecapInputItem[];
  completedTaskSummaries: RecapCompletedTask[];
  now: Date;
  maxLines?: number;
}): WeeklyRecap | null {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const { start, end } = recapWindow(opts.now);
  const lines: WeeklyRecapLine[] = [];
  const seen = new Set<string>();

  for (const task of opts.completedTaskSummaries) {
    if (!inWindow(task.doneAt, start, end)) continue;
    const text = oneLine(task.goal);
    if (!text || seen.has(task.id)) continue;
    seen.add(task.id);
    lines.push({
      text,
      suggestedMemory: text,
      sourceId: `task:${task.id}`,
    });
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines) {
    for (const item of opts.memoryItems) {
      if (!inWindow(item.updatedAt, start, end)) continue;
      if (seen.has(item.id)) continue;
      const text = oneLine(item.title || item.content);
      if (!text) continue;
      seen.add(item.id);
      lines.push({
        text,
        suggestedMemory: oneLine(
          [item.title, item.content].filter(Boolean).join(" — "),
          400,
        ),
        sourceId: `memory:${item.id}`,
      });
      if (lines.length >= maxLines) break;
    }
  }

  if (lines.length === 0) return null;
  return {
    title: "Learn from this week",
    lines,
    weekStartIso: start.toISOString(),
    weekEndIso: end.toISOString(),
    weekKey: isoWeekKey(opts.now),
  };
}

/** Human inbox body: one recap line per row, no JSON. */
export function formatWeeklyRecapBody(recap: WeeklyRecap): string {
  return recap.lines.map((line) => line.text).join("\n");
}

export function parseWeeklyRecapLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

export function recapInboxTaskId(weekKey: string): string {
  return `recap:${weekKey}`;
}
