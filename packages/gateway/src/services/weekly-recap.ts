/**
 * Weekly recap inbox tick (Phase 3.3).
 * One item per ISO week; never an empty recap.
 */
import {
  buildWeeklyRecap,
  formatWeeklyRecapBody,
  isoWeekKey,
  recapInboxTaskId,
  type RecapCompletedTask,
  type RecapInputItem,
} from "@grokdesk/shared";
import type { InboxService } from "./inbox.js";
import type { MemoryService } from "./memory.js";
import type { SettingsService } from "./settings.js";
import type { TaskService } from "./tasks.js";
import type { Db } from "../db.js";

const LAST_WEEK_KEY = "weekly_recap_last";

export function readWeeklyRecapLastWeek(db: Db): string | null {
  const row = db
    .prepare(`SELECT value_json FROM settings WHERE key = ?`)
    .get(LAST_WEEK_KEY) as { value_json: string } | undefined;
  if (!row?.value_json) return null;
  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return typeof row.value_json === "string" && row.value_json.trim()
      ? row.value_json.trim()
      : null;
  }
}

export function writeWeeklyRecapLastWeek(db: Db, weekKey: string): void {
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(LAST_WEEK_KEY, JSON.stringify(weekKey));
}

export function shouldEmitWeeklyRecap(opts: {
  enabled: boolean;
  lastWeekKey: string | null;
  weekKey: string;
  hasLines: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (!opts.hasLines) return false;
  return opts.lastWeekKey !== opts.weekKey;
}

export function emitWeeklyRecapIfDue(opts: {
  db: Db;
  inbox: InboxService;
  memory: MemoryService;
  tasks: TaskService;
  settings: SettingsService;
  now?: Date;
}): { emitted: boolean; weekKey: string } {
  const now = opts.now ?? new Date();
  const weekKey = isoWeekKey(now);
  const enabled = opts.settings.getAll().weeklyRecapEnabled !== false;
  const lastWeekKey = readWeeklyRecapLastWeek(opts.db);
  const memoryItems: RecapInputItem[] = opts.memory.list().map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    updatedAt: item.updatedAt,
    kind: item.kind,
  }));
  const completedTaskSummaries: RecapCompletedTask[] = opts.tasks
    .list()
    .filter((t) => t.status === "done" && t.completedAt)
    .map((t) => ({
      id: t.id,
      goal: t.goal,
      doneAt: t.completedAt as string,
    }));
  const recap = buildWeeklyRecap({
    memoryItems,
    completedTaskSummaries,
    now,
  });
  if (
    !shouldEmitWeeklyRecap({
      enabled,
      lastWeekKey,
      weekKey,
      hasLines: Boolean(recap?.lines.length),
    }) ||
    !recap
  ) {
    return { emitted: false, weekKey };
  }
  const item = opts.inbox.addDeduped({
    kind: "recap",
    title: recap.title,
    body: formatWeeklyRecapBody(recap),
    taskId: recapInboxTaskId(weekKey),
  });
  writeWeeklyRecapLastWeek(opts.db, weekKey);
  return { emitted: item != null, weekKey };
}
