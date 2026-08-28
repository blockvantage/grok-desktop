/**
 * ACP ScheduledTask{Created,Fired,Deleted} (Phase 3.5).
 * Engine-created schedules reconcile into Desk's scheduler of record.
 */

import { intervalToCron } from "./loop-schedule.js";

export const SCHEDULED_TASK_ACTIONS = [
  "created",
  "fired",
  "deleted",
  "other",
] as const;
export type ScheduledTaskAction = (typeof SCHEDULED_TASK_ACTIONS)[number];

export type ScheduledTaskView = {
  engineId: string;
  prompt: string;
  interval: string | null;
  cron: string | null;
  action: ScheduledTaskAction;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

export function scheduledTaskActionFromToken(token: string): ScheduledTaskAction {
  const t = token.toLowerCase().replace(/-/g, "_");
  if (t.includes("created") || t.includes("create")) return "created";
  if (t.includes("deleted") || t.includes("delete") || t.includes("cancel")) {
    return "deleted";
  }
  if (t.includes("fired") || t.includes("fire") || t.includes("tick")) {
    return "fired";
  }
  return "other";
}

export function decodeScheduledTaskEvent(raw: unknown): ScheduledTaskView | null {
  const p = rec(raw);
  if (!p) return null;
  const inner = rec(p.payload) ?? rec(p.task) ?? p;
  const blob = [
    p.sessionUpdate,
    p.type,
    p.kind,
    inner.sessionUpdate,
    inner.type,
    p.title,
  ]
    .filter((v) => typeof v === "string")
    .join(" ");
  const looks =
    /scheduled[_\s-]?task/i.test(blob) ||
    str(inner.engineId) != null ||
    str(inner.engine_id) != null;
  if (!looks && !/scheduled/i.test(blob)) return null;
  if (!looks && !str(inner.prompt) && !str(inner.interval)) return null;
  const engineId =
    str(inner.engineId) ??
    str(inner.engine_id) ??
    str(inner.taskId) ??
    str(inner.task_id) ??
    str(inner.id);
  if (!engineId) return null;
  const prompt =
    str(inner.prompt) ??
    str(inner.goal) ??
    str(inner.goalTemplate) ??
    str(inner.description) ??
    engineId;
  const interval =
    str(inner.interval) ??
    str(inner.every) ??
    str(inner.cron);
  const cronFromInterval = interval ? intervalToCron(interval) : null;
  const cron = str(inner.cron) ?? cronFromInterval;
  return {
    engineId,
    prompt,
    interval,
    cron,
    action: scheduledTaskActionFromToken(blob),
  };
}

/** Stable Desk schedule id for an engine-created scheduled task. */
export function engineScheduleDeskId(engineId: string): string {
  const safe = engineId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 108);
  return `eng-${safe || "unknown"}`.slice(0, 128);
}
